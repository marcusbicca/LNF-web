import { useCallback, useState } from 'react'
import { useApp } from '../context/AppContext'
import type { CadastroJson, FatorEntry, ItemAnalise, ItensJson, PedidoItem } from '../types'
import { format, parseLenient } from '../utils/json'

// ── Lógica de análise ────────────────────────────────────────────────────────

function analisarItens(
  pedidosDict: Record<string, PedidoItem[]>,
  itens: ItensJson,
): ItemAnalise[] {
  const resultado: ItemAnalise[] = []
  const vistos = new Set<string>()

  for (const pedidos of Object.values(pedidosDict)) {
    for (const pedido of pedidos) {
      const key = `${pedido.Fornecedor}|${pedido['Código']}|${pedido['Referência']}`
      if (vistos.has(key)) continue
      vistos.add(key)

      const fornData = itens[pedido.Fornecedor]
      const itemData = fornData?.Itens[pedido['Código']]
      const refExiste = itemData !== undefined && pedido['Referência'] in itemData.referencias

      let status: ItemAnalise['status'] = 'novo'
      let conflito: ItemAnalise['conflito']
      let fator: number | null = null

      if (refExiste && itemData) {
        status = 'existe'
        const fatores: FatorEntry[] = itemData.referencias[pedido['Referência']]
        fator = fatores.length > 0 ? fatores[0].fator ?? null : null
      } else if (fornData) {
        // Checa se a referência existe em outro código SAP do mesmo fornecedor
        for (const [cod, item] of Object.entries(fornData.Itens)) {
          if (cod !== pedido['Código'] && pedido['Referência'] in item.referencias) {
            status = 'conflito'
            const fatores: FatorEntry[] = item.referencias[pedido['Referência']]
            conflito = {
              codigoExistente: cod,
              fatorExistente: fatores.length > 0 ? fatores[0].fator ?? null : null,
            }
            break
          }
        }
      }

      resultado.push({
        referencia: pedido['Referência'],
        codigoSAP: pedido['Código'],
        descricao: pedido['Descrição'],
        fornecedor: pedido.Fornecedor,
        fator,
        status,
        conflito,
        incluir: status !== 'existe',
      })
    }
  }

  return resultado
}

function aplicarRegistros(base: ItensJson, itensParaAdd: ItemAnalise[]): ItensJson {
  const novo = JSON.parse(JSON.stringify(base)) as ItensJson

  for (const item of itensParaAdd) {
    if (!item.incluir) continue

    if (!novo[item.fornecedor]) {
      novo[item.fornecedor] = { Configuracoes: {}, Itens: {} }
    }
    if (!novo[item.fornecedor].Itens[item.codigoSAP]) {
      novo[item.fornecedor].Itens[item.codigoSAP] = { referencias: {}, descricao: item.descricao }
    }

    const fatores: FatorEntry[] = item.fator !== null ? [{ fator: item.fator }] : []
    novo[item.fornecedor].Itens[item.codigoSAP].referencias[item.referencia] = fatores
  }

  return novo
}

// ── Componente principal ─────────────────────────────────────────────────────

