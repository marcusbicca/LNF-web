// ─────────────────────────────────────────────────────────────────────────────
// Lançamento — a aba "Lançamento" do xlsm, em tela.
//
// ESTA TELA É SÓ LAYOUT. Nenhum botão faz nada ainda e os dados vêm de um mock.
// É de propósito: o que se quer provar aqui é que a informação COUBE e ficou
// legível — inclusive no celular, onde a planilha nunca coube.
//
// ── o que é fiel à planilha, e por quê ───────────────────────────────────────
// As colunas, os marcadores ("Sem pedido", "Indefinido", "Lote alt.") e as
// tolerâncias (±R$ 2 no total, ±R$ 0,50 na linha) não foram redesenhados. Eles
// são a regra de conferência que o operador já tem na cabeça, e mudá-los junto
// com o meio transformaria "a tela nova" em "a regra nova" — dois riscos num
// commit só. A referência é Layout.bas + Planilha.VerificarDiferencas.
//
// ── o que MUDOU de propósito ─────────────────────────────────────────────────
// Na planilha, a conferência é cor de célula: o operador varre 16 colunas
// procurando vermelho. Aqui os quatro números que decidem a NF sobem para o
// topo, com o delta calculado, e o resto vira detalhe. É a mesma informação com
// a pergunta respondida em vez de apenas exibida — e é o que faz a tela caber
// numa mão.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { nfDeExemplo } from '../mocks/lancamento'
import {
  MARCAS_PEDIDO,
  MARCA_INDEFINIDO,
  MARCA_LOTE_ALT,
  TOLERANCIA_LINHA,
  TOLERANCIA_TOTAL,
  type ColunaEditavel,
  type EstadoLancamento,
  type ItemLancamento,
} from '../types/lancamento'

const moeda = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const numero = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v.toLocaleString('pt-BR')

const ehMarcador = (pedido: string) => (MARCAS_PEDIDO as readonly string[]).includes(pedido)

export function Lancamento() {
  const nf: EstadoLancamento = nfDeExemplo

  const [itens, setItens] = useState<ItemLancamento[]>(nf.itens)
  const [pedidos, setPedidos] = useState<string[]>(nf.pedidos)
  const [chave, setChave] = useState('')

  const editar = (id: string, campo: ColunaEditavel, valor: string) =>
    setItens((atual) =>
      atual.map((i) =>
        i.id === id ? { ...i, [campo]: campo === 'qtdNf' ? Number(valor) || 0 : valor } : i,
      ),
    )

  const { deltaTotal, deltaFrete, foraTotal, foraFrete } = useMemo(() => {
    const d = nf.dados
    const dt = (d.totalPedido ?? 0) - (d.valorTotalNf ?? 0)
    const df = (d.totalFretePedido ?? 0) - (d.freteNf ?? 0)
    return {
      deltaTotal: dt,
      deltaFrete: df,
      foraTotal: Math.abs(dt) > TOLERANCIA_TOTAL,
      foraFrete: Math.abs(df) > TOLERANCIA_TOTAL,
    }
  }, [nf.dados])

  // A planilha só destaca valor unitário de linha QUANDO o total já divergiu
  // (o `If vDiferencas` de VerificarDiferencas). Mantido: sem isso, arredonda-
  // mento de centavo acenderia a grade inteira numa NF que fecha certo.
  const conferirLinhas = foraTotal

  return (
    <div className="p-4 space-y-4 max-w-[110rem] mx-auto">
      <EntradaNf
        chave={chave}
        onChave={setChave}
        fornecedor={nf.fornecedor}
        nfNumero={nf.dados.nf}
        lancada={nf.sinais.lancada}
      />

      <div className="grid gap-4 items-start lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Pedidos valores={pedidos} onChange={setPedidos} />
        <Comandos />
      </div>

      <Conferencia
        dados={nf.dados}
        deltaTotal={deltaTotal}
        deltaFrete={deltaFrete}
        foraTotal={foraTotal}
        foraFrete={foraFrete}
      />

      <Alertas sinais={nf.sinais} />

      {/* A grade fica com a largura inteira, e os painéis descem. São dezesseis
          colunas: qualquer coisa que se ponha ao lado é largura roubada da
          única parte da tela que não tem como encolher. */}
      <GradeItens
        itens={itens}
        centrosDoUsuario={nf.centrosDoUsuario}
        lancada={nf.sinais.lancada}
        conferirLinhas={conferirLinhas}
        onEditar={editar}
      />

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <PainelDados dados={nf.dados} />
        <PainelDivergencias divergencias={nf.divergencias} />
      </div>
    </div>
  )
}

