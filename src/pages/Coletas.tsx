import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Coletas — o recibo de cada coleta de pedidos. Mais valioso que um grid porque
// LÊ o que interessa (contadores, o que falhou) sem trazer a coluna 'pedidos'
// (jsonb pesado, centenas de KB) e destaca as coletas com lote com erro.
// Read-only: quem coleta é o Coreon; aqui é acompanhamento.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

// Sem 'pedidos' (jsonb grande) nem 'itens' no SELECT: a lista quer o resumo.
const COLS = 'id,criado_em,terminado_em,usuario,maquina,de,ate,total,publicados,lotes_ok,lotes_erro,erro'

export function Coletas() {
  const { config } = useApp()
  const svc = useMemo(() => (config ? new SupabaseService(config) : null), [config])

  const [rows, setRows] = useState<Row[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!svc) return
    setCarregando(true)
    setErro(null)
    try {
      setRows(await svc.lerLinhas('coletas', { select: COLS, order: 'criado_em.desc', limit: 50 }))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [svc])

  useEffect(() => {
    void carregar()
  }, [carregar])

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
        <h2 className="text-xl font-bold">Coletas de pedidos</h2>
        <button
          onClick={() => void carregar()}
          disabled={carregando}
          className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded text-zinc-300"
        >
          {carregando ? 'Lendo...' : 'Atualizar'}
        </button>
      </div>

      {erro && (
        <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">❌ {erro}</div>
      )}

      {!carregando && rows.length === 0 && !erro && (
        <p className="text-sm text-zinc-500">Nenhuma coleta registrada.</p>
      )}

      <div className="space-y-3">
        {rows.map((r, i) => {
          const lotesErro = Number(r.lotes_erro ?? 0)
          const publicados = Number(r.publicados ?? 0)
          const total = Number(r.total ?? 0)
          const emAberto = !r.terminado_em
          const temErro = lotesErro > 0 || !!r.erro
          return (
            <div
              key={String(r.id ?? i)}
              className={`rounded-lg border p-3 space-y-2 ${
                temErro ? 'border-amber-800 bg-amber-950/20' : 'border-zinc-800 bg-zinc-900'
              }`}
            >
              <div className="flex items-center gap-2 text-sm">
                <span className={temErro ? 'text-amber-400' : emAberto ? 'text-zinc-400' : 'text-green-400'}>
                  {temErro ? '⚠️' : emAberto ? '⏳' : '✅'}
                </span>
                <span className="font-mono text-zinc-300 truncate">{String(r.id ?? '')}</span>
                <span className="ml-auto text-xs text-zinc-500 shrink-0">{fmt(r.criado_em)}</span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                <span>{String(r.usuario ?? '—')} · {String(r.maquina ?? '—')}</span>
                {!!(r.de || r.ate) && <span>faixa {String(r.de ?? '')}–{String(r.ate ?? '')}</span>}
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <Badge rotulo="publicados" valor={`${publicados}/${total}`} />
                <Badge rotulo="lotes ok" valor={String(r.lotes_ok ?? 0)} />
                <Badge rotulo="lotes erro" valor={String(lotesErro)} alerta={lotesErro > 0} />
                {emAberto ? (
                  <Badge rotulo="estado" valor="em aberto" />
                ) : (
                  <Badge rotulo="terminou" valor={fmt(r.terminado_em)} />
                )}
              </div>

              {!!r.erro && (
                <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded p-2 whitespace-pre-wrap break-words">
                  {String(r.erro)}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function fmt(v: unknown): string {
  if (!v) return ''
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString()
}

function Badge({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <span
      className={`inline-flex items-baseline gap-1 rounded px-2 py-0.5 border ${
        alerta ? 'border-amber-700 bg-amber-950/40 text-amber-300' : 'border-zinc-700 bg-zinc-950 text-zinc-300'
      }`}
    >
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{rotulo}</span>
      <span className="font-mono">{valor}</span>
    </span>
  )
}
