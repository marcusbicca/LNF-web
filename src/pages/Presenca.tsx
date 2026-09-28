import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'
import { carregarAtividade, desde, type Atividade, type AtividadeUsuario } from '../services/presenca'
import { carregarRecusas, pareceAlmoxarifado, type Recusa } from '../services/recusas'

// ─────────────────────────────────────────────────────────────────────────────
// Presença — quem usa a ferramenta, quanto, e quem nunca usou
//
// Dois relógios, e eles medem coisas diferentes:
//
//   PRESENÇA      usuarios.visto_em, carimbado pela Edge Function em toda
//                 chamada validada. Enxerga a máquina ligada e sincronizando
//                 sem executar nada — o que o historico não tem como ver.
//
//   ÚLTIMA AÇÃO   historico. O que a pessoa de fato EXECUTOU.
//
// Alguém pode estar presente hoje e sem ação nenhuma há uma semana: está com o
// Coreon aberto e não usou. Juntar os dois num número só apagaria exatamente
// essa distinção. Ver o cabeçalho de services/presenca.ts.
//
// ── a tela responde três perguntas, nesta ordem ──────────────────────────────
//
//   1. quem está ativo AGORA           → ordenação por última ação
//   2. quem sumiu                      → a faixa de "há X dias" e o corte de 30d
//   3. quem nunca usou                 → os cadastrados sem histórico, no fim
//
// A terceira é a que não se consegue ver de outro jeito: um cadastro que nunca
// foi usado não aparece em log nenhum, só na diferença entre as duas tabelas.
//
// ── por que não carrega sozinha ──────────────────────────────────────────────
//
// A varredura são várias idas ao banco. Uma tela que faz isso ao abrir castiga
// quem só passou por ela para chegar em outra, e o dado não muda de minuto em
// minuto — quem quer ver, pede.
// ─────────────────────────────────────────────────────────────────────────────

// Faixas de atividade. O corte em 30 dias não é estatística, é a pergunta
// prática: "esta pessoa ainda usa isto?" — e um mês sem nenhuma ação num
// trabalho diário responde que não.
function faixa(a: AtividadeUsuario): { rotulo: string; cor: string } {
  if (a.em7 > 0)  return { rotulo: 'ativo',  cor: 'text-green-400' }
  if (a.em30 > 0) return { rotulo: 'no mês', cor: 'text-amber-500' }

  // Presente sem ação é um estado PRÓPRIO, e o mais interessante da tela: a
  // pessoa abre o Coreon todo dia e não usa. Chamar isso de 'inativo' junto de
  // quem nem liga a máquina esconderia a diferença entre "não precisa" e "não
  // consegue" — e só a segunda pede alguém ir conversar.
  const pres = a.presencaEm ? Date.parse(a.presencaEm) : NaN
  if (!Number.isNaN(pres) && pres >= Date.now() - 7 * 864e5)
    return { rotulo: 'aberto, sem uso', cor: 'text-blue-400' }

  if (!a.vistoEm && !a.presencaEm) return { rotulo: 'nunca usou', cor: 'text-zinc-600' }
  return { rotulo: 'inativo', cor: 'text-red-400' }
}

