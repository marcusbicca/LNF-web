import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'
import {
  parseTabelas,
  paraEdicao,
  paraGravar,
  type TabelaMeta,
  type ColunaMeta,
  type EditVal,
} from '../services/schema'

// ─────────────────────────────────────────────────────────────────────────────
// Tabelas — editor universal. Descobre as tabelas/colunas do Supabase via
// OpenAPI do PostgREST e monta o formulário sozinho:
//   boolean → checkbox · number → numérico · text → caixa de texto
//   array   → textarea (1 item por linha) · jsonb → editor de JSON validado
//   timestamp/PK auto → só leitura (o banco gerencia)
//
// Não precisa adaptar o código quando surge tabela ou coluna nova.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>
const PAGE = 100

export function Tabelas() {
  const { config } = useApp()
  const svc = useMemo(
    () => (config ? new SupabaseService(config.supabaseUrl, config.supabaseKey) : null),
    [config],
  )

  const [tabelas, setTabelas] = useState<TabelaMeta[]>([])
  const [carregandoTabelas, setCarregandoTabelas] = useState(false)
  const [erroTabelas, setErroTabelas] = useState<string | null>(null)

  const [tab, setTab] = useState<TabelaMeta | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [offset, setOffset] = useState(0)
  const [temMais, setTemMais] = useState(false)
  const [carregandoRows, setCarregandoRows] = useState(false)
  const [erroRows, setErroRows] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')

  const [selData, setSelData] = useState<Row | null>(null) // null = linha nova
  const [ehNovo, setEhNovo] = useState(false)
  const [form, setForm] = useState<Record<string, EditVal>>({})
  const [salvando, setSalvando] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const somenteLeitura = !!tab && tab.pkCols.length === 0

  const orderOf = useCallback((t: TabelaMeta) => {
    return (t.pkCols.length ? t.pkCols : t.colunas.slice(0, 1).map(c => c.nome)).join(',')
  }, [])

  const firstTextPk = useMemo(() => {
    if (!tab) return null
    return tab.pkCols.find(c => tab.colunas.find(x => x.nome === c)?.tipo === 'text') ?? null
  }, [tab])

  // ── carrega a lista de tabelas via OpenAPI ─────────────────────────────────
  const carregarTabelas = useCallback(async () => {
    if (!svc) return
    setCarregandoTabelas(true)
    setErroTabelas(null)
    try {
      const doc = await svc.openApi()
      setTabelas(parseTabelas(doc as never))
    } catch (e) {
      setErroTabelas((e as Error).message)
    } finally {
      setCarregandoTabelas(false)
    }
  }, [svc])

  useEffect(() => {
    void carregarTabelas()
  }, [carregarTabelas])

  // ── carrega uma página de linhas ───────────────────────────────────────────
  const carregarPagina = useCallback(
    async (t: TabelaMeta, off: number, termo: string, anexar: boolean) => {
      if (!svc) return
      setCarregandoRows(true)
      setErroRows(null)
      try {
        const filtros =
          termo.trim() && firstTextPk
            ? `${firstTextPk}=ilike.*${encodeURIComponent(termo.trim())}*`
            : undefined
        const page = await svc.lerLinhas(t.nome, {
          order: orderOf(t),
          limit: PAGE,
          offset: off,
          filtros,
        })
        setRows(prev => (anexar ? [...prev, ...page] : page))
        setTemMais(page.length === PAGE)
        setOffset(off + page.length)
      } catch (e) {
        setErroRows((e as Error).message)
        if (!anexar) setRows([])
      } finally {
        setCarregandoRows(false)
      }
    },
    [svc, orderOf, firstTextPk],
  )

  function selecionarTabela(t: TabelaMeta) {
    setTab(t)
    setRows([])
    setOffset(0)
    setFiltro('')
    setSelData(null)
    setEhNovo(false)
    setForm({})
    setStatus(null)
    void carregarPagina(t, 0, '', false)
  }

  // busca (debounce simples por Enter/blur do input)
  function buscar() {
    if (tab) void carregarPagina(tab, 0, filtro, false)
  }

  const filtrados = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    if (!f) return rows
    return rows.filter(r =>
      Object.values(r).some(v => String(v ?? '').toLowerCase().includes(f)),
    )
  }, [rows, filtro])

  // ── seleção / novo ─────────────────────────────────────────────────────────
  function selecionarRow(r: Row) {
    if (!tab) return
    setSelData(r)
    setEhNovo(false)
    setForm(montarForm(tab, r))
    setStatus(null)
  }

  function novo() {
    if (!tab) return
    setSelData(null)
    setEhNovo(true)
    setForm(montarForm(tab, null))
    setStatus(null)
  }

  function setCampo(col: string, val: EditVal) {
    setForm(f => ({ ...f, [col]: val }))
  }

  function pkFiltro(r: Row): string {
    if (!tab) return ''
    return tab.pkCols
      .map(c => `${c}=eq.${encodeURIComponent(String(r[c]))}`)
      .join('&')
  }

  // ── gravar ─────────────────────────────────────────────────────────────────
  async function salvar() {
    if (!svc || !tab || somenteLeitura) return
    setStatus(null)
    let payload: Row
    try {
      payload = montarPayload(tab, form, ehNovo)
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
      return
    }
    // PKs obrigatórias em linha nova de PK natural
    if (ehNovo && !tab.autoPk) {
      for (const c of tab.pkCols) {
        if (payload[c] == null || payload[c] === '') {
          setStatus(`⚠️ Preencha a chave "${c}".`)
          return
        }
      }
    }
    const onConflict = ehNovo && tab.autoPk ? null : tab.pkCols.join(',')

    setSalvando(true)
    try {
      await svc.salvarLinha(tab.nome, payload, onConflict)
      setStatus('✅ Linha gravada')
      await carregarPagina(tab, 0, filtro, false)
      // mantém em modo edição se PK natural conhecida
      if (!tab.autoPk) {
        setSelData(payload)
        setEhNovo(false)
      } else {
        novo()
      }
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  async function remover() {
    if (!svc || !tab || !selData || somenteLeitura) return
    const rotulo = tab.pkCols.map(c => selData[c]).join(' · ')
    if (!window.confirm(`Remover a linha "${rotulo}" de ${tab.nome}?`)) return
    setSalvando(true)
    setStatus(null)
    try {
      await svc.deletarLinha(tab.nome, pkFiltro(selData))
      setStatus('✅ Linha removida')
      novo()
      await carregarPagina(tab, 0, filtro, false)
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
      {/* Seletor de tabela */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-zinc-400 shrink-0">Tabela:</label>
        <select
          value={tab?.nome ?? ''}
          onChange={e => {
            const t = tabelas.find(x => x.nome === e.target.value)
            if (t) selecionarTabela(t)
          }}
          disabled={carregandoTabelas || tabelas.length === 0}
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
        >
          <option value="" disabled>
            {carregandoTabelas ? 'Carregando tabelas...' : 'Selecione uma tabela'}
          </option>
          {tabelas.map(t => (
            <option key={t.nome} value={t.nome}>
              {t.nome}
            </option>
          ))}
        </select>
        <button
          onClick={() => void carregarTabelas()}
          title="Recarregar schema"
          className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors"
        >
          ⟳
        </button>
      </div>

      {erroTabelas && (
        <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">
          ❌ {erroTabelas}
        </div>
      )}

      {tab && (
        <>
          {somenteLeitura && (
            <div className="bg-yellow-950 border border-yellow-800 rounded-lg p-2.5 text-yellow-300 text-xs">
              Esta tabela não tem chave primária detectada — somente leitura.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Lista de linhas */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={filtro}
                  onChange={e => setFiltro(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && buscar()}
                  onBlur={buscar}
                  placeholder="Filtrar (Enter busca no servidor)..."
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                />
                {!somenteLeitura && (
                  <button
                    onClick={novo}
                    className="px-3 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    + Novo
                  </button>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                {filtrados.length} linha(s){temMais ? '+' : ''}
              </p>
              <div className="border border-zinc-800 rounded-lg max-h-80 overflow-y-auto divide-y divide-zinc-800">
                {filtrados.map((r, i) => (
                  <RowLinha
                    key={i}
                    tab={tab}
                    row={r}
                    selecionado={selData != null && mesmaPk(tab, r, selData)}
                    onClick={() => selecionarRow(r)}
                  />
                ))}
                {filtrados.length === 0 && !carregandoRows && (
                  <p className="text-xs text-zinc-500 p-3">Nenhuma linha.</p>
                )}
              </div>
              {carregandoRows && <p className="text-zinc-400 text-sm">Carregando...</p>}
              {erroRows && <p className="text-red-300 text-sm">❌ {erroRows}</p>}
              {temMais && !carregandoRows && (
                <button
                  onClick={() => void carregarPagina(tab, offset, filtro, true)}
                  className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors"
                >
                  Carregar mais
                </button>
              )}
            </div>

            {/* Formulário dinâmico */}
            <div className="space-y-3">
              {(selData || ehNovo) ? (
                <>
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                    {ehNovo ? 'Nova linha' : 'Editando'} · {tab.nome}
                  </p>
                  {tab.colunas.map(col => (
                    <CampoDinamico
                      key={col.nome}
                      col={col}
                      value={form[col.nome]}
                      onChange={v => setCampo(col.nome, v)}
                      ehNovo={ehNovo}
                      autoPk={tab.autoPk}
                    />
                  ))}

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

                  {!somenteLeitura && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => void salvar()}
                        disabled={salvando}
                        className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition-colors"
                      >
                        {salvando ? 'Gravando...' : 'Gravar'}
                      </button>
                      {selData && !ehNovo && (
                        <button
                          onClick={() => void remover()}
                          disabled={salvando}
                          className="px-4 bg-zinc-800 hover:bg-red-900 border border-zinc-700 disabled:opacity-40 text-zinc-300 hover:text-red-200 rounded-lg text-sm transition-colors"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-zinc-500 mt-2">
                  Selecione uma linha para editar{!somenteLeitura ? ' ou clique em + Novo' : ''}.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── helpers de estado ──────────────────────────────────────────────────────
function montarForm(tab: TabelaMeta, row: Row | null): Record<string, EditVal> {
  const f: Record<string, EditVal> = {}
  for (const col of tab.colunas) {
    f[col.nome] = row ? paraEdicao(col, row[col.nome]) : col.tipo === 'boolean' ? false : ''
  }
  return f
}

function montarPayload(tab: TabelaMeta, form: Record<string, EditVal>, ehNovo: boolean): Row {
  const payload: Row = {}
  for (const col of tab.colunas) {
    if (col.tipo === 'datetime' && col.temDefault) continue // gerido pelo banco
    if (ehNovo && tab.autoPk && col.nome === 'id') continue // identity → banco gera
    payload[col.nome] = paraGravar(col, form[col.nome])
  }
  return payload
}

function mesmaPk(tab: TabelaMeta, a: Row, b: Row): boolean {
  return tab.pkCols.every(c => String(a[c]) === String(b[c]))
}

// ── linha da lista ──────────────────────────────────────────────────────────
function RowLinha({
  tab,
  row,
  selecionado,
  onClick,
}: {
  tab: TabelaMeta
  row: Row
  selecionado: boolean
  onClick: () => void
}) {
  const chave = tab.pkCols.map(c => String(row[c] ?? '')).join(' · ') || '(sem pk)'
  const descCol = tab.colunas.find(
    c => !c.pk && (c.tipo === 'text' || c.tipo === 'array') && row[c.nome] != null,
  )
  const secundario = descCol ? String(row[descCol.nome]) : ''
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 transition-colors ${
        selecionado ? 'bg-green-900/40 text-white' : 'text-zinc-300 hover:bg-zinc-800/60'
      }`}
    >
      <p className="text-sm font-mono truncate">{chave}</p>
      {secundario && <p className="text-xs text-zinc-500 truncate mt-0.5">{secundario}</p>}
    </button>
  )
}

// ── campo dinâmico por tipo de coluna ────────────────────────────────────────
function CampoDinamico({
  col,
  value,
  onChange,
  ehNovo,
  autoPk,
}: {
  col: ColunaMeta
  value: EditVal
  onChange: (v: EditVal) => void
  ehNovo: boolean
  autoPk: boolean
}) {
  // PK: auto (identity) → não editável; natural em linha existente → travada.
  const pkAuto = col.pk && autoPk && col.nome === 'id'
  const pkTravada = col.pk && !ehNovo && !pkAuto
  const dateGerido = col.tipo === 'datetime' && col.temDefault
  const readOnly = pkAuto || pkTravada || dateGerido

  const rotulo = (
    <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
      {col.nome}
      {col.pk && <span className="ml-1 text-amber-500">PK</span>}
      {col.required && <span className="ml-1 text-red-500">*</span>}
      <span className="ml-1 text-zinc-600 lowercase">
        {col.tipo}
        {readOnly ? ' · auto' : ''}
      </span>
    </label>
  )

  if (readOnly) {
    return (
      <div>
        {rotulo}
        <input
          value={pkAuto && ehNovo ? '(gerado pelo banco)' : String(value ?? '')}
          readOnly
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-400 font-mono"
        />
      </div>
    )
  }

  if (col.tipo === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer py-1">
        <input
          type="checkbox"
          checked={value === true}
          onChange={e => onChange(e.target.checked)}
          className="w-4 h-4 accent-green-500"
        />
        {col.nome}
        {col.pk && <span className="text-amber-500 text-xs">PK</span>}
      </label>
    )
  }

  if (col.tipo === 'array') {
    return (
      <div>
        {rotulo}
        <textarea
          value={String(value ?? '')}
          onChange={e => onChange(e.target.value)}
          rows={3}
          placeholder={`um ${col.itemTipo === 'number' ? 'número' : 'item'} por linha`}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-green-500 resize-y"
        />
      </div>
    )
  }

  if (col.tipo === 'json') {
    let jsonInvalido = false
    const s = String(value ?? '').trim()
    if (s) {
      try {
        JSON.parse(s)
      } catch {
        jsonInvalido = true
      }
    }
    return (
      <div>
        {rotulo}
        <textarea
          value={String(value ?? '')}
          onChange={e => onChange(e.target.value)}
          rows={4}
          placeholder="{ }"
          className={`w-full bg-zinc-900 border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none resize-y ${
            jsonInvalido ? 'border-red-700 focus:border-red-500' : 'border-zinc-700 focus:border-green-500'
          }`}
        />
        {jsonInvalido && <p className="text-[11px] text-red-400 mt-1">JSON inválido</p>}
      </div>
    )
  }

  // number / text / datetime editável
  return (
    <div>
      {rotulo}
      <input
        type={col.tipo === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
      />
    </div>
  )
}
