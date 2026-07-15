// ─────────────────────────────────────────────────────────────────────────────
// SupabaseService — camada de dados do LNF-Web sobre o Postgres do Supabase
// (PostgREST), acessado DIRETO do navegador (sem Power Automate).
//
// Substitui o antigo GitHubService (que lia/gravava os JSONs do LNF-files). Em
// vez de arquivos, os dados vivem em tabelas:
//
//   itens.json           ↔  materiais        (PK fornecedor+codigo)
//   forn.json            ↔  fornecedores     (PK nome)
//   usersList.json       ↔  usuarios         (PK username)
//   centros.json         ↔  centros          (PK centro)
//   termos_globais.json  ↔  termos_globais   (surrogate id)
//
// A leitura (lerArquivo) RECONSTRÓI o shape JSON legado que as telas já
// consomem — assim Mapeamento/Cadastros continuam funcionando quase sem
// mudança. A escrita passa a ser POR LINHA (upsert/delete), o que elimina por
// construção o truncamento de arquivo inteiro que causava perda de dados.
//
// Mapeamento coluna↔chave espelha o lado C# (SupabaseSync/SupabaseStore do
// LNF-Coreon), para que os dois produzam/consumam exatamente o mesmo formato.
//
// Chave: o campo "Supabase Key" da tela de Configurações. Para GRAVAR é preciso
// a secret key (service_role) — a publishable/anon só lê (RLS). Fica só no
// localStorage do navegador, mesmo tradeoff do antigo GitHub token.
// ─────────────────────────────────────────────────────────────────────────────

export interface FileResult {
  data: unknown
  sha: string
}

type Row = Record<string, unknown>

// ── helpers de coerção (espelham os builders C#) ─────────────────────────────
function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => String(x)) : []
}
function boolp(v: unknown): boolean {
  return v === true
}
function strOrNull(v: unknown): string | null {
  if (v == null) return null
  const s = String(v)
  return s === '' ? null : s
}
function numOr0(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}
function obj(v: unknown): Row {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {}
}

