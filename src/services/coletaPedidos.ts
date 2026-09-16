// ─────────────────────────────────────────────────────────────────────────────
// Coleta de pedidos SEM a pipe do Coreon — o caminho provisório
//
// ── por que isto existe, se a pipe 'coletar_pedidos' já foi escrita ─────────
//
// Porque a pipe só existe a partir da 1.0.0.7, e a frota está na 1.0.0.6. Um
// teste que depende da atualização chegar não é um teste: é uma espera. Pior,
// se a pipe nova tiver defeito, não haveria COM O QUE COMPARAR — o erro
// apareceria como "não funciona" sem dizer se o problema é a coleta, o replay
// ou os dois.
//
// Este caminho usa só o 'read_table', que existe em TODO Coreon em campo.
// Produz exatamente as mesmas linhas em pedidos_sap, pelo mesmo desenho, e é o
// que dá uma base conhecida antes de a pipe nova ser julgada.
//
// ── o que ele NÃO substitui ────────────────────────────────────────────────
//
// O consumo. Ler de pedidos_sap durante o Executar (FontePedido = "supabase")
// é código do Coreon, e nenhuma quantidade de trabalho no navegador alcança
// isso. Este módulo ENCHE a tabela; quem a usa continua sendo a 1.0.0.7.
//
// ── fidelidade é o requisito, não o desempenho ─────────────────────────────
//
// As linhas gravadas aqui vão ser lidas pelo FontePedidoSupabaseService.Montar,
// que as entrega ao MESMO MontarBasePedidos do Executar. Então a forma tem que
// bater campo a campo com o que o Coreon gravaria — inclusive a estrutura
// derivada da KONV, que não é a tabela crua.
//
// Onde há divergência de forma, o sintoma não é erro: é um pedidosDict que
// parece certo e responde errado. É por isso que cada leitura aqui repete os
// campos, o filtro e os campos-chave do lado C#, e não uma versão "equivalente".
// ─────────────────────────────────────────────────────────────────────────────

import type { SolicitacoesService, Solicitacao } from './solicitacoes'
import { corpoDaPipe } from './envelope'
import type { SupabaseService } from './supabase'

export const TABELA = 'pedidos_sap'

/** O mesmo bloco do Executar — calibrado contra o limite da OPTIONS da RFC. */
export const BLOCO = 30

/** Teto padrão, igual ao ColetaPedidosTetoPadrao do Coreon. */
export const TETO_PADRAO = 300

type Row = Record<string, unknown>
type Linha = Record<string, string>
/** O que o read_table devolve: { chave → { campo: valor } }. */
type Dados = Record<string, Linha>

export interface Progresso {
  fase: 'listando' | 'lendo' | 'gravando' | 'pronto'
  feitos: number
  total: number
  mensagem: string
}

export interface OpcoesColeta {
  /** AAAAMMDD. Compara com EKKO.AEDAT (criação do pedido). */
  de: string
  ate: string
  sessaoId: string
  limite?: number
  destinatario?: string
  sapUsuario?: string
  sapSenha?: string
  /** Só lista os pedidos do período; não lê item nem grava nada. */
  apenasListar?: boolean
  timeoutMs?: number
  onProgresso?: (p: Progresso) => void
}

export interface ResultadoColeta {
  encontrados: number
  coletados: number
  ignorados: number
  pedidos: string[]
}

// ── EBELN com 10 posições ───────────────────────────────────────────────────
// Mesmo padding do MontarFiltroPedidos. Sem ele o SAP não acha a linha e
// devolve vazio SEM erro, que é o pior jeito de errar.
export function chave(pedido: string): string {
  const p = (pedido ?? '').trim().padStart(10, '0')
  return p.length > 10 ? p.slice(-10) : p
}

