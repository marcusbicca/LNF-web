// ─────────────────────────────────────────────────────────────────────────────
// Lançamento — a aba "Lançamento" do xlsm, em tela.
//
// ESTA TELA É SÓ LAYOUT. Nenhum botão faz nada e os dados vêm de um mock.
// O que se quer provar aqui é que a informação coube e ficou legível.
//
// ── o que é fiel à planilha, e por quê ───────────────────────────────────────
// As dezesseis colunas, os marcadores ("Sem pedido", "Indefinido", "Lote alt.")
// e as tolerâncias (±R$ 2 no total, ±R$ 0,50 na linha) não foram redesenhados.
// São a regra de conferência que o operador já tem na cabeça, e mudá-las junto
// com o meio transformaria "a tela nova" em "a regra nova" — dois riscos num
// commit só. Fonte: Layout.bas + Planilha.VerificarDiferencas + Analise.
// Conferido contra o VBA de dentro do .xlam publicado: os endereços batem.
//
// ── as três coisas que mudaram, e o motivo de cada uma ───────────────────────
//
// 1. CABE NA TELA. Nada de rolar a página no computador: o topo é fixo e só a
//    grade rola, por dentro. Rolar para achar a linha e rolar de volta para ver
//    o total é o gesto que a planilha obriga, e é onde a conferência erra.
//    Quem preferir a grade inteira aberta tem o botão "Expandir" — aí a página
//    volta a rolar, por escolha de quem está usando.
//
// 2. OS AVISOS ABREM EM JANELA, como o JFeedback faz hoje, e o botão do
//    cabeçalho os traz de volta. O JFeedback some quando se fecha, e a
//    informação vai junto.
//
// 3. A LINHA DIZ O QUE TEM. A planilha pinta a célula; quem olha o vermelho
//    ainda precisa adivinhar se é o centro, o valor ou o cadastro. Aqui a linha
//    problemática ganha borda, fundo e um marcador que se abre nomeando o
//    problema — sem tirar nenhuma das cores de célula que já existiam.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { nfDeExemplo } from '../mocks/lancamento'
import {
  MARCAS_PEDIDO,
  MARCA_INDEFINIDO,
  MARCA_LOTE_ALT,
  ROTULO_PROBLEMA,
  TOLERANCIA_LINHA,
  TOLERANCIA_TOTAL,
  type ColunaEditavel,
  type EstadoLancamento,
  type ItemLancamento,
  type MensagemFeedback,
  type ProblemaLinha,
} from '../types/lancamento'

const moeda = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const numero = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v.toLocaleString('pt-BR')

const ehMarcador = (pedido: string) => (MARCAS_PEDIDO as readonly string[]).includes(pedido)

// ── as mensagens, na ordem de gravidade do UsarUltimoExecutar ────────────────
function mensagensDe(sinais: EstadoLancamento['sinais']): MensagemFeedback[] {
  const m: MensagemFeedback[] = []

  if (sinais.centroBloqueiaLancamento)
    m.push({ tom: 'erro', texto: 'Centro não vinculado ao seu usuário — lançamento bloqueado.' })
  if (sinais.difFrete) m.push({ tom: 'aviso', texto: 'Divergência de frete.' })
  if (sinais.difValorUN) m.push({ tom: 'aviso', texto: 'Divergência de valores unitários.' })
  if (sinais.itemSemPedido) m.push({ tom: 'aviso', texto: 'Há itens sem pedido.' })
  if (sinais.itemIndefinido) m.push({ tom: 'aviso', texto: 'Há itens sem cadastro.' })
  if (sinais.difCentro && !sinais.centroBloqueiaLancamento)
    m.push({ tom: 'aviso', texto: 'O centro de um ou mais pedidos não está vinculado ao seu usuário.' })
  if (sinais.semLote) m.push({ tom: 'aviso', texto: 'Não foi possível encontrar um ou mais lotes.' })
  if (sinais.loteFit)
    m.push({ tom: 'aviso', texto: 'Um ou mais lotes foram ajustados para no máximo 10 dígitos.' })
  if (sinais.mensagem) m.push({ tom: 'aviso', texto: sinais.mensagem })

  if (m.length === 0) m.push({ tom: 'ok', texto: 'Nenhuma divergência localizada.' })
  return m
}

