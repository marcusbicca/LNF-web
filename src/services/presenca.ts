// ─────────────────────────────────────────────────────────────────────────────
// Presença e atividade — quem está usando a ferramenta, e quanto
//
// ── por que NADA disto é gravado ────────────────────────────────────────────
//
// A ideia inicial era carimbar 'visto_em' e 'ultima_acao' na tabela usuarios,
// a cada chamada, pela Edge Function. Seria uma escrita por leitura do parque
// inteiro — e, pior, poria em usuarios um dado que ninguém deve poder editar
// por lá. Presença não se declara; se observa.
//
// O historico já é o registro, e é imutável por natureza: 8 mil linhas, 23
// usuários, 17 ações, desde julho. Tudo que este relatório mostra é uma conta
// sobre ele. Zero escrita, zero coluna nova, zero risco de alguém "corrigir" a
// própria presença.
//
// ── o que este número NÃO é ─────────────────────────────────────────────────
//
// 'visto em' aqui é a última AÇÃO, não o último acesso. Quem abre o Coreon,
// deixa sincronizando e não executa nada não aparece — para o historico, ele
// não fez nada, porque de fato não fez.
//
// A diferença importa em um caso só: máquina ligada e ociosa. Para "quem está
// usando a ferramenta", que é a pergunta de verdade, a ação é a medida certa —
// e é a única que não custa uma escrita por poll.
//
// ── e por que os usuários SEM histórico aparecem ────────────────────────────
//
// São 42 cadastrados e 23 com histórico. Os 19 restantes são a informação mais
// acionável da tela: cadastro que nunca foi usado. Um relatório montado só a
// partir do historico não os enxergaria — por isso a lista de usuarios entra,
// e quem não tem ação nenhuma aparece com zero em vez de sumir.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseService } from './supabase'

export interface AtividadeUsuario {
  username: string
  nome: string
  nivelAdm: number
  /** Última ação registrada. null = nunca usou. */
  vistoEm: string | null
  ultimaAcao: string | null
  primeiraEm: string | null
  total: number
  /** Ações nos últimos 7 e 30 dias — é o que separa "ativo" de "já foi". */
  em7: number
  em30: number
  falhas: number
  /** Quantas vezes cada ação, da mais usada para a menos. */
  porAcao: Array<{ acao: string; n: number }>
}

// Uma página por ida. O PostgREST corta em 1000 por padrão, então pedir 5000
// devolveria 1000 em silêncio — e um relatório que perde 80% das linhas sem
// avisar é pior que um relatório que não carrega.
const PAGINA = 1000

// Teto de páginas. O historico cresce para sempre e esta tela varre tudo; sem
// um teto, o dia em que ele passar de algumas dezenas de milhares de linhas a
// tela trava o navegador de quem abriu, sem aviso. Estourando, o relatório diz
// que está incompleto em vez de mentir.
const MAX_PAGINAS = 60

export interface Atividade {
  usuarios: AtividadeUsuario[]
  /** Linhas de histórico lidas. */
  linhas: number
  /** O teto de páginas foi atingido: os números são um piso. */
  truncado: boolean
}

interface Linha {
  usuario: string
  acao: string
  quando: string
  sucesso: boolean
}

function diasAtras(n: number): number {
  return Date.now() - n * 24 * 60 * 60 * 1000
}