// ── o laço de leitura ───────────────────────────────────────────────────────
//
// Uma solicitação por vez, na mesma sessão. Não dá para enfileirar as quatro
// leituras de um bloco de uma vez: a resposta da EKKO é o FILTRO da KONV, e o
// navegador precisa lê-la antes de montar a próxima.
//
// O 'ultimoId' é o que distingue a resposta desta chamada da anterior — todas
// têm acao='read_table' na mesma sessão, e sem ele o aguardarNaSessao devolve
// a leitura passada na hora.
class Leitor {
  private ultimoId = 0
  private abriu = false

  constructor(
    private sol: SolicitacoesService,
    private sessaoId: string,
    private comum: Pick<OpcoesColeta, 'destinatario' | 'sapUsuario' | 'sapSenha'>,
    private timeoutMs: number,
  ) {}

  async ler(
    tabela: string,
    campos: string[],
    filtro: string[],
    camposChave: string[],
    custom = false,
  ): Promise<Dados> {
    const payload: Row = { Tabela: tabela, Campos: campos, Filtro: filtro, CamposChave: camposChave }
    if (custom) payload.Custom = true

    const extra = {
      ...(this.comum.destinatario ? { destinatario: this.comum.destinatario } : {}),
      ...(this.comum.sapUsuario ? { sapUsuario: this.comum.sapUsuario } : {}),
      ...(this.comum.sapSenha ? { sapSenha: this.comum.sapSenha } : {}),
    }

    // A abertura só no PRIMEIRO passo. Uma sessão que já existe recusaria um
    // segundo iniciar_sessao, e uma que nunca foi aberta devolve
    // SESSAO_EXPIRADA em tudo que vier depois — foi exatamente o que mordeu no
    // descrever_tabela.
    const passos = this.abriu
      ? [{ acao: 'read_table', payload, ...extra }]
      : [
          { acao: 'iniciar_sessao', payload: { IncluirPipes: false }, ...extra },
          { acao: 'read_table', payload, ...extra },
        ]

    await this.sol.criarSequencia(this.sessaoId, passos)
    this.abriu = true

    const s: Solicitacao = await this.sol.aguardarNaSessao(
      this.sessaoId,
      'read_table',
      this.ultimoId,
      { timeoutMs: this.timeoutMs },
    )
    this.ultimoId = s.id

    if (s.status !== 'concluida')
      throw new Error(`read_table ${tabela}: ${s.erro || s.status} (solicitação #${s.id})`)

    const corpo = corpoDaPipe(s.resultado)
    if (corpo.Sucesso === false)
      throw new Error(`read_table ${tabela}: ${String(corpo.Mensagem ?? corpo.Codigo ?? 'recusado')}`)

    return (corpo.Dados as Dados) ?? {}
  }
}

// ── passo 1: quais pedidos existem no período ───────────────────────────────
//
// O resto do PedidoService parte de uma lista que a NF já deu. Aqui não há NF,
// então a lista precisa ser descoberta — e é só isso que este passo faz.
//
// AEDAT e não BEDAT: "pedidos criados no período" é data de criação do
// registro. O KNUMV <> '' é o mesmo filtro do BuscarEKKO — pedido sem KNUMV não
// tem condição de preço, e é o KNUMV que a leitura da KONV usa como chave.
async function listarPedidos(
  leitor: Leitor,
  de: string,
  ate: string,
): Promise<string[]> {
  const dados = await leitor.ler(
    'EKKO',
    ['EBELN', 'AEDAT', 'KNUMV'],
    [`AEDAT >= '${de}' `, `AND AEDAT <= '${ate}' `, "AND KNUMV <> '' "],
    ['EBELN'],
  )

  const vistos = new Set<string>()
  for (const linha of Object.values(dados)) {
    const p = (linha?.EBELN ?? '').trim()
    if (p) vistos.add(p)
  }

  // Ordenado para o teto cortar sempre no mesmo lugar: duas coletas do mesmo
  // período com o mesmo teto pegam os mesmos pedidos, em vez de depender da
  // ordem em que a RFC devolveu.
  return [...vistos].sort()
}

