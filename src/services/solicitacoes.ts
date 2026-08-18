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
  /** Vale para TODOS os usuários e fica em pé até ser encerrada. */
  universal?: boolean
}

/** Progresso de uma solicitação universal (view solicitacoes_universais). */
export interface Universal {
  id: number
  criado_em: string
  criado_por: string | null
  acao: string
  payload: unknown
  status: StatusSolicitacao
  usuarios: number
  concluidas: number
  com_erro: number
  faltam: string[]
}

/**
 * Terminou (para o bem ou para o mal) — nada mais vai mudar sozinho.
 *
 * 'aberta' NÃO entra: é o estado de uma universal circulando, e ela só termina
 * quando alguém a encerra. Esperar por uma universal na tela seria esperar por
 * uma decisão humana.
 */
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
   * Cria a solicitação. NÃO tenta descobrir o id dela.
   *
   * POR QUE NÃO. A versão anterior relia a tabela logo após o insert para
   * aprender o id, e depois esperava por esse id. Dois passos frágeis onde
   * bastava zero: o fluxo do PA não devolve a linha inserida, então o id era um
   * palpite baseado em "a mais recente que casa acao + sessao_id" — e a espera
   * inteira dependia dele estar certo.
   *
   * O cliente JÁ tem um identificador que controla: o sessao_id, que ele mesmo
   * gera. Esperar por (sessao_id, acao) não precisa aprender nada do servidor,
   * então não há o que sair errado no caminho de volta.
   *
   * Por isso 'criar' virou fogo-e-esquece, e quem quer o resultado usa
   * 'criarEAguardar'.
   */
  async criar(n: NovaSolicitacao): Promise<void> {
    // Universal não tem sessão: ela roda em TODAS as máquinas, e sessão é
    // estado que sobrevive entre passos numa só. O banco recusa a combinação
    // (constraint), então recusar aqui dá um erro melhor.
    if (n.universal && n.sessaoId)
      throw new Error('Solicitação universal não pode ter sessão — ela roda em todas as máquinas.')
    if (!n.universal && !n.sessaoId)
      throw new Error('Toda solicitação precisa de sessaoId — é por ele que a resposta é encontrada.')

    const linha: Row = {
      criado_por: this.usuario || null,
      acao: n.acao,
      payload: n.payload ?? {},
      // 'aberta' é o estado de quem circula; 'pendente' é o de quem tem um dono.
      status: n.universal ? 'aberta' : 'pendente',
    }
    if (n.universal) linha.universal = true
    if (n.sessaoId) linha.sessao_id = n.sessaoId
    if (n.destinatario) linha.destinatario = n.destinatario
    if (n.sapUsuario) linha.sap_usuario = n.sapUsuario
    if (n.sapSenha) linha.sap_senha = n.sapSenha

    await this.svc.salvarLinha(TABELA_ESCRITA, linha, null)
  }

  /**
   * Cria e espera a resposta, identificando a linha por (sessao_id, acao).
   *
   * A busca é sempre pela MAIS RECENTE que casa o par: reenviar a mesma ação na
   * mesma sessão é normal (tentar de novo depois de um erro), e nesse caso quem
   * interessa é a última.
   */
  async criarEAguardar(
    n: NovaSolicitacao,
    opts: { timeoutMs?: number; intervaloMs?: number; onTick?: (s: Solicitacao | null) => void } = {},
  ): Promise<Solicitacao> {
    const antes = await this.ultimaDaSessao(n.sessaoId!, n.acao)
    const idAntes = antes?.id ?? 0

    await this.criar(n)

    return this.aguardarNaSessao(n.sessaoId!, n.acao, idAntes, opts)
  }

  /**
   * Espera a resposta de (sessao_id, acao) cujo id seja maior que idAntes.
   *
   * Separado do criarEAguardar de propósito: assim a espera pode ser RETOMADA
   * por quem não fez o insert — a tela guarda (sessaoId, acao, idAntes) e volta
   * a esperar depois de trocar de aba ou recarregar a página.
   *
   * Sem isso a espera morria com o componente: trocar para a aba Respostas
   * desmonta a de Solicitações, a promessa continua rodando e os setState dela
   * caem no vazio. O resultado chegava e se perdia.
   */
  async aguardarNaSessao(
    sessaoId: string,
    acao: string,
    idAntes: number,
    opts: { timeoutMs?: number; intervaloMs?: number; onTick?: (s: Solicitacao | null) => void } = {},
  ): Promise<Solicitacao> {
    const timeout = opts.timeoutMs ?? 5 * 60 * 1000
    const intervalo = opts.intervaloMs ?? 4000
    const ate = Date.now() + timeout

    for (;;) {
      // id > idAntes garante que estamos olhando a linha NOVA, e não uma
      // execução anterior da mesma ação nesta sessão.
      const s = await this.ultimaDaSessao(sessaoId, acao)
      const nova = s && s.id > idAntes ? s : null

      opts.onTick?.(nova)
      if (nova && encerrada(nova)) return nova

      if (Date.now() >= ate) {
        if (!nova)
          throw new Error(
            `A solicitação de '${acao}' não apareceu na sessão ${sessaoId} ` +
              `em ${Math.round(timeout / 1000)}s. O insert não chegou à tabela ` +
              `'${TABELA_ESCRITA}', ou a leitura em '${VIEW_LEITURA}' não a alcança.`,
          )
        throw new Error(
          `A solicitação #${nova.id} continua em '${nova.status}' após ` +
            `${Math.round(timeout / 1000)}s. ` +
            (nova.status === 'pendente'
              ? 'Nenhuma máquina a pegou — só Coreons acordados entram em ' +
                'cadência rápida. Ela segue na fila; confira na aba Respostas.'
              : `${nova.executor ?? 'Uma máquina'} está executando; ` +
                'acompanhe na aba Respostas.'),
        )
      }

      await new Promise((r) => setTimeout(r, intervalo))
    }
  }

  /**
   * Enfileira VÁRIAS solicitações na mesma sessão, de uma vez.
   *
   * Não espera entre elas, e não precisa: o banco só libera a segunda quando a
   * primeira CONCLUIR, e só para a máquina que pegou a primeira (0021). Falhou
   * uma, as seguintes nunca são reservadas — corrija e reenvie só ela, que a
   * fila volta a andar.
   *
   * A ordem é a do array. O banco ordena por id, e um insert único gera ids
   * crescentes na ordem das linhas.
   */
  async criarSequencia(
    sessaoId: string,
    passos: Array<Omit<NovaSolicitacao, 'sessaoId' | 'universal'>>,
  ): Promise<void> {
    if (!passos.length) return

    const linhas: Row[] = passos.map((p) => {
      const l: Row = {
        criado_por: this.usuario || null,
        acao: p.acao,
        payload: p.payload ?? {},
        sessao_id: sessaoId,
        status: 'pendente',
      }
      if (p.destinatario) l.destinatario = p.destinatario
      if (p.sapUsuario) l.sap_usuario = p.sapUsuario
      if (p.sapSenha) l.sap_senha = p.sapSenha
      return l
    })

    // Um único UPSERT: as linhas entram na mesma instrução, então os ids saem
    // na ordem do array. Mandar uma por vez abriria a chance de outra máquina
    // pegar a primeira antes de a segunda existir — e aí a sequência começaria
    // sem estar inteira.
    await this.svc.upsertBruto(TABELA_ESCRITA, linhas, null)
  }

  // ── universais ─────────────────────────────────────────────────────────────

  async listarUniversais(apenasAbertas = false): Promise<Universal[]> {
    const rows = await this.svc.lerLinhas('solicitacoes_universais', {
      order: 'id.desc',
      filtros: apenasAbertas ? 'status=eq.aberta' : undefined,
      limit: 50,
    })
    return rows.map((r) => ({
      id: Number(r.id ?? 0),
      criado_em: String(r.criado_em ?? ''),
      criado_por: (r.criado_por as string) ?? null,
      acao: String(r.acao ?? ''),
      payload: r.payload ?? null,
      status: (r.status as StatusSolicitacao) ?? 'aberta',
      usuarios: Number(r.usuarios ?? 0),
      concluidas: Number(r.concluidas ?? 0),
      com_erro: Number(r.com_erro ?? 0),
      faltam: Array.isArray(r.faltam) ? (r.faltam as string[]) : [],
    }))
  }

  /** O "seu comando": tira a universal de circulação. */
  async encerrarUniversal(id: number): Promise<void> {
    await this.svc.rpc('encerrar_universal', { p_id: id })
  }

  /** A mais recente de uma ação dentro de uma sessão, ou null. */
  async ultimaDaSessao(sessaoId: string, acao: string): Promise<Solicitacao | null> {
    const rows = await this.svc.lerLinhas(VIEW_LEITURA, {
      filtros: `sessao_id=eq.${encodeURIComponent(sessaoId)}&acao=eq.${encodeURIComponent(acao)}`,
      order: 'id.desc',
      limit: 1,
    })
    return rows.length ? toSolicitacao(rows[0]) : null
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
