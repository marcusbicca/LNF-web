// ─────────────────────────────────────────────────────────────────────────────
// Solicitações remotas — pedir a um Coreon que execute algo, daqui.
//
// COMO FUNCIONA, DE PONTA A PONTA
//
//   1. Inserimos uma linha em 'solicitacoes' com destinatario NULO.
//   2. O gatilho do banco empurra app_control.solicitacoes_ate para now()+10min.
//   3. Todo Coreon que já esteja acordado lê essa marca no ciclo normal dele,
//      vê a janela aberta e passa a consultar 1x/min. O primeiro a reservar
//      leva — a função pegar_solicitacao() usa 'for update skip locked', então
//      duas máquinas nunca pegam a mesma linha.
//   4. Ele executa e grava status/resultado/erro na própria linha.
//   5. Aqui a gente só relê a linha até status sair de 'pendente'/'executando'.
//
// O QUE ISSO IMPLICA PRA TELA, E NÃO É ÓBVIO:
//
//   • Só máquinas ACORDADAS respondem. Um Coreon aberto mas cujo operador não
//     mexe em nada há horas não está em modo rápido — ele só descobre a janela
//     no próximo ciclo, que acontece quando alguém age. Solicitação sem
//     resposta não é erro; pode ser que ninguém esteja disponível.
//
//   • A leitura é pela VIEW 'solicitacoes_painel', não pela tabela. A tabela
//     não tem SELECT liberado justamente para que a senha do SAP não saia por
//     ali; a view expõe tudo menos ela, mais um booleano 'tem_senha'.
//
//   • Encadear passos exige endereçar. A sessão vive na MEMÓRIA da máquina que
//     atendeu, então o 2º passo tem que ir com destinatario = executor do 1º.
//     Sem isso, outra máquina pode pegar e não terá o estado.
// ─────────────────────────────────────────────────────────────────────────────

import { SupabaseService } from './supabase'

export const TABELA_ESCRITA = 'solicitacoes'
export const VIEW_LEITURA = 'solicitacoes_painel'

export type StatusSolicitacao =
  | 'pendente'
  | 'executando'
  | 'concluida'
  | 'erro'
  | 'expirada'

export interface Solicitacao {
  id: number
  criado_em: string
  criado_por: string | null
  destinatario: string | null
  acao: string
  payload: unknown
  sessao_id: string | null
  sap_usuario: string | null
  tem_senha: boolean
  status: StatusSolicitacao
  executor: string | null
  maquina: string | null
  iniciado_em: string | null
  terminado_em: string | null
  resultado: unknown
  erro: string | null
  updated_at: string
}

export interface NovaSolicitacao {
  acao: string
  payload?: Record<string, unknown>
  sessaoId?: string
  destinatario?: string
  sapUsuario?: string
  sapSenha?: string
}

/** Terminou (para o bem ou para o mal) — nada mais vai mudar sozinho. */
export function encerrada(s: Pick<Solicitacao, 'status'>): boolean {
  return s.status === 'concluida' || s.status === 'erro' || s.status === 'expirada'
}

type Row = Record<string, unknown>

function toSolicitacao(r: Row): Solicitacao {
  return {
    id: Number(r.id ?? 0),
    criado_em: String(r.criado_em ?? ''),
    criado_por: (r.criado_por as string) ?? null,
    destinatario: (r.destinatario as string) ?? null,
    acao: String(r.acao ?? ''),
    payload: r.payload ?? null,
    sessao_id: (r.sessao_id as string) ?? null,
    sap_usuario: (r.sap_usuario as string) ?? null,
    tem_senha: r.tem_senha === true,
    status: (r.status as StatusSolicitacao) ?? 'pendente',
    executor: (r.executor as string) ?? null,
    maquina: (r.maquina as string) ?? null,
    iniciado_em: (r.iniciado_em as string) ?? null,
    terminado_em: (r.terminado_em as string) ?? null,
    resultado: r.resultado ?? null,
    erro: (r.erro as string) ?? null,
    updated_at: String(r.updated_at ?? ''),
  }
}