// ── entrada da NF ────────────────────────────────────────────────────────────
// Na planilha isto é a TextBox1: 44 dígitos disparam a busca sozinhos, e menos
// que isso é tratado como número de NF (que exige login no SAP). O campo aqui
// conta os dígitos em vez de esperar o operador contar.
function EntradaNf({
  chave,
  onChave,
  fornecedor,
  nfNumero,
  lancada,
}: {
  chave: string
  onChave: (v: string) => void
  fornecedor: string
  nfNumero: string
  lancada: boolean
}) {
  const digitos = chave.replace(/\D/g, '').length

  return (
    <section className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <input
            value={chave}
            onChange={(e) => onChave(e.target.value)}
            inputMode="numeric"
            placeholder="Chave da NF (44 dígitos) ou número"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-3 pr-16 py-2.5 text-sm font-mono focus:outline-none focus:border-green-500 transition-colors"
          />
          {digitos > 0 && (
            <span
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono ${
                digitos === 44 ? 'text-green-400' : 'text-zinc-500'
              }`}
            >
              {digitos}/44
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button className="flex-1 sm:flex-none px-3 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm transition-colors">
            Arquivo
          </button>
          <button className="flex-1 sm:flex-none px-3 py-2.5 bg-zinc-800 hover:bg-red-900 border border-zinc-700 text-zinc-300 hover:text-red-200 rounded-lg text-sm transition-colors">
            Limpar
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-zinc-500 text-xs uppercase tracking-wide">Fornecedor</span>
        <span className="font-medium break-words min-w-0">{fornecedor || '—'}</span>
        <span className="text-zinc-700">·</span>
        <span className="text-zinc-500 text-xs uppercase tracking-wide">NF</span>
        <span className="font-mono">{nfNumero || '—'}</span>
        <span
          className={`ml-auto px-2 py-0.5 rounded text-xs font-medium border ${
            lancada
              ? 'bg-green-950 border-green-800 text-green-300'
              : 'bg-sky-950 border-sky-800 text-sky-300'
          }`}
        >
          {lancada ? 'Lançada' : 'Analisada'}
        </span>
      </div>
    </section>
  )
}

// ── pedidos (A15:A19) ────────────────────────────────────────────────────────
function Pedidos({
  valores,
  onChange,
}: {
  valores: string[]
  onChange: (v: string[]) => void
}) {
  const setNo = (i: number, v: string) =>
    onChange(valores.map((atual, idx) => (idx === i ? v : atual)))

  return (
    <section className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
      <h2 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Pedidos</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
        {valores.map((v, i) => (
          <input
            key={i}
            value={v}
            onChange={(e) => setNo(i, e.target.value)}
            inputMode="numeric"
            placeholder={`Pedido ${i + 1}`}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-green-500 transition-colors"
          />
        ))}
      </div>
    </section>
  )
}

// ── comandos ─────────────────────────────────────────────────────────────────
// Um por botão do xlsm, com o nome que o operador já conhece. A hierarquia é
// nova: na planilha os oito botões têm o mesmo peso visual, e o Executar — que
// é o que se aperta em toda NF — some no meio deles.
const SECUNDARIOS = [
  'Lançar MIGO',
  'Lançar SLIP',
  'Divergência',
  'Estorno',
  'Múltiplas NFs',
  'Opções',
]

function Comandos() {
  return (
    <section className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
      <h2 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Comandos</h2>
      <div className="flex flex-col sm:flex-row gap-2">
        <button className="sm:w-44 bg-green-600 hover:bg-green-500 text-white font-semibold py-2.5 rounded-lg transition-colors">
          Executar
        </button>
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SECUNDARIOS.map((rotulo) => (
            <button
              key={rotulo}
              className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm py-2.5 px-2 rounded-lg transition-colors"
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── conferência: os quatro números que decidem ───────────────────────────────
function Conferencia({
  dados,
  deltaTotal,
  deltaFrete,
  foraTotal,
  foraFrete,
}: {
  dados: EstadoLancamento['dados']
  deltaTotal: number
  deltaFrete: number
  foraTotal: boolean
  foraFrete: boolean
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <Confronto
        titulo="Valor total"
        rotuloA="NF"
        valorA={dados.valorTotalNf}
        rotuloB="Pedido (produtos + frete)"
        valorB={dados.totalPedido}
        delta={deltaTotal}
        fora={foraTotal}
      />
      <Confronto
        titulo="Frete"
        rotuloA="NF"
        valorA={dados.freteNf}
        rotuloB="Pedido"
        valorB={dados.totalFretePedido}
        delta={deltaFrete}
        fora={foraFrete}
      />
    </section>
  )
}

function Confronto({
  titulo,
  rotuloA,
  valorA,
  rotuloB,
  valorB,
  delta,
  fora,
}: {
  titulo: string
  rotuloA: string
  valorA: number | null
  rotuloB: string
  valorB: number | null
  delta: number
  fora: boolean
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        fora ? 'border-red-800/70 bg-red-950/30' : 'border-zinc-800 bg-zinc-950'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="text-[11px] uppercase tracking-wide text-zinc-500">{titulo}</h2>
        <span
          className={`text-xs font-medium ${fora ? 'text-red-300' : 'text-green-400'}`}
        >
          {fora ? `Δ ${moeda(delta)}` : 'confere'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-zinc-500 mb-0.5">{rotuloA}</div>
          <div className="text-lg font-semibold tabular-nums break-words">{moeda(valorA)}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-zinc-500 mb-0.5">{rotuloB}</div>
          <div className="text-lg font-semibold tabular-nums break-words text-zinc-300">
            {moeda(valorB)}
          </div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-zinc-600">
        tolerância ± {moeda(TOLERANCIA_TOTAL)}
      </div>
    </div>
  )
}

// ── alertas ──────────────────────────────────────────────────────────────────
// As mesmas frases que o JFeedback escreve, na mesma ordem de gravidade. A
// diferença é que aqui elas ficam na tela em vez de num modal que o operador
// fecha e não pode reabrir.
function Alertas({ sinais }: { sinais: EstadoLancamento['sinais'] }) {
  const itens: Array<{ tom: 'erro' | 'aviso' | 'ok'; texto: string }> = []

  if (sinais.centroBloqueiaLancamento)
    itens.push({ tom: 'erro', texto: 'Centro não vinculado ao seu usuário — lançamento bloqueado.' })
  if (sinais.difFrete) itens.push({ tom: 'aviso', texto: 'Divergência de frete.' })
  if (sinais.difValorUN) itens.push({ tom: 'aviso', texto: 'Divergência de valores unitários.' })
  if (sinais.itemSemPedido) itens.push({ tom: 'aviso', texto: 'Há itens sem pedido.' })
  if (sinais.itemIndefinido) itens.push({ tom: 'aviso', texto: 'Há itens sem cadastro.' })
  if (sinais.difCentro && !sinais.centroBloqueiaLancamento)
    itens.push({ tom: 'aviso', texto: 'O centro de um ou mais pedidos não está vinculado ao seu usuário.' })
  if (sinais.semLote) itens.push({ tom: 'aviso', texto: 'Não foi possível encontrar um ou mais lotes.' })
  if (sinais.loteFit)
    itens.push({ tom: 'aviso', texto: 'Um ou mais lotes foram ajustados para no máximo 10 dígitos.' })
  if (sinais.mensagem) itens.push({ tom: 'aviso', texto: sinais.mensagem })

  if (itens.length === 0)
    itens.push({ tom: 'ok', texto: 'Nenhuma divergência localizada.' })

  const cor = {
    erro: 'border-red-800/70 bg-red-950/30 text-red-200',
    aviso: 'border-amber-800/60 bg-amber-950/30 text-amber-200',
    ok: 'border-green-800/60 bg-green-950/30 text-green-200',
  }

  // O bloqueio ocupa uma faixa inteira; os avisos viram etiquetas que se
  // ajeitam em uma ou duas linhas. Empilhar seis barras iguais gastava uma
  // tela e, pior, dava ao "centro não vinculado" o mesmo peso do "lote
  // ajustado" — que são coisas de urgência muito diferente.
  const bloqueios = itens.filter((a) => a.tom === 'erro')
  const demais = itens.filter((a) => a.tom !== 'erro')

  return (
    <section className="space-y-2">
      {bloqueios.map((a, i) => (
        <div key={i} className={`rounded-lg border px-3 py-2 text-sm break-words ${cor[a.tom]}`}>
          {a.texto}
        </div>
      ))}
      {demais.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {demais.map((a, i) => (
            <span
              key={i}
              className={`rounded-lg border px-2.5 py-1.5 text-xs break-words ${cor[a.tom]}`}
            >
              {a.texto}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

// ── a grade de itens ─────────────────────────────────────────────────────────
const CABECALHOS = [
  'Pedido',
  'Centro',
  'Dep.',
  'Material',
  'Descrição',
  'Referência',
  'Item',
  'Qnt NF',
  'UMB Forn',
  'Lote',
  'Validade',
  'Qnt Pend.',
  'UMB Ped',
  'Vl Un Pedido',
  'Vl Un NF',
  'Frete Un',
]

interface GradeProps {
  itens: ItemLancamento[]
  centrosDoUsuario: string[]
  lancada: boolean
  conferirLinhas: boolean
  onEditar: (id: string, campo: ColunaEditavel, valor: string) => void
}

function GradeItens(props: GradeProps) {
  return (
    <section className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 px-4 py-3 border-b border-zinc-800">
        <h2 className="text-[11px] uppercase tracking-wide text-zinc-500">Itens</h2>
        <span className="text-xs text-zinc-500">{props.itens.length} linha(s)</span>
      </div>

      {/* Celular: um cartão por item. A grade de 16 colunas não cabe em 400px,
          e espremer vira o problema que já corrigimos em Respostas. */}
      <div className="md:hidden divide-y divide-zinc-800">
        {props.itens.map((i) => (
          <CartaoItem key={i.id} item={i} {...props} />
        ))}
      </div>

      {/* Desktop: a grade inteira, rolando na horizontal dentro do próprio
          container — nunca o corpo da página. */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-zinc-800">
              {CABECALHOS.map((h) => (
                <th key={h} className="font-medium px-2.5 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {props.itens.map((i) => (
              <LinhaItem key={i.id} item={i} {...props} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Uma célula de entrada, para as quatro colunas que o operador ajusta. O anel
// verde não é enfeite: é o que diz, sem legenda, onde se pode digitar.
function Campo({
  valor,
  onChange,
  largura = 'w-24',
  tipo = 'text',
}: {
  valor: string | number
  onChange: (v: string) => void
  largura?: string
  tipo?: string
}) {
  return (
    <input
      value={valor}
      type={tipo}
      onChange={(e) => onChange(e.target.value)}
      className={`${largura} bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-xs font-mono focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/40 transition-colors`}
    />
  )
}

// As mesmas regras de cor de Planilha.VerificarDiferencas, traduzidas de fundo
// sólido para borda + tinta: num tema escuro, célula chapada de vermelho apaga
// o texto que ela deveria destacar.
function classePedido(pedido: string) {
  return ehMarcador(pedido)
    ? 'text-amber-300 font-semibold'
    : 'text-zinc-200'
}

function classeCentro(centro: string, doUsuario: string[]) {
  return doUsuario.includes(centro) ? 'text-zinc-300' : 'text-red-300 font-semibold'
}

function classeMaterial(material: string) {
  return material === MARCA_INDEFINIDO ? 'text-amber-300 font-semibold' : 'text-zinc-200'
}

function linhaDivergeNoValor(item: ItemLancamento) {
  if (item.valorUnNf === null || item.valorUnPedido === null) return false
  return Math.abs((item.valorUnNf - item.valorUnPedido) * item.qtdNf) > TOLERANCIA_LINHA
}

function LinhaItem({ item, centrosDoUsuario, lancada, conferirLinhas, onEditar }: GradeProps & { item: ItemLancamento }) {
  const diverge = conferirLinhas && linhaDivergeNoValor(item)
  const loteAlt = item.referencia === MARCA_LOTE_ALT

  return (
    <tr className="hover:bg-zinc-900/50">
      <td className={`px-2.5 py-1.5 font-mono ${classePedido(item.pedido)}`}>{item.pedido || '—'}</td>
      <td className={`px-2.5 py-1.5 font-mono ${classeCentro(item.centro, centrosDoUsuario)}`}>
        {item.centro}
      </td>
      <td className="px-2.5 py-1.5">
        <Campo valor={item.deposito} onChange={(v) => onEditar(item.id, 'deposito', v)} largura="w-16" />
      </td>
      <td className={`px-2.5 py-1.5 font-mono ${classeMaterial(item.material)}`}>{item.material}</td>
      <td className="px-2.5 py-1.5 text-zinc-400 max-w-xs truncate" title={item.descricao}>
        {item.descricao}
      </td>
      <td className="px-2.5 py-1.5 font-mono">
        {loteAlt ? (
          <span className="px-1.5 py-0.5 rounded bg-green-950 border border-green-800 text-green-300">
            {MARCA_LOTE_ALT}
          </span>
        ) : (
          <span className="text-zinc-400">{item.referencia}</span>
        )}
      </td>
      <td className="px-2.5 py-1.5">
        <span
          className={`inline-block min-w-[1.75rem] text-center font-mono rounded px-1 ${
            item.qtdNf > 0
              ? lancada
                ? 'bg-green-900/60 text-green-200'
                : 'bg-zinc-800 text-zinc-200'
              : 'text-zinc-500'
          }`}
        >
          {item.item || '—'}
        </span>
      </td>
      <td className="px-2.5 py-1.5">
        <Campo
          valor={item.qtdNf}
          tipo="number"
          onChange={(v) => onEditar(item.id, 'qtdNf', v)}
          largura="w-16"
        />
      </td>
      <td className="px-2.5 py-1.5 font-mono text-zinc-400">{item.umbForn || '—'}</td>
      <td className="px-2.5 py-1.5">
        <Campo valor={item.lote} onChange={(v) => onEditar(item.id, 'lote', v)} largura="w-28" />
      </td>
      <td className="px-2.5 py-1.5">
        <Campo valor={item.validade} onChange={(v) => onEditar(item.id, 'validade', v)} largura="w-24" />
      </td>
      <td className="px-2.5 py-1.5 font-mono tabular-nums text-zinc-400">{numero(item.qtdPendente)}</td>
      <td className="px-2.5 py-1.5 font-mono text-zinc-400">{item.umbPed || '—'}</td>
      <td
        className={`px-2.5 py-1.5 font-mono tabular-nums ${
          diverge ? 'text-red-300 font-semibold' : 'text-zinc-400'
        }`}
      >
        {moeda(item.valorUnPedido)}
      </td>
      <td
        className={`px-2.5 py-1.5 font-mono tabular-nums ${
          diverge ? 'text-green-300 font-semibold' : 'text-zinc-400'
        }`}
      >
        {moeda(item.valorUnNf)}
      </td>
      <td className="px-2.5 py-1.5 font-mono tabular-nums text-zinc-400">
        {moeda(item.freteUnPedido)}
      </td>
    </tr>
  )
}

function CartaoItem({ item, centrosDoUsuario, lancada, conferirLinhas, onEditar }: GradeProps & { item: ItemLancamento }) {
  const diverge = conferirLinhas && linhaDivergeNoValor(item)

  return (
    <div className="p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`text-sm font-mono ${classePedido(item.pedido)}`}>
            {item.pedido || '—'}
            {item.item && <span className="text-zinc-500"> · item {item.item}</span>}
          </div>
          <div className={`text-sm font-mono ${classeMaterial(item.material)}`}>{item.material}</div>
          <div className="text-xs text-zinc-400 break-words">{item.descricao}</div>
        </div>
        <span
          className={`shrink-0 px-1.5 py-0.5 rounded text-[11px] font-mono border ${
            centrosDoUsuario.includes(item.centro)
              ? 'border-zinc-700 text-zinc-400'
              : 'border-red-800 bg-red-950/40 text-red-300'
          }`}
        >
          {item.centro}
        </span>
      </div>

      {item.referencia === MARCA_LOTE_ALT ? (
        <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono bg-green-950 border border-green-800 text-green-300">
          {MARCA_LOTE_ALT}
        </span>
      ) : (
        <div className="text-[11px] font-mono text-zinc-500 break-all">{item.referencia}</div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <CampoRotulado rotulo="Qnt NF">
          <Campo
            valor={item.qtdNf}
            tipo="number"
            onChange={(v) => onEditar(item.id, 'qtdNf', v)}
            largura="w-full"
          />
        </CampoRotulado>
        <CampoRotulado rotulo="Depósito">
          <Campo
            valor={item.deposito}
            onChange={(v) => onEditar(item.id, 'deposito', v)}
            largura="w-full"
          />
        </CampoRotulado>
        <CampoRotulado rotulo="Lote">
          <Campo valor={item.lote} onChange={(v) => onEditar(item.id, 'lote', v)} largura="w-full" />
        </CampoRotulado>
        <CampoRotulado rotulo="Validade">
          <Campo
            valor={item.validade}
            onChange={(v) => onEditar(item.id, 'validade', v)}
            largura="w-full"
          />
        </CampoRotulado>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Leitura rotulo="Vl Un Ped" valor={moeda(item.valorUnPedido)} tom={diverge ? 'red' : undefined} />
        <Leitura rotulo="Vl Un NF" valor={moeda(item.valorUnNf)} tom={diverge ? 'green' : undefined} />
        <Leitura rotulo="Frete Un" valor={moeda(item.freteUnPedido)} />
        <Leitura rotulo="Qnt Pend." valor={numero(item.qtdPendente)} />
        <Leitura rotulo="UMB Forn" valor={item.umbForn || '—'} />
        <Leitura rotulo="UMB Ped" valor={item.umbPed || '—'} />
      </div>

      {lancada && item.qtdNf > 0 && (
        <div className="text-[11px] text-green-300">lançado</div>
      )}
    </div>
  )
}

function CampoRotulado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">{rotulo}</span>
      {children}
    </label>
  )
}

function Leitura({
  rotulo,
  valor,
  tom,
}: {
  rotulo: string
  valor: string
  tom?: 'red' | 'green'
}) {
  const cor = tom === 'red' ? 'text-red-300' : tom === 'green' ? 'text-green-300' : 'text-zinc-300'
  return (
    <div className="min-w-0">
      <div className="text-zinc-500">{rotulo}</div>
      <div className={`font-mono tabular-nums break-words ${cor}`}>{valor}</div>
    </div>
  )
}

// ── painel de dados da NF (S2:S14) ───────────────────────────────────────────
// Os quatro números de dinheiro saíram daqui para o topo. O que fica é o que se
// consulta, não o que se confere.
function PainelDados({ dados }: { dados: EstadoLancamento['dados'] }) {
  const linhas: Array<[string, string]> = [
    ['Nota de remessa', dados.nf || '—'],
    ['Txt. cabeç.', dados.txtCabec || '—'],
    ['Conh. transp.', dados.conhTransp || '—'],
    ['Data de emissão', dados.dataEmissao || '—'],
    ['Data de lançamento', dados.dataLancamento || '—'],
    ['Valor produtos (pedido)', moeda(dados.valorProdutosPedido)],
    ['Planejador / comprador', dados.planejador || '—'],
    ['Data programada', dados.dataProgramada || '—'],
    ['MIGO', dados.migo || '—'],
  ]

  return (
    <section className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
      <h2 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-3">Dados da NF</h2>
      <dl className="space-y-2 text-sm">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="flex gap-3 justify-between items-baseline">
            <dt className="text-zinc-500 text-xs shrink-0">{rotulo}</dt>
            <dd className="font-mono text-right break-words min-w-0">{valor}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// ── divergências (a aba Diferenças, que são três grades) ─────────────────────
function PainelDivergencias({
  divergencias,
}: {
  divergencias: EstadoLancamento['divergencias']
}) {
  const vazio =
    divergencias.valorUn.length === 0 &&
    divergencias.semPedido.length === 0 &&
    divergencias.frete.length === 0

  return (
    <section className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-4">
      <h2 className="text-[11px] uppercase tracking-wide text-zinc-500">Divergências</h2>

      {vazio && <p className="text-sm text-zinc-500">Nenhuma.</p>}

      {divergencias.valorUn.length > 0 && (
        <BlocoDivergencia titulo="Valor unitário">
          {divergencias.valorUn.map((d, i) => (
            <li key={i} className="text-xs break-words">
              <span className="font-mono text-zinc-300">
                {d.pedido}/{d.item}
              </span>
              <span className="text-zinc-500"> — NF </span>
              <span className="font-mono text-zinc-300">{moeda(d.valorUnNf)}</span>
              {d.divisor && d.divisor !== '1' && (
                <span className="text-zinc-500"> (divisor {d.divisor})</span>
              )}
            </li>
          ))}
        </BlocoDivergencia>
      )}

      {divergencias.semPedido.length > 0 && (
        <BlocoDivergencia titulo="Itens sem pedido">
          {divergencias.semPedido.map((d, i) => (
            <li key={i} className="text-xs break-words">
              <span className="font-mono text-zinc-300">{d.codigo}</span>
              <span className="text-zinc-500"> · ref </span>
              <span className="font-mono text-zinc-400">{d.referencia}</span>
              <span className="text-zinc-500"> · centro {d.centroNf} · qtd {numero(d.qtdNf)}</span>
            </li>
          ))}
        </BlocoDivergencia>
      )}

      {divergencias.frete.length > 0 && (
        <BlocoDivergencia titulo="Frete">
          {divergencias.frete.map((d, i) => (
            <li key={i} className="text-xs break-words">
              <span className="font-mono text-zinc-300">{d.pedido}</span>
              <span className="text-zinc-500"> · itens {d.itens.join(', ')} · </span>
              <span className="font-mono text-zinc-300">{moeda(d.valorFreteTotal)}</span>
            </li>
          ))}
        </BlocoDivergencia>
      )}
    </section>
  )
}

function BlocoDivergencia({
  titulo,
  children,
}: {
  titulo: string
  children: React.ReactNode
}) {
  return (
    <div className="border border-amber-800/60 bg-amber-950/20 rounded-lg p-3">
      <h3 className="text-xs font-medium text-amber-300 mb-1.5">{titulo}</h3>
      <ul className="space-y-1">{children}</ul>
    </div>
  )
}
