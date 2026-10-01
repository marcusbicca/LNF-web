import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { QuemPediu } from './QuemPediu'
import { SupabaseService } from '../services/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// InconsistenciasPendentes — as NFs que o Coreon BARROU por contradição entre o
// lote e a quantidade comercial, e a triagem delas no mesmo lugar.
//
// ── o sinal ───────────────────────────────────────────────────────────────────
//
// A soma dos qLote de um item não bateu com o qCom, e o fator entre os dois NÃO
// é uma conversão cadastrada. O caso típico: a NF traz qCom=1200 UN e um lote
// qLote=3 porque o fornecedor pôs a quantidade em CAIXAS no lote (1 CX = 400
// UN). Houvesse a conversão CX→UN 400 no cadastro, o Coreon resolveria sozinho e
// nada apareceria aqui; sem ela, ele barra a NF (informa e segue pra próxima,
// nunca derruba o lote) e registra a ocorrência para alguém corrigir o cadastro.
//
// ── o que fazer com um caso ─────────────────────────────────────────────────
//
// Quase sempre a correção é cadastrar a conversão que falta (a caixa do
// fornecedor) na aba Materiais / no Mapeamento, e reprocessar a NF. Feito isso,
// marca-se o caso como RESOLVIDO. Quando não era inconsistência de verdade —
// qLote que o fornecedor digitou errado, por exemplo — marca-se IGNORADO, que
// conta separado para medir onde a detecção erra.
//
// ── espelha a ConversoesPendentes ───────────────────────────────────────────
//
// De propósito: é a mesma pessoa, na mesma tela (Mapeamento), triando o mesmo
// tipo de problema de cadastro. O gate de transporte, a leitura por status
// pendente, o fechamento por (fornecedor, codigo, referencia) e a triagem em
// lote são os mesmos — reaprender a cada aba seria o custo de telas diferentes.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

