import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { GitHubService } from '../services/github'

// ─────────────────────────────────────────────────────────────────────────────
// Cadastros — CRUD manual de fornecedores, usuários e centros, lendo/gravando
// os arquivos direto do LNF-files (mesmo repo do itens.json).
//
//   • forn_list.json  → fornecedores (array)
//   • usersList.json  → usuários (objeto keyed por login)
//   • centros.json    → centros   (objeto Centros keyed por id)
//
// Cada entidade vira uma lista de { key, data }. Campos texto/número via input,
// listas via textarea (1 por linha) e booleanos via checkbox. FornOverrides de
// centros é preservado (não editável por campos simples).
// ─────────────────────────────────────────────────────────────────────────────

type Data = Record<string, unknown>

interface Entry {
  key: string
  data: Data
}

type FieldType = 'text' | 'number' | 'boolean' | 'list'

interface FieldSpec {
  path: string
  label: string
  type: FieldType
}

interface EntityConfig {
  id: 'fornecedores' | 'usuarios' | 'centros'
  label: string
  file: string
  keyLabel: string
  parse: (raw: unknown) => Entry[]
  build: (entries: Entry[]) => unknown
  blank: () => Data
  fields: FieldSpec[]
}

// ── helpers de path ──────────────────────────────────────────────────────────
function getPath(obj: Data, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as Data)[k]),
    obj,
  )
}

function cloneSetPath(obj: Data, path: string, val: unknown): Data {
  const copy = JSON.parse(JSON.stringify(obj)) as Data
  const ks = path.split('.')
  const last = ks.pop() as string
  let o = copy
  for (const k of ks) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {}
    o = o[k] as Data
  }
  o[last] = val
  return copy
}

function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => String(x)) : []
}

// Limpa o objeto do fornecedor antes de gravar: remove campos vazios/false/0
// e arrays de termos vazios (espelha o forn.json, que omite campos opcionais).
// Campos desconhecidos com valor "truthy" são preservados.
function pruneForn(d: Data): Data {
  const o: Data = {}
  for (const [k, v] of Object.entries(d)) {
    if (k === 'termos') {
      const t: Data = {}
      for (const [tk, tv] of Object.entries((v as Data) ?? {})) {
        const arr = asList(tv)
        if (arr.length) t[tk] = arr
      }
      if (Object.keys(t).length) o.termos = t
      continue
    }
    if (Array.isArray(v)) {
      const arr = v.map(String)
      if (arr.length) o[k] = arr
    } else if (typeof v === 'boolean') {
      if (v) o[k] = true
    } else if (typeof v === 'number') {
      if (v) o[k] = v
    } else if (typeof v === 'string') {
      if (v.trim()) o[k] = v
    } else if (v != null) {
      o[k] = v
    }
  }
  return o
}

// ── acessos padrão (usuários) ────────────────────────────────────────────────
const ACESSOS = [
  'cadastroFornecedores',
  'cadastroItens',
  'cadastroUsuarios',
  'arquivosRestritos',
  'almoxarifado',
  'planejamento',
  'compras',
  'fiscal',
] as const

const ACESSO_LABELS: Record<string, string> = {
  cadastroFornecedores: 'Cadastro Fornecedores',
  cadastroItens: 'Cadastro Itens',
  cadastroUsuarios: 'Cadastro Usuários',
  arquivosRestritos: 'Arquivos Restritos',
  almoxarifado: 'Almoxarifado',
  planejamento: 'Planejamento',
  compras: 'Compras',
  fiscal: 'Fiscal',
}

function acessosVazio(): Record<string, boolean> {
  return Object.fromEntries(ACESSOS.map(a => [a, false]))
}

