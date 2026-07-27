import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Cadastros — CRUD manual de fornecedores, usuários e centros, lendo/gravando
// direto no Supabase (sem Power Automate, sem GitHub).
//
//   • forn.json      → tabela fornecedores (PK nome)
//   • usersList.json → tabela usuarios     (PK username)
//   • centros.json   → tabela centros      (PK centro)
//
// A leitura reconstrói o shape JSON legado (via SupabaseService.lerArquivo);
// a escrita é POR LINHA (upsert/delete por entidade) — nada de reescrever o
// "arquivo" inteiro, o que elimina a perda de dados por truncamento.
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
  // Escrita por linha no Supabase. oldKey presente = rename (chave mudou).
  save: (svc: SupabaseService, key: string, data: Data, oldKey?: string) => Promise<void>
  remove: (svc: SupabaseService, key: string) => Promise<void>
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

// Só dígitos, 14 posições — mesma normalização do Coreon (FornecedorService),
// pra que o CNPJ gravado case com o lookup por CNPJ.
function normalizarCnpj(v: string): string | null {
  const d = (v ?? '').replace(/\D/g, '')
  if (!d) return null
  return d.length < 14 ? d.padStart(14, '0') : d
}

// Acrescenta um CNPJ à lista sem duplicar (compara normalizado).
function comCnpj(lista: string[], cnpj: string): string[] {
  const norm = normalizarCnpj(cnpj)
  if (!norm) return lista
  if (lista.some(x => normalizarCnpj(x) === norm)) return lista
  return [...lista, norm]
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
  'lancamentoFuturo',
  'internet',
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
  lancamentoFuturo: 'Lançamento Futuro',
  internet: 'Internet (MeuDanfe)',
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
    save: (svc, key, data, oldKey) => svc.salvarFornecedor(key, pruneForn(data), oldKey),
    remove: (svc, key) => svc.removerFornecedor(key),
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
    save: (svc, key, data, oldKey) =>
      svc.salvarUsuario(
        key,
        {
          centros: asList(data.centros),
          acessos: { ...acessosVazio(), ...((data.acessos as Record<string, boolean>) ?? {}) },
          nivelAdm: Number(data.nivelAdm) || 0,
        },
        oldKey,
      ),
    remove: (svc, key) => svc.removerUsuario(key),
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
    save: (svc, key, data, oldKey) =>
      svc.salvarCentro(
        key,
        {
          GenericLote: String(data.GenericLote ?? 'N'),
          GenericVal: String(data.GenericVal ?? '31.12.2099'),
          GenericLoteItems: asList(data.GenericLoteItems),
          Ceps: asList(data.Ceps),
          Cnpjs: asList(data.Cnpjs),
          CentroPardini: !!data.CentroPardini,
          FornOverrides: data.FornOverrides ?? {},
        },
        oldKey,
      ),
    remove: (svc, key) => svc.removerCentro(key),
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

  const svc = useMemo(
    () => (config ? new SupabaseService(config.paUrl, config.usuario) : null),
    [config],
  )

  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [filtro, setFiltro] = useState('')
  const [selKey, setSelKey] = useState<string | null>(null)
  const [form, setForm] = useState<{ key: string; data: Data }>({ key: '', data: {} })

  const [salvando, setSalvando] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  // Solicitações de cadastro de fornecedor (tabela solicitacoes_forn, pendentes).
  const [solic, setSolic] = useState<Array<Record<string, unknown>>>([])
  const [solicCnpj, setSolicCnpj] = useState<string | null>(null) // solicitação sendo atendida

  const carregarSolic = useCallback(async () => {
    if (!svc || entId !== 'fornecedores') {
      setSolic([])
      return
    }
    try {
      setSolic(
        await svc.lerLinhas('solicitacoes_forn', {
          filtros: 'status=eq.pendente',
          order: 'created_at.desc',
          limit: 200,
        }),
      )
    } catch {
      setSolic([]) // tabela pode não existir ainda — silencioso
    }
  }, [svc, entId])

  useEffect(() => {
    void carregarSolic()
  }, [carregarSolic])

  // Carrega a entidade selecionada (tabela do Supabase, via shape legado).
  const carregar = useCallback(async () => {
    if (!svc) return
    setCarregando(true)
    setErro(null)
    setStatus(null)
    setSelKey(null)
    setForm({ key: '', data: ent.blank() })
    const p = pathFor(ent)
    setPath(p)
    try {
      const { data } = await svc.lerArquivo(p)
      setEntries(ent.parse(data))
    } catch (e) {
      setErro((e as Error).message)
      setEntries([])
    } finally {
      setCarregando(false)
    }
  }, [svc, ent, pathFor])

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
    setSolicCnpj(null)
  }

  function novo() {
    setSelKey(null)
    setForm({ key: '', data: ent.blank() })
    setStatus(null)
    setSolicCnpj(null)
  }

  // "Cadastrar" a partir de uma solicitação: pré-preenche o nome como chave e
  // o CNPJ na lista.
  //
  // Se o nome JÁ existe, isto é COMPLEMENTO e não cadastro novo: carrega os
  // dados atuais do fornecedor e só ACRESCENTA o CNPJ. Sem isso o save gravaria
  // a linha com apenas esse CNPJ e o resto em branco — apagando as demais
  // filiais e toda a configuração de processamento do fornecedor.
  function cadastrarDeSolic(sol: Record<string, unknown>) {
    const cnpj = String(sol.cnpj ?? '')
    const nome = String(sol.nome ?? '').trim()

    const existente = entries.find(e => e.key.trim().toLowerCase() === nome.toLowerCase())
    if (existente) {
      const data = JSON.parse(JSON.stringify(existente.data)) as Data
      data.cnpjs = comCnpj(asList(data.cnpjs), cnpj)
      setSelKey(existente.key)
      setForm({ key: existente.key, data })
      setSolicCnpj(cnpj || null)
      setStatus(`ℹ️ "${existente.key}" já é cadastrado — CNPJ somado aos existentes. Revise e salve.`)
      return
    }

    setSelKey(null)
    setForm({ key: nome, data: { cnpjs: comCnpj([], cnpj) } })
    setSolicCnpj(cnpj || null)
    setStatus('ℹ️ Revise e salve para concluir o cadastro.')
  }

  async function ignorarSolic(sol: Record<string, unknown>) {
    if (!svc) return
    const cnpj = String(sol.cnpj ?? '')
    if (!cnpj) return
    try {
      await svc.salvarLinha('solicitacoes_forn', { cnpj, status: 'ignorado' }, 'cnpj')
      await carregarSolic()
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    }
  }

  function setCampo(pathStr: string, val: unknown) {
    setForm(f => ({ ...f, data: cloneSetPath(f.data, pathStr, val) }))
  }

  // Recalcula a lista local após um save (com possível rename), espelhando o
  // que foi gravado por linha no Supabase.
  function aplicarLocal(key: string, data: Data = form.data): Entry[] {
    if (selKey && entries.some(e => e.key === selKey)) {
      let next = entries.map(e => (e.key === selKey ? { key, data } : e))
      if (key !== selKey) next = next.filter((e, i) => !(e.key === key && entries[i]?.key !== selKey))
      return next
    }
    if (entries.some(e => e.key === key)) {
      return entries.map(e => (e.key === key ? { key, data } : e))
    }
    return [...entries, { key, data }]
  }

  // Rede de segurança pro cadastro de fornecedor: o nome digitado já existe mas
  // NÃO é o registro aberto na tela (veio de "novo" ou de uma solicitação). O
  // save é por linha inteira, então gravar o form como está apagaria os CNPJs
  // das outras filiais e a configuração. Aqui o form é fundido SOBRE o cadastro
  // atual e os CNPJs entram somados — nome repetido complementa, não substitui.
  function fundirSeExistente(key: string, data: Data): Data {
    if (entId !== 'fornecedores') return data
    const existente = entries.find(e => e.key.trim().toLowerCase() === key.toLowerCase())
    if (!existente || existente.key === selKey) return data

    const base = JSON.parse(JSON.stringify(existente.data)) as Data
    for (const [k, v] of Object.entries(data)) base[k] = v

    let uniao = asList(existente.data.cnpjs)
    for (const c of asList(data.cnpjs)) uniao = comCnpj(uniao, c)
    base.cnpjs = uniao
    return base
  }

  async function salvar() {
    if (!svc) return
    const key = form.key.trim()
    if (!key) {
      setStatus(`⚠️ Informe o ${ent.keyLabel}.`)
      return
    }
    setSalvando(true)
    setStatus(null)
    try {
      const oldKey = selKey && selKey !== key ? selKey : undefined
      const dados = fundirSeExistente(key, form.data)
      await ent.save(svc, key, dados, oldKey)
      setEntries(aplicarLocal(key, dados))
      setSelKey(key)
      setStatus(`✅ "${key}" salvo com sucesso`)

      // Se veio de uma solicitação de cadastro, marca como concluída.
      if (entId === 'fornecedores' && solicCnpj) {
        try {
          await svc.salvarLinha('solicitacoes_forn', { cnpj: solicCnpj, status: 'cadastrado' }, 'cnpj')
          setSolicCnpj(null)
          await carregarSolic()
        } catch {
          /* não bloqueia o sucesso do cadastro */
        }
      }
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  async function remover() {
    if (!svc || !selKey) return
    if (!window.confirm(`Remover "${selKey}" de ${ent.label}?`)) return
    setSalvando(true)
    setStatus(null)
    try {
      await ent.remove(svc, selKey)
      setEntries(entries.filter(e => e.key !== selKey))
      const removido = selKey
      novo()
      setStatus(`✅ "${removido}" removido`)
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  // ── Guardas ────────────────────────────────────────────────────────────────
  if (!config) {
    return (
      <div className="p-6 text-center text-zinc-400 mt-12 space-y-2">
        <p className="text-4xl">🔑</p>
        <p>
          Configure a conexão do Supabase em{' '}
          <span className="text-white font-medium">Configurações</span> para começar.
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

      {/* Solicitações de cadastro de fornecedor (pendentes) */}
      {entId === 'fornecedores' && solic.length > 0 && (
        <div className="border border-amber-800/60 bg-amber-950/30 rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-amber-300">
            {solic.length} solicitação(ões) de cadastro de fornecedor
          </p>
          <div className="divide-y divide-amber-900/40 max-h-56 overflow-y-auto">
            {solic.map(s => (
              <div key={String(s.cnpj)} className="flex items-center gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-zinc-100 truncate">{String(s.nome || '(sem nome)')}</p>
                  <p className="text-xs text-zinc-500">
                    CNPJ {String(s.cnpj)}
                    {s.usuario ? ` · ${String(s.usuario)}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => cadastrarDeSolic(s)}
                  className="px-2.5 py-1 bg-green-700 hover:bg-green-600 text-white rounded text-xs font-medium transition-colors"
                >
                  Cadastrar
                </button>
                <button
                  onClick={() => void ignorarSolic(s)}
                  className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded text-xs transition-colors"
                >
                  Ignorar
                </button>
              </div>
            ))}
          </div>
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
