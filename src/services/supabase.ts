// ─────────────────────────────────────────────────────────────────────────────
// SupabaseService — camada de dados do LNF-Web sobre o Postgres do Supabase
// (PostgREST), acessado via um fluxo do Power Automate que guarda o secret no
// servidor (o secret NUNCA vai para o browser — o Supabase bloqueia isso).
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
// Config: o campo "URL do Power Automate" (o mesmo fluxo que o LNF-Coreon usa).
// Fica só no localStorage do navegador — não é chave secreta, é o endpoint do
// fluxo, que por sua vez valida o usuário e executa a chamada REST no Supabase.
//
// Contrato do fluxo (idêntico ao lado C#): recebe um JSON
//   { op:"SELECT"|"UPDATE"|"UPSERT"|"DELETE"|"OPENAPI", tabela, query|linhas|conflito|filtro, usuario }
// e devolve o corpo da API do Supabase (para SELECT, o array de linhas).
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

// Só dígitos, 14 posições — mesma normalização do Coreon (FornecedorService),
// pra que o CNPJ gravado case com o lookup por CNPJ.
function cnpjNorm(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '')
  if (!d) return null
  return d.length < 14 ? d.padStart(14, '0') : d
}

// Raízes = 8 primeiros dígitos dos CNPJs, unidas às informadas explicitamente.
// É o que o Coreon usa como fallback quando a filial exata não está cadastrada,
// então derivar aqui evita cadastro com CNPJ e sem raiz (fornecedor que "some"
// pra filiais novas). As informadas são preservadas: existe raiz cadastrada sem
// CNPJ de filial correspondente.
function raizes(informadas: unknown, cnpjs: unknown): string[] {
  const out: string[] = []
  const add = (r: string) => {
    if (r.length === 8 && !out.includes(r)) out.push(r)
  }
  for (const v of arr(informadas)) add(String(v).replace(/\D/g, '').slice(0, 8))
  for (const v of arr(cnpjs)) {
    const n = cnpjNorm(v)
    if (n) add(n.slice(0, 8))
  }
  return out
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
  const cnpjs = arr(o.cnpjs)
    .map(cnpjNorm)
    .filter((c): c is string => c !== null)
  return {
    nome,
    raiz_cnpjs: raizes(o.raizCNPJs, cnpjs),   // derivadas dos CNPJs, sempre
    cnpjs,
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
    preco_nf_ja_convertido: boolp(o.precoNfJaConvertido),
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
    precoNfJaConvertido: boolp(r.preco_nf_ja_convertido),
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

// ── cache de leitura (padrão Coreon: só rele se a tabela mudou) ──────────────
// Guarda os dados já buscados por (tabela|query) + a watermark (max updated_at).
// Ao abrir a página, uma leitura mínima (1 linha) confere a watermark; se não
// mudou, serve do cache — evita puxar a tabela inteira toda vez. Só vale pra
// tabelas com updated_at; escrita da própria web invalida o cache da tabela.
// Módulo-level: sobrevive à navegação entre páginas (mesma sessão do SPA).
const CACHEAVEIS = new Set(['fornecedores', 'materiais', 'centros', 'usuarios'])
const cacheLeitura = new Map<string, { wm: string; rows: Row[] }>()

function pkMateriais(r: Row): string {
  return String(r.fornecedor) + '|||' + String(r.codigo)
}

// A resposta do fluxo do PA é o corpo cru da API. Alguns fluxos devolvem o
// JSON como string, ou embrulhado ({body|value|data}). Estes helpers toleram
// as variações comuns.
function parseJson(txt: string): unknown {
  const t = (txt ?? '').trim()
  if (!t) return null
  let p: unknown = JSON.parse(t)
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p)
    } catch {
      /* era mesmo uma string */
    }
  }
  return p
}

function parseRows(txt: string): Row[] {
  const p = parseJson(txt)
  if (Array.isArray(p)) return p as Row[]
  if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>
    for (const k of ['body', 'value', 'data']) if (Array.isArray(o[k])) return o[k] as Row[]
    // objeto de erro do PostgREST/PA
    if (o.message || o.error)
      throw new Error(String(o.message ?? o.error))
  }
  throw new Error('Resposta do Power Automate não é uma lista de linhas.')
}

