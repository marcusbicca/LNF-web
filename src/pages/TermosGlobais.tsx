import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Termos Globais — o fallback de termos que o Coreon usa quando o fornecedor
// não tem os próprios. A tabela é REPLACE-ALL (sem chave natural), então um
// editor dedicado é mais seguro que o grid: monta as duas listas (genéricos e
// "fim de termo"), e grava tudo de uma vez via replaceTermosGlobais.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>
interface Termo { tipo: string; texto: string }

export function TermosGlobais() {
  const { config } = useApp()
  const svc = useMemo(() => (config ? new SupabaseService(config) : null), [config])

  const [genericos, setGenericos] = useState<Termo[]>([])
  const [fim, setFim] = useState<Termo[]>([])
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!svc) return
    setCarregando(true)
    setErro(null)
    setStatus(null)
    try {
      const rows = (await svc.lerLinhas('termos_globais', { order: 'ordem' })) as Row[]
      const toT = (r: Row): Termo => ({ tipo: String(r.tipo ?? ''), texto: String(r.texto ?? '') })
      setGenericos(rows.filter(r => !r.is_fim).map(toT))
      setFim(rows.filter(r => !!r.is_fim).map(toT))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [svc])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function salvar() {
    if (!svc) return
    setSalvando(true)
    setStatus(null)
    try {
      // Descarta linhas totalmente vazias (tipo e texto em branco).
      const limpo = (l: Termo[]) => l.filter(t => t.tipo.trim() || t.texto.trim())
      await svc.replaceTermosGlobais({
        TermosGenericos: limpo(genericos).map(t => ({ Tipo: t.tipo.trim(), Texto: t.texto })),
        FimTermos: limpo(fim).map(t => ({ Tipo: t.tipo.trim(), Texto: t.texto })),
      })
      setStatus('✅ Termos globais salvos.')
      await carregar()
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  if (!config)
    return (
      <div className="p-6 text-center text-zinc-400 mt-12 space-y-2">
        <p className="text-4xl">🔑</p>
        <p>Configure a conexão em Configurações para começar.</p>
      </div>
    )

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Termos Globais</h2>
        <button
          onClick={() => void carregar()}
          disabled={carregando}
          className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded text-zinc-300"
        >
          {carregando ? 'Lendo...' : 'Recarregar'}
        </button>
      </div>

      <p className="text-xs text-zinc-500">
        Fallback usado quando o fornecedor não tem termos próprios daquele tipo. Salvar reescreve as
        duas listas inteiras.
      </p>

      {erro && (
        <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">❌ {erro}</div>
      )}

      <Lista titulo="Termos genéricos" itens={genericos} onChange={setGenericos} />
      <Lista titulo="Fim de termo (FimTermos)" itens={fim} onChange={setFim} />

      {status && (
        <div
          className={`rounded-lg p-2.5 text-sm ${
            status.startsWith('✅')
              ? 'bg-green-950 border border-green-800 text-green-300'
              : 'bg-red-950 border border-red-800 text-red-300'
          }`}
        >
          {status}
        </div>
      )}

      <button
        onClick={() => void salvar()}
        disabled={salvando}
        className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition-colors"
      >
        {salvando ? 'Salvando...' : 'Salvar termos globais'}
      </button>
    </div>
  )
}

function Lista({
  titulo,
  itens,
  onChange,
}: {
  titulo: string
  itens: Termo[]
  onChange: (v: Termo[]) => void
}) {
  const set = (i: number, campo: keyof Termo, val: string) =>
    onChange(itens.map((t, idx) => (idx === i ? { ...t, [campo]: val } : t)))
  const remover = (i: number) => onChange(itens.filter((_, idx) => idx !== i))
  const adicionar = () => onChange([...itens, { tipo: '', texto: '' }])

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-200">{titulo}</span>
        <button onClick={adicionar} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-200">
          + Termo
        </button>
      </div>
      {itens.length === 0 && <p className="text-xs text-zinc-600">Nenhum termo.</p>}
      {itens.map((t, i) => (
        <div key={i} className="flex gap-2 items-start">
          <input
            value={t.tipo}
            onChange={e => set(i, 'tipo', e.target.value)}
            placeholder="tipo"
            className="w-28 shrink-0 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-green-500"
          />
          <input
            value={t.texto}
            onChange={e => set(i, 'texto', e.target.value)}
            placeholder="texto do termo"
            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-green-500"
          />
          <button
            onClick={() => remover(i)}
            className="shrink-0 px-2 py-1.5 text-xs text-zinc-500 hover:text-red-300"
            aria-label="Remover"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
