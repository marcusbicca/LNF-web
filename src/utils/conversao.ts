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
}

// Reconstrói o estado de edição a partir do que está gravado.
export function reconstruirConv(conv: FatorEntry[] | undefined): ConvEditavel {
  if (!conv || conv.length === 0) return { fator: 1, umbsIguais: true, de: '', para: '' }
  const c = conv[0]
  if ((c.de && c.de !== '') || (c.para && c.para !== '')) {
    return { fator: c.fator ?? 1, umbsIguais: false, de: c.de ?? '', para: c.para ?? '' }
  }
  return { fator: c.fator ?? 1, umbsIguais: true, de: '', para: '' }
}

// Serializa uma conversão no formato do itens.json (espelha ConverterConversao).
//
// Campo vazio não é gravado, e fator 1 também não: o cadastro guarda o que
// DESVIA do padrão, então "1" e "ausente" têm que ser a mesma coisa no disco —
// senão duas gravações equivalentes produzem linhas diferentes e o diff acusa
// mudança onde não houve.
export function convToJson(de: string, para: string, fator: number): FatorEntry {
  const o: FatorEntry = {}
  if (de) o.de = de
  if (para) o.para = para
  if (fator !== 0 && fator !== 1) o.fator = fator
  return o
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