// ── o que há de errado com uma linha ─────────────────────────────────────────
function problemasDaLinha(
  item: ItemLancamento,
  centrosDoUsuario: string[],
  conferirLinhas: boolean,
): ProblemaLinha[] {
  const p: ProblemaLinha[] = []

  if (ehMarcador(item.pedido)) p.push('sem-pedido')
  if (item.material === MARCA_INDEFINIDO) p.push('material-indefinido')
  if (!centrosDoUsuario.includes(item.centro)) p.push('centro-nao-vinculado')
  if (
    conferirLinhas &&
    item.valorUnNf !== null &&
    item.valorUnPedido !== null &&
    Math.abs((item.valorUnNf - item.valorUnPedido) * item.qtdNf) > TOLERANCIA_LINHA
  )
    p.push('valor-divergente')
  // Lote em branco só é problema quando há o que receber. Numa linha zerada
  // ("Finalizado") a ausência é o esperado, não uma falta.
  if (item.qtdNf > 0 && item.lote.trim() === '') p.push('sem-lote')

  return p
}

export function Lancamento() {
  const nf: EstadoLancamento = nfDeExemplo

  const [itens, setItens] = useState<ItemLancamento[]>(nf.itens)
  const [pedidos, setPedidos] = useState<string[]>(nf.pedidos.filter((p) => p !== ''))
  const [chave, setChave] = useState('')
  const [feedbackAberto, setFeedbackAberto] = useState(false)
  const [dadosAbertos, setDadosAbertos] = useState(false)
  const [expandida, setExpandida] = useState(false)

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
  // (o `If vDiferencas` de VerificarDiferencas). Mantido: sem isso, centavo de
  // arredondamento acenderia a grade inteira numa NF que fecha certo.
  const conferirLinhas = foraTotal

  const mensagens = useMemo(() => mensagensDe(nf.sinais), [nf.sinais])
  const gravidade: MensagemFeedback['tom'] = mensagens.some((m) => m.tom === 'erro')
    ? 'erro'
    : mensagens.some((m) => m.tom === 'aviso')
      ? 'aviso'
      : 'ok'

  // Enquanto não há transporte, "processar" é apertar Executar. Quando houver,
  // o gatilho passa a ser a resposta chegando — e só esta linha muda.
  const processar = () => setFeedbackAberto(true)

  return (
    <div
      className={`flex flex-col gap-3 p-3 max-w-[120rem] mx-auto ${
        expandida ? '' : 'lg:h-full lg:overflow-hidden'
      }`}
    >
      <Topo
        chave={chave}
        onChave={setChave}
        nf={nf}
        pedidos={pedidos}
        onPedidos={setPedidos}
        deltaTotal={deltaTotal}
        deltaFrete={deltaFrete}
        foraTotal={foraTotal}
        foraFrete={foraFrete}
        gravidade={gravidade}
        quantosAvisos={mensagens.filter((m) => m.tom !== 'ok').length}
        onAbrirFeedback={() => setFeedbackAberto(true)}
        dadosAbertos={dadosAbertos}
        onAlternarDados={() => setDadosAbertos((v) => !v)}
        onExecutar={processar}
      />

      <GradeItens
        itens={itens}
        centrosDoUsuario={nf.centrosDoUsuario}
        lancada={nf.sinais.lancada}
        conferirLinhas={conferirLinhas}
        onEditar={editar}
        expandida={expandida}
        onAlternarExpansao={() => setExpandida((v) => !v)}
      />

      {feedbackAberto && (
        <JanelaFeedback
          mensagens={mensagens}
          divergencias={nf.divergencias}
          onFechar={() => setFeedbackAberto(false)}
        />
      )}
    </div>
  )
}

// ── o topo: tudo o que não é a grade, no menor espaço em que ainda se lê ─────
interface TopoProps {
  chave: string
  onChave: (v: string) => void
  nf: EstadoLancamento
  pedidos: string[]
  onPedidos: (v: string[]) => void
  deltaTotal: number
  deltaFrete: number
  foraTotal: boolean
  foraFrete: boolean
  gravidade: MensagemFeedback['tom']
  quantosAvisos: number
  onAbrirFeedback: () => void
  dadosAbertos: boolean
  onAlternarDados: () => void
  onExecutar: () => void
}

