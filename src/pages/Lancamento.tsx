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
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'
import {
  SolicitacoesService,
  novaSessaoId,
  type Solicitacao,
} from '../services/solicitacoes'
import { deUltimoExecutar } from '../services/ultimoExecutar'
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

// Uma linha para reconhecer o Executar na lista, sem abrir. Lê por tentativa:
// é JSON de outra máquina, e um resultado fora do formato não pode quebrar a
// listagem inteira.
function resumoDoExecutar(resultado: unknown): string {
  try {
    const r = resultado as Record<string, unknown>
    const nfs = (r?.Nfs ?? {}) as Record<string, Record<string, unknown>>
    const chaves = Object.keys(nfs)
    if (chaves.length === 0) return 'sem NFs na resposta'
    const primeira = nfs[chaves[0]]
    const nome = [primeira?.NumeroNF, primeira?.Fornecedor].filter(Boolean).join(' · ')
    return chaves.length > 1 ? `${chaves.length} NFs — ${nome}…` : nome || chaves[0]
  } catch {
    return '(resposta ilegível)'
  }
}

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
  // O mock deixa de ser o dado e passa a ser o VALOR INICIAL. É o que permite
  // a tela continuar demonstrável sem nada conectado, e ser substituída
  // inteira quando uma resposta de verdade chega.
  const [nf, setNf] = useState<EstadoLancamento>(nfDeExemplo)

  const [itens, setItens] = useState<ItemLancamento[]>(nf.itens)
  const [pedidos, setPedidos] = useState<string[]>(nf.pedidos.filter((p) => p !== ''))
  const [chave, setChave] = useState('')

  // Trocar a NF reinicia o que é editável: os campos da grade são cópia de
  // trabalho, e manter a edição da nota anterior por cima da nova seria
  // misturar duas notas na mesma tela.
  function carregar(novo: EstadoLancamento) {
    setNf(novo)
    setItens(novo.itens)
    setPedidos(novo.pedidos.filter((p) => p !== ''))
    setChave(novo.chaveNf)
  }
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
      <Importar onCarregar={carregar} />

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

