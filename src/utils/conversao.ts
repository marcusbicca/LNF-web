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