export class SupabaseService {
  private paUrl: string
  private usuario: string
  private configurado: boolean
  constructor(paUrl: string, usuario?: string) {
    this.paUrl = (paUrl ?? '').trim()
    this.usuario = (usuario ?? '').trim()
    this.configurado = !!this.paUrl
  }

  private assertConfigurado(): void {
    if (!this.configurado)
      throw new Error(
        'Configure a URL do Power Automate em Configurações e clique em Salvar.',
      )
  }

  // Transporte único: POST para o fluxo do PA (que segura o secret), que executa
  // a operação no Supabase e devolve o corpo da API. Mesmo contrato do C#.
  private async pa(payload: Record<string, unknown>): Promise<string> {
    this.assertConfigurado()
    let res: Response
    try {
      res = await fetch(this.paUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (e) {
      throw new Error('Falha de conexão com o Power Automate: ' + (e as Error).message)
    }
    const txt = await res.text()
    if (!res.ok) throw new Error(`Power Automate ${res.status}: ${txt || res.statusText}`)
    return txt
  }

  // SELECT via PA (op=SELECT), numa chamada só. O teto de linhas é controlado
  // pelo "Max rows" do Supabase (mantido alto o bastante pros dados). usuario
  // vai junto (o fluxo valida quem pode ler).
  private async getAll(table: string, params: string): Promise<Row[]> {
    const order =
      ORDER_BY[table] && !params.includes('order=') ? `&order=${ORDER_BY[table]}` : ''
    const txt = await this.pa({
      op: 'SELECT',
      tabela: table,
      query: `${params}${order}`,
      usuario: this.usuario,
    })
    return parseRows(txt)
  }

  // Leitura com cache por watermark (max updated_at). Faz UMA leitura mínima
  // (1 linha) pra saber se a tabela mudou; se a watermark bate com o cache,
  // devolve o cache sem puxar a tabela inteira. Só cacheia tabelas com
  // updated_at (CACHEAVEIS); as demais caem no getAll normal.
  private async getAllCached(table: string, params: string): Promise<Row[]> {
    if (!CACHEAVEIS.has(table)) return this.getAll(table, params)

    const chave = table + '|' + params
    let wm = ''
    try {
      const top = await this.getAll(table, 'select=updated_at&order=updated_at.desc&limit=1')
      wm = top.length ? String(top[0].updated_at ?? '') : ''
    } catch {
      // Sem watermark (rede/coluna): não arrisca cache — lê normal.
      return this.getAll(table, params)
    }

    const hit = cacheLeitura.get(chave)
    if (hit && wm && hit.wm === wm) return hit.rows

    const rows = await this.getAll(table, params)
    if (wm) cacheLeitura.set(chave, { wm, rows })
    return rows
  }

  // Invalida o cache de leitura de uma tabela (após escrita da própria web).
  private invalidarCache(table: string): void {
    for (const k of cacheLeitura.keys()) if (k.startsWith(table + '|')) cacheLeitura.delete(k)
  }

  private async upsert(table: string, rows: Row[], onConflict: string | null): Promise<void> {
    if (rows.length === 0) return
    const chunk = 500
    for (let i = 0; i < rows.length; i += chunk) {
      const payload: Record<string, unknown> = {
        op: 'UPSERT',
        tabela: table,
        linhas: rows.slice(i, i + chunk),
        usuario: this.usuario,
      }
      if (onConflict) payload.conflito = onConflict
      await this.pa(payload)
    }
    this.invalidarCache(table)
  }

  private async del(table: string, filter: string): Promise<void> {
    await this.pa({ op: 'DELETE', tabela: table, filtro: filter, usuario: this.usuario })
    this.invalidarCache(table)
  }

  // UPDATE (PATCH) das linhas que casam com o filtro. Diferente do UPSERT: o
  // UPSERT cria uma linha nova quando a chave muda, o UPDATE MOVE a existente —
  // e é isso que dispara o "on update cascade" das FKs, levando os filhos junto
  // numa transação só. Exige o ramo "UPDATE" no fluxo do Power Automate.
  private async update(table: string, filter: string, valores: Row): Promise<void> {
    if (!filter) throw new Error('UPDATE sem filtro atingiria a tabela inteira.')
    await this.pa({
      op: 'UPDATE',
      tabela: table,
      linhas: [valores],
      filtro: filter,
      usuario: this.usuario,
    })
    this.invalidarCache(table)
  }

  // ── leitura: reconstrói o shape JSON legado a partir das tabelas ───────────
  async lerArquivo(path: string): Promise<FileResult> {
    const table = tabelaDoPath(path)
    const rows = await this.getAllCached(table, 'select=*')

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

  // ── renomear fornecedor ────────────────────────────────────────────────────
  //
  // CAMINHO BOM: um UPDATE na chave. A FK de materiais é "on update cascade",
  // então o Postgres move os materiais junto, na MESMA transação — nada é
  // copiado e não existe instante em que os dois nomes coexistem.
  //
  // CAMINHO ANTIGO (plano B): cria o novo, copia os materiais, apaga o antigo.
  // Funciona, mas são três operações soltas: rede caindo no meio deixa DOIS
  // fornecedores, o novo sem materiais e o antigo intacto.
  //
  // O plano B fica porque o UPDATE depende de duas coisas fora deste código: o
  // ramo "UPDATE" no fluxo do Power Automate e o "on update cascade" na FK.
  // Faltando qualquer uma, o UPDATE falha — e falhar sem renomear seria pior
  // que renomear pelo caminho antigo.
  //
  // forn_overrides fica de fora do cascade nos dois caminhos: é chave de JSONB,
  // sem FK. Por isso a correção dos centros é sempre um passo à parte.
  private async renomearFornecedor(antigo: string, novo: string, data: Row): Promise<void> {
    try {
      await this.update(
        'fornecedores',
        `nome=eq.${encodeURIComponent(antigo)}`,
        { nome: novo },
      )
      // Só depois de o nome ter migrado é que gravamos o resto da edição —
      // assim um erro aqui deixa o fornecedor renomeado e íntegro.
      await this.upsert('fornecedores', [buildFornRow(novo, data)], 'nome')
      await this.renomearFornEmCentros(antigo, novo)
      return
    } catch (e) {
      console.warn('renomearFornecedor: UPDATE atômico indisponível, usando copiar-e-apagar', e)
    }

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
    await this.renomearFornEmCentros(antigo, novo)
    await this.removerFornecedor(antigo)
  }

  // centros.forn_overrides é um JSONB com o NOME do fornecedor como chave. Não
  // há FK ali, então nenhum cascade alcança: sem isto, renomear deixava o
  // override preso ao nome antigo e ele parava de valer, calado.
  // O Coreon já fazia (FornCadastroService.RenomearFornEmCentros) — aqui faltava.
  private async renomearFornEmCentros(antigo: string, novo: string): Promise<void> {
    const centros = await this.getAll('centros', 'select=centro,forn_overrides')
    const rows: Row[] = []
    for (const c of centros) {
      const ov = c.forn_overrides as Record<string, unknown> | null | undefined
      if (!ov || !Object.prototype.hasOwnProperty.call(ov, antigo)) continue
      const novoOv = { ...ov }
      novoOv[novo] = novoOv[antigo]
      delete novoOv[antigo]
      rows.push({ centro: c.centro, forn_overrides: novoOv })
    }
    if (rows.length > 0) await this.upsert('centros', rows, 'centro')
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

  // ── introspecção / editor universal ───────────────────────────────────────

  // Documento OpenAPI da raiz do PostgREST (descreve tabelas/colunas/PKs).
  // Requer que o fluxo do PA trate op=OPENAPI (proxy do GET /rest/v1/).
  async openApi(): Promise<unknown> {
    const txt = await this.pa({ op: 'OPENAPI', usuario: this.usuario })
    return parseJson(txt)
  }

  // Uma página de linhas de qualquer tabela (paginação/ordem/filtros do caller).
  async lerLinhas(
    table: string,
    opts: { order?: string; limit?: number; offset?: number; filtros?: string } = {},
  ): Promise<Row[]> {
    const parts = ['select=*']
    if (opts.order) parts.push(`order=${opts.order}`)
    if (opts.limit != null) parts.push(`limit=${opts.limit}`)
    if (opts.offset != null) parts.push(`offset=${opts.offset}`)
    if (opts.filtros) parts.push(opts.filtros)
    return this.getAll(table, parts.join('&'))
  }

  async salvarLinha(table: string, payload: Row, onConflict: string | null): Promise<void> {
    await this.upsert(table, [payload], onConflict)
  }

  async deletarLinha(table: string, filtro: string): Promise<void> {
    await this.del(table, filtro)
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