// ── KONV: a parte que não é a tabela crua ───────────────────────────────────
//
// O que vai em pedidos_sap.konv NÃO é a KONV como o SAP a devolve: é a
// estrutura que o SapNcoService.DadosKONV deriva dela —
//
//     { "EBELN|ITEM": { KSCHL: { …campos, KWERT_NUM, Sinal, QtdLinhas } } }
//
// Chaveada por KSCHL, com uma regra de precedência entre condições
// estatísticas e efetivas. Gravar a tabela crua aqui faria o Montar entregar
// ao MontarBasePedidos algo que ele não sabe ler — e o efeito seria um preço
// silenciosamente ausente, não um erro.
//
// Por isso esta função é uma transcrição, e não uma interpretação.
function derivarKonv(
  linhas: Linha[],
  porKnumv: Map<string, string[]>,
): Record<string, Record<string, Row>> {
  const saida: Record<string, Record<string, Row>> = {}

  for (const row of linhas) {
    const knumv = (row.KNUMV ?? '').trim()
    const pedidos = porKnumv.get(knumv)
    if (!pedidos) continue

    const item = normalizarItem(row.KPOSN ?? '')

    for (const pedido of pedidos) {
      const k = `${pedido}|${item}`

      const kwert = num(row.KWERT)
      const cond: Row = {
        Pedido: pedido,
        ItemPedido: item,

        KNUMV: row.KNUMV ?? '',
        KPOSN: row.KPOSN ?? '',
        STUNR: row.STUNR ?? '',
        ZAEHK: row.ZAEHK ?? '',
        KAPPL: row.KAPPL ?? '',
        KSCHL: row.KSCHL ?? '',
        KRECH: row.KRECH ?? '',

        KAWRT: row.KAWRT ?? '',
        KBETR: row.KBETR ?? '',
        KWERT: row.KWERT ?? '',

        KAWRT_NUM: num(row.KAWRT),
        KBETR_NUM: num(row.KBETR),
        KWERT_NUM: kwert,
        KWERT_NUM_TOTAL: kwert,

        WAERS: row.WAERS ?? '',
        KPEIN: row.KPEIN ?? '',
        KMEIN: row.KMEIN ?? '',

        KNTYP: row.KNTYP ?? '',
        KSTAT: row.KSTAT ?? '',
        KINAK: row.KINAK ?? '',
        KHERK: row.KHERK ?? '',
        KGRPE: row.KGRPE ?? '',

        Sinal: kwert < 0 ? -1 : 1,
        EhNegativo: kwert < 0,
        EhPositivo: kwert > 0,
        EhZero: kwert === 0,

        EhEstatistica: (row.KSTAT ?? '').trim() !== '',
        Agregado: false,
        QtdLinhas: 1,
      }

      acumular(saida, k, cond)
    }
  }

  return saida
}

/** Transcrição do AdicionarCondicaoKonvResumo. */
function acumular(
  destino: Record<string, Record<string, Row>>,
  k: string,
  nova: Row,
): void {
  if (!destino[k]) destino[k] = {}

  const kschl = String(nova.KSCHL ?? '').trim().toUpperCase()
  if (!kschl) return

  const existente = destino[k][kschl]
  if (!existente) {
    destino[k][kschl] = nova
    return
  }

  const novaEst = nova.EhEstatistica === true
  const velhaEst = existente.EhEstatistica === true
  const kwertNovo = Number(nova.KWERT_NUM ?? 0)

  // Estatística cede lugar à efetiva, mas o total acumulado sobrevive à troca.
  if (velhaEst && !novaEst) {
    nova.SubstituiuEstatistica = true
    nova.QtdLinhas = Number(existente.QtdLinhas ?? 0) + 1
    nova.KWERT_NUM_TOTAL = Number(existente.KWERT_NUM_TOTAL ?? 0) + kwertNovo
    destino[k][kschl] = nova
    return
  }

  if (!velhaEst && novaEst) {
    existente.IgnorouEstatistica = true
    existente.QtdLinhas = Number(existente.QtdLinhas ?? 0) + 1
    existente.KWERT_NUM_TOTAL = Number(existente.KWERT_NUM_TOTAL ?? 0) + kwertNovo
    return
  }

  if (velhaEst && novaEst) {
    existente.QtdLinhas = Number(existente.QtdLinhas ?? 0) + 1
    existente.KWERT_NUM_TOTAL = Number(existente.KWERT_NUM_TOTAL ?? 0) + kwertNovo
    return
  }

  // Ambas efetivas: soma.
  const total = Number(existente.KWERT_NUM ?? 0) + kwertNovo
  existente.KWERT_NUM = total
  existente.KWERT = String(total)
  existente.KWERT_NUM_TOTAL = Number(existente.KWERT_NUM_TOTAL ?? 0) + kwertNovo
  existente.Sinal = total < 0 ? -1 : 1
  existente.EhNegativo = total < 0
  existente.EhPositivo = total > 0
  existente.EhZero = total === 0
  existente.Agregado = true
  existente.QtdLinhas = Number(existente.QtdLinhas ?? 0) + 1
}