/**
 * Id de sessão legível. Não precisa ser único no universo — só distinguir as
 * sessões vivas de um usuário, que expiram em 30 min de inatividade no Coreon.
 * Legível de propósito: ele aparece na tabela e a gente vai ler isso com o
 * olho, não com um script.
 */
export function novaSessaoId(usuario: string): string {
  const u = (usuario || 'web').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase()
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const carimbo = `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
  const sal = Math.random().toString(36).slice(2, 6)
  return `${u}-${carimbo}-${sal}`
}

export class SolicitacoesService {
  constructor(
    private svc: SupabaseService,
    private usuario: string,
  ) {}

  /**
   * Cria a solicitação e devolve a linha recém-criada.
   *
   * O insert vai por UPSERT sem onConflict (o id é bigserial, então nunca há
   * conflito) — é o caminho de escrita que o fluxo já conhece. Como o PA não
   * devolve a linha inserida, relemos pelo par sessao_id/acao mais recente.
   */
  async criar(n: NovaSolicitacao): Promise<Solicitacao> {
    const linha: Row = {
      criado_por: this.usuario || null,
      acao: n.acao,
      payload: n.payload ?? {},
      status: 'pendente',
    }
    if (n.sessaoId) linha.sessao_id = n.sessaoId
    if (n.destinatario) linha.destinatario = n.destinatario
    if (n.sapUsuario) linha.sap_usuario = n.sapUsuario
    if (n.sapSenha) linha.sap_senha = n.sapSenha

    await this.svc.salvarLinha(TABELA_ESCRITA, linha, null)

    // Reler é a única forma de saber o id: o fluxo devolve o corpo do
    // PostgREST, mas o caminho de UPSERT daqui não pede representation.
    const filtros = [
      `acao=eq.${encodeURIComponent(n.acao)}`,
      n.sessaoId ? `sessao_id=eq.${encodeURIComponent(n.sessaoId)}` : '',
    ]
      .filter(Boolean)
      .join('&')

    const rows = await this.svc.lerLinhas(VIEW_LEITURA, {
      filtros,
      order: 'id.desc',
      limit: 1,
    })
    if (!rows.length)
      throw new Error(
        `Solicitação de '${n.acao}' criada, mas a releitura em '${VIEW_LEITURA}' ` +
          `não a encontrou (filtro: ${filtros}). O insert e a leitura estão ` +
          `olhando lugares diferentes.`,
      )

    const s = toSolicitacao(rows[0])

    // Sanidade: o id tem que ser um número real, e a linha tem que ser NOVA.
    //
    // A releitura acha a mais recente que casa acao + sessao_id. Se por algum
    // motivo ela devolver uma linha antiga — sessao_id repetido, filtro que não
    // pegou —, o aguardar ficaria esperando uma solicitação que já terminou
    // ontem, ou pior, uma que nunca vai mudar de estado. Falhar aqui, com o que
    // foi encontrado, é muito melhor do que um "expirou" cinco minutos depois.
    if (!Number.isFinite(s.id) || s.id <= 0)
      throw new Error(`Releitura devolveu id inválido (${JSON.stringify(rows[0].id)}).`)

    const idadeMs = Date.now() - new Date(s.criado_em).getTime()
    if (Number.isFinite(idadeMs) && idadeMs > 60_000)
      throw new Error(
        `A releitura devolveu a solicitação #${s.id}, criada há ` +
          `${Math.round(idadeMs / 1000)}s — não é a que acabamos de inserir. ` +
          `Verifique se o insert chegou à tabela '${TABELA_ESCRITA}'.`,
      )

    return s
  }

  async porId(id: number): Promise<Solicitacao | null> {
    const rows = await this.svc.lerLinhas(VIEW_LEITURA, { filtros: `id=eq.${id}`, limit: 1 })
    return rows.length ? toSolicitacao(rows[0]) : null
  }

  async daSessao(sessaoId: string): Promise<Solicitacao[]> {
    const rows = await this.svc.lerLinhas(VIEW_LEITURA, {
      filtros: `sessao_id=eq.${encodeURIComponent(sessaoId)}`,
      order: 'id',
    })
    return rows.map(toSolicitacao)
  }

  async listar(opts: { limit?: number; offset?: number; filtros?: string } = {}): Promise<Solicitacao[]> {
    const rows = await this.svc.lerLinhas(VIEW_LEITURA, {
      order: 'id.desc',
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
      filtros: opts.filtros,
    })
    return rows.map(toSolicitacao)
  }

  /** Sessões distintas vistas nas últimas N solicitações, mais recente primeiro. */
  async sessoesRecentes(limite = 200): Promise<
    Array<{ sessaoId: string; executor: string | null; ultima: string; qtd: number }>
  > {
    const rows = await this.listar({ limit: limite })
    const mapa = new Map<string, { sessaoId: string; executor: string | null; ultima: string; qtd: number }>()
    for (const s of rows) {
      if (!s.sessao_id) continue
      const atual = mapa.get(s.sessao_id)
      if (atual) {
        atual.qtd += 1
        // As linhas vêm id.desc, então o executor da mais recente já entrou;
        // só preenchemos se ainda não sabíamos de nenhum.
        if (!atual.executor && s.executor) atual.executor = s.executor
      } else {
        mapa.set(s.sessao_id, {
          sessaoId: s.sessao_id,
          executor: s.executor,
          ultima: s.criado_em,
          qtd: 1,
        })
      }
    }
    return [...mapa.values()]
  }

  /**
   * Relê até a solicitação encerrar.
   *
   * onTick existe para a tela poder dizer "pendente há 40s" em vez de ficar
   * num spinner mudo — a espera pode ser longa e legítima (nenhuma máquina
   * acordada), e um spinner sem informação faz o usuário achar que travou.
   */
  async aguardar(
    id: number,
    opts: { timeoutMs?: number; intervaloMs?: number; onTick?: (s: Solicitacao) => void } = {},
  ): Promise<Solicitacao> {
    const timeout = opts.timeoutMs ?? 5 * 60 * 1000
    const intervalo = opts.intervaloMs ?? 4000
    const ate = Date.now() + timeout

    let vista: Solicitacao | null = null
    let primeira = true

    for (;;) {
      const s = await this.porId(id)

      // ⚠ LINHA NÃO ENCONTRADA É ERRO, NÃO "AINDA NÃO".
      //
      // Este laço já teve o defeito de tratar as duas coisas igual: porId
      // devolve null quando a consulta não casa nada, e aqui se dormia e
      // repetia calado até estourar — para então afirmar "não foi atendida a
      // tempo, continua na fila". Uma linha que acabamos de criar não pode
      // sumir, então null significa outra coisa: id errado, view apontando para
      // lugar diferente do insert, filtro que não casa. Tudo isso ficava
      // invisível atrás de um falso "expirou".
      if (!s) {
        if (primeira)
          throw new Error(
            `A solicitação #${id} não foi encontrada logo após ser criada. ` +
              `Isso não é fila cheia — é a leitura não achando a linha que o ` +
              `insert acabou de gravar. Confira se a view '${VIEW_LEITURA}' ` +
              `existe (migração 0020) e se o ramo SELECT do fluxo a alcança.`,
          )
        throw new Error(
          `A solicitação #${id} desapareceu durante a espera (estava em ` +
            `'${vista?.status ?? '?'}'). Alguém a removeu da tabela?`,
        )
      }

      primeira = false
      vista = s
      opts.onTick?.(s)
      if (encerrada(s)) return s

      // O texto só promete "continua na fila" quando a linha foi de fato vista
      // pendente. Antes ele afirmava isso em qualquer caso.
      if (Date.now() >= ate)
        throw new Error(
          `A solicitação #${id} continua em '${s.status}' após ` +
            `${Math.round(timeout / 1000)}s. ` +
            (s.status === 'pendente'
              ? 'Nenhuma máquina a pegou — só Coreons acordados entram em ' +
                'cadência rápida. Ela segue na fila; confira na aba Respostas.'
              : `${s.executor ?? 'Uma máquina'} está executando; ` +
                'acompanhe na aba Respostas.'),
        )

      await new Promise((r) => setTimeout(r, intervalo))
    }
  }
}

