// ─────────────────────────────────────────────────────────────────────────────
// Coleta de pedidos — o caminho provisório, pelo read_table
//
// Existe porque a pipe 'coletar_pedidos' só chega na 1.0.0.7 e a frota está na
// 1.0.0.6. Este cartão faz o mesmo trabalho usando só 'read_table', que todo
// Coreon em campo já tem — então dá para encher pedidos_sap hoje e ter uma base
// conhecida ANTES de julgar a pipe nova.
//
// Recolhido por padrão, como o catálogo: é ferramenta de teste, não o que
// alguém veio fazer na aba.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'
import { SolicitacoesService, novaSessaoId } from '../services/solicitacoes'
import { coletar, TETO_PADRAO, type Progresso, type ResultadoColeta } from '../services/coletaPedidos'

const CHAVE_ABERTO = 'lnf.coletaPedidos.aberto'

/** AAAAMMDD de N dias atrás. O padrão é uma semana — range curto é o barato. */
function diasAtras(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

export function ColetaPedidos() {
  const { config } = useApp()

  const svc = useMemo(() => (config ? new SupabaseService(config) : null), [config])
  const sol = useMemo(
    () => (svc ? new SolicitacoesService(svc, config?.usuario ?? '') : null),
    [svc, config],
  )

  const [aberto, setAberto] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHAVE_ABERTO) === '1'
    } catch {
      return false
    }
  })

  const [de, setDe] = useState(diasAtras(7))
  const [ate, setAte] = useState(diasAtras(0))
  const [limite, setLimite] = useState(String(TETO_PADRAO))
  const [destinatario, setDestinatario] = useState('')

  const [rodando, setRodando] = useState(false)
  const [progresso, setProgresso] = useState<Progresso | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoColeta | null>(null)

  function alternar() {
    const novo = !aberto
    setAberto(novo)
    try {
      localStorage.setItem(CHAVE_ABERTO, novo ? '1' : '0')
    } catch {
      /* modo privado — a escolha vale só para esta visita */
    }
  }

  async function rodar(apenasListar: boolean) {
    if (!sol || !svc || rodando) return

    setRodando(true)
    setErro(null)
    setResultado(null)
    setProgresso(null)

    try {
      const r = await coletar(sol, svc, config?.usuario ?? '', {
        de,
        ate,
        limite: Number(limite) || TETO_PADRAO,
        sessaoId: novaSessaoId(config?.usuario ?? ''),
        destinatario: destinatario.trim() || undefined,
        apenasListar,
        onProgresso: setProgresso,
      })
      setResultado(r)
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setRodando(false)
    }
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={alternar}
          className="flex items-center gap-2 text-left text-sm font-medium text-zinc-200"
        >
          <span className="text-zinc-500">{aberto ? '▾' : '▸'}</span>
          Coleta de pedidos (provisória)
        </button>
        {!aberto && (
          <span className="text-xs text-zinc-500">
            Enche <code>pedidos_sap</code> pelo read_table, sem esperar a 1.0.0.7
          </span>
        )}
      </header>

      {aberto && (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-relaxed text-zinc-400">
            Lê a EKKO no período para descobrir os pedidos, depois busca
            EKPO/EKET/EKKO/KONV de 30 em 30 e grava em <code>pedidos_sap</code>. É
            uma solicitação remota por leitura — quem executa é o primeiro Coreon
            que pegar, e <strong>ele precisa estar logado no SAP</strong>.
          </p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-zinc-400">
              De (AAAAMMDD)
              <input
                value={de}
                onChange={(e) => setDe(e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100"
              />
            </label>
            <label className="text-xs text-zinc-400">
              Até (AAAAMMDD)
              <input
                value={ate}
                onChange={(e) => setAte(e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100"
              />
            </label>
            <label className="text-xs text-zinc-400">
              Limite
              <input
                value={limite}
                onChange={(e) => setLimite(e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100"
              />
            </label>
            <label className="text-xs text-zinc-400">
              Máquina (opcional)
              <input
                value={destinatario}
                onChange={(e) => setDestinatario(e.target.value)}
                placeholder="em branco = a primeira"
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Conferir o range custa UMA leitura; descobrir depois custa
                quatro por pedido. Por isso o botão de listar vem primeiro. */}
            <button
              type="button"
              disabled={rodando}
              onClick={() => rodar(true)}
              className="rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-200 disabled:opacity-40"
            >
              Só listar
            </button>
            <button
              type="button"
              disabled={rodando}
              onClick={() => rodar(false)}
              className="rounded bg-green-700 px-3 py-1 text-sm text-white disabled:opacity-40"
            >
              Coletar
            </button>
          </div>

          {progresso && (
            <p className="text-xs text-zinc-400">
              {progresso.mensagem}
              {progresso.total > 0 && ` (${progresso.feitos}/${progresso.total})`}
            </p>
          )}

          {erro && <p className="text-xs whitespace-pre-wrap text-red-400">{erro}</p>}

          {resultado && (
            <div className="space-y-1 text-xs text-zinc-300">
              <p>
                {resultado.encontrados} no período · {resultado.coletados} coletado(s)
                {resultado.ignorados > 0 && (
                  <span className="text-amber-500">
                    {' '}
                    · {resultado.ignorados} fora do teto — suba o limite ou estreite o período
                  </span>
                )}
              </p>
              {resultado.pedidos.length > 0 && (
                <p className="break-all text-zinc-500">{resultado.pedidos.join(', ')}</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
