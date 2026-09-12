// ─────────────────────────────────────────────────────────────────────────────
// O envelope das respostas do Coreon, desembrulhado num lugar só.
//
// A coluna 'resultado' de uma solicitação NUNCA guarda o corpo da pipe cru.
// Quem grava é o SolicitacaoRemotaService.Concluir, e ele embrulha:
//
//     resultado = { duracao_seg: 12.3, resposta: <corpo da pipe> }
//
// A duração é cronometrada por quem chamou, não pela pipe, então ela só cabia
// por fora. O preço é que todo leitor precisa saber disso — e essa é
// exatamente a espécie de conhecimento que se esquece.
//
// Este projeto já pagou duas vezes por espalhá-lo: a tela de Lançamento lia
// `resultado.Nfs`, achava undefined e dizia "sem NFs na resposta" para
// respostas inteiras e corretas; e a aba Respostas tinha a sua própria cópia
// da regra. Por isso agora é uma função, e quem precisar de outra chama esta.
// ─────────────────────────────────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/**
 * Descasca os envelopes conhecidos e devolve o corpo da pipe.
 *
 * Aceita texto JSON porque o mesmo campo passa por dois transportes (Edge
 * Function e fluxo do Power Automate) e por colar-JSON à mão.
 *
 * Três voltas cobrem o pior caso real, `{ resultado: { duracao_seg, resposta } }`.
 * O teto existe para que um objeto cíclico ou um formato inesperado não rode
 * para sempre.
 */
export function corpoDaPipe(bruto: unknown): Record<string, unknown> {
  let v: unknown = bruto

  for (let i = 0; i < 3; i++) {
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v)
      } catch {
        return {}
      }
      continue
    }

    const o = obj(v)
    const dentro = o.resposta ?? o.resultado ?? o.Resultado
    if (dentro === undefined || dentro === null) return o
    v = dentro
  }

  return obj(v)
}
