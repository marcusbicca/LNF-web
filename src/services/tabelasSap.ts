// ─────────────────────────────────────────────────────────────────────────────
// O catálogo de tabelas do SAP — nome, para que serve, e os campos sob demanda
//
// ── o que muda em relação aos modelos ───────────────────────────────────────
//
// Nos modelos de read_table, os campos são escritos à mão por quem criou o
// modelo. Isso erra, e erra calado quando o campo existe mas significa outra
// coisa. Aqui o catálogo guarda só a TABELA; os campos chegam do dicionário de
// dados do próprio SAP, que não tem como divergir do sistema porque É o
// sistema.
//
// ── um caminho curto e um longo, e o curto se prova sozinho ─────────────────
//
// PREFERIDO: a pipe 'descrever_tabela'. Uma ida só — o Coreon lê DD03L, DD04T
// e DD02T do lado dele, onde o resultado de uma leitura vira o filtro da
// seguinte sem passar pela rede.
//
// RESERVA: dois read_table encadeados (DD03L, depois DD04T com os elementos
// que vieram). Mais lento, e funciona em todo Coreon que existe.
//
// A reserva não é pessimismo: a solicitação vai para o PRIMEIRO Coreon que
// pegar, e não dá para escolher qual. Durante a janela em que o parque está
// atualizando, a mesma ação cairia ora numa máquina nova ora numa velha — e
// sem a reserva isso apareceria como falha intermitente e inexplicável.
//
// ── como se decide, sem adivinhar pelo texto ────────────────────────────────
//
// Coreon que não conhece a ação responde pelo ErroPadrao, que devolve OUTRO
// FORMATO — o de um lançamento, com MaterialDocument e ReturnMessages, e sem
// 'Campos'. Coreon que conhece devolve 'Campos' SEMPRE, inclusive quando
// recusa (lista vazia).
//
// Então a pergunta é estrutural: veio um array 'Campos'? Sim, a máquina
// entendeu — inclusive um "não conheço esta tabela", que é resposta legítima
// e não deve cair na reserva, porque o read_table diria o mesmo. Não veio, a
// máquina é velha.
//
// Casar pela MENSAGEM seria frágil: ela passa pelo ErroPublicoService.Traduzir
// antes de sair, e o texto não é contrato.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseService } from './supabase'
import type { SolicitacoesService } from './solicitacoes'
import { corpoDaPipe } from './envelope'

export const TABELA = 'sap_tabelas'

export interface CampoSap {
  nome: string
  descricao: string
  /** Faz parte da chave primária — é o que serve de CamposChave num read_table. */
  chave: boolean
  tipo: string
  tamanho: number
  decimais: number
}

export interface TabelaSap {
  empresa: string
  tabela: string
  descricao: string
  campos: CampoSap[]
  /** null = os campos nunca foram buscados. Diferente de lista vazia. */
  camposEm: string | null
  camposPor: string | null
}

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const int = (v: unknown): number => {
  const n = Number(txt(v).trim())
  return Number.isFinite(n) ? n : 0
}

function paraTabela(r: Record<string, unknown>): TabelaSap {
  const campos = Array.isArray(r.campos) ? (r.campos as Record<string, unknown>[]) : []
  return {
    empresa: txt(r.empresa) || 'fleury',
    tabela: txt(r.tabela).toUpperCase(),
    descricao: txt(r.descricao),
    campos: campos.map((c) => ({
      nome: txt(c.nome).toUpperCase(),
      descricao: txt(c.descricao),
      chave: c.chave === true,
      tipo: txt(c.tipo),
      tamanho: int(c.tamanho),
      decimais: int(c.decimais),
    })),
    camposEm: (r.campos_em as string) ?? null,
    camposPor: (r.campos_por as string) ?? null,
  }
}

export async function listar(svc: SupabaseService, empresa: string): Promise<TabelaSap[]> {
  const rows = await svc.lerLinhas(TABELA, {
    filtros: `empresa=eq.${encodeURIComponent(empresa)}`,
    order: 'tabela',
    limit: 500,
  })
  return rows.map(paraTabela)
}

/**
 * Grava a tabela. Só as colunas presentes são tocadas — o upsert do PostgREST
 * não zera o que não vai no corpo —, então salvar a descrição não apaga os
 * campos que alguém acabou de buscar.
 */
export async function salvarTabela(
  svc: SupabaseService,
  t: { empresa: string; tabela: string; descricao: string; criadoPor?: string },
): Promise<void> {
  await svc.salvarLinha(
    TABELA,
    {
      empresa: t.empresa,
      tabela: t.tabela.trim().toUpperCase(),
      descricao: t.descricao,
      ...(t.criadoPor ? { criado_por: t.criadoPor } : {}),
    },
    'empresa,tabela',
  )
}