export async function carregarAtividade(svc: SupabaseService): Promise<Atividade> {
  // ── as quatro colunas, e só elas ──────────────────────────────────────────
  //
  // O historico tem 'nfs' e 'detalhe' em jsonb, e um select=* traria as duas em
  // cada uma das milhares de linhas para produzir contagens que não dependem
  // delas. São as colunas que decidem se esta tela abre em um segundo ou em um
  // minuto.
  const brutas: Linha[] = []
  let truncado = false

  // O offset anda pelo que CHEGOU, não pelo que foi pedido. O PostgREST tem um
  // teto de linhas por resposta que não é nosso: pedir 1000 e receber 500 é
  // legítimo, e avançar de 1000 em 1000 nesse caso pularia metade do histórico
  // sem erro nenhum — o relatório sairia menor e parecendo completo.
  let off = 0

  for (let p = 0; p < MAX_PAGINAS; p++) {
    const page = await svc.lerLinhas('historico', {
      select: 'usuario,acao,data_hora_inicio,sucesso',
      // Ordem fixa para a paginação por offset ser determinística: sem ela, duas
      // páginas podem trazer a mesma linha e outra nunca aparecer.
      order: 'data_hora_inicio.asc',
      limit: PAGINA,
      offset: off,
    })

    for (const r of page) {
      const usuario = String(r.usuario ?? '').trim().toLowerCase()
      if (!usuario) continue
      brutas.push({
        usuario,
        acao: String(r.acao ?? '').trim() || '(sem ação)',
        quando: String(r.data_hora_inicio ?? ''),
        sucesso: r.sucesso !== false,
      })
    }

    // Página vazia é o fim de verdade. Uma página CURTA também costuma ser, mas
    // só quando ela veio curta por acabar o dado — e isso não se distingue de
    // um teto do servidor. Por isso o corte é na vazia: uma ida a mais no fim
    // custa pouco e não deixa linha para trás.
    if (page.length === 0) break

    off += page.length
    if (p === MAX_PAGINAS - 1) truncado = true
  }

  // ── os cadastrados entram TODOS, inclusive os de zero ─────────────────────
  const cadastrados = await svc.lerLinhas('usuarios', {
    select: 'username,nome,nivel_adm',
    order: 'username.asc',
  })

  const porUsuario = new Map<string, AtividadeUsuario>()

  const criar = (username: string, nome = '', nivelAdm = 0): AtividadeUsuario => ({
    username,
    nome,
    nivelAdm,
    vistoEm: null,
    ultimaAcao: null,
    primeiraEm: null,
    total: 0,
    em7: 0,
    em30: 0,
    falhas: 0,
    porAcao: [],
  })

  for (const r of cadastrados) {
    const u = String(r.username ?? '').trim().toLowerCase()
    if (!u) continue
    porUsuario.set(u, criar(u, String(r.nome ?? ''), Number(r.nivel_adm ?? 0)))
  }

  const contagens = new Map<string, Map<string, number>>()
  const corte7 = diasAtras(7)
  const corte30 = diasAtras(30)

  for (const l of brutas) {
    // Histórico de quem saiu do cadastro continua valendo: o trabalho foi
    // feito, e some-lo esconderia atividade real de uma pessoa que existiu.
    let a = porUsuario.get(l.usuario)
    if (!a) {
      a = criar(l.usuario)
      porUsuario.set(l.usuario, a)
    }

    a.total++
    if (!l.sucesso) a.falhas++

    const t = Date.parse(l.quando)
    if (!Number.isNaN(t)) {
      if (t >= corte7) a.em7++
      if (t >= corte30) a.em30++
    }

    // As linhas vêm em ordem crescente, então a última que passa por aqui é a
    // mais nova — e a primeira a chegar é a mais antiga.
    if (!a.primeiraEm) a.primeiraEm = l.quando
    a.vistoEm = l.quando
    a.ultimaAcao = l.acao

    let m = contagens.get(l.usuario)
    if (!m) { m = new Map(); contagens.set(l.usuario, m) }
    m.set(l.acao, (m.get(l.acao) ?? 0) + 1)
  }

  for (const [u, m] of contagens) {
    const a = porUsuario.get(u)
    if (!a) continue
    a.porAcao = [...m.entries()]
      .map(([acao, n]) => ({ acao, n }))
      .sort((x, y) => y.n - x.n || x.acao.localeCompare(y.acao))
  }

  // Mais recente primeiro; quem nunca usou vai para o fim, em ordem de nome.
  // É a ordem que responde "quem está ativo" na primeira tela, e deixa os
  // inativos agrupados no fim, que é onde eles são úteis.
  const usuarios = [...porUsuario.values()].sort((a, b) => {
    if (a.vistoEm && b.vistoEm) return a.vistoEm < b.vistoEm ? 1 : -1
    if (a.vistoEm) return -1
    if (b.vistoEm) return 1
    return a.username.localeCompare(b.username)
  })

  return { usuarios, linhas: brutas.length, truncado }
}

/** "há 3 dias", "há 2 h", "agora" — ou null para quem nunca usou. */
export function desde(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null

  const min = Math.floor((Date.now() - t) / 60000)
  if (min < 2) return 'agora'
  if (min < 60) return `há ${min} min`

  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`

  const d = Math.floor(h / 24)
  if (d < 30) return `há ${d} d`

  const m = Math.floor(d / 30)
  return m < 12 ? `há ${m} m` : `há ${Math.floor(m / 12)} a`
}
