import type { FatorEntry } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// A gramática de conversão do itens.json, num lugar só.
//
// Estas duas funções viviam dentro do Mapeamento. Saíram de lá quando a tela de
// conversões suspeitas passou a precisar das mesmas: duas cópias da regra que
// decide o que é "universal" e o que é "direcional" divergiriam na primeira
// correção, e essa divergência apareceria como conversão gravada de um jeito
// numa tela e lida de outro na outra.
//
// A convenção espelha ExecutarService.ProcessarConversao, no LNF-Coreon:
//   • lista vazia            → sem conversão
//   • só fator               → universal (vale independente das UMBs)
//   • de/para preenchidos    → direcional (só quando as UMBs batem)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConvEditavel {
  fator: number
  umbsIguais: boolean
  de: string
  para: string

  // NÃO editável na tela, e é justamente por isso que ele existe aqui.
  //
  // O cadastro aceita um quarto campo, padraoOrigem ("CX*"), que casa por
  // PREFIXO da UMB do pedido. Nenhuma tela do LNF-web escreve isso — mas o
  // itens.json pode ter, vindo de cadastro antigo ou feito à mão, e o
  // ExecutarService o respeita. Sem carregá-lo daqui até a gravação, editar
  // qualquer conversão da referência APAGARIA esse campo em silêncio: a
  // conversão continuaria lá, com a mesma cara, e deixaria de casar.
  padraoOrigem?: string
}

const VAZIA: ConvEditavel = { fator: 1, umbsIguais: true, de: '', para: '' }

export function convVazia(): ConvEditavel {
  return { ...VAZIA }
}

// ── a forma canônica de uma unidade de medida ────────────────────────────────
//
// Espelha UmbUtils.Normalizar do LNF-Coreon, e tem que continuar espelhando:
// os dois escrevem na MESMA coluna, e uma unidade que só um dos dois considera
// limpa é uma conversão que só um dos dois enxerga.
//
// A conversão só se aplica quando as unidades batem, e o teste é igualdade
// exata. Basta um ponto sobrando para o cadastro deixar de existir na prática:
// "CX." nunca é "CX", a quantidade vai inteira para o MIGO, e nada avisa.
// Aconteceu três vezes no cadastro de produção (migração 0043) — e numa delas
// a pessoa contornou cadastrando a conversão certa DO LADO da errada, com o
// mesmo fator, sinal de que viu o sintoma sem conseguir ver a causa.
//
// O alfabeto é letra, dígito e '%'. O '%' fica porque É unidade de medida no
// SAP (T006, MSEHI = '%'): uma limpeza que apagasse tudo que não é letra ou
// dígito o transformaria em string VAZIA — e UMB vazia significa conversão
// universal, que aplica a tudo. O conserto criaria um problema maior.
export function normalizarUmb(umb: string | undefined | null): string {
  if (!umb) return ''
  return umb.toUpperCase().replace(/[^A-Z0-9%]/g, '')
}

// O '*' do padraoOrigem é SINTAXE, não unidade: "CX*" quer dizer "toda UMB de
// pedido que comece com CX". Ele sai antes de normalizar — passar o campo
// inteiro pelo normalizarUmb apagaria o asterisco e transformaria casamento por
// prefixo em igualdade, mudando o que a conversão casa sem mudar a aparência.
export function normalizarPadrao(padrao: string | undefined | null): string {
  if (!padrao) return ''
  return normalizarUmb(padrao.replace(/\*+$/, ''))
}

// ── TODAS as conversões da referência ────────────────────────────────────────
//
// A referência guarda uma LISTA, e sempre guardou: o ExecutarService percorre
// item por item e usa a primeira que casar com as unidades daquela nota. É
// assim que um material tem "CX>UN 12" e "CT>UN 100" ao mesmo tempo.
//
// As telas, porém, liam só a primeira e gravavam uma lista de um elemento —
// então editar a conversão de caixa APAGAVA a de caixote. O sintoma era
// exatamente esse: "ele substitui uma que já existe, quando deveria incluir".
// A lista inteira entrando e saindo é o que conserta isso.
export function reconstruirConvs(conv: FatorEntry[] | undefined): ConvEditavel[] {
  if (!conv || conv.length === 0) return []
  return conv.map(c => {
    const direcional = (c.de && c.de !== '') || (c.para && c.para !== '')
    return {
      fator: c.fator ?? 1,
      umbsIguais: !direcional,
      de: c.de ?? '',
      para: c.para ?? '',
      padraoOrigem: c.padraoOrigem,
    }
  })
}