// ─────────────────────────────────────────────────────────────────────────────
// Trazer uma análise de NF para cá
//
// Dois caminhos, e os dois existem porque falham por motivos diferentes.
//
// ANALISAR roda um Executar NOVO numa máquina: baixa a NF pela chave, cruza
// com os pedidos informados e devolve o resultado. É o caminho quando a
// pergunta é sobre uma nota específica — não sobre o que alguém já rodou.
//
// COLAR funciona sempre: offline, sem sessão, sem a máquina do outro estar
// ligada. É o caminho de quem já tem a resposta em mãos — da aba Respostas,
// de um log, de uma conversa.
//
// Por que os passos vão numa SEQUÊNCIA, e não soltos: o Coreon recusa
// qualquer ação num sessao_id que ele não abriu, e é a sessão que liga os
// passos — o XML baixado vive nela, e é lá que o Executar vai procurá-lo. No
// lote, o banco só libera o passo seguinte quando o anterior concluiu, e só
// para a MESMA máquina. Soltos, cairiam em sessões (ou máquinas) diferentes.
//
// O canal remoto consulta 1x/min enquanto há janela aberta, então a espera
// normal é de dezenas de segundos — mais o tempo do Executar em si, que lê
// todos os pedidos por RFC. Não é lentidão da tela.
// ─────────────────────────────────────────────────────────────────────────────
function Importar({ onCarregar }: { onCarregar: (e: EstadoLancamento) => void }) {
  const { config } = useApp()
  const sol = useMemo(() => {
    if (!config) return null
    return new SolicitacoesService(new SupabaseService(config), config.usuario ?? '')
  }, [config])

  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [destinatario, setDestinatario] = useState('')
  const [chaveNf, setChaveNf] = useState('')
  const [pedidosTxt, setPedidosTxt] = useState('')
  const [sapUsuario, setSapUsuario] = useState('')
  const [sapSenha, setSapSenha] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [progresso, setProgresso] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])

  // Uma resposta multi-NF traz várias; guardadas aqui para trocar sem refazer
  // a viagem, que é cara.
  // ── executares já rodados, prontos para reabrir ───────────────────────
  //
  // A resposta completa de um 'executar' fica na coluna 'resultado' da
  // solicitação — é o corpo da pipe, guardado inteiro pelo Concluir. O
  // histórico geral NÃO serve: lá o executar grava só resumo (contagens e o
  // Nfs achatado), sem o PedidosDict, que é o que a grade precisa.
  //
  // Por isso reabrir é de graça: o JSON já está no banco, não há máquina a
  // acordar nem Executar a rodar de novo.
  const [recentes, setRecentes] = useState<Solicitacao[] | null>(null)
  const [carregandoRecentes, setCarregandoRecentes] = useState(false)

  const [bruto, setBruto] = useState<unknown>(null)
  const [chaves, setChaves] = useState<string[]>([])
  const [chaveSel, setChaveSel] = useState('')

  function aplicar(b: unknown, chaveEscolhida?: string) {
    setErro(null)
    try {
      const { estado, chaves: cs, avisos: av } = deUltimoExecutar(b, { chaveEscolhida })
      setBruto(b)
      setChaves(cs)
      setChaveSel(estado.chaveNf)
      setAvisos(av)
      onCarregar(estado)
      return true
    } catch (e) {
      setErro((e as Error).message)
      return false
    }
  }

  function colar() {
    const t = texto.trim()
    if (!t) return
    let parsed: unknown
    try {
      parsed = JSON.parse(t)
    } catch (e) {
      setErro('JSON inválido: ' + (e as Error).message)
      return
    }
    if (aplicar(parsed)) setAberto(false)
  }

  // ── rodar um Executar NOVO numa máquina, e ler o resultado ────────────────
  //
  // Três passos numa sequência só, na MESMA sessão — e é a sessão que amarra:
  // o XML baixado no passo 2 fica no AppState daquela sessão, e é ele que o
  // Executar do passo 3 encontra. Passos avulsos cairiam em sessões
  // diferentes (ou em máquinas diferentes) e o Executar não acharia XML nenhum.
  //
  // O 'executar' vai SÍNCRONO, e isso resolve duas coisas de uma vez:
  //
  //   • a resposta completa volta no corpo da própria solicitação — não é
  //     preciso um quarto passo com get_ultimo_executar;
  //   • nada é escrito na planilha do outro lado. Assíncrono dispara o
  //     ExcelCallbackService.Avisar no fim, que escreve o feedback e abre o
  //     JFeedback na tela de quem estiver sentado lá.
  //
  // Lancar fica de fora: isto ANALISA. Análise é aberta a todos no Coreon; o
  // lançamento é que exige almoxarifado — e não é o que se quer aqui.
  async function carregarRecentes() {
    if (!sol) return setErro('Configure o transporte em Configurações.')
    setCarregandoRecentes(true)
    setErro(null)
    try {
      setRecentes(
        await sol.listar({
          limit: 30,
          filtros: 'acao=eq.executar&status=eq.concluida',
        }),
      )
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregandoRecentes(false)
    }
  }

  async function analisar() {
    if (!sol) {
      setErro('Configure o transporte em Configurações.')
      return
    }
    const alvo = destinatario.trim()
    const chaveLimpa = chaveNf.replace(/\D/g, '')
    const pedidos = pedidosTxt
      .split(/[\s,;]+/)
      .map((p) => p.trim())
      .filter(Boolean)

    if (!alvo) return setErro('Informe o usuário Windows da máquina que vai rodar.')
    if (chaveLimpa.length !== 44) return setErro('A chave da NF precisa ter 44 dígitos.')
    if (!!sapUsuario.trim() !== !!sapSenha.trim())
      return setErro(
        'Usuário e senha do SAP andam juntos: preencha os dois, ou deixe os dois em branco ' +
          'para rodar com o login da máquina.',
      )

    setErro(null)
    setOcupado('analisar')
    setProgresso('Abrindo sessão…')

    try {
      const sessaoId = novaSessaoId(config?.usuario ?? '')
      // ── a credencial é de QUEM PEDE, não da máquina ────────────────────
      //
      // Eu mandava o destinatário como sapUsuario, o que está errado duas
      // vezes: login do SAP não é o usuário do Windows, e o campo existe
      // justamente para o SAP ser acessado em nome de quem PEDIU — é o que o
      // SolicitacaoRemotaService diz, e é o que faz o histórico registrar a
      // pessoa certa.
      //
      // OS DOIS ou NENHUM: o AbrirSessaoIsolada só marca CredencialPropria
      // quando usuário E senha vêm preenchidos. Mandar só a senha não dá erro
      // — cai calado no login do operador da máquina, e a ação sai no nome
      // dele. É o tipo de falha que só se descobre lendo o histórico depois.
      const usarCred = !!sapUsuario.trim() && !!sapSenha.trim()
      const comum = {
        destinatario: alvo,
        ...(usarCred ? { sapUsuario: sapUsuario.trim(), sapSenha: sapSenha.trim() } : {}),
      }

      await sol.criarSequencia(sessaoId, [
        { acao: 'iniciar_sessao', payload: { IncluirPipes: false }, ...comum },
        { acao: 'baixar_xml_internet', payload: { Chave: chaveLimpa }, ...comum },
        {
          acao: 'executar',
          // PedidosPorNfUsuario só vai quando há o que mandar.
          //
          // No Coreon a precedência é usuário > XML: informado, ele vence;
          // vazio, o PedidosBuscaService tira os pedidos do próprio XML. Um
          // dicionário com lista vazia NÃO é "deixa o XML decidir" — é uma
          // entrada preenchida com nada, e o campo existe para SOBREPOR.
          payload:
            pedidos.length > 0
              ? { PedidosPorNfUsuario: { [chaveLimpa]: pedidos } }
              : {},
          ...comum,
        },
      ])

      setProgresso('Baixando a NF e rodando o Executar na máquina…')

      // O Executar é a ação mais longa do Coreon: leitura RFC de todos os
      // pedidos, mais a espera do canal remoto. Teto generoso de propósito.
      const resp = await sol.aguardarNaSessao(sessaoId, 'executar', 0, {
        timeoutMs: 12 * 60 * 1000,
        onTick: (r) => {
          if (r?.status) setProgresso(`Executando… (${r.status})`)
        },
      })

      if (resp.erro) return setErro(resp.erro)
      if (aplicar(resp.resultado)) setAberto(false)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(null)
      setProgresso('')
    }
  }

  return (
    <section className="shrink-0 bg-zinc-950 border border-zinc-800 rounded-xl">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button
          onClick={() => setAberto((v) => !v)}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm transition-colors"
        >
          Trazer análise {aberto ? '▴' : '▾'}
        </button>

        {chaves.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            NF:
            <select
              value={chaveSel}
              onChange={(e) => {
                setChaveSel(e.target.value)
                aplicar(bruto, e.target.value)
              }}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-green-500"
            >
              {chaves.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="text-zinc-600">{chaves.length} na resposta</span>
          </label>
        )}

        {progresso && <span className="text-xs text-amber-300">{progresso}</span>}
        {avisos.length > 0 && !progresso && (
          <span className="text-xs text-amber-400">{avisos.join(' · ')}</span>
        )}
      </div>

      {aberto && (
        <div className="border-t border-zinc-800 p-3 space-y-4">
          <div className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-wide text-zinc-500">
              Analisar uma NF numa máquina
            </h3>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="block text-[11px] text-zinc-500 mb-0.5">Chave da NF</span>
                <input
                  value={chaveNf}
                  onChange={(e) => setChaveNf(e.target.value)}
                  inputMode="numeric"
                  placeholder="44 dígitos"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-green-500"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] text-zinc-500 mb-0.5">
                  Pedidos <span className="text-zinc-600">(opcional — sobrepõe o XML)</span>
                </span>
                <input
                  value={pedidosTxt}
                  onChange={(e) => setPedidosTxt(e.target.value)}
                  placeholder="em branco = usa os do XML"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-green-500"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] text-zinc-500 mb-0.5">
                  Máquina (usuário Windows)
                </span>
                <input
                  value={destinatario}
                  onChange={(e) => setDestinatario(e.target.value)}
                  placeholder="israel.santos"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-green-500"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] text-zinc-500 mb-0.5">
                  Usuário SAP <span className="text-zinc-600">(o seu)</span>
                </span>
                <input
                  value={sapUsuario}
                  onChange={(e) => setSapUsuario(e.target.value)}
                  placeholder="em branco = login da máquina"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-green-500"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] text-zinc-500 mb-0.5">Senha SAP</span>
                <input
                  value={sapSenha}
                  onChange={(e) => setSapSenha(e.target.value)}
                  type="password"
                  autoComplete="off"
                  placeholder="só se preencher o usuário"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                />
              </label>
            </div>

            <button
              onClick={analisar}
              disabled={!!ocupado}
              className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {ocupado === 'analisar' ? 'Rodando…' : 'Analisar'}
            </button>

            <p className="text-[11px] text-zinc-600">
              Baixa a NF e roda um Executar <strong>novo</strong> naquela máquina, em sessão
              própria — o trabalho de quem estiver sentado lá não é tocado, nada é escrito na
              planilha dele e <strong>nada é lançado</strong>: só análise.
            </p>
            <p className="text-[11px] text-zinc-600">
              Os pedidos são <strong>opcionais</strong>: vazio, o Coreon usa os que estiverem
              no próprio XML; preenchidos, eles vencem. Não havendo nem um nem outro, a
              resposta volta com <span className="font-mono">PEDIDO_NAO_INFORMADO</span> —
              que também é um resultado útil.
            </p>
            <p className="text-[11px] text-zinc-600">
              A credencial do SAP é <strong>a sua</strong>, não a da máquina — é assim que o
              Executar roda em seu nome e o histórico registra você. Os dois campos andam
              juntos. Deixando ambos em branco, roda com o login que o operador já validou
              naquela máquina — funciona, mas a ação sai no nome <strong>dele</strong>.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] uppercase tracking-wide text-zinc-500">
                Ou reabrir um Executar já rodado
              </h3>
              <button
                onClick={carregarRecentes}
                disabled={carregandoRecentes}
                className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs disabled:opacity-40 transition-colors"
              >
                {carregandoRecentes ? 'Buscando…' : recentes ? 'Recarregar' : 'Listar'}
              </button>
            </div>

            {recentes?.length === 0 && (
              <p className="text-[11px] text-zinc-600">
                Nenhum Executar concluído na fila de solicitações.
              </p>
            )}

            {recentes && recentes.length > 0 && (
              <ul className="border border-zinc-800 rounded-lg divide-y divide-zinc-800 max-h-56 overflow-y-auto">
                {recentes.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => {
                        if (aplicar(r.resultado)) setAberto(false)
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-zinc-900 transition-colors"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="font-mono text-zinc-300">#{r.id}</span>
                        <span className="text-zinc-400">{r.criado_por || '—'}</span>
                        <span className="text-zinc-600">
                          {new Date(r.criado_em).toLocaleString('pt-BR')}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-500 break-words">
                        {resumoDoExecutar(r.resultado)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[11px] text-zinc-600">
              Reabrir é de graça: o JSON já está guardado na resposta da solicitação. Nenhuma
              máquina é acordada e nada roda de novo.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-wide text-zinc-500">
              Ou colar a resposta
            </h3>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              spellCheck={false}
              rows={6}
              placeholder='{"Sucesso":true,"Nfs":{…},"PedidosDict":{…}}'
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-green-500"
            />
            <div className="flex gap-2">
              <button
                onClick={colar}
                disabled={!texto.trim()}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 rounded-lg text-sm transition-colors"
              >
                Carregar
              </button>
              <button
                onClick={() => {
                  setTexto('')
                  setErro(null)
                }}
                className="px-3 py-2 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
              >
                Limpar
              </button>
            </div>
            <p className="text-[11px] text-zinc-600">
              Aceita o corpo da resposta do <span className="font-mono">get_ultimo_executar</span>{' '}
              ou a linha inteira da aba Respostas (o campo{' '}
              <span className="font-mono">resultado</span> é desembrulhado sozinho).
            </p>
          </div>

          {erro && (
            <div className="rounded-lg border border-red-800/70 bg-red-950/30 px-3 py-2 text-sm text-red-200 break-words">
              {erro}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