export function RegistroNF() {
  const { config, itens, carregandoItens, erroItens, gravarItens } = useApp()

  const [jsonTexto, setJsonTexto] = useState('')
  const [mostrarTextarea, setMostrarTextarea] = useState(false)
  const [cadastro, setCadastro] = useState<CadastroJson | null>(null)
  const [erroJson, setErroJson] = useState<string | null>(null)
  const [itensAnalise, setItensAnalise] = useState<ItemAnalise[]>([])
  const [commitando, setCommitando] = useState(false)
  const [statusCommit, setStatusCommit] = useState<string | null>(null)

  const parseJson = useCallback(
    (texto: string) => {
      setErroJson(null)
      try {
        const parsed = parseLenient<CadastroJson>(texto)
        if (!parsed.PedidosDict) throw new Error('Campo PedidosDict ausente — JSON inválido')
        setJsonTexto(format(parsed))
        setCadastro(parsed)
        if (itens) setItensAnalise(analisarItens(parsed.PedidosDict, itens))
      } catch (e) {
        setErroJson((e as Error).message)
        setCadastro(null)
      }
    },
    [itens],
  )

  async function colarClipboard() {
    try {
      const texto = await navigator.clipboard.readText()
      setJsonTexto(texto)
      parseJson(texto)
    } catch {
      setErroJson('Não foi possível acessar a área de transferência. Use o campo manual.')
      setMostrarTextarea(true)
    }
  }

  function limpar() {
    setJsonTexto('')
    setCadastro(null)
    setErroJson(null)
    setItensAnalise([])
    setStatusCommit(null)
  }

  function setFator(idx: number, valor: string) {
    setItensAnalise(prev =>
      prev.map((item, i) =>
        i === idx
          ? { ...item, fator: valor === '' ? null : parseFloat(valor.replace(',', '.')) || null }
          : item,
      ),
    )
  }

  function toggleIncluir(idx: number) {
    setItensAnalise(prev => prev.map((item, i) => (i === idx ? { ...item, incluir: !item.incluir } : item)))
  }

  async function registrar() {
    if (!itens || !cadastro) return
    setCommitando(true)
    setStatusCommit(null)
    try {
      const novoItens = aplicarRegistros(itens, itensAnalise)
      const novosCount = itensAnalise.filter(i => i.incluir).length
      const usuario = config?.usuario ?? 'LNF-Web'
      const nfs = Object.values(cadastro.Nfs)
        .map(n => `NF${n.NumeroNF}`)
        .join(', ')
      const msg = `[${usuario}] ${nfs} — ${novosCount} ref. adicionada(s)`
      await gravarItens(novoItens, msg)
      setStatusCommit(`✅ ${novosCount} referência(s) registrada(s) com sucesso`)
      setItensAnalise(prev =>
        prev.map(i => (i.incluir ? { ...i, status: 'existe' as const, incluir: false } : i)),
      )
    } catch (e) {
      setStatusCommit(`❌ ${(e as Error).message}`)
    } finally {
      setCommitando(false)
    }
  }

  // ── Guardas ──────────────────────────────────────────────────────────────

  if (!config) {
    return (
      <div className="p-6 text-center text-zinc-400 mt-12 space-y-2">
        <p className="text-4xl">🔑</p>
        <p>Configure o GitHub Token em <span className="text-white font-medium">Configurações</span> para começar.</p>
      </div>
    )
  }

  if (carregandoItens) {
    return <div className="p-6 text-center text-zinc-400 mt-12">Carregando itens.json...</div>
  }

  if (erroItens) {
    return (
      <div className="p-6 text-center text-red-400 mt-12">
        <p className="font-medium">Erro ao carregar itens</p>
        <p className="text-sm mt-1">{erroItens}</p>
      </div>
    )
  }

  // ── Contagens ─────────────────────────────────────────────────────────────

  const novos = itensAnalise.filter(i => i.status === 'novo')
  const conflitos = itensAnalise.filter(i => i.status === 'conflito')
  const existentes = itensAnalise.filter(i => i.status === 'existe')
  const selecionados = itensAnalise.filter(i => i.incluir)

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">

      {/* ── Entrada de JSON ────────────────────────────────────────────── */}
      {!cadastro && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => void colarClipboard()}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white py-3.5 rounded-lg font-medium transition-colors"
            >
              📋 Colar JSON do Clipboard
            </button>
            <button
              onClick={() => setMostrarTextarea(v => !v)}
              title="Campo manual"
              className="px-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-lg transition-colors"
            >
              {mostrarTextarea ? '▲' : '▼'}
            </button>
          </div>

          {mostrarTextarea && (
            <>
              <textarea
                value={jsonTexto}
                onChange={e => setJsonTexto(e.target.value)}
                placeholder='{"Sucesso": true, "PedidosDict": {...}}'
                rows={8}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-green-500 resize-none"
              />
              <button
                onClick={() => parseJson(jsonTexto)}
                className="w-full bg-green-700 hover:bg-green-600 text-white py-2.5 rounded-lg font-medium transition-colors"
              >
                Analisar
              </button>
            </>
          )}

          {erroJson && (
            <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">
              ❌ {erroJson}
            </div>
          )}
        </div>
      )}

      {/* ── Resultado da análise ───────────────────────────────────────── */}
      {cadastro && (
        <>
          {/* Cabeçalho */}
          <div className="flex justify-between items-center">
            <h2 className="font-semibold">NFs Processadas</h2>
            <button onClick={limpar} className="text-zinc-500 hover:text-zinc-300 text-sm">
              ✕ Limpar
            </button>
          </div>

          {/* Cards de NF */}
          <div className="space-y-2">
            {Object.values(cadastro.Nfs).map(nf => (
              <div
                key={nf.ChaveNFe}
                className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm">
                    NF {nf.NumeroNF} · {nf.Fornecedor}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5 truncate">{nf.Mensagem}</p>
                  {(nf.SemLote || nf.DifValorUN || nf.DifFrete) && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {nf.SemLote && <Tag label="Sem Lote" color="yellow" />}
                      {nf.DifValorUN && <Tag label="Dif. Valor" color="orange" />}
                      {nf.DifFrete && <Tag label="Dif. Frete" color="orange" />}
                    </div>
                  )}
                </div>
                <span
                  className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${
                    nf.Lancada
                      ? 'bg-green-900 text-green-300'
                      : 'bg-red-900 text-red-300'
                  }`}
                >
                  {nf.Lancada ? 'Lançada' : 'Não lançada'}
                </span>
              </div>
            ))}
          </div>

          {/* Tudo já existe */}
          {novos.length === 0 && conflitos.length === 0 && (
            <div className="bg-green-950 border border-green-800 rounded-lg p-3 text-green-300 text-sm">
              ✅ Todas as {existentes.length} referência(s) já estão em itens.json
            </div>
          )}

          {/* Novas referências */}
          {novos.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-green-400">
                ➕ Novas referências ({novos.length})
              </h3>
              {itensAnalise.map((item, idx) =>
                item.status === 'novo' ? (
                  <ItemCard
                    key={`${item.fornecedor}|${item.codigoSAP}|${item.referencia}`}
                    item={item}
                    onFatorChange={v => setFator(idx, v)}
                    onToggle={() => toggleIncluir(idx)}
                  />
                ) : null,
              )}
            </div>
          )}

          {/* Conflitos */}
          {conflitos.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-yellow-400">
                ⚠️ Conflitos — referência em outro código SAP ({conflitos.length})
              </h3>
              {itensAnalise.map((item, idx) =>
                item.status === 'conflito' ? (
                  <ItemCard
                    key={`${item.fornecedor}|${item.codigoSAP}|${item.referencia}`}
                    item={item}
                    onFatorChange={v => setFator(idx, v)}
                    onToggle={() => toggleIncluir(idx)}
                  />
                ) : null,
              )}
            </div>
          )}

          {/* Status do commit */}
          {statusCommit && (
            <div
              className={`rounded-lg p-3 text-sm ${
                statusCommit.startsWith('✅')
                  ? 'bg-green-950 border border-green-800 text-green-300'
                  : 'bg-red-950 border border-red-800 text-red-300'
              }`}
            >
              {statusCommit}
            </div>
          )}

          {/* Botão registrar */}
          {(novos.length > 0 || conflitos.length > 0) && (
            <button
              onClick={() => void registrar()}
              disabled={commitando || selecionados.length === 0}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-lg transition-colors"
            >
              {commitando
                ? 'Registrando no GitHub...'
                : `Registrar ${selecionados.length} referência(s) no GitHub`}
            </button>
          )}

          {/* Existentes (colapsável) */}
          {existentes.length > 0 && (
            <details className="text-sm">
              <summary className="text-zinc-500 cursor-pointer hover:text-zinc-300 select-none">
                ✅ {existentes.length} referência(s) já existem em itens.json
              </summary>
              <div className="mt-2 space-y-0.5 pl-3 border-l border-zinc-800">
                {existentes.map(item => (
                  <p
                    key={`${item.fornecedor}|${item.codigoSAP}|${item.referencia}`}
                    className="text-xs text-zinc-500"
                  >
                    <span className="text-zinc-300 font-mono">{item.referencia}</span> — {item.descricao}
                  </p>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}

// ── Subcomponentes ───────────────────────────────────────────────────────────

interface ItemCardProps {
  item: ItemAnalise
  onFatorChange: (v: string) => void
  onToggle: () => void
}

function ItemCard({ item, onFatorChange, onToggle }: ItemCardProps) {
  return (
    <div
      className={`bg-zinc-900 border rounded-lg p-3 space-y-2 ${
        item.status === 'conflito' ? 'border-yellow-700' : 'border-zinc-700'
      } ${!item.incluir ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={item.incluir}
          onChange={onToggle}
          className="mt-0.5 w-4 h-4 accent-green-500 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{item.descricao}</p>
          <p className="text-xs text-zinc-400 mt-0.5 font-mono">
            {item.fornecedor} · {item.codigoSAP} ·{' '}
            <span className="text-white">{item.referencia}</span>
          </p>
          {item.conflito && (
            <p className="text-xs text-yellow-400 mt-1">
              ⚠️ Referência já mapeada para {item.conflito.codigoExistente}
              {item.conflito.fatorExistente !== null && ` (fator ${item.conflito.fatorExistente})`}
            </p>
          )}
        </div>
      </div>

      {item.incluir && (
        <div className="flex items-center gap-2 pl-7">
          <label className="text-xs text-zinc-400 shrink-0 w-10">Fator:</label>
          <input
            type="number"
            value={item.fator ?? ''}
            onChange={e => onFatorChange(e.target.value)}
            placeholder="Deixe vazio = sem conversão"
            step="any"
            min="0"
            className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-green-500"
          />
        </div>
      )}
    </div>
  )
}

function Tag({ label, color }: { label: string; color: 'yellow' | 'orange' }) {
  const cls =
    color === 'yellow'
      ? 'bg-yellow-900 text-yellow-300'
      : 'bg-orange-900 text-orange-300'
  return <span className={`text-xs px-1.5 py-0.5 rounded ${cls}`}>{label}</span>
}