// ── catálogo de pipes ────────────────────────────────────────────────────────
//
// O Coreon devolve, no resultado do 'iniciar_sessao' com IncluirPipes, a lista
// de todas as ações e os campos de cada uma. É daí que a tela monta o
// formulário — nada é escrito à mão aqui, senão a lista estaria errada na
// próxima versão do Coreon.

export interface CampoPipe {
  nome: string
  /** texto | numero | booleano | data | lista<X> | mapa<X> | opcao[a,b] | objeto */
  tipo: string
  /** objeto aninhado: os campos dele */
  campos?: Record<string, unknown>
}

export interface Pipe {
  acao: string
  /** 'contrato' = tipos exatos; 'inferido' = extraído do código, é palpite */
  origem: 'contrato' | 'inferido' | 'nenhum'
  campos: CampoPipe[]
}

export interface Catalogo {
  versaoCoreon: string
  executor: string
  maquina: string
  sessaoId: string
  loginSap: string
  camposGlobais: CampoPipe[]
  pipes: Pipe[]
}

function camposDe(obj: unknown): CampoPipe[] {
  if (!obj || typeof obj !== 'object') return []
  return Object.entries(obj as Record<string, unknown>).map(([nome, v]) => {
    // Objeto aninhado chega como { tipo: 'objeto', campos: {...} }.
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      return { nome, tipo: String(o.tipo ?? 'objeto'), campos: o.campos as Record<string, unknown> }
    }
    return { nome, tipo: String(v) }
  })
}

