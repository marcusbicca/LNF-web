import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Início — um RESUMO do parque numa olhada (não é grid, é panorama):
//   • estado da frota (app_control.status) em destaque;
//   • presença de hoje, solicitações pendentes, recusas — como números;
//   • as últimas execuções.
// Cada bloco é uma leitura pequena e enxuta (só as colunas necessárias).
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

interface Resumo {
  status: string
  presencaHoje: number
  totalUsuarios: number
  solicForn: number
  solicConversao: number
  recusas: number
  ultimas: Array<{ usuario: string; acao: string; sucesso: boolean; quando: string }>
}

function inicioDoDiaISO(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function Inicio() {
  const { config } = useApp()
  const svc = useMemo(() => (config ? new SupabaseService(config) : null), [config])

  const [r, setR] = useState<Resumo | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!svc) return
    setCarregando(true)
    setErro(null)
    try {
      const desde = inicioDoDiaISO()
      // Leituras enxutas, em paralelo. Cada uma pega só o que precisa.
      const [appc, usuarios, forn, conv, recusas, hist] = await Promise.all([
        svc.lerLinhas('app_control', { select: 'status', limit: 1 }),
        svc.lerLinhas('usuarios', { select: 'visto_em' }),
        svc.lerLinhas('solicitacoes_forn', { select: 'cnpj', filtros: 'status=eq.pendente', limit: 1000 }).catch(() => [] as Row[]),
        svc.lerLinhas('solicitacoes_conversao', { select: 'codigo', filtros: 'status=eq.pendente', limit: 1000 }).catch(() => [] as Row[]),
        svc.lerLinhas('recusas_acesso', { select: 'usuario', limit: 1000 }).catch(() => [] as Row[]),
        svc.lerLinhas('historico', {
          select: 'usuario,acao,sucesso,data_hora_inicio',
          order: 'data_hora_inicio.desc',
          limit: 8,
        }),
      ])

      const presencaHoje = (usuarios as Row[]).filter(u => {
        const v = u.visto_em ? String(u.visto_em) : ''
        return v && v >= desde
      }).length

      setR({
        status: String(appc[0]?.status ?? 'ativo'),
        presencaHoje,
        totalUsuarios: usuarios.length,
        solicForn: forn.length,
        solicConversao: conv.length,
        recusas: recusas.length,
        ultimas: (hist as Row[]).map(h => ({
          usuario: String(h.usuario ?? ''),
          acao: String(h.acao ?? ''),
          sucesso: !!h.sucesso,
          quando: h.data_hora_inicio ? String(h.data_hora_inicio) : '',
        })),
      })
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
        <h2 className="text-xl font-bold">Início</h2>
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

      {r && (
        <>
          {/* Estado da frota */}
          <div
            className={`rounded-lg p-3 border text-sm ${
              r.status === 'ativo'
                ? 'bg-green-950/50 border-green-800 text-green-300'
                : r.status === 'bloqueado'
                  ? 'bg-amber-950/50 border-amber-800 text-amber-300'
                  : 'bg-red-950/50 border-red-800 text-red-300'
            }`}
          >
            Estado da frota: <b>{r.status}</b>
            {r.status !== 'ativo' && ' — o parque está com operação restrita.'}
          </div>

          {/* Números */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile n={r.presencaHoje} rotulo="Ativos hoje" sub={`de ${r.totalUsuarios}`} />
            <Tile n={r.solicForn} rotulo="Cadastros pend." alerta={r.solicForn > 0} />
            <Tile n={r.solicConversao} rotulo="Conversões pend." alerta={r.solicConversao > 0} />
            <Tile n={r.recusas} rotulo="Recusas" alerta={r.recusas > 0} />
          </div>

          {/* Últimas execuções */}
          <div className="border border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800 text-sm font-semibold text-zinc-300">
              Últimas execuções
            </div>
            <div className="divide-y divide-zinc-800">
              {r.ultimas.length === 0 && <p className="text-xs text-zinc-500 p-3">Nada recente.</p>}
              {r.ultimas.map((u, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className={u.sucesso ? 'text-green-400' : 'text-red-400'}>{u.sucesso ? '✅' : '❌'}</span>
                  <span className="text-zinc-300 font-mono truncate">{u.acao}</span>
                  <span className="text-zinc-500 truncate">· {u.usuario}</span>
                  <span className="ml-auto text-xs text-zinc-600 shrink-0">{fmtHora(u.quando)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function fmtHora(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

function Tile({ n, rotulo, sub, alerta }: { n: number; rotulo: string; sub?: string; alerta?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${alerta ? 'border-amber-800 bg-amber-950/30' : 'border-zinc-800 bg-zinc-900'}`}>
      <div className={`text-2xl font-bold ${alerta ? 'text-amber-300' : 'text-zinc-100'}`}>{n}</div>
      <div className="text-xs text-zinc-400">{rotulo}</div>
      {sub && <div className="text-[11px] text-zinc-600">{sub}</div>}
    </div>
  )
}
