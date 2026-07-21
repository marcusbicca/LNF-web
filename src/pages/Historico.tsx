import { useCallback, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Histórico / Debug — dois modos na mesma janela.
//   • Histórico: tabela historico (todas as operações). Busca, filtros, CSV.
//   • Debug:     tabela debug (1 linha por usuário/tipo, com o log em 'conteudo').
//                Lista + expandir pra ler o conteúdo (copiar/baixar).
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>
type Modo = 'historico' | 'debug'

// Colunas escalares do histórico (na ordem). jsonb (nfs/detalhe) vão só no export.
const COLS: Array<{ campo: string; label: string }> = [
  { campo: 'created_at', label: 'Data' },
  { campo: 'usuario', label: 'Usuário' },
  { campo: 'acao', label: 'Ação' },
  { campo: 'sucesso', label: 'OK' },
  { campo: 'codigo', label: 'Código' },
  { campo: 'mensagem', label: 'Mensagem' },
  { campo: 'maquina', label: 'Máquina' },
  { campo: 'login_sap', label: 'Login SAP' },
  { campo: 'tempo_ms', label: 'Tempo (ms)' },
]

function fmt(campo: string, v: unknown): string {
  if (v == null) return ''
  if (campo === 'created_at' || campo === 'updated_at') {
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('pt-BR')
  }
  if (campo === 'sucesso') return v === true ? '✓' : '✗'
  return String(v)
}

function csvEscape(s: string): string {
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function Historico() {
  const { config } = useApp()
  const svc = useMemo(
    () => (config ? new SupabaseService(config.paUrl, config.usuario) : null),
    [config],
  )

  const [modo, setModo] = useState<Modo>('historico')
  const [rows, setRows] = useState<Row[]>([])
  const [offset, setOffset] = useState(0)
  const [temMais, setTemMais] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [busca, setBusca] = useState('')
  const [filtroAcao, setFiltroAcao] = useState('')
  const [filtroUsuario, setFiltroUsuario] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [limite, setLimite] = useState(200)
  const [buscou, setBuscou] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)

  const carregar = useCallback(
    async (off: number, anexar: boolean) => {
      if (!svc) return
      setCarregando(true)
      setErro(null)
      setBuscou(true)
      const lim = Math.max(1, Number(limite) || 200)
      try {
        // Coluna de data por modo (historico=created_at, debug=updated_at).
        const col = modo === 'historico' ? 'created_at' : 'updated_at'
        const conds: string[] = []
        if (filtroUsuario) conds.push('usuario=eq.' + encodeURIComponent(filtroUsuario))
        if (modo === 'historico' && filtroAcao) conds.push('acao=eq.' + encodeURIComponent(filtroAcao))
        if (modo === 'debug' && filtroTipo) conds.push('tipo=eq.' + encodeURIComponent(filtroTipo))
        if (dataInicio) conds.push(`${col}=gte.${dataInicio}`)
        if (dataFim) conds.push(`${col}=lte.${dataFim}T23:59:59`)
        const page = await svc.lerLinhas(modo, {
          order: col + '.desc',
          limit: lim,
          offset: off,
          filtros: conds.length ? conds.join('&') : undefined,
        })
        setRows(prev => (anexar ? [...prev, ...page] : page))
        setTemMais(page.length === lim)
        setOffset(off + page.length)
      } catch (e) {
        setErro((e as Error).message)
        if (!anexar) setRows([])
      } finally {
        setCarregando(false)
      }
    },
    [svc, modo, filtroAcao, filtroUsuario, filtroTipo, dataInicio, dataFim, limite],
  )

  // NÃO carrega ao abrir — a busca só acontece ao clicar "Buscar".

  // Opções de filtro derivadas do que já foi carregado.
  const usuarios = useMemo(
    () => [...new Set(rows.map(r => String(r.usuario ?? '')).filter(Boolean))].sort(),
    [rows],
  )
  const acoes = useMemo(
    () => [...new Set(rows.map(r => String(r.acao ?? '')).filter(Boolean))].sort(),
    [rows],
  )
  const tipos = useMemo(
    () => [...new Set(rows.map(r => String(r.tipo ?? '')).filter(Boolean))].sort(),
    [rows],
  )

  // Busca geral (client-side) sobre todos os valores da linha.
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      Object.values(r).some(v => JSON.stringify(v ?? '').toLowerCase().includes(q)),
    )
  }, [rows, busca])

  function trocarModo(m: Modo) {
    if (m === modo) return
    setModo(m)
    setRows([])
    setOffset(0)
    setTemMais(false)
    setExpandido(null)
    setBusca('')
    setFiltroAcao('')
    setFiltroTipo('')
    setBuscou(false)
  }

  function exportarCsv() {
    const cabec = [...COLS.map(c => c.label), 'NFs', 'Detalhe']
    const linhas = filtradas.map(r => [
      ...COLS.map(c => csvEscape(fmt(c.campo, r[c.campo]))),
      csvEscape(JSON.stringify(r.nfs ?? [])),
      csvEscape(JSON.stringify(r.detalhe ?? {})),
    ])
    const csv = [cabec.join(','), ...linhas.map(l => l.join(','))].join('\n')
    baixar(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `historico-${hoje()}.csv`)
  }

  function baixarConteudo(usuario: string, tipo: string, conteudo: string) {
    baixar(new Blob([conteudo], { type: 'text/plain;charset=utf-8' }), `debug-${usuario}-${tipo}-${hoje()}.txt`)
  }

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
    <div className="p-4 space-y-3 max-w-5xl mx-auto">
      {/* Seletor de modo */}
      <div className="inline-flex rounded-lg border border-zinc-700 overflow-hidden text-sm">
        {(['historico', 'debug'] as Modo[]).map(m => (
          <button
            key={m}
            onClick={() => trocarModo(m)}
            className={`px-4 py-1.5 transition-colors ${
              modo === m ? 'bg-green-600 text-white' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {m === 'historico' ? 'Histórico' : 'Debug'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Filtrar carregados..."
          className="flex-1 min-w-40 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
        />
        {modo === 'historico' && (
          <select
            value={filtroAcao}
            onChange={e => setFiltroAcao(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-green-500"
          >
            <option value="">Ação: todas</option>
            {acoes.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        )}
        {modo === 'debug' && (
          <select
            value={filtroTipo}
            onChange={e => setFiltroTipo(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-green-500"
          >
            <option value="">Tipo: todos</option>
            {tipos.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        <select
          value={filtroUsuario}
          onChange={e => setFiltroUsuario(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-green-500"
        >
          <option value="">Usuário: todos</option>
          {usuarios.map(u => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <input
          type="date"
          value={dataInicio}
          onChange={e => setDataInicio(e.target.value)}
          title="Data inicial (opcional)"
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-green-500"
        />
        <input
          type="date"
          value={dataFim}
          onChange={e => setDataFim(e.target.value)}
          title="Data final (opcional)"
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-green-500"
        />
        <input
          type="number"
          min={1}
          value={limite}
          onChange={e => setLimite(Number(e.target.value))}
          title="Máximo de linhas (as últimas N do período)"
          className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-green-500"
        />
        <button
          onClick={() => void carregar(0, false)}
          disabled={carregando}
          className="bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          Buscar
        </button>
        {modo === 'historico' && (
          <button
            onClick={exportarCsv}
            disabled={filtradas.length === 0}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm transition-colors"
          >
            Exportar CSV
          </button>
        )}
      </div>

      <p className="text-xs text-zinc-500">{filtradas.length} linha(s){temMais ? '+' : ''}</p>
      {erro && <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">❌ {erro}</div>}

      {modo === 'historico' ? (
        <div className="border border-zinc-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                {COLS.map(c => (
                  <th key={c.campo} className="text-left font-medium px-2.5 py-2 whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th className="text-left font-medium px-2.5 py-2">NFs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filtradas.map((r, i) => {
                const nfs = Array.isArray(r.nfs) ? (r.nfs as unknown[]) : []
                return (
                  <tr key={i} className="hover:bg-zinc-800/40">
                    {COLS.map(c => (
                      <td
                        key={c.campo}
                        className={`px-2.5 py-1.5 align-top ${
                          c.campo === 'mensagem' ? 'max-w-xs truncate' : 'whitespace-nowrap'
                        } ${c.campo === 'sucesso' ? (r.sucesso ? 'text-green-400' : 'text-red-400') : 'text-zinc-300'}`}
                        title={c.campo === 'mensagem' ? String(r.mensagem ?? '') : undefined}
                      >
                        {fmt(c.campo, r[c.campo])}
                      </td>
                    ))}
                    <td className="px-2.5 py-1.5 text-zinc-500 whitespace-nowrap">{nfs.length}</td>
                  </tr>
                )
              })}
              {filtradas.length === 0 && !carregando && (
                <tr>
                  <td colSpan={COLS.length + 1} className="px-3 py-4 text-center text-zinc-500 text-xs">
                    {buscou ? 'Nenhum registro.' : 'Defina os filtros (data / limite) e clique Buscar.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800">
          {filtradas.map(r => {
            const usuario = String(r.usuario ?? '')
            const tipo = String(r.tipo ?? '')
            const conteudo = String(r.conteudo ?? '')
            const chave = `${usuario}|${tipo}`
            const aberto = expandido === chave
            return (
              <div key={chave}>
                <button
                  onClick={() => setExpandido(aberto ? null : chave)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-800/40 transition-colors"
                >
                  <span className="text-zinc-500 w-4">{aberto ? '▾' : '▸'}</span>
                  <span className="text-zinc-200 font-medium">{usuario || '(sem usuário)'}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{tipo}</span>
                  <span className="ml-auto text-xs text-zinc-500 whitespace-nowrap">
                    {fmt('updated_at', r.updated_at)}
                  </span>
                </button>
                {aberto && (
                  <div className="px-3 pb-3 space-y-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => void navigator.clipboard?.writeText(conteudo)}
                        className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1 text-zinc-300"
                      >
                        Copiar
                      </button>
                      <button
                        onClick={() => baixarConteudo(usuario, tipo, conteudo)}
                        className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1 text-zinc-300"
                      >
                        Baixar .txt
                      </button>
                    </div>
                    <pre className="max-h-96 overflow-auto bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-300 whitespace-pre-wrap break-words">
                      {conteudo || '(vazio)'}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
          {filtradas.length === 0 && !carregando && (
            <div className="px-3 py-4 text-center text-zinc-500 text-xs">
              {buscou ? 'Nenhum debug.' : 'Defina os filtros e clique Buscar.'}
            </div>
          )}
        </div>
      )}

      {carregando && <p className="text-zinc-400 text-sm">Carregando...</p>}
      {temMais && !carregando && (
        <button
          onClick={() => void carregar(offset, true)}
          className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors"
        >
          Carregar mais
        </button>
      )}
    </div>
  )
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}
