import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Histórico — leitura da tabela historico (todas as operações, todos os
// usuários). Busca geral, filtro por ação/usuário e exportação CSV.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>
const PAGE = 200

// Colunas escalares exibidas (na ordem). jsonb (nfs/detalhe) vão só no export.
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
  if (campo === 'created_at') {
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

  const [rows, setRows] = useState<Row[]>([])
  const [offset, setOffset] = useState(0)
  const [temMais, setTemMais] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [busca, setBusca] = useState('')
  const [filtroAcao, setFiltroAcao] = useState('')
  const [filtroUsuario, setFiltroUsuario] = useState('')

  const carregar = useCallback(
    async (off: number, anexar: boolean) => {
      if (!svc) return
      setCarregando(true)
      setErro(null)
      try {
        const conds: string[] = []
        if (filtroAcao) conds.push('acao=eq.' + encodeURIComponent(filtroAcao))
        if (filtroUsuario) conds.push('usuario=eq.' + encodeURIComponent(filtroUsuario))
        const page = await svc.lerLinhas('historico', {
          order: 'created_at.desc',
          limit: PAGE,
          offset: off,
          filtros: conds.length ? conds.join('&') : undefined,
        })
        setRows(prev => (anexar ? [...prev, ...page] : page))
        setTemMais(page.length === PAGE)
        setOffset(off + page.length)
      } catch (e) {
        setErro((e as Error).message)
        if (!anexar) setRows([])
      } finally {
        setCarregando(false)
      }
    },
    [svc, filtroAcao, filtroUsuario],
  )

  useEffect(() => {
    if (config?.paUrl) void carregar(0, false)
  }, [config?.paUrl, carregar])

  // Opções de filtro derivadas do que já foi carregado.
  const acoes = useMemo(
    () => [...new Set(rows.map(r => String(r.acao ?? '')).filter(Boolean))].sort(),
    [rows],
  )
  const usuarios = useMemo(
    () => [...new Set(rows.map(r => String(r.usuario ?? '')).filter(Boolean))].sort(),
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

  function exportarCsv() {
    const cabec = [...COLS.map(c => c.label), 'NFs', 'Detalhe']
    const linhas = filtradas.map(r => [
      ...COLS.map(c => csvEscape(fmt(c.campo, r[c.campo]))),
      csvEscape(JSON.stringify(r.nfs ?? [])),
      csvEscape(JSON.stringify(r.detalhe ?? {})),
    ])
    const csv = [cabec.join(','), ...linhas.map(l => l.join(','))].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `historico-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
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
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar em tudo..."
          className="flex-1 min-w-40 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
        />
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
        <button
          onClick={exportarCsv}
          disabled={filtradas.length === 0}
          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm transition-colors"
        >
          Exportar CSV
        </button>
      </div>

      <p className="text-xs text-zinc-500">{filtradas.length} linha(s){temMais ? '+' : ''}</p>
      {erro && <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">❌ {erro}</div>}

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
                  Nenhum registro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