// ── definição das entidades ──────────────────────────────────────────────────
const ENTIDADES: EntityConfig[] = [
  {
    id: 'fornecedores',
    label: 'Fornecedores',
    file: 'forn.json',
    keyLabel: 'Nome',
    parse: raw => {
      const obj = (raw as Record<string, Data>) ?? {}
      return Object.entries(obj).map(([k, v]) => ({
        key: k,
        data: JSON.parse(JSON.stringify(v ?? {})) as Data, // preserva tudo
      }))
    },
    build: entries =>
      Object.fromEntries(entries.map(({ key, data }) => [key, pruneForn(data)])),
    blank: () => ({ cnpjs: [] }),
    fields: [
      { path: 'raizCNPJs', label: 'Raiz CNPJs', type: 'list' },
      { path: 'cnpjs', label: 'CNPJs', type: 'list' },
      { path: 'lifnrs', label: 'LIFNRs', type: 'list' },
      { path: 'ordem', label: 'Ordem', type: 'number' },
      { path: 'dateFormat', label: 'Date Format', type: 'text' },
      { path: 'refColuna', label: 'Ref Coluna', type: 'text' },
      { path: 'refUniversal', label: 'Ref Universal', type: 'text' },
      { path: 'skipRefs', label: 'Skip Refs', type: 'list' },
      { path: 'infoXprod', label: 'Info Xprod', type: 'boolean' },
      { path: 'genericLoteForn', label: 'Generic Lote Forn', type: 'boolean' },
      { path: 'peinh1000PorDecimais', label: 'Peinh 1000 por Decimais', type: 'boolean' },
      { path: 'forcarPeinh1000', label: 'Forçar Peinh 1000', type: 'boolean' },
      { path: 'termos.lote', label: 'Termo · Lote', type: 'list' },
      { path: 'termos.fimLote', label: 'Termo · Fim Lote', type: 'list' },
      { path: 'termos.validade', label: 'Termo · Validade', type: 'list' },
      { path: 'termos.fimValidade', label: 'Termo · Fim Validade', type: 'list' },
      { path: 'termos.quantidade', label: 'Termo · Quantidade', type: 'list' },
      { path: 'termos.fimQuantidade', label: 'Termo · Fim Quantidade', type: 'list' },
      { path: 'termos.referencia', label: 'Termo · Referência', type: 'list' },
      { path: 'termos.fimReferencia', label: 'Termo · Fim Referência', type: 'list' },
      { path: 'termos.pedido', label: 'Termo · Pedido', type: 'list' },
    ],
  },
  {
    id: 'usuarios',
    label: 'Usuários',
    file: 'usersList.json',
    keyLabel: 'Usuário',
    parse: raw => {
      const obj = (raw as Record<string, Data>) ?? {}
      return Object.entries(obj).map(([k, v]) => ({
        key: k,
        data: {
          centros: asList(v.centros),
          acessos: { ...acessosVazio(), ...((v.acessos as Record<string, boolean>) ?? {}) },
          nivelAdm: typeof v.nivelAdm === 'number' ? v.nivelAdm : 0,
        },
      }))
    },
    build: entries =>
      Object.fromEntries(
        entries.map(({ key, data }) => [
          key,
          {
            centros: asList(data.centros),
            acessos: { ...acessosVazio(), ...((data.acessos as Record<string, boolean>) ?? {}) },
            nivelAdm: Number(data.nivelAdm) || 0,
          },
        ]),
      ),
    blank: () => ({ centros: [], acessos: acessosVazio(), nivelAdm: 0 }),
    fields: [
      { path: 'nivelAdm', label: 'Nível Adm', type: 'number' },
      { path: 'centros', label: 'Centros', type: 'list' },
      ...ACESSOS.map(a => ({ path: `acessos.${a}`, label: ACESSO_LABELS[a], type: 'boolean' as const })),
    ],
  },
  {
    id: 'centros',
    label: 'Centros',
    file: 'centros.json',
    keyLabel: 'Centro',
    parse: raw => {
      const obj = (raw as { Centros?: Record<string, Data> })?.Centros ?? {}
      return Object.entries(obj).map(([k, v]) => ({
        key: k,
        data: {
          GenericLote: String(v.GenericLote ?? 'N'),
          GenericVal: String(v.GenericVal ?? '31.12.2099'),
          GenericLoteItems: asList(v.GenericLoteItems),
          Ceps: asList(v.Ceps),
          Cnpjs: asList(v.Cnpjs),
          CentroPardini: !!v.CentroPardini,
          FornOverrides: v.FornOverrides ?? null, // preservado
        },
      }))
    },
    build: entries => ({
      Centros: Object.fromEntries(
        entries.map(({ key, data }) => {
          const ceps = asList(data.Ceps)
          const cnpjs = asList(data.Cnpjs)
          const o: Data = {
            GenericLote: String(data.GenericLote ?? 'N'),
            GenericVal: String(data.GenericVal ?? '31.12.2099'),
            GenericLoteItems: asList(data.GenericLoteItems),
            Ceps: ceps.length ? ceps : null,
            Cnpjs: cnpjs.length ? cnpjs : null,
            FornOverrides: data.FornOverrides ?? null,
          }
          if (data.CentroPardini) o.CentroPardini = true
          return [key, o]
        }),
      ),
    }),
    blank: () => ({
      GenericLote: 'N',
      GenericVal: '31.12.2099',
      GenericLoteItems: [],
      Ceps: [],
      Cnpjs: [],
      CentroPardini: false,
      FornOverrides: null,
    }),
    fields: [
      { path: 'GenericLote', label: 'Generic Lote', type: 'text' },
      { path: 'GenericVal', label: 'Generic Val', type: 'text' },
      { path: 'GenericLoteItems', label: 'Generic Lote Items', type: 'list' },
      { path: 'Ceps', label: 'CEPs', type: 'list' },
      { path: 'Cnpjs', label: 'CNPJs', type: 'list' },
      { path: 'CentroPardini', label: 'Centro Pardini', type: 'boolean' },
    ],
  },
]