export async function salvarCampos(
  svc: SupabaseService,
  empresa: string,
  tabela: string,
  campos: CampoSap[],
  por: string,
): Promise<void> {
  await svc.salvarLinha(
    TABELA,
    {
      empresa,
      tabela: tabela.toUpperCase(),
      campos,
      campos_em: new Date().toISOString(),
      campos_por: por || null,
    },
    'empresa,tabela',
  )
}

export async function removerTabela(
  svc: SupabaseService,
  empresa: string,
  tabela: string,
): Promise<void> {
  await svc.deletarLinha(
    TABELA,
    `empresa=eq.${encodeURIComponent(empresa)}&tabela=eq.${encodeURIComponent(tabela)}`,
  )
}

// ── a busca dos campos, pelo Coreon ─────────────────────────────────────────

/** O 'Dados' de um read_table: { chave: { CAMPO: valor } }. */
function linhasDoReadTable(resultado: unknown): Record<string, string>[] {
  const corpo = corpoDaPipe(resultado)
  if (corpo.Sucesso === false)
    throw new Error(txt(corpo.Mensagem) || 'O Coreon recusou a leitura.')

  const dados = corpo.Dados
  if (!dados || typeof dados !== 'object') return []
  return Object.values(dados as Record<string, Record<string, string>>)
}

export interface OpcoesBusca {
  sessaoId: string
  destinatario?: string
  sapUsuario?: string
  sapSenha?: string
  onPasso?: (texto: string) => void
  timeoutMs?: number
}

/**
 * Pergunta ao primeiro Coreon disponível quais são os campos da tabela.
 *
 * Tenta a pipe 'descrever_tabela' e, se quem atendeu não a conhecer, refaz
 * pelo caminho longo. Ver a nota do topo sobre por que a decisão é
 * estrutural, e não pelo texto do erro.
 */
export async function buscarCampos(
  sol: SolicitacoesService,
  tabela: string,
  opts: OpcoesBusca,
): Promise<CampoSap[]> {
  const nome = tabela.trim().toUpperCase()
  opts.onPasso?.(`Perguntando os campos de ${nome} ao Coreon…`)

  const s = await sol.criarEAguardar(
    {
      sessaoId: opts.sessaoId,
      destinatario: opts.destinatario,
      sapUsuario: opts.sapUsuario,
      sapSenha: opts.sapSenha,
      acao: 'descrever_tabela',
      payload: { tabela: nome },
    },
    { timeoutMs: opts.timeoutMs ?? 4 * 60 * 1000 },
  )

  if (s.status === 'concluida') {
    const corpo = corpoDaPipe(s.resultado)

    if (Array.isArray(corpo.Campos)) {
      // A máquina entendeu a ação. O que ela disser vale — inclusive a recusa.
      if (corpo.Sucesso === false)
        throw new Error(txt(corpo.Mensagem) || `Não consegui os campos de ${nome}.`)

      return (corpo.Campos as Record<string, unknown>[]).map((c) => ({
        nome: txt(c.Nome).toUpperCase(),
        descricao: txt(c.Descricao),
        chave: c.Chave === true,
        tipo: txt(c.Tipo),
        tamanho: int(c.Tamanho),
        decimais: int(c.Decimais),
      }))
    }

    opts.onPasso?.('Quem atendeu ainda não tem essa ação — indo pelo caminho longo…')
  }

  return buscarCamposPorReadTable(sol, nome, opts)
}

/**
 * O caminho longo: DD03L e depois DD04T, dois read_table encadeados.
 *
 * Nenhum dos dois precisa cair na MESMA máquina — o read_table não guarda
 * estado entre chamadas, então qualquer Coreon com o SAP logado responde
 * qualquer passo. É o que permite não endereçar destinatário.
 *
 * Some no dia em que não houver mais Coreon sem 'descrever_tabela'.
 */