function Topo(p: TopoProps) {
  const digitos = p.chave.replace(/\D/g, '').length

  return (
    <div className="shrink-0 space-y-3">
      {/* linha 1 — entrada da NF e identificação */}
      <section className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[16rem]">
          <input
            value={p.chave}
            onChange={(e) => p.onChave(e.target.value)}
            inputMode="numeric"
            placeholder="Chave da NF (44 dígitos) ou número"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-3 pr-16 py-2 text-sm font-mono focus:outline-none focus:border-green-500 transition-colors"
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

        <button className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm transition-colors">
          Arquivo
        </button>
        <button className="px-3 py-2 bg-zinc-800 hover:bg-red-900 border border-zinc-700 text-zinc-300 hover:text-red-200 rounded-lg text-sm transition-colors">
          Limpar
        </button>

        <div className="w-px h-6 bg-zinc-800 hidden sm:block" />

        <div className="flex items-center gap-2 min-w-0 text-sm">
          <span className="truncate max-w-[22rem]" title={p.nf.fornecedor}>
            {p.nf.fornecedor || '—'}
          </span>
          <span className="text-zinc-700">·</span>
          <span className="font-mono text-zinc-400">{p.nf.dados.nf || '—'}</span>
        </div>

        <span
          className={`ml-auto px-2 py-0.5 rounded text-xs font-medium border ${
            p.nf.sinais.lancada
              ? 'bg-green-950 border-green-800 text-green-300'
              : 'bg-sky-950 border-sky-800 text-sky-300'
          }`}
        >
          {p.nf.sinais.lancada ? 'Lançada' : 'Analisada'}
        </span>
      </section>

      {/* linha 2 — pedidos, comandos, conferência */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3 min-w-0">
          <Pedidos valores={p.pedidos} onChange={p.onPedidos} />
          <Comandos
            onExecutar={p.onExecutar}
            gravidade={p.gravidade}
            quantosAvisos={p.quantosAvisos}
            onAbrirFeedback={p.onAbrirFeedback}
            dadosAbertos={p.dadosAbertos}
            onAlternarDados={p.onAlternarDados}
          />
        </div>

        <Conferencia
          dados={p.nf.dados}
          deltaTotal={p.deltaTotal}
          deltaFrete={p.deltaFrete}
          foraTotal={p.foraTotal}
          foraFrete={p.foraFrete}
        />
      </div>

      {p.dadosAbertos && <PainelDados dados={p.nf.dados} />}
    </div>
  )
}

// ── pedidos: quantos o operador quiser ───────────────────────────────────────
// Na planilha eram cinco, porque cinco é o que cabia em A15:A19. O limite era
// do endereço, não da regra — some junto com a célula.
function Pedidos({ valores, onChange }: { valores: string[]; onChange: (v: string[]) => void }) {
  const setNo = (i: number, v: string) => onChange(valores.map((a, idx) => (idx === i ? v : a)))
  const remover = (i: number) => onChange(valores.filter((_, idx) => idx !== i))
  const adicionar = () => onChange([...valores, ''])

  return (
    <section className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-[11px] uppercase tracking-wide text-zinc-500">Pedidos</h2>
        <span className="text-[11px] text-zinc-600">{valores.length}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {valores.map((v, i) => (
          <div key={i} className="relative">
            <input
              value={v}
              onChange={(e) => setNo(i, e.target.value)}
              inputMode="numeric"
              placeholder="Pedido"
              autoFocus={v === '' && i === valores.length - 1}
              className="w-40 bg-zinc-900 border border-zinc-700 rounded-lg pl-3 pr-7 py-1.5 text-sm font-mono focus:outline-none focus:border-green-500 transition-colors"
            />
            <button
              onClick={() => remover(i)}
              aria-label={`Remover pedido ${i + 1}`}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded text-zinc-600 hover:text-red-300 hover:bg-zinc-800 transition-colors leading-none"
            >
              ×
            </button>
          </div>
        ))}

        <button
          onClick={adicionar}
          className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-dashed border-zinc-700 hover:border-green-700 text-zinc-400 hover:text-green-300 rounded-lg text-sm transition-colors"
        >
          + pedido
        </button>
      </div>
    </section>
  )
}

// ── comandos ─────────────────────────────────────────────────────────────────
const SECUNDARIOS = ['Lançar MIGO', 'Lançar SLIP', 'Divergência', 'Estorno', 'Múltiplas NFs', 'Opções']

function Comandos({
  onExecutar,
  gravidade,
  quantosAvisos,
  onAbrirFeedback,
  dadosAbertos,
  onAlternarDados,
}: {
  onExecutar: () => void
  gravidade: MensagemFeedback['tom']
  quantosAvisos: number
  onAbrirFeedback: () => void
  dadosAbertos: boolean
  onAlternarDados: () => void
}) {
  const corAviso =
    gravidade === 'erro'
      ? 'bg-red-950 border-red-800 text-red-200 hover:bg-red-900'
      : gravidade === 'aviso'
        ? 'bg-amber-950 border-amber-800 text-amber-200 hover:bg-amber-900'
        : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800'

  return (
    <section className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex flex-wrap items-center gap-2">
      <button
        onClick={onExecutar}
        className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg text-sm transition-colors"
      >
        Executar
      </button>

      {SECUNDARIOS.map((rotulo) => (
        <button
          key={rotulo}
          className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm rounded-lg transition-colors"
        >
          {rotulo}
        </button>
      ))}

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onAlternarDados}
          className="px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
        >
          Dados da NF {dadosAbertos ? '▴' : '▾'}
        </button>
        <button
          onClick={onAbrirFeedback}
          className={`px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${corAviso}`}
        >
          {quantosAvisos > 0 ? `⚠ ${quantosAvisos} aviso(s)` : '✓ sem avisos'}
        </button>
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
    <section className="grid gap-3 sm:grid-cols-2 xl:w-[42rem]">
      <Confronto
        titulo="Valor total"
        rotuloA="NF"
        valorA={dados.valorTotalNf}
        rotuloB="Pedido (prod. + frete)"
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
      className={`rounded-xl border p-3 ${
        fora ? 'border-red-800/70 bg-red-950/30' : 'border-zinc-800 bg-zinc-950'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h2 className="text-[11px] uppercase tracking-wide text-zinc-500">{titulo}</h2>
        <span className={`text-xs font-medium ${fora ? 'text-red-300' : 'text-green-400'}`}>
          {fora ? `Δ ${moeda(delta)}` : 'confere'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-zinc-500">{rotuloA}</div>
          <div className="text-base font-semibold tabular-nums break-words">{moeda(valorA)}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-zinc-500">{rotuloB}</div>
          <div className="text-base font-semibold tabular-nums break-words text-zinc-300">
            {moeda(valorB)}
          </div>
        </div>
      </div>
    </div>
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

function GradeItens(
  props: GradeProps & { expandida: boolean; onAlternarExpansao: () => void },
) {
  const comProblema = props.itens.filter(
    (i) => problemasDaLinha(i, props.centrosDoUsuario, props.conferirLinhas).length > 0,
  ).length

  return (
    <section
      className={`bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col overflow-hidden ${
        props.expandida ? '' : 'lg:flex-1 lg:min-h-0'
      }`}
    >
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800">
        <div className="flex items-baseline gap-3 min-w-0">
          <h2 className="text-[11px] uppercase tracking-wide text-zinc-500">Itens</h2>
          <span className="text-xs text-zinc-500">{props.itens.length} linha(s)</span>
          {comProblema > 0 && (
            <span className="text-xs text-amber-300">{comProblema} com pendência</span>
          )}
        </div>

        {/* Rolar a página é escolha, não padrão. Ajustado, só a grade rola;
            expandido, ela abre inteira e o risco de rolar é de quem pediu. */}
        <button
          onClick={props.onAlternarExpansao}
          className="hidden lg:block shrink-0 px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded text-xs transition-colors"
        >
          {props.expandida ? 'Ajustar à tela' : 'Expandir'}
        </button>
      </div>

      {/* Celular: um cartão por item. A grade de dezesseis colunas não cabe em
          400px, e espremer vira o problema que já corrigimos em Respostas. */}
      <div className="md:hidden divide-y divide-zinc-800 overflow-y-auto">
        {props.itens.map((i) => (
          <CartaoItem key={i.id} item={i} {...props} />
        ))}
      </div>

      {/* Desktop: a grade inteira. Rola por dentro — nunca o corpo da página —
          e o cabeçalho fica grudado, senão rolar cem itens perde a referência
          de qual coluna é qual. */}
      <div className="hidden md:block flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="sticky top-0 z-10 bg-zinc-950">
            <tr className="text-left text-zinc-500 border-b border-zinc-800">
              <th className="w-6" />
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
const classePedido = (pedido: string) =>
  ehMarcador(pedido) ? 'text-amber-300 font-semibold' : 'text-zinc-200'

const classeCentro = (centro: string, doUsuario: string[]) =>
  doUsuario.includes(centro) ? 'text-zinc-300' : 'text-red-300 font-semibold'

const classeMaterial = (material: string) =>
  material === MARCA_INDEFINIDO ? 'text-amber-300 font-semibold' : 'text-zinc-200'

function LinhaItem({
  item,
  centrosDoUsuario,
  lancada,
  conferirLinhas,
  onEditar,
}: GradeProps & { item: ItemLancamento }) {
  const [aberta, setAberta] = useState(false)
  const problemas = problemasDaLinha(item, centrosDoUsuario, conferirLinhas)
  const bloqueia = problemas.includes('centro-nao-vinculado')
  const diverge = problemas.includes('valor-divergente')
  const loteAlt = item.referencia === MARCA_LOTE_ALT

  const tinta = bloqueia
    ? 'bg-red-950/20 hover:bg-red-950/30'
    : problemas.length > 0
      ? 'bg-amber-950/15 hover:bg-amber-950/25'
      : 'hover:bg-zinc-900/50'

  return (
    <>
      <tr className={tinta}>
        {/* A faixa é o que faz a pendência aparecer na varredura vertical: sem
            ela, o operador precisa achar a célula colorida no meio de dezesseis. */}
        <td className="p-0">
          {problemas.length > 0 && (
            <button
              onClick={() => setAberta((v) => !v)}
              aria-label="Ver pendências da linha"
              className="block w-full h-full py-1.5"
            >
              <span
                className={`block w-1 h-4 mx-auto rounded-full ${
                  bloqueia ? 'bg-red-500' : 'bg-amber-500'
                }`}
              />
            </button>
          )}
        </td>
        <td className={`px-2.5 py-1.5 font-mono ${classePedido(item.pedido)}`}>
          {item.pedido || '—'}
        </td>
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
          <Campo valor={item.qtdNf} tipo="number" onChange={(v) => onEditar(item.id, 'qtdNf', v)} largura="w-16" />
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

      {aberta && problemas.length > 0 && (
        <tr className={bloqueia ? 'bg-red-950/20' : 'bg-amber-950/15'}>
          <td />
          <td colSpan={CABECALHOS.length} className="px-2.5 pb-2">
            <div className="flex flex-wrap gap-1.5">
              {problemas.map((p) => (
                <Etiqueta key={p} problema={p} />
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function Etiqueta({ problema }: { problema: ProblemaLinha }) {
  const grave = problema === 'centro-nao-vinculado'
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[11px] border ${
        grave
          ? 'bg-red-950 border-red-800 text-red-200'
          : 'bg-amber-950 border-amber-800 text-amber-200'
      }`}
    >
      {ROTULO_PROBLEMA[problema]}
    </span>
  )
}