// Serialização canônica (chaves ordenadas) para diff estável de linhas.
function canon(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (typeof v === 'object') {
    const keys = Object.keys(v as Row).sort()
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canon((v as Row)[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

// ── builders legado → linha (mesma ordem/colunas do lado C#) ─────────────────
// Regra do PostgREST: num upsert em lote todas as linhas precisam ter o MESMO
// conjunto de chaves — por isso os builders SEMPRE emitem todas as colunas.

export function buildFornRow(nome: string, o: Row): Row {
  return {
    nome,
    raiz_cnpjs: arr(o.raizCNPJs),
    cnpjs: arr(o.cnpjs),
    lifnrs: arr(o.lifnrs),
    ordem: numOr0(o.ordem),
    info_xprod: boolp(o.infoXprod),
    ref_coluna: strOrNull(o.refColuna),
    ref_universal: strOrNull(o.refUniversal),
    from_umb_column: strOrNull(o.fromUMBColumn),
    date_format: strOrNull(o.dateFormat),
    frete_com_ipi: boolp(o.freteComIPI),
    generic_lote_forn: boolp(o.genericLoteForn),
    peinh1000_por_decimais: boolp(o.peinh1000PorDecimais),
    forcar_peinh1000: boolp(o.forcarPeinh1000),
    buscar_ref_no_xprod: boolp(o.buscarRefNoXprod),
    skip_refs: arr(o.skipRefs),
    termos: obj(o.termos),
  }
}

export function buildMaterialRow(fornecedor: string, codigo: string, item: Row): Row {
  return {
    fornecedor,
    codigo,
    descricao: item.descricao == null ? null : String(item.descricao),
    referencias: obj(item.referencias),
    alias_referencias: obj(item.aliasReferencias),
    umb_migo: item.UmbMigo == null ? null : String(item.UmbMigo),
  }
}

export function buildCentroRow(centro: string, c: Row): Row {
  return {
    centro,
    generic_lote: strOrNull(c.GenericLote),
    generic_val: strOrNull(c.GenericVal),
    generic_lote_items: arr(c.GenericLoteItems),
    ceps: arr(c.Ceps),
    cnpjs: arr(c.Cnpjs),
    forn_overrides: obj(c.FornOverrides),
    centro_pardini: boolp(c.CentroPardini),
  }
}

export function buildUsuarioRow(username: string, u: Row): Row {
  return {
    username,
    centros: arr(u.centros),
    nivel_adm: numOr0(u.nivelAdm),
    acessos: obj(u.acessos),
  }
}

// ── linha → shape legado (para lerArquivo) ───────────────────────────────────
function fornRowToLegacy(r: Row): Row {
  return {
    raizCNPJs: arr(r.raiz_cnpjs),
    cnpjs: arr(r.cnpjs),
    lifnrs: arr(r.lifnrs),
    ordem: numOr0(r.ordem),
    infoXprod: boolp(r.info_xprod),
    refColuna: r.ref_coluna ?? '',
    refUniversal: r.ref_universal ?? '',
    fromUMBColumn: r.from_umb_column ?? '',
    dateFormat: r.date_format ?? '',
    freteComIPI: boolp(r.frete_com_ipi),
    genericLoteForn: boolp(r.generic_lote_forn),
    peinh1000PorDecimais: boolp(r.peinh1000_por_decimais),
    forcarPeinh1000: boolp(r.forcar_peinh1000),
    buscarRefNoXprod: boolp(r.buscar_ref_no_xprod),
    skipRefs: arr(r.skip_refs),
    termos: obj(r.termos),
  }
}

function materialRowToLegacy(r: Row): Row {
  const item: Row = {
    referencias: obj(r.referencias),
    descricao: r.descricao ?? '',
  }
  const alias = obj(r.alias_referencias)
  if (Object.keys(alias).length) item.aliasReferencias = alias
  if (r.umb_migo != null && String(r.umb_migo) !== '') item.UmbMigo = String(r.umb_migo)
  return item
}

function centroRowToLegacy(r: Row): Row {
  return {
    GenericLote: String(r.generic_lote ?? 'N'),
    GenericVal: String(r.generic_val ?? '31.12.2099'),
    GenericLoteItems: arr(r.generic_lote_items),
    Ceps: arr(r.ceps),
    Cnpjs: arr(r.cnpjs),
    FornOverrides: obj(r.forn_overrides),
    CentroPardini: boolp(r.centro_pardini),
  }
}

function usuarioRowToLegacy(r: Row): Row {
  return {
    centros: arr(r.centros),
    nivelAdm: numOr0(r.nivel_adm),
    acessos: obj(r.acessos),
  }
}

// ── mapa arquivo → tabela ────────────────────────────────────────────────────
function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

const FILE_TO_TABLE: Record<string, string> = {
  'itens.json': 'materiais',
  'forn.json': 'fornecedores',
  'usersList.json': 'usuarios',
  'centros.json': 'centros',
  'termos_globais.json': 'termos_globais',
}

function tabelaDoPath(path: string): string {
  const t = FILE_TO_TABLE[basename(path)]
  if (!t) throw new Error(`Arquivo sem tabela mapeada no Supabase: ${basename(path)}`)
  return t
}

// Ordem de paginação por tabela (paging determinístico via limit/offset).
const ORDER_BY: Record<string, string> = {
  materiais: 'fornecedor,codigo',
  fornecedores: 'nome',
  usuarios: 'username',
  centros: 'centro',
  termos_globais: 'is_fim,ordem',
}

// Snapshot cru por tabela (populado na leitura, usado no diff da escrita).
// Módulo-level: sobrevive à criação de novas instâncias do serviço entre a
// leitura (carregar) e a escrita (gravar).
const snapshots = new Map<string, Map<string, Row>>()

function pkMateriais(r: Row): string {
  return String(r.fornecedor) + '|||' + String(r.codigo)
}

export class SupabaseService {
  private base: string
  constructor(
    url: string,
    private key: string,
  ) {
    this.base = url.replace(/\/+$/, '') + '/rest/v1/'
  }

  private headers(extra?: Record<string, string>): HeadersInit {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      ...extra,
    }
  }

  private async erro(res: Response): Promise<never> {
    let detalhe = res.statusText
    try {
      const body = (await res.json()) as { message?: string; hint?: string; code?: string }
      detalhe = body.message
        ? `${body.code ? body.code + ': ' : ''}${body.message}${body.hint ? ' — ' + body.hint : ''}`
        : detalhe
    } catch {
      /* corpo não-JSON */
    }
    throw new Error(`Supabase ${res.status}: ${detalhe}`)
  }

  // GET paginado (contorna o teto de linhas do PostgREST).
  private async getAll(table: string, params: string): Promise<Row[]> {
    const pageSize = 1000
    const order = ORDER_BY[table] ? `&order=${ORDER_BY[table]}` : ''
    const all: Row[] = []
    for (let offset = 0; ; offset += pageSize) {
      const q = `${params}${order}&limit=${pageSize}&offset=${offset}`
      const res = await fetch(`${this.base}${table}?${q}`, { headers: this.headers() })
      if (!res.ok) await this.erro(res)
      const rows = (await res.json()) as Row[]
      all.push(...rows)
      if (rows.length < pageSize) break
    }
    return all
  }

  private async upsert(table: string, rows: Row[], onConflict: string | null): Promise<void> {
    if (rows.length === 0) return
    const chunk = 500
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk)
      const q = onConflict ? `?on_conflict=${onConflict}` : ''
      const res = await fetch(`${this.base}${table}${q}`, {
        method: 'POST',
        headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(slice),
      })
      if (!res.ok) await this.erro(res)
    }
  }

  private async del(table: string, filter: string): Promise<void> {
    const res = await fetch(`${this.base}${table}?${filter}`, {
      method: 'DELETE',
      headers: this.headers({ Prefer: 'return=minimal' }),
    })
    if (!res.ok) await this.erro(res)
  }

  // ── leitura: reconstrói o shape JSON legado a partir das tabelas ───────────
  async lerArquivo(path: string): Promise<FileResult> {
    const table = tabelaDoPath(path)
    const rows = await this.getAll(table, 'select=*')

    // Guarda snapshot cru para o diff da escrita (materiais).
    if (table === 'materiais') {
      const snap = new Map<string, Row>()
      for (const r of rows) snap.set(pkMateriais(r), r)
      snapshots.set('materiais', snap)
    }

    let data: unknown
    switch (table) {
      case 'materiais': {
        const root: Record<string, Record<string, Row>> = {}
        for (const r of rows) {
          const forn = String(r.fornecedor)
          const cod = String(r.codigo)
          if (!forn || !cod) continue
          ;(root[forn] ??= {})[cod] = materialRowToLegacy(r)
        }
        data = root
        break
      }
      case 'fornecedores': {
        const root: Record<string, Row> = {}
        for (const r of rows) {
          const nome = String(r.nome)
          if (nome) root[nome] = fornRowToLegacy(r)
        }
        data = root
        break
      }
      case 'usuarios': {
        const root: Record<string, Row> = {}
        for (const r of rows) {
          const u = String(r.username)
          if (u) root[u] = usuarioRowToLegacy(r)
        }
        data = root
        break
      }
      case 'centros': {
        const centros: Record<string, Row> = {}
        for (const r of rows) {
          const c = String(r.centro)
          if (c) centros[c] = centroRowToLegacy(r)
        }
        data = { Centros: centros }
        break
      }
      case 'termos_globais': {
        const gen: Row[] = []
        const fim: Row[] = []
        for (const r of rows) {
          const e = { Tipo: r.tipo, Texto: r.texto }
          if (boolp(r.is_fim)) fim.push(e)
          else gen.push(e)
        }
        data = { TermosGenericos: gen, FimTermos: fim }
        break
      }
      default:
        data = null
    }
    return { data, sha: 'sb-' + Date.now() }
  }

  // ── escrita de itens.json (materiais): diff por linha ──────────────────────
  // Só itens.json passa por aqui (AppContext.gravarItens / Mapeamento). Os
  // cadastros (forn/usuarios/centros) usam os métodos por entidade abaixo.
  async gravarArquivo(path: string, conteudo: unknown, _sha: string, _msg: string): Promise<string> {
    const table = tabelaDoPath(path)
    if (table !== 'materiais') {
      throw new Error(
        `gravarArquivo(${basename(path)}) não suportado — use os métodos de cadastro por entidade.`,
      )
    }

    const desejado = conteudo as Record<string, Record<string, Row>>

    // Snapshot: cache da leitura ou re-SELECT.
    let snap = snapshots.get('materiais')
    if (!snap) {
      snap = new Map<string, Row>()
      for (const r of await this.getAll('materiais', 'select=*')) snap.set(pkMateriais(r), r)
      snapshots.set('materiais', snap)
    }

    // Garante que os fornecedores referenciados existam (FK de materiais).
    const fornsDesejados = Object.keys(desejado)
    await this.garantirFornecedores(fornsDesejados)

    const upserts: Row[] = []
    const vivos = new Set<string>()
    for (const forn of fornsDesejados) {
      for (const [cod, item] of Object.entries(desejado[forn] ?? {})) {
        const row = buildMaterialRow(forn, cod, obj(item))
        const pk = forn + '|||' + cod
        vivos.add(pk)
        const atual = snap.get(pk)
        if (atual && materiaisIguais(row, atual)) continue
        upserts.push(row)
      }
    }

    const deletes: Array<{ forn: string; cod: string }> = []
    for (const [pk, r] of snap) {
      if (!vivos.has(pk)) deletes.push({ forn: String(r.fornecedor), cod: String(r.codigo) })
    }

    await this.upsert('materiais', upserts, 'fornecedor,codigo')
    for (const d of deletes) {
      await this.del(
        'materiais',
        `fornecedor=eq.${encodeURIComponent(d.forn)}&codigo=eq.${encodeURIComponent(d.cod)}`,
      )
    }

    // Atualiza o snapshot para o novo estado desejado.
    const novo = new Map<string, Row>()
    for (const forn of fornsDesejados) {
      for (const [cod, item] of Object.entries(desejado[forn] ?? {})) {
        novo.set(forn + '|||' + cod, buildMaterialRow(forn, cod, obj(item)))
      }
    }
    snapshots.set('materiais', novo)

    return 'sb-' + Date.now()
  }

  // Cria linhas-stub em fornecedores para nomes ainda inexistentes (no-op se já
  // existem). Necessário porque materiais tem FK → fornecedores(nome).
  private async garantirFornecedores(nomes: string[]): Promise<void> {
    if (nomes.length === 0) return
    const existentes = new Set<string>()
    for (const r of await this.getAll('fornecedores', 'select=nome')) {
      existentes.add(String(r.nome))
    }
    const faltando = nomes.filter(n => !existentes.has(n))
    if (faltando.length === 0) return
    await this.upsert(
      'fornecedores',
      faltando.map(n => buildFornRow(n, {})),
      'nome',
    )
  }

  // ── cadastros por entidade (fornecedores) ──────────────────────────────────
  async salvarFornecedor(nome: string, data: Row, nomeAntigo?: string): Promise<void> {
    if (nomeAntigo && nomeAntigo !== nome) {
      await this.renomearFornecedor(nomeAntigo, nome, data)
      return
    }
    await this.upsert('fornecedores', [buildFornRow(nome, data)], 'nome')
  }

  async removerFornecedor(nome: string): Promise<void> {
    // FK on delete cascade remove os materiais do fornecedor junto.
    await this.del('fornecedores', `nome=eq.${encodeURIComponent(nome)}`)
  }

  // Rename preservando os materiais: cria o novo nome, recria os materiais sob
  // ele e só então apaga o antigo (cascade limpa os materiais antigos).
  private async renomearFornecedor(antigo: string, novo: string, data: Row): Promise<void> {
    await this.upsert('fornecedores', [buildFornRow(novo, data)], 'nome')
    const mats = await this.getAll(
      'materiais',
      `select=*&fornecedor=eq.${encodeURIComponent(antigo)}`,
    )
    if (mats.length > 0) {
      const rows = mats.map(m =>
        buildMaterialRow(novo, String(m.codigo), materialRowToLegacy(m)),
      )
      await this.upsert('materiais', rows, 'fornecedor,codigo')
    }
    await this.removerFornecedor(antigo)
  }

  // ── cadastros por entidade (usuários) ──────────────────────────────────────
  async salvarUsuario(username: string, data: Row, usernameAntigo?: string): Promise<void> {
    await this.upsert('usuarios', [buildUsuarioRow(username, data)], 'username')
    if (usernameAntigo && usernameAntigo !== username) await this.removerUsuario(usernameAntigo)
  }

  async removerUsuario(username: string): Promise<void> {
    await this.del('usuarios', `username=eq.${encodeURIComponent(username)}`)
  }

  // ── cadastros por entidade (centros) ───────────────────────────────────────
  async salvarCentro(centro: string, data: Row, centroAntigo?: string): Promise<void> {
    await this.upsert('centros', [buildCentroRow(centro, data)], 'centro')
    if (centroAntigo && centroAntigo !== centro) await this.removerCentro(centroAntigo)
  }

  async removerCentro(centro: string): Promise<void> {
    await this.del('centros', `centro=eq.${encodeURIComponent(centro)}`)
  }

  // ── termos globais (replace-all) ───────────────────────────────────────────
  async replaceTermosGlobais(termos: {
    TermosGenericos?: Array<{ Tipo?: string; Texto?: string }>
    FimTermos?: Array<{ Tipo?: string; Texto?: string }>
  }): Promise<void> {
    await this.del('termos_globais', 'id=gte.0')
    const rows: Row[] = []
    let o = 0
    for (const e of termos.TermosGenericos ?? [])
      rows.push({ tipo: e.Tipo ?? '', texto: e.Texto ?? '', is_fim: false, ordem: ++o })
    o = 0
    for (const e of termos.FimTermos ?? [])
      rows.push({ tipo: e.Tipo ?? '', texto: e.Texto ?? '', is_fim: true, ordem: ++o })
    await this.upsert('termos_globais', rows, null)
  }

  // Upsert bruto (usado pela importação única). onConflict null = insert puro.
  async upsertBruto(table: string, rows: Row[], onConflict: string | null): Promise<void> {
    await this.upsert(table, rows, onConflict)
  }

  async deleteBruto(table: string, filter: string): Promise<void> {
    await this.del(table, filter)
  }
}

// Compara as colunas de negócio de materiais (ignora updated_at etc.).
function materiaisIguais(nova: Row, atual: Row): boolean {
  return (
    canon(nova.descricao ?? null) === canon(atual.descricao ?? null) &&
    canon(nova.referencias ?? {}) === canon(atual.referencias ?? {}) &&
    canon(nova.alias_referencias ?? {}) === canon(atual.alias_referencias ?? {}) &&
    canon(nova.umb_migo ?? null) === canon(atual.umb_migo ?? null)
  )
}