/**
 * Extrai o catálogo do 'resultado' de uma solicitação de iniciar_sessao.
 *
 * O caminho é resultado.resposta.* porque o Coreon embrulha a resposta do pipe
 * num envelope com a duração — ver SolicitacaoRemotaService.ResultadoJson.
 */
export function lerCatalogo(resultado: unknown): Catalogo | null {
  if (!resultado || typeof resultado !== 'object') return null
  const env = resultado as Record<string, unknown>
  const r = (env.resposta ?? env) as Record<string, unknown>
  if (!r || typeof r !== 'object') return null
  if (r.Sucesso !== true) return null

  const pipesBrutas = Array.isArray(r.Pipes) ? (r.Pipes as Record<string, unknown>[]) : []

  return {
    versaoCoreon: String(r.VersaoCoreon ?? ''),
    executor: String(r.Executor ?? ''),
    maquina: String(r.Maquina ?? ''),
    sessaoId: String(r.SessaoId ?? ''),
    loginSap: String(r.LoginSap ?? ''),
    camposGlobais: camposDe(r.CamposGlobais),
    pipes: pipesBrutas
      .map((p) => ({
        acao: String(p.acao ?? ''),
        origem: (p.origem as Pipe['origem']) ?? 'nenhum',
        campos: camposDe(p.campos),
      }))
      .filter((p) => p.acao)
      .sort((a, b) => a.acao.localeCompare(b.acao)),
  }
}

/**
 * Converte o que o usuário digitou para o tipo que a pipe espera.
 *
 * Vazio vira ausente (e não string vazia): mandar "" num campo opcional faria
 * o Coreon tratá-lo como informado. Só o booleano sempre vai, porque false é
 * uma resposta e não uma ausência.
 */
export function coagir(tipo: string, bruto: string, marcado: boolean): unknown | undefined {
  const t = (tipo || '').toLowerCase()

  if (t === 'booleano') return marcado

  const v = (bruto ?? '').trim()
  if (!v) return undefined

  if (t === 'numero') {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : v
  }

  if (t.startsWith('lista<')) {
    // Uma linha por item — caminho de rede tem espaço, vírgula e ponto-e-vírgula
    // no meio, então quebrar por eles perderia arquivos.
    const itens = v
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const interno = t.slice(6, -1)
    return interno === 'numero' ? itens.map((s) => Number(s.replace(',', '.'))) : itens
  }

  if (t === 'objeto' || t.startsWith('mapa<')) {
    try {
      return JSON.parse(v)
    } catch {
      // Devolve o texto cru: o Coreon recusa com uma mensagem clara, e é melhor
      // do que a tela decidir sozinha que o JSON está errado.
      return v
    }
  }

  return v
}
