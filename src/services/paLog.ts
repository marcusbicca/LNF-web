// ─────────────────────────────────────────────────────────────────────────────
// paLog — o que foi pedido ao Power Automate e o que ele respondeu.
//
// Existe por um motivo específico: quando "Entradas e Saídas Seguras" está
// ligada na ação do fluxo, o histórico de execução do Power Automate mostra a
// run como bem-sucedida e esconde exatamente o que interessa — o corpo que foi
// enviado e o corpo que voltou. Do lado de cá nada é escondido, então é aqui
// que dá pra ver.
//
// Fica só na memória da aba (nada de localStorage): é material de diagnóstico,
// não histórico. Recarregou a página, esvaziou.
//
// A URL do fluxo NUNCA entra no registro. Ela é o endpoint com a chave de
// invocação embutida, e o painel é feito pra ser copiado e colado num chat.
// ─────────────────────────────────────────────────────────────────────────────

export interface PaCall {
  id: number
  quando: Date
  op: string
  tabela: string
  /** Corpo enviado, já serializado. */
  pedido: string
  /** Status HTTP devolvido pelo fluxo. 0 = nem chegou a responder. */
  status: number
  /** Corpo cru da resposta, sem interpretação. */
  resposta: string
  ms: number
  /** Preenchido quando a chamada foi considerada falha, com o porquê. */
  erro?: string
}

// Teto do buffer: o suficiente pra cobrir uma sessão de investigação sem
// segurar linhas de tabela inteiras na memória indefinidamente.
const MAX = 60

let seq = 0
let calls: PaCall[] = []
const ouvintes = new Set<() => void>()

// Cada mudança troca o ARRAY, nunca o edita no lugar. useSyncExternalStore
// compara os snapshots por identidade: mutar o mesmo array (um unshift, um
// campo de um item) deixaria a referência igual e a tela nunca repintaria.
function trocar(novo: PaCall[]): void {
  calls = novo
  for (const f of ouvintes) f()
}

export function registrarChamadaPa(c: Omit<PaCall, 'id' | 'quando'>): PaCall {
  const call: PaCall = { ...c, id: ++seq, quando: new Date() }
  trocar([call, ...calls].slice(0, MAX))   // mais recente primeiro
  return call
}

/** Marca uma chamada já registrada como falha (a falha pode ser descoberta
 *  depois, ao inspecionar o corpo de uma resposta HTTP 200). */
export function marcarErroPa(id: number, erro: string): void {
  if (!calls.some(c => c.id === id)) return
  trocar(calls.map(c => (c.id === id ? { ...c, erro } : c)))
}

export function lerChamadasPa(): PaCall[] {
  return calls
}

export function limparChamadasPa(): void {
  trocar([])
}

export function observarPa(f: () => void): () => void {
  ouvintes.add(f)
  return () => ouvintes.delete(f)
}

// Recorta corpos grandes (um upsert de 500 materiais são centenas de KB). O
// começo é o que identifica a chamada; o resto é repetição.
export function resumir(texto: string, max = 4000): string {
  const t = texto ?? ''
  return t.length <= max ? t : t.slice(0, max) + `\n… (+${t.length - max} caracteres)`
}

/** Um relatório de texto puro das chamadas, pronto pra colar. */
export function relatorioPa(): string {
  if (calls.length === 0) return 'Nenhuma chamada ao Power Automate nesta sessão.'
  return calls
    .map(c => {
      const cab =
        `#${c.id}  ${c.quando.toLocaleTimeString()}  ${c.op} ${c.tabela}  ` +
        `HTTP ${c.status || '—'}  ${c.ms}ms` +
        (c.erro ? `\nFALHA: ${c.erro}` : '')
      return `${cab}\n--- pedido ---\n${resumir(c.pedido)}\n--- resposta ---\n${resumir(c.resposta)}`
    })
    .join('\n\n' + '═'.repeat(60) + '\n\n')
}
