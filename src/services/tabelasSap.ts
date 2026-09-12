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
// ── e por que isso roda em duas idas, e não numa ────────────────────────────
//
// O Coreon ganhou uma pipe 'descrever_tabela' que faz tudo de um lado só. Ela
// é melhor — uma ida em vez de duas — e NÃO é o que esta tela usa.
//
// O motivo é o parque: a solicitação vai para o PRIMEIRO Coreon que pegar, e
// não dá para escolher qual. Numa frota em que parte das máquinas ainda não
// atualizou, a mesma ação funcionaria ou não conforme quem atendesse — falha
// intermitente e inexplicável para quem usa. O read_table existe em todo
// Coreon que está no ar hoje.
//
// Quando o parque estiver atualizado, trocar as duas chamadas abaixo por uma
// de 'descrever_tabela' é uma função só. Fica anotado em buscarCampos.
//
// ── as duas leituras ────────────────────────────────────────────────────────
//
//   DD03L   os campos: nome, posição, se é chave, tipo, tamanho, decimais
//   DD04T   o rótulo de cada um, achado pelo ROLLNAME que a DD03L trouxe
//
// A segunda depende do resultado da primeira, e é por isso que são duas: não
// há como pedir as duas de uma vez sem saber os elementos de dados antes.
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
 * Duas solicitações encadeadas, e nenhuma precisa cair na MESMA máquina: o
 * read_table não guarda estado entre chamadas, então qualquer Coreon com o SAP
 * logado responde qualquer passo. É o que permite não endereçar destinatário.
 */
export async function buscarCampos(
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