function csv(at: Atividade): string {
  const linhas = [
    ['usuario', 'nome', 'nivel', 'situacao', 'presenca_em', 'ultima_acao_em',
     'ultima_acao', 'total', 'em_7d', 'em_30d', 'falhas', 'primeira_acao_em',
     'por_acao'].join(';'),
  ]

  for (const u of at.usuarios) {
    linhas.push([
      u.username,
      u.nome,
      String(u.nivelAdm),
      faixa(u).rotulo,
      u.presencaEm ?? '',
      u.vistoEm ?? '',
      u.ultimaAcao ?? '',
      String(u.total),
      String(u.em7),
      String(u.em30),
      String(u.falhas),
      u.primeiraEm ?? '',
      u.porAcao.map((p) => `${p.acao}=${p.n}`).join(' '),
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
  }

  return linhas.join('\r\n')
}

// Cada portão pede uma reação diferente, então cada um tem sua cor e sua
// legenda. 'cadastro' é o único que é alarme — os outros são permissão faltando.
const PORTOES: Record<string, { rotulo: string; cor: string; borda: string }> = {
  cadastro: { rotulo: 'fora do cadastro', cor: 'text-red-300',   borda: 'border-red-900 bg-red-950/30' },
  internet: { rotulo: 'MeuDanfe pago',    cor: 'text-amber-300', borda: 'border-amber-900/60 bg-amber-950/20' },
  escrita:  { rotulo: 'escrita barrada',  cor: 'text-blue-300',  borda: 'border-blue-900/60 bg-blue-950/20' },
}

function PainelRecusas({
  recusas,
  carregando,
  onRecarregar,
}: {
  recusas: Recusa[] | null
  carregando: boolean
  onRecarregar: () => void
}) {
  // Ordem por gravidade: intruso primeiro, depois permissão faltando.
  const ordem = ['cadastro', 'internet', 'escrita']
  const grupos = useMemo(() => {
    const g: Record<string, Recusa[]> = { cadastro: [], internet: [], escrita: [] }
    for (const r of recusas ?? []) (g[r.portao] ??= []).push(r)
    return g
  }, [recusas])

  if (!recusas || recusas.length === 0) {
    return (
      <div className="border border-zinc-800 rounded p-3 flex items-center gap-2">
        <span className="text-sm text-zinc-500">
          {carregando ? 'Lendo recusas…' : 'Nenhuma tentativa de acesso negada registrada.'}
        </span>
        <button
          onClick={onRecarregar}
          disabled={carregando}
          className="ml-auto text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
        >
          ↻ atualizar
        </button>
      </div>
    )
  }

  const intrusos = grupos.cadastro.length

  return (
    <div className="border border-zinc-800 rounded">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 border-b border-zinc-800">
        <h3 className="text-sm font-semibold">Tentativas de acesso negadas</h3>
        {intrusos > 0 && (
          <span className="text-xs text-red-300">
            {intrusos} de fora do cadastro
          </span>
        )}
        <button
          onClick={onRecarregar}
          disabled={carregando}
          className="ml-auto text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
        >
          {carregando ? 'atualizando…' : '↻ atualizar'}
        </button>
      </div>

      <div className="p-2 space-y-3">
        {ordem.filter((p) => grupos[p]?.length).map((p) => {
          const meta = PORTOES[p] ?? { rotulo: p, cor: 'text-zinc-300', borda: 'border-zinc-800' }
          return (
            <div key={p} className="space-y-1">
              {grupos[p].map((r) => {
                const almox = p === 'cadastro' && pareceAlmoxarifado(r)
                return (
                  <div
                    key={`${r.portao}:${r.usuario}`}
                    className={`rounded border px-3 py-2 text-sm ${meta.borda}`}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono">{r.usuario}</span>
                      <span className={`text-[10px] px-1 rounded bg-zinc-900 ${meta.cor}`}>
                        {meta.rotulo}
                      </span>
                      {almox && (
                        <span className="text-[10px] px-1 rounded bg-green-900/50 text-green-300">
                          almoxarifado?
                        </span>
                      )}
                      <span className="ml-auto text-xs text-zinc-500">
                        {r.total}× · última {desde(r.ultimaEm) ?? '—'}
                      </span>
                    </div>

                    {/* Perfil do diretório — só o portão 'cadastro' tem. */}
                    {p === 'cadastro' && (
                      <div className="mt-1 text-xs">
                        {r.nomeCompleto || r.cargo || r.setor ? (
                          <span className="text-zinc-300">
                            {r.nomeCompleto ?? '—'}
                            {r.cargo && <span className="text-zinc-400"> · {r.cargo}</span>}
                            {r.setor && <span className="text-zinc-400"> · {r.setor}</span>}
                            {(r.cidade || r.estado) && (
                              <span className="text-zinc-500">
                                {' · '}{[r.cidade, r.estado].filter(Boolean).join('/')}
                              </span>
                            )}
                          </span>
                        ) : r.perfilStatus === 'nao_encontrado' ? (
                          <span className="text-zinc-600">
                            diretório não conhece {r.usuario}@grupofleury.com.br
                          </span>
                        ) : (
                          <span className="text-zinc-600">perfil ainda não buscado</span>
                        )}
                      </div>
                    )}

                    {r.op && (
                      <div className="mt-0.5 text-[11px] text-zinc-600 font-mono">
                        {r.op}{r.motivo ? ` — ${r.motivo}` : ''}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Presenca() {
  const { config } = useApp()

  const [at, setAt] = useState<Atividade | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [soAtivos, setSoAtivos] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)

  // As recusas são uma leitura barata (uma tabela pequena) e são o AVISO da
  // tela — quem tentou entrar e não pôde. Por isso carregam sozinhas ao abrir,
  // ao contrário da varredura do histórico, que espera o clique.
  const [recusas, setRecusas] = useState<Recusa[] | null>(null)
  const [carregandoRec, setCarregandoRec] = useState(false)

  const carregarRec = useCallback(async () => {
    if (!config) return
    setCarregandoRec(true)
    try {
      const svc = new SupabaseService(config)
      setRecusas(await carregarRecusas(svc))
    } catch {
      // Uma recusa que não carrega não pode esconder a presença: falha calada,
      // o painel só não aparece.
      setRecusas(null)
    } finally {
      setCarregandoRec(false)
    }
  }, [config])

  useEffect(() => { void carregarRec() }, [carregarRec])

  const carregar = useCallback(async () => {
    if (!config) return
    setCarregando(true)
    setErro(null)
    try {
      const svc = new SupabaseService(config)
      setAt(await carregarAtividade(svc))
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setCarregando(false)
    }
  }, [config])

  const lista = useMemo(() => {
    if (!at) return []
    const q = busca.trim().toLowerCase()
    return at.usuarios.filter((u) => {
      if (soAtivos && u.em30 === 0) return false
      if (!q) return true
      return u.username.includes(q) || u.nome.toLowerCase().includes(q)
    })
  }, [at, busca, soAtivos])

  const resumo = useMemo(() => {
    if (!at) return null
    let ativos = 0, mes = 0, semUso = 0, inativos = 0, nunca = 0
    for (const u of at.usuarios) {
      const r = faixa(u).rotulo
      if (r === 'ativo') ativos++
      else if (r === 'no mês') mes++
      else if (r === 'aberto, sem uso') semUso++
      else if (r === 'nunca usou') nunca++
      else inativos++
    }
    return { ativos, mes, semUso, inativos, nunca, total: at.usuarios.length }
  }, [at])

  const baixarCsv = () => {
    if (!at) return
    const blob = new Blob(['﻿' + csv(at)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `presenca-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!config)
    return (
      <div className="p-4 text-zinc-400">
        Configure a URL do Power Automate em <b>Configurações</b>.
      </div>
    )

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Presença</h2>
        <button
          onClick={carregar}
          disabled={carregando}
          className="ml-auto px-3 py-1.5 text-sm rounded bg-green-700 hover:bg-green-600 disabled:opacity-50"
        >
          {carregando ? 'Lendo histórico…' : at ? 'Recarregar' : 'Carregar'}
        </button>
        {at && (
          <button
            onClick={baixarCsv}
            className="px-3 py-1.5 text-sm rounded bg-zinc-800 hover:bg-zinc-700"
          >
            CSV
          </button>
        )}
      </div>

      {erro && (
        <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded p-3">
          {erro}
        </div>
      )}

      <PainelRecusas
        recusas={recusas}
        carregando={carregandoRec}
        onRecarregar={() => void carregarRec()}
      />

      {!at && !carregando && !erro && (
        <p className="text-sm text-zinc-500">
          As contagens saem do histórico, calculadas na hora. A presença vem do
          carimbo que a Edge Function faz a cada chamada — é o que mostra quem
          está com o Coreon aberto sem executar nada.
        </p>
      )}

      {at && resumo && (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="text-green-400">{resumo.ativos} ativo(s) em 7d</span>
            <span className="text-amber-500">{resumo.mes} só no mês</span>
            <span className="text-blue-400">{resumo.semUso} aberto(s) sem uso</span>
            <span className="text-red-400">{resumo.inativos} parado(s) há +30d</span>
            <span className="text-zinc-600">{resumo.nunca} nunca usou</span>
            <span className="text-zinc-500 ml-auto font-mono text-xs">
              {at.linhas.toLocaleString('pt-BR')} linhas lidas
            </span>
          </div>

          {at.truncado && (
            <div className="text-sm text-amber-500 bg-amber-950/30 border border-amber-900 rounded p-3">
              O histórico passou do teto de leitura desta tela, então os totais
              são um <strong>piso</strong> — há ações mais antigas que não entraram
              na conta. As faixas de 7 e 30 dias continuam corretas.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="filtrar por usuário ou nome"
              className="flex-1 min-w-[12rem] bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={soAtivos}
                onChange={(e) => setSoAtivos(e.target.checked)}
              />
              só quem usou nos últimos 30 dias
            </label>
          </div>

          <div className="space-y-1">
            {lista.map((u) => {
              const f = faixa(u)
              const abertoAqui = aberto === u.username
              return (
                <div key={u.username} className="border border-zinc-800 rounded">
                  <button
                    onClick={() => setAberto(abertoAqui ? null : u.username)}
                    className="w-full text-left px-3 py-2 hover:bg-zinc-900 flex flex-wrap items-baseline gap-x-3 gap-y-1"
                  >
                    <span className="font-mono text-sm">{u.username}</span>
                    {u.nome && <span className="text-xs text-zinc-500 truncate">{u.nome}</span>}
                    {u.nivelAdm > 0 && (
                      <span className="text-[10px] px-1 rounded bg-zinc-800 text-zinc-400">
                        nível {u.nivelAdm}
                      </span>
                    )}

                    <span className={`ml-auto text-xs ${f.cor}`}>{f.rotulo}</span>
                    <span
                      className="text-xs text-zinc-500 w-20 text-right"
                      title="última ação executada"
                    >
                      {desde(u.vistoEm) ?? '—'}
                    </span>
                    <span className="text-xs text-zinc-400 w-16 text-right font-mono">
                      {u.total}
                    </span>
                  </button>

                  {abertoAqui && (
                    <div className="px-3 pb-3 pt-1 border-t border-zinc-800 text-sm space-y-2">
                      {u.vistoEm ? (
                        <>
                          <div className="text-xs text-zinc-500">
                            última: <span className="text-zinc-300 font-mono">{u.ultimaAcao}</span>
                            {' · '}
                            {new Date(u.vistoEm).toLocaleString('pt-BR')}
                            {u.primeiraEm && (
                              <> · primeira em {new Date(u.primeiraEm).toLocaleDateString('pt-BR')}</>
                            )}
                            {u.falhas > 0 && (
                              <> · <span className="text-red-400">{u.falhas} com falha</span></>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-1">
                            {u.porAcao.map((p) => (
                              <span
                                key={p.acao}
                                className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800"
                              >
                                {p.acao} <span className="text-green-400">{p.n}</span>
                              </span>
                            ))}
                          </div>

                          <div className="text-xs text-zinc-500">
                            7 dias: {u.em7} · 30 dias: {u.em30}
                            {u.presencaEm && (
                              <> · Coreon visto {desde(u.presencaEm)}</>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-zinc-500">
                          Cadastrado, sem nenhuma ação registrada desde que o
                          histórico existe.
                          {u.presencaEm && (
                            <> Mas o Coreon dele foi visto {desde(u.presencaEm)} —
                            está abrindo a ferramenta e não executando nada.</>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {lista.length === 0 && (
              <p className="text-sm text-zinc-500">Nenhum usuário com esse filtro.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