// A primeira, para quem só sabe lidar com uma. Continua existindo porque o
// mapeamento edita UMA conversão por vínculo — mas agora é uma vista da função
// acima, e não uma segunda leitura do mesmo JSON.
export function reconstruirConv(conv: FatorEntry[] | undefined): ConvEditavel {
  return reconstruirConvs(conv)[0] ?? convVazia()
}

// Serializa uma conversão no formato do itens.json (espelha ConverterConversao).
//
// Campo vazio não é gravado, e fator 1 também não: o cadastro guarda o que
// DESVIA do padrão, então "1" e "ausente" têm que ser a mesma coisa no disco —
// senão duas gravações equivalentes produzem linhas diferentes e o diff acusa
// mudança onde não houve.
export function convToJson(de: string, para: string, fator: number, padraoOrigem?: string): FatorEntry {
  const o: FatorEntry = {}
  if (de) o.de = de
  if (para) o.para = para
  if (fator !== 0 && fator !== 1) o.fator = fator
  if (padraoOrigem) o.padraoOrigem = padraoOrigem
  return o
}

// A lista inteira, pronta para gravar.
//
// Sai de fora a conversão que não diz nada — universal com fator 1, que é o
// mesmo que não existir. Ela aparece na tela enquanto está sendo digitada (é a
// linha em branco que o "+ Adicionar" cria) e não pode virar entrada morta no
// cadastro, atrapalhando quem for ler depois.
export function convsToJson(convs: ConvEditavel[]): FatorEntry[] {
  return convs
    .filter(c => {
      const f = c.fator
      if (!Number.isFinite(f) || f <= 0) return false
      if (c.umbsIguais) return f !== 1 || !!c.padraoOrigem
      return c.de.trim() !== '' && c.para.trim() !== ''
    })
    // normalizarUmb na GRAVAÇÃO: é aqui que se impede uma "CX." nova de
    // nascer. Sem isto, a tela continuaria aceitando o ponto e o Coreon
    // continuaria tendo que limpar na leitura — o dado sujo no banco, e as
    // duas pontas concordando por acidente em vez de por contrato.
    .map(c =>
      c.umbsIguais
        ? convToJson('', '', c.fator, c.padraoOrigem)
        : convToJson(normalizarUmb(c.de), normalizarUmb(c.para), c.fator, c.padraoOrigem),
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// QUAL das conversões vai valer — a mesma escolha que o Coreon faz
//
// Espelha ExecutarService.ProcessarConversao: percorre a lista NA ORDEM e para
// na PRIMEIRA que casar. Não existe "a melhor": existe a primeira.
//
// É essa regra que responde à pergunta que ninguém conseguia responder olhando
// a tela — "por que ele usou aquela conversão e não esta?". Com a lista inteira
// à vista e a vencedora marcada, a resposta deixa de exigir ler o código do
// Coreon.
//
// Os três casamentos, e o que cada um faz com o fator:
//
//   universal (de e para vazios)          → conversao = fator
//   padraoOrigem casa o começo da UMB ped → conversao = fator
//   dirA  de = UMB da NF, para = UMB ped  → conversao = 1/fator
//   dirB  de = UMB ped,   para = UMB NF   → conversao = fator
//
// E o número que sai daqui é o DIVISOR do runtime: qtdSAP = qtdNF / conversao,
// valor convertido = valor da NF × conversao.
// ─────────────────────────────────────────────────────────────────────────────
export type MotivoConv = 'universal' | 'padrao' | 'dirA' | 'dirB'

export interface ConvVencedora {
  indice: number
  conversao: number
  motivo: MotivoConv
}

export function resolverConv(
  convs: ConvEditavel[],
  umbNf: string,
  umbPedido: string,
): ConvVencedora | null {
  // Normaliza os DOIS lados. O cadastro é gravado limpo, mas umbNf e umbPedido
  // vêm da nota e do pedido no SAP — não passaram por lugar nenhum. Comparar em
  // forma canônica é o que impede um ponto do fornecedor de desligar a
  // conversão, e é exatamente o que o ExecutarService faz (UmbUtils.Iguais).
  const from = normalizarUmb(umbNf)
  const to = normalizarUmb(umbPedido)

  for (let i = 0; i < convs.length; i++) {
    const c = convs[i]
    const de = normalizarUmb(c.de)
    const para = normalizarUmb(c.para)
    const padrao = normalizarPadrao(c.padraoOrigem)
    const f = c.fator > 0 ? c.fator : 1

    const universal = de === '' && para === ''
    const casaPadrao = padrao !== '' && to.startsWith(padrao)

    if (universal || casaPadrao)
      return { indice: i, conversao: f, motivo: universal ? 'universal' : 'padrao' }

    if (de !== '' && para !== '') {
      if (de === from && para === to) return { indice: i, conversao: f !== 0 ? 1 / f : 1, motivo: 'dirA' }
      if (de === to && para === from) return { indice: i, conversao: f, motivo: 'dirB' }
    }
  }

  return null
}

export function explicarMotivo(m: MotivoConv): string {
  switch (m) {
    case 'universal': return 'universal — vale para qualquer unidade'
    case 'padrao':    return 'casou pelo início da UMB do pedido'
    case 'dirA':      return 'de = UMB da NF → o fator entra invertido (1/f)'
    case 'dirB':      return 'de = UMB do pedido → o fator entra direto'
  }
}

// Como a conversão aparece escrita para quem vai ler: a mesma grafia que a tela
// de cadastro em lote aceita ("CX>UN 12", "/12"). Uma gramática só para ler e
// escrever evita que a pessoa veja um formato aqui e tenha que traduzir para
// digitar noutro lugar.
export function escreverConv(conv: FatorEntry[] | undefined): string {
  if (!conv || conv.length === 0) return ''
  return conv
    .map(c => {
      const f = c.fator == null || c.fator === 0 ? 1 : c.fator
      if (c.de && c.para) return `${c.de}>${c.para} ${num(f)}`
      if (c.de) return `${c.de}* /${num(f)}`
      return `/${num(f)}`
    })
    .join('; ')
}

function num(d: number): string {
  return String(Math.round(d * 1e10) / 1e10)
}

// ─────────────────────────────────────────────────────────────────────────────
// A sugestão de fator, a partir de uma NF e do saldo do pedido.
//
// Esta regra já existia — era o botão "Sugerir" do Mapeamento — e saiu de lá
// pelo mesmo motivo das duas acima: a tela de conversões suspeitas precisa da
// MESMA sugestão, e a segunda cópia já tinha nascido errada. Ela usava a razão
// invertida (saldo ÷ NF em vez de NF ÷ saldo) e não mexia em de/para, o que
// produzia o número certo por acaso num caso e o sentido errado no outro.
//
// ── as duas convenções, que não são a mesma ─────────────────────────────────
//
// Para JULGAR se é conversão, comparam-se duas razões no mesmo sentido:
//   saldo ÷ qtdNF   contra   valorNF ÷ valorPedido
// Numa conversão errada as duas dão o mesmo número — a mesma caixa contada de
// dois jeitos.
//
// Para GRAVAR, o cadastro quer outra coisa: fator = qtdNF ÷ qtdPedido, com a
// orientação base de = UMB do pedido, para = UMB da NF ("1 [pedido] = fator
// [NF]"). Confundir uma com a outra é gravar a conversão de cabeça para baixo.
//
// ── por que o fator é mantido inteiro ───────────────────────────────────────
//
// Fração menor que 1 vira o seu inverso, e de/para trocam de lado junto — o
// resultado é equivalente e legível. "CX>UN 12" se lê; "UN>CX 0,0833" é o mesmo
// fato escrito de um jeito que ninguém confere de cabeça.
// ─────────────────────────────────────────────────────────────────────────────
export function sugerirConv(
  qtdNf: number,
  qtdPedido: number,
  umbNf: string,
  umbPedido: string,
  universal: boolean,
): ConvEditavel | null {
  if (qtdNf === 0) return null

  const f = qtdPedido !== 0 ? qtdNf / qtdPedido : 1

  if (universal) return { fator: f, umbsIguais: true, de: '', para: '' }

  return f > 0 && f < 1
    ? { fator: 1 / f, umbsIguais: false, de: umbNf, para: umbPedido }
    : { fator: f, umbsIguais: false, de: umbPedido, para: umbNf }
}