async function buscarCamposPorReadTable(
  sol: SolicitacoesService,
  tabela: string,
  opts: OpcoesBusca,
): Promise<CampoSap[]> {
  const nome = tabela.trim().toUpperCase()
  const timeoutMs = opts.timeoutMs ?? 4 * 60 * 1000
  const base = {
    sessaoId: opts.sessaoId,
    destinatario: opts.destinatario,
    sapUsuario: opts.sapUsuario,
    sapSenha: opts.sapSenha,
  }

  // ── 1. os campos ──────────────────────────────────────────────────────────
  opts.onPasso?.(`Lendo os campos de ${nome} (DD03L)…`)

  const r1 = await sol.criarEAguardar(
    {
      ...base,
      acao: 'read_table',
      payload: {
        Tabela: 'DD03L',
        Campos: ['TABNAME', 'FIELDNAME', 'POSITION', 'KEYFLAG',
                 'ROLLNAME', 'DATATYPE', 'LENG', 'DECIMALS'],
        Filtro: [`TABNAME = '${nome}'`],
        CamposChave: ['TABNAME', 'FIELDNAME'],
      },
    },
    { timeoutMs },
  )

  if (r1.status !== 'concluida') throw new Error(r1.erro || `A leitura terminou em '${r1.status}'.`)

  const campos: CampoSap[] = linhasDoReadTable(r1.resultado)
    // Linha começada com ponto (.INCLUDE, .APPEND) não é campo: é costura de
    // estrutura. Os campos que ela traz aparecem sozinhos na lista, e pedir um
    // ".INCLUDE" num read_table daria erro.
    .filter((l) => {
      const f = txt(l.FIELDNAME).trim()
      return f.length > 0 && f[0] !== '.'
    })
    .map((l) => ({
      nome: txt(l.FIELDNAME).trim().toUpperCase(),
      descricao: '',
      chave: txt(l.KEYFLAG).trim().toUpperCase() === 'X',
      tipo: txt(l.DATATYPE).trim(),
      tamanho: int(l.LENG),
      decimais: int(l.DECIMALS),
      _pos: int(l.POSITION),
      _el: txt(l.ROLLNAME).trim(),
    }))
    .sort((a, b) => a._pos - b._pos || a.nome.localeCompare(b.nome))
    .map(({ _pos: _p, ...c }) => c as CampoSap & { _el: string })

  if (campos.length === 0)
    throw new Error(
      `O SAP não conhece a tabela '${nome}' (ou ela não tem campos próprios). ` +
        'Confira o nome — a DD02T ajuda a procurar.',
    )

  // ── 2. os rótulos ─────────────────────────────────────────────────────────
  //
  // Enfeite útil: sem eles a lista de campos continua correta, só fica sem os
  // textos. Por isso esta etapa NÃO derruba a busca quando falha — devolver
  // 200 campos sem rótulo é muito melhor que devolver erro.
  const elementos = [
    ...new Set(
      (campos as (CampoSap & { _el: string })[]).map((c) => c._el).filter((e) => e.length > 0),
    ),
  ]

  if (elementos.length > 0) {
    opts.onPasso?.(`Lendo o texto de ${elementos.length} campo(s) (DD04T)…`)
    try {
      // Português primeiro; o inglês entra só onde faltou. A ordem importa —
      // invertida, o genérico sobrescreveria a tradução boa.
      const texto = new Map<string, string>()
      for (const idioma of ['P', 'E']) {
        const faltam = elementos.filter((e) => !texto.has(e))
        if (faltam.length === 0) break

        const r2 = await sol.criarEAguardar(
          {
            ...base,
            acao: 'read_table',
            payload: {
              Tabela: 'DD04T',
              Campos: ['ROLLNAME', 'DDLANGUAGE', 'DDTEXT', 'SCRTEXT_L'],
              Filtro: [
                `DDLANGUAGE = '${idioma}' AND ( `,
                ...faltam.map((e, i) => `${i === 0 ? '' : 'OR '}ROLLNAME = '${e}' `),
                ') ',
              ],
              CamposChave: ['ROLLNAME', 'DDLANGUAGE'],
            },
          },
          { timeoutMs },
        )
        if (r2.status !== 'concluida') break

        for (const l of linhasDoReadTable(r2.resultado)) {
          const rn = txt(l.ROLLNAME).trim()
          if (!rn || texto.has(rn)) continue
          // SCRTEXT_L é o rótulo longo de tela; DDTEXT o texto curto. Fica o
          // mais informativo que existir.
          const t = txt(l.SCRTEXT_L).trim() || txt(l.DDTEXT).trim()
          if (t) texto.set(rn, t)
        }
      }

      for (const c of campos as (CampoSap & { _el: string })[])
        if (c._el && texto.has(c._el)) c.descricao = texto.get(c._el)!
    } catch {
      opts.onPasso?.('Os campos vieram, mas os rótulos não — segue sem eles.')
    }
  }

  return (campos as (CampoSap & { _el: string })[]).map(({ _el: _e, ...c }) => c)
}

/** O trecho de CamposChave que um read_table desta tabela precisa. */
export const chavesDe = (t: TabelaSap): string =>
  t.campos.filter((c) => c.chave).map((c) => c.nome).join(', ')