function dbl(r: Row, k: string): number {
  const v = r[k]
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function txt(r: Row, k: string): string {
  const v = r[k]
  return v == null ? '' : String(v)
}

function num(d: number, casas = 4): string {
  if (!Number.isFinite(d)) return '—'
  return String(Math.round(d * 10 ** casas) / 10 ** casas)
}

interface Caso {
  fornecedor: string
  codigo: string
  referencia: string
  centro: string
  nf: string
  nfChave: string
  umbNf: string
  somaLote: number
  qtdCom: number
  fator: number
  detalhe: string
  vezes: number
  usuario: string
}

function montar(r: Row): Caso {
  return {
    fornecedor: txt(r, 'fornecedor'),
    codigo: txt(r, 'codigo'),
    referencia: txt(r, 'referencia'),
    centro: txt(r, 'centro'),
    nf: txt(r, 'nf'),
    nfChave: txt(r, 'nf_chave'),
    umbNf: txt(r, 'umb_nf'),
    somaLote: dbl(r, 'soma_lote'),
    qtdCom: dbl(r, 'qtd_com'),
    fator: dbl(r, 'fator'),
    detalhe: txt(r, 'detalhe'),
    vezes: Math.max(1, Math.round(dbl(r, 'vezes'))),
    usuario: txt(r, 'usuario'),
  }
}

function Campo({
  rotulo,
  valor,
  largura = 'w-28',
  cor = 'text-zinc-300',
  titulo,
}: {
  rotulo: string
  valor: string
  largura?: string
  cor?: string
  titulo?: string
}) {
  return (
    <div title={titulo}>
      <label className="block text-[11px] text-zinc-500 mb-0.5">{rotulo}</label>
      <input
        type="text"
        value={valor}
        readOnly
        className={`${largura} bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-sm font-mono ${cor}`}
      />
    </div>
  )
}

export function InconsistenciasPendentes() {
  const { config } = useApp()

  const svc = useMemo(
    () => (config ? new SupabaseService(config) : null),
    [config],
  )

  const [casos, setCasos] = useState<Caso[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)
  const [selId, setSelId] = useState<string | null>(null)

  // Set de chave(c), não de índice: a lista encolhe a cada carga, e índice
  // guardado fecharia o caso errado depois, calado.
  const [marcados, setMarcados] = useState<Set<string>>(new Set())

  const chave = (c: Caso) => `${c.fornecedor}\u0000${c.codigo}\u0000${c.referencia}`
  const sel = useMemo(() => casos.find((c) => chave(c) === selId) ?? null, [casos, selId])

  const carregar = useCallback(async () => {
    if (!svc) return
    setCarregando(true)
    setErro(null)
    try {
      const rows = await svc.lerLinhas('inconsistencias', {
        order: 'vezes.desc,updated_at.desc',
        filtros: 'status=eq.pendente',
        limit: 200,
      })
      setCasos(rows.map(montar))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [svc])

  // O gate é TRANSPORTE, não paUrl — mesma condição do AppContext e do
  // Mapeamento. Com a Edge Function configurada o paUrl fica vazio, e condicionar
  // ao paUrl faria o painel mentir "nada pendente" para uma fila cheia.
  const temTransporte = !!(config?.edgeUrl || config?.paUrl)

  useEffect(() => {
    if (temTransporte && aberto) void carregar()
  }, [temTransporte, aberto, carregar])

  // ── fechar casos ──────────────────────────────────────────────────────────
  //
  // 'status' diz SE foi resolvido; 'motivo_fechamento' diz POR QUE. Os dois,
  // como na conversao_suspeita: 'ignorada' sozinho não distingue "não era
  // inconsistência" (falso positivo do detector, que é o que interessa contar)
  // de "depois eu vejo". 'fechado_por' ≠ 'usuario' — usuario é quem lançou a NF
  // que gerou o caso, quase nunca quem o fecha.
  async function fecharCasos(
    alvos: Caso[],
    novoStatus: 'corrigida' | 'ignorada',
    motivo: string,
  ): Promise<{ ok: number; falhas: number }> {
    if (!svc || alvos.length === 0) return { ok: 0, falhas: 0 }
    let ok = 0
    let falhas = 0
    for (const c of alvos) {
      try {
        await svc.salvarLinha(
          'inconsistencias',
          {
            fornecedor: c.fornecedor,
            codigo: c.codigo,
            referencia: c.referencia,
            status: novoStatus,
            motivo_fechamento: motivo,
            fechado_por: config?.usuario ?? '',
          },
          'fornecedor,codigo,referencia',
        )
        ok++
      } catch {
        // Uma falha não interrompe as outras: fechar oito de dez é melhor que
        // zero, e o que não fechou continua na fila, visível.
        falhas++
      }
    }
    return { ok, falhas }
  }

  async function marcar(novoStatus: 'corrigida' | 'ignorada', motivo: string) {
    if (!sel) return
    setStatus(null)
    const r = await fecharCasos([sel], novoStatus, motivo)
    if (r.ok === 0) {
      setStatus('❌ Não foi possível gravar.')
      return
    }
    setStatus(novoStatus === 'corrigida' ? '✅ Marcada como resolvida.' : '✅ Fechada.')
    setSelId(null)
    await carregar()
  }

  async function fecharSelecionados(novoStatus: 'corrigida' | 'ignorada', motivo: string) {
    const alvos = casos.filter((c) => marcados.has(chave(c)))
    if (alvos.length === 0) return
    setStatus(null)
    const r = await fecharCasos(alvos, novoStatus, motivo)
    setMarcados(new Set())
    if (selId && alvos.some((a) => chave(a) === selId)) setSelId(null)
    setStatus(
      r.falhas === 0
        ? `✅ ${r.ok} caso(s) fechado(s).`
        : `⚠️ ${r.ok} fechado(s), ${r.falhas} falhou/falharam e continuam na fila.`,
    )
    await carregar()
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <section className="border border-zinc-800 rounded-lg mb-3">
      <button
        onClick={() => setAberto((a) => !a)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold">
          NFs barradas por lote
          {casos.length > 0 && (
            <span className="ml-2 text-xs font-mono text-amber-400">{casos.length}</span>
          )}
        </span>
        <span className="text-zinc-500 text-xs">{aberto ? '▾' : '▸'}</span>
      </button>

      {aberto && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-zinc-500">
            A soma dos lotes não bateu com a quantidade comercial da NF, e o fator entre os
            dois não é uma conversão cadastrada do item. O Coreon barrou a NF (informando e
            seguindo para a próxima). Quase sempre a correção é <strong className="text-zinc-400">
            cadastrar a conversão que falta</strong> (a caixa do fornecedor) e reprocessar.
          </p>

          {erro && <p className="text-xs text-red-400 font-mono">{erro}</p>}
          {status && <p className="text-xs font-mono">{status}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => void carregar()}
              disabled={carregando}
              className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
            >
              {carregando ? 'Carregando…' : 'Recarregar'}
            </button>
          </div>

          {casos.length === 0 && !carregando && (
            <p className="text-xs text-zinc-600">Nenhuma NF barrada pendente.</p>
          )}

          {/* ── triagem em lote ────────────────────────────────────────────
              Só aparece com algo marcado: uma barra permanente com botões
              destrutivos ao lado da lista é um clique errado esperando. */}
          {marcados.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-green-900 bg-green-950/30 px-3 py-2 text-xs">
              <span className="text-green-300">
                {marcados.size} marcado{marcados.size > 1 ? 's' : ''}
              </span>
              <button
                onClick={() => void fecharSelecionados('ignorada', 'nao_e_inconsistencia')}
                className="px-2.5 py-1 rounded bg-zinc-700 hover:bg-zinc-600"
                title="Fecha sem corrigir e registra que não era inconsistência de cadastro."
              >
                Não é inconsistência
              </button>
              <button
                onClick={() => void fecharSelecionados('corrigida', 'resolvido')}
                className="px-2.5 py-1 rounded bg-green-700 hover:bg-green-600 text-white"
                title="Fecha como resolvido. Se voltar a acontecer, o caso REABRE sozinho."
              >
                Resolvido
              </button>
              <button
                onClick={() => setMarcados(new Set())}
                className="px-2 py-1 rounded text-zinc-500 hover:text-zinc-300 ml-auto"
              >
                limpar
              </button>
            </div>
          )}

          <ul className="space-y-1">
            {casos.map((c) => {
              const id = chave(c)
              return (
                <li key={id} className="flex items-start gap-2">
                  {/* A caixa fica FORA do botão: aninhar clicáveis faria marcar
                      abrir o caso, e a triagem em lote existe justamente para
                      não precisar abrir. */}
                  <input
                    type="checkbox"
                    checked={marcados.has(id)}
                    onChange={(e) => {
                      const n = new Set(marcados)
                      if (e.target.checked) n.add(id)
                      else n.delete(id)
                      setMarcados(n)
                    }}
                    className="mt-2.5 accent-green-600 shrink-0"
                    title="Marcar para fechar em lote"
                  />
                  <button
                    onClick={() => setSelId(id === selId ? null : id)}
                    className={`flex-1 min-w-0 text-left px-3 py-2 rounded border text-xs ${
                      id === selId
                        ? 'border-green-600 bg-zinc-900'
                        : 'border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{c.fornecedor}/{c.referencia || '—'}</span>
                      {c.vezes > 1 && <span className="text-amber-400 font-mono">{c.vezes}×</span>}
                      {c.nf && <span className="text-zinc-500">NF {c.nf}</span>}
                    </div>
                    <div className="text-zinc-500 mt-0.5">
                      ΣqLote {num(c.somaLote)} {c.umbNf} ↔ qCom {num(c.qtdCom)} {c.umbNf}
                      {' · '}
                      <span className="text-zinc-300">fator {num(c.fator)}</span>
                    </div>
                    <div className="mt-1">
                      <QuemPediu usuario={c.usuario} centro={c.centro} />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>

          {/* ── detalhe do caso selecionado ──────────────────────────────── */}
          {sel && (
            <div className="border border-zinc-800 rounded p-3 space-y-3">
              <div className="flex flex-wrap gap-3">
                <Campo rotulo="Fornecedor" valor={sel.fornecedor} largura="w-40" />
                <Campo rotulo="Referência" valor={sel.referencia} largura="w-40" />
                <Campo rotulo="Centro" valor={sel.centro} largura="w-24" />
              </div>
              <div className="flex flex-wrap gap-3">
                <Campo rotulo="NF" valor={sel.nf} largura="w-32" />
                <Campo rotulo="Chave NF" valor={sel.nfChave} largura="w-[30rem]" titulo={sel.nfChave} />
              </div>
              <div className="flex flex-wrap gap-3">
                <Campo rotulo="Σ qLote" valor={num(sel.somaLote)} />
                <Campo rotulo="qCom" valor={num(sel.qtdCom)} />
                <Campo rotulo="UMB NF" valor={sel.umbNf} largura="w-20" />
                <Campo
                  rotulo="Fator"
                  valor={num(sel.fator)}
                  cor="text-amber-300"
                  titulo="qCom ÷ Σ qLote — o fator que, cadastrado, resolveria o caso."
                />
              </div>

              <p className="text-xs text-zinc-500">
                Cadastre a conversão <span className="font-mono text-zinc-300">fator {num(sel.fator)}</span>{' '}
                para <span className="font-mono">{sel.fornecedor}/{sel.referencia}</span> (na aba
                Materiais ou no Mapeamento) e reprocesse a NF; depois marque como resolvido. Se o
                lote veio errado do fornecedor e não é caso de cadastro, marque como não é
                inconsistência.
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void marcar('corrigida', 'resolvido')}
                  className="px-3 py-1.5 rounded bg-green-700 hover:bg-green-600 text-white text-xs"
                >
                  Marcar resolvido
                </button>
                <button
                  onClick={() => void marcar('ignorada', 'nao_e_inconsistencia')}
                  className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-xs"
                >
                  Não é inconsistência
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