// Caminho do arquivo: mesma pasta do itens.json (config.itensPath).
function dirOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(0, i + 1) : ''
}

export function Cadastros() {
  const { config } = useApp()

  const [entId, setEntId] = useState<EntityConfig['id']>('fornecedores')
  const ent = useMemo(() => ENTIDADES.find(e => e.id === entId)!, [entId])

  const pathFor = useCallback(
    (e: EntityConfig) => {
      const override = localStorage.getItem('lnf_cadpath_' + e.id)
      if (override && override.trim()) return override.trim()
      return dirOf(config?.itensPath ?? 'itens.json') + e.file
    },
    [config?.itensPath],
  )

  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [sha, setSha] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [filtro, setFiltro] = useState('')
  const [selKey, setSelKey] = useState<string | null>(null)
  const [form, setForm] = useState<{ key: string; data: Data }>({ key: '', data: {} })

  const [salvando, setSalvando] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  // Carrega o arquivo da entidade selecionada.
  const carregar = useCallback(async () => {
    if (!config?.githubToken) return
    setCarregando(true)
    setErro(null)
    setStatus(null)
    setSelKey(null)
    setForm({ key: '', data: ent.blank() })
    const p = pathFor(ent)
    setPath(p)
    try {
      const svc = new GitHubService(config.githubToken, config.owner, config.repo)
      const { data, sha: s } = await svc.lerArquivo(p)
      setEntries(ent.parse(data))
      setSha(s)
    } catch (e) {
      setErro((e as Error).message)
      setEntries([])
      setSha(null)
    } finally {
      setCarregando(false)
    }
  }, [config, ent, pathFor])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const filtrados = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    const arr = f ? entries.filter(e => e.key.toLowerCase().includes(f)) : entries
    return [...arr].sort((a, b) => a.key.localeCompare(b.key))
  }, [entries, filtro])

  function selecionar(e: Entry) {
    setSelKey(e.key)
    setForm({ key: e.key, data: JSON.parse(JSON.stringify(e.data)) as Data })
    setStatus(null)
  }

  function novo() {
    setSelKey(null)
    setForm({ key: '', data: ent.blank() })
    setStatus(null)
  }

  function setCampo(pathStr: string, val: unknown) {
    setForm(f => ({ ...f, data: cloneSetPath(f.data, pathStr, val) }))
  }

  async function gravar(novosEntries: Entry[], msg: string) {
    if (!config) return
    if (!sha) {
      setStatus('❌ SHA do arquivo ausente — recarregue.')
      return
    }
    setSalvando(true)
    setStatus(null)
    try {
      const svc = new GitHubService(config.githubToken, config.owner, config.repo)
      const novoSha = await svc.gravarArquivo(path, ent.build(novosEntries), sha, msg)
      setSha(novoSha)
      setEntries(novosEntries)
    } finally {
      setSalvando(false)
    }
  }

  async function salvar() {
    const key = form.key.trim()
    if (!key) {
      setStatus(`⚠️ Informe o ${ent.keyLabel}.`)
      return
    }
    const usuario = config?.usuario ?? 'LNF-Web'

    let next: Entry[]
    if (selKey && entries.some(e => e.key === selKey)) {
      // Edição (com possível rename): substitui na mesma posição.
      next = entries.map(e => (e.key === selKey ? { key, data: form.data } : e))
      if (key !== selKey) next = next.filter((e, i) => !(e.key === key && entries[i]?.key !== selKey))
    } else if (entries.some(e => e.key === key)) {
      next = entries.map(e => (e.key === key ? { key, data: form.data } : e))
    } else {
      next = [...entries, { key, data: form.data }]
    }

    try {
      await gravar(next, `[${usuario}] Cadastro ${ent.label}: ${key}`)
      setSelKey(key)
      setStatus(`✅ "${key}" salvo com sucesso`)
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    }
  }

  async function remover() {
    if (!selKey) return
    if (!window.confirm(`Remover "${selKey}" de ${ent.label}?`)) return
    const usuario = config?.usuario ?? 'LNF-Web'
    const next = entries.filter(e => e.key !== selKey)
    try {
      await gravar(next, `[${usuario}] Remover ${ent.label}: ${selKey}`)
      novo()
      setStatus(`✅ "${selKey}" removido`)
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    }
  }

  // ── Guardas ────────────────────────────────────────────────────────────────
  if (!config) {
    return (
      <div className="p-6 text-center text-zinc-400 mt-12 space-y-2">
        <p className="text-4xl">🔑</p>
        <p>
          Configure o GitHub Token em <span className="text-white font-medium">Configurações</span>{' '}
          para começar.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 max-w-3xl mx-auto">
      {/* Seletor de entidade */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
        {ENTIDADES.map(e => (
          <button
            key={e.id}
            onClick={() => setEntId(e.id)}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              entId === e.id ? 'bg-green-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Caminho do arquivo */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-500 shrink-0">Arquivo:</label>
        <input
          value={path}
          onChange={e => setPath(e.target.value)}
          onBlur={() => {
            localStorage.setItem('lnf_cadpath_' + ent.id, path)
            void carregar()
          }}
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-green-500"
        />
      </div>

      {carregando && <p className="text-zinc-400 text-sm">Carregando {ent.label.toLowerCase()}...</p>}
      {erro && (
        <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">
          ❌ {erro}
        </div>
      )}

      {!carregando && !erro && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Lista de existentes */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={filtro}
                onChange={e => setFiltro(e.target.value)}
                placeholder={`Filtrar ${ent.label.toLowerCase()}...`}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
              />
              <button
                onClick={novo}
                className="px-3 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                + Novo
              </button>
            </div>
            <p className="text-xs text-zinc-500">{filtrados.length} de {entries.length}</p>
            <div className="border border-zinc-800 rounded-lg max-h-80 overflow-y-auto divide-y divide-zinc-800">
              {filtrados.map(e => (
                <button
                  key={e.key}
                  onClick={() => selecionar(e)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    e.key === selKey ? 'bg-green-900/40 text-white' : 'text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                >
                  {e.key || '(vazio)'}
                </button>
              ))}
              {filtrados.length === 0 && (
                <p className="text-xs text-zinc-500 p-3">Nenhum item.</p>
              )}
            </div>
          </div>

          {/* Formulário */}
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
                {ent.keyLabel}
              </label>
              <input
                value={form.key}
                onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                placeholder={selKey ? '' : `Novo ${ent.keyLabel.toLowerCase()}`}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
              />
            </div>

            {ent.fields.map(f => (
              <Campo
                key={f.path}
                spec={f}
                value={getPath(form.data, f.path)}
                onChange={v => setCampo(f.path, v)}
              />
            ))}

            {ent.id === 'centros' && form.data.FornOverrides != null && (
              <p className="text-[11px] text-zinc-500">
                FornOverrides preservado (não editável aqui):{' '}
                <span className="font-mono">{JSON.stringify(form.data.FornOverrides)}</span>
              </p>
            )}

            {status && (
              <div
                className={`rounded-lg p-2.5 text-sm ${
                  status.startsWith('✅')
                    ? 'bg-green-950 border border-green-800 text-green-300'
                    : status.startsWith('⚠️')
                      ? 'bg-yellow-950 border border-yellow-800 text-yellow-300'
                      : 'bg-red-950 border border-red-800 text-red-300'
                }`}
              >
                {status}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => void salvar()}
                disabled={salvando}
                className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition-colors"
              >
                {salvando ? 'Salvando...' : selKey ? 'Salvar alterações' : 'Adicionar'}
              </button>
              {selKey && (
                <button
                  onClick={() => void remover()}
                  disabled={salvando}
                  className="px-4 bg-zinc-800 hover:bg-red-900 border border-zinc-700 disabled:opacity-40 text-zinc-300 hover:text-red-200 rounded-lg text-sm transition-colors"
                >
                  Remover
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Campo genérico ───────────────────────────────────────────────────────────
function Campo({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (spec.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
        <input
          type="checkbox"
          checked={!!value}
          onChange={e => onChange(e.target.checked)}
          className="w-4 h-4 accent-green-500"
        />
        {spec.label}
      </label>
    )
  }

  if (spec.type === 'list') {
    const txt = asList(value).join('\n')
    return (
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
          {spec.label} <span className="text-zinc-600">(1 por linha)</span>
        </label>
        <textarea
          value={txt}
          onChange={e =>
            onChange(
              e.target.value
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean),
            )
          }
          rows={3}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-green-500 resize-y"
        />
      </div>
    )
  }

  if (spec.type === 'number') {
    return (
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
          {spec.label}
        </label>
        <input
          type="number"
          value={value == null ? '' : String(value)}
          onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
        />
      </div>
    )
  }

  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
        {spec.label}
      </label>
      <input
        value={value == null ? '' : String(value)}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
      />
    </div>
  )
}
