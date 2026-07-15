// ─────────────────────────────────────────────────────────────────────────────
// Introspecção do schema via OpenAPI do PostgREST.
//
// O Supabase/PostgREST publica um documento OpenAPI (Swagger 2.0) na raiz
// `/rest/v1/`, descrevendo TODAS as tabelas, colunas, tipos e chaves primárias.
// A partir daí o editor universal monta o formulário sozinho — sem precisar
// adaptar o código quando surge tabela ou coluna nova.
// ─────────────────────────────────────────────────────────────────────────────

export type ColunaTipo = 'boolean' | 'number' | 'text' | 'array' | 'json' | 'datetime'

export interface ColunaMeta {
  nome: string
  tipo: ColunaTipo
  itemTipo?: 'number' | 'text' // para arrays
  pk: boolean
  required: boolean // NOT NULL sem default
  temDefault: boolean
}

export interface TabelaMeta {
  nome: string
  colunas: ColunaMeta[]
  pkCols: string[]
  // PK única inteira chamada "id" → tratada como auto (identity/serial): não
  // é enviada no INSERT de linha nova (o banco gera).
  autoPk: boolean
}

interface OpenApiProp {
  type?: string
  format?: string
  description?: string
  default?: unknown
  items?: { type?: string; format?: string }
}
interface OpenApiDef {
  properties?: Record<string, OpenApiProp>
  required?: string[]
}
interface OpenApiDoc {
  definitions?: Record<string, OpenApiDef>
  components?: { schemas?: Record<string, OpenApiDef> }
  paths?: Record<string, unknown>
}

function classificar(prop: OpenApiProp): { tipo: ColunaTipo; itemTipo?: 'number' | 'text' } {
  const fmt = (prop.format ?? '').toLowerCase()
  const type = prop.type ?? ''

  if (type === 'array' || fmt.endsWith('[]')) {
    const itFmt = (prop.items?.format ?? '').toLowerCase()
    const itType = prop.items?.type ?? ''
    const numerico =
      itType === 'integer' || itType === 'number' || /int|numeric|double|real|decimal/.test(itFmt)
    return { tipo: 'array', itemTipo: numerico ? 'number' : 'text' }
  }
  if (type === 'boolean' || fmt === 'boolean') return { tipo: 'boolean' }
  if (type === 'integer' || type === 'number' || /^(int|bigint|smallint|numeric|double|real|decimal)/.test(fmt))
    return { tipo: 'number' }
  if (fmt === 'jsonb' || fmt === 'json' || type === 'object') return { tipo: 'json' }
  if (/timestamp|date|time/.test(fmt)) return { tipo: 'datetime' }
  return { tipo: 'text' }
}

function ehPk(prop: OpenApiProp): boolean {
  const d = prop.description ?? ''
  return /<pk\/>/i.test(d) || /primary key/i.test(d)
}

export function parseTabelas(doc: OpenApiDoc): TabelaMeta[] {
  const defs = doc.definitions ?? doc.components?.schemas ?? {}
  const paths = doc.paths ?? {}
  const tabelas: TabelaMeta[] = []

  for (const [nome, def] of Object.entries(defs)) {
    // Só entidades expostas como recurso REST (exclui tipos de RPC).
    if (Object.keys(paths).length && !(`/${nome}` in paths)) continue
    const props = def.properties ?? {}
    const required = new Set(def.required ?? [])

    const colunas: ColunaMeta[] = Object.entries(props).map(([col, prop]) => {
      const { tipo, itemTipo } = classificar(prop)
      const temDefault = prop.default !== undefined
      return {
        nome: col,
        tipo,
        itemTipo,
        pk: ehPk(prop),
        required: required.has(col) && !temDefault,
        temDefault,
      }
    })

    const pkCols = colunas.filter(c => c.pk).map(c => c.nome)
    const autoPk =
      pkCols.length === 1 &&
      pkCols[0] === 'id' &&
      colunas.find(c => c.nome === 'id')?.tipo === 'number'

    // PKs primeiro; demais na ordem do schema.
    colunas.sort((a, b) => Number(b.pk) - Number(a.pk))

    tabelas.push({ nome, colunas, pkCols, autoPk })
  }

  tabelas.sort((a, b) => a.nome.localeCompare(b.nome))
  return tabelas
}

// ── conversões DB ↔ representação de edição do formulário ────────────────────
export type EditVal = string | boolean

// valor do banco → o que o input mostra
export function paraEdicao(col: ColunaMeta, v: unknown): EditVal {
  switch (col.tipo) {
    case 'boolean':
      return v === true
    case 'array':
      return Array.isArray(v) ? v.map(String).join('\n') : ''
    case 'json':
      return v == null ? '' : JSON.stringify(v, null, 2)
    default:
      return v == null ? '' : String(v)
  }
}

// representação de edição → valor a gravar (lança em JSON inválido)
export function paraGravar(col: ColunaMeta, v: EditVal): unknown {
  switch (col.tipo) {
    case 'boolean':
      return v === true
    case 'number': {
      const s = String(v).trim()
      if (s === '') return null
      const n = Number(s.replace(',', '.'))
      if (!Number.isFinite(n)) throw new Error(`"${col.nome}": número inválido`)
      return n
    }
    case 'array': {
      const linhas = String(v)
        .split('\n')
        .map(x => x.trim())
        .filter(Boolean)
      if (col.itemTipo === 'number') {
        return linhas.map(x => {
          const n = Number(x.replace(',', '.'))
          if (!Number.isFinite(n)) throw new Error(`"${col.nome}": item não numérico "${x}"`)
          return n
        })
      }
      return linhas
    }
    case 'json': {
      const s = String(v).trim()
      if (s === '') return {}
      try {
        return JSON.parse(s)
      } catch {
        throw new Error(`"${col.nome}": JSON inválido`)
      }
    }
    default: {
      const s = String(v)
      return s === '' ? null : s
    }
  }
}