function normalizarItem(kposn: string): string {
  const s = (kposn ?? '').trim()
  if (!s) return '00000'
  return s.length >= 5 ? s.slice(-5) : s.padStart(5, '0')
}

/** SAP manda decimal com ponto; vazio é zero, e lixo também — não lança. */
function num(v: string | undefined): number {
  const n = Number(String(v ?? '').trim().replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

// ── recorte por pedido ──────────────────────────────────────────────────────
//
// As chaves do SAP são "EBELN" ou "EBELN|EBELP". O recorte é por PREFIXO, e o
// separador entra na comparação de propósito: sem ele, o pedido 4500001
// levaria junto as linhas do 45000010.
function recortar<T>(fonte: Record<string, T>, pedido: string): Record<string, T> {
  const o: Record<string, T> = {}
  for (const [k, v] of Object.entries(fonte ?? {}))
    if (k === pedido || k.startsWith(pedido + '|')) o[k] = v
  return o
}

// ── a coleta ────────────────────────────────────────────────────────────────

export async function coletar(
  sol: SolicitacoesService,
  svc: SupabaseService,
  usuario: string,
  opts: OpcoesColeta,
): Promise<ResultadoColeta> {
  const de = so(opts.de)
  const ate = so(opts.ate)
  if (de.length !== 8 || ate.length !== 8)
    throw new Error("Informe 'de' e 'ate' no formato AAAAMMDD.")
  if (de > ate) throw new Error('O início do período é depois do fim.')

  const teto = opts.limite && opts.limite > 0 ? opts.limite : TETO_PADRAO
  const avisar = opts.onProgresso ?? (() => {})

  const leitor = new Leitor(
    sol,
    opts.sessaoId,
    { destinatario: opts.destinatario, sapUsuario: opts.sapUsuario, sapSenha: opts.sapSenha },
    opts.timeoutMs ?? 5 * 60 * 1000,
  )

  avisar({ fase: 'listando', feitos: 0, total: 0, mensagem: `Procurando pedidos de ${de} a ${ate}…` })

  const todos = await listarPedidos(leitor, de, ate)
  const encontrados = todos.length
  const pedidos = encontrados > teto ? todos.slice(0, teto) : todos
  const ignorados = encontrados - pedidos.length

  if (encontrados === 0 || opts.apenasListar)
    return { encontrados, coletados: 0, ignorados, pedidos }

  const agora = new Date().toISOString()
  let coletados = 0

  for (let i = 0; i < pedidos.length; i += BLOCO) {
    const fatia = pedidos.slice(i, i + BLOCO).map(chave)

    avisar({
      fase: 'lendo',
      feitos: i,
      total: pedidos.length,
      mensagem: `Lendo itens ${i + 1}–${Math.min(i + BLOCO, pedidos.length)} de ${pedidos.length}…`,
    })

    const filtro = filtroPedidos(fatia)

    const ekpo = await leitor.ler(
      'EKPO',
      ['WERKS', 'EBELN', 'EBELP', 'LGORT', 'MATNR', 'TXZ01', 'MENGE', 'MEINS', 'BRTWR', 'PEINH', 'ELIKZ', 'LOEKZ'],
      [...filtro, "AND LOEKZ = ''"],
      ['EBELN', 'EBELP'],
    )

    const eket = await leitor.ler(
      'EKET',
      ['EBELN', 'EBELP', 'WEMNG', 'EINDT'],
      filtro,
      ['EBELN', 'EBELP'],
    )

    const ekko = await leitor.ler(
      'EKKO',
      ['EBELN', 'KNUMV', 'EKGRP', 'PROCSTAT'],
      [...filtro, "AND KNUMV <>''"],
      ['EBELN'],
    )

    // KNUMV → pedidos. Um mesmo KNUMV pode servir a mais de um pedido, e a
    // condição lida uma vez vale para todos eles.
    const porKnumv = new Map<string, string[]>()
    for (const linha of Object.values(ekko)) {
      const ebeln = (linha?.EBELN ?? '').trim()
      const knumv = (linha?.KNUMV ?? '').trim()
      if (!ebeln || !knumv) continue
      const lista = porKnumv.get(knumv) ?? []
      if (!lista.includes(ebeln)) lista.push(ebeln)
      porKnumv.set(knumv, lista)
    }

    let konv: Record<string, Record<string, Row>> = {}
    if (porKnumv.size > 0) {
      // Custom: a KONV é lida pela Z_CUSTOM_READ_TABLE_ONE no Coreon, e não
      // pela BBP — a BBP trunca o WA e a KONV tem campos demais.
      const cru = await leitor.ler(
        'KONV',
        ['KNUMV', 'KPOSN', 'STUNR', 'ZAEHK', 'KAPPL', 'KSCHL', 'KRECH', 'KAWRT',
         'KBETR', 'WAERS', 'KPEIN', 'KMEIN', 'KNTYP', 'KSTAT', 'KINAK', 'KHERK',
         'KGRPE', 'KWERT'],
        filtroKnumv([...porKnumv.keys()]),
        // A PK da KONV. Chave menor colapsaria condições distintas do mesmo
        // item — e o que se perde numa colisão é justamente um preço.
        ['KNUMV', 'KPOSN', 'STUNR', 'ZAEHK'],
        true,
      )
      konv = derivarKonv(Object.values(cru), porKnumv)
    }

    const lote: Row[] = fatia.map((ped) => ({
      pedido: ped,
      ekpo: recortar(ekpo, ped),
      eket: recortar(eket, ped),
      ekko: recortar(ekko, ped),
      konv: recortar(konv, ped),
      coletado_em: agora,
      coletado_por: usuario || null,
    }))

    avisar({
      fase: 'gravando',
      feitos: i,
      total: pedidos.length,
      mensagem: `Gravando ${lote.length} pedido(s)…`,
    })

    // Uma escrita por BLOCO, não uma por pedido: cada escrita é uma ida à Edge
    // Function, e 300 idas fariam a rede dominar o custo do trabalho de
    // verdade, que é ler o SAP.
    await svc.upsertBruto(TABELA, lote, 'pedido')
    coletados += lote.length
  }

  avisar({
    fase: 'pronto',
    feitos: coletados,
    total: pedidos.length,
    mensagem: `${coletados} pedido(s) coletado(s).`,
  })

  return { encontrados, coletados, ignorados, pedidos }
}

/** Transcrição do MontarFiltroPedidos — uma condição por linha (CHAR72). */
function filtroPedidos(chaves: string[]): string[] {
  if (!chaves.length) return []
  const f = chaves.map((p, i) => (i === 0 ? `( EBELN = '${p}'` : `OR EBELN = '${p}'`))
  f.push(' )')
  return f
}

function filtroKnumv(knumvs: string[]): string[] {
  const f = knumvs.map((k, i) => (i === 0 ? `( KNUMV = '${k}'` : `OR KNUMV = '${k}'`))
  f.push(' )')
  return f
}

const so = (s: string) => (s ?? '').replace(/\D/g, '')