function CartaoItem({
  item,
  centrosDoUsuario,
  lancada,
  conferirLinhas,
  onEditar,
}: GradeProps & { item: ItemLancamento }) {
  const problemas = problemasDaLinha(item, centrosDoUsuario, conferirLinhas)
  const bloqueia = problemas.includes('centro-nao-vinculado')
  const diverge = problemas.includes('valor-divergente')

  return (
    <div
      className={`p-3 space-y-2.5 border-l-2 ${
        bloqueia ? 'border-l-red-600' : problemas.length > 0 ? 'border-l-amber-600' : 'border-l-transparent'
      }`}
    >
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

      {problemas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {problemas.map((p) => (
            <Etiqueta key={p} problema={p} />
          ))}
        </div>
      )}

      {item.referencia === MARCA_LOTE_ALT ? (
        <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono bg-green-950 border border-green-800 text-green-300">
          {MARCA_LOTE_ALT}
        </span>
      ) : (
        <div className="text-[11px] font-mono text-zinc-500 break-all">{item.referencia}</div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <CampoRotulado rotulo="Qnt NF">
          <Campo valor={item.qtdNf} tipo="number" onChange={(v) => onEditar(item.id, 'qtdNf', v)} largura="w-full" />
        </CampoRotulado>
        <CampoRotulado rotulo="Depósito">
          <Campo valor={item.deposito} onChange={(v) => onEditar(item.id, 'deposito', v)} largura="w-full" />
        </CampoRotulado>
        <CampoRotulado rotulo="Lote">
          <Campo valor={item.lote} onChange={(v) => onEditar(item.id, 'lote', v)} largura="w-full" />
        </CampoRotulado>
        <CampoRotulado rotulo="Validade">
          <Campo valor={item.validade} onChange={(v) => onEditar(item.id, 'validade', v)} largura="w-full" />
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

      {lancada && item.qtdNf > 0 && <div className="text-[11px] text-green-300">lançado</div>}
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

function Leitura({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: 'red' | 'green' }) {
  const cor = tom === 'red' ? 'text-red-300' : tom === 'green' ? 'text-green-300' : 'text-zinc-300'
  return (
    <div className="min-w-0">
      <div className="text-zinc-500">{rotulo}</div>
      <div className={`font-mono tabular-nums break-words ${cor}`}>{valor}</div>
    </div>
  )
}

// ── dados da NF (S2:S14), sob demanda ────────────────────────────────────────
// Os quatro números de dinheiro saíram daqui para a conferência. O que fica é o
// que se consulta, não o que se confere — e por isso vem fechado: ocupar altura
// permanente com o que se olha uma vez é o que tira espaço da grade.
function PainelDados({ dados }: { dados: EstadoLancamento['dados'] }) {
  const linhas: Array<[string, string]> = [
    ['Nota de remessa', dados.nf || '—'],
    ['Txt. cabeç.', dados.txtCabec || '—'],
    ['Conh. transp.', dados.conhTransp || '—'],
    ['Emissão', dados.dataEmissao || '—'],
    ['Lançamento', dados.dataLancamento || '—'],
    ['Produtos (pedido)', moeda(dados.valorProdutosPedido)],
    ['Planejador', dados.planejador || '—'],
    ['Data programada', dados.dataProgramada || '—'],
    ['MIGO', dados.migo || '—'],
  ]

  return (
    <section className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
      <div className="grid gap-x-6 gap-y-2 grid-cols-2 md:grid-cols-3 xl:grid-cols-5 text-sm">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0">
            <div className="text-[11px] text-zinc-500">{rotulo}</div>
            <div className="font-mono break-words">{valor}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── a janela de feedback ─────────────────────────────────────────────────────
// O equivalente do JFeedback, com a diferença que importa: fechar não perde. O
// botão do cabeçalho traz de volta, e as divergências vêm junto — na planilha
// elas moram numa aba separada que quase ninguém abre.
function JanelaFeedback({
  mensagens,
  divergencias,
  onFechar,
}: {
  mensagens: MensagemFeedback[]
  divergencias: EstadoLancamento['divergencias']
  onFechar: () => void
}) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onFechar])

  const cor = {
    erro: 'border-red-800/70 bg-red-950/40 text-red-200',
    aviso: 'border-amber-800/60 bg-amber-950/30 text-amber-200',
    ok: 'border-green-800/60 bg-green-950/30 text-green-200',
  }

  const temDivergencia =
    divergencias.valorUn.length > 0 ||
    divergencias.semPedido.length > 0 ||
    divergencias.frete.length > 0

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onFechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Resultado do processamento"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl max-h-[85dvh] flex flex-col bg-zinc-950 border border-zinc-800 rounded-t-2xl sm:rounded-2xl overflow-hidden"
      >
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold">Resultado do processamento</h2>
          <button
            onClick={onFechar}
            aria-label="Fechar"
            className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <div className="space-y-2">
            {mensagens.map((m, i) => (
              <div key={i} className={`rounded-lg border px-3 py-2 text-sm break-words ${cor[m.tom]}`}>
                {m.texto}
              </div>
            ))}
          </div>

          {temDivergencia && (
            <div className="space-y-3">
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
                      <span className="text-zinc-500">
                        {' '}
                        · centro {d.centroNf} · qtd {numero(d.qtdNf)}
                      </span>
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
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 py-3 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onFechar}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

function BlocoDivergencia({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border border-amber-800/60 bg-amber-950/20 rounded-lg p-3">
      <h3 className="text-xs font-medium text-amber-300 mb-1.5">{titulo}</h3>
      <ul className="space-y-1">{children}</ul>
    </div>
  )
}
