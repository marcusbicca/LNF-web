// ── itens.json ──────────────────────────────────────────────────────────────
// Estrutura: fornecedor → códigoSAP → { referencias, descricao }
// referencias: referência do fornecedor → array de fator (vazio = sem conversão)

export interface ItensJson {
  [fornecedor: string]: FornecedorData
}

export interface FornecedorData {
  Configuracoes: Record<string, unknown>
  Itens: Record<string, ItemSAP>
}

export interface ItemSAP {
  referencias: Record<string, FatorEntry[]>
  descricao: string
  aliasReferencias?: Record<string, string>
  UmbMigo?: string
}

// Conversão de UMB gravada em itens.json. Espelha CadastroConversao do
// LNF-Coreon: chaves minúsculas; `de`/`para` só quando não-vazios; `fator`
// só quando ≠ 0 e ≠ 1 (lista vazia = referência sem conversão).
export interface FatorEntry {
  de?: string
  para?: string
  fator?: number
}

// ── Cadastro JSON (output do LNF-Coreon) ────────────────────────────────────

export interface CadastroJson {
  Sucesso: boolean
  Codigo: string | null
  Mensagem: string
  Nfs: Record<string, NfInfo>
  PedidosDict: Record<string, PedidoItem[]>
  ItensSemPedido: unknown[]
  DivergenciasValorUN: unknown[]
  DivergenciasFrete: unknown[]
}

export interface NfInfo {
  ChaveNFe: string
  NumeroNF: string
  SerieNF: string
  Fornecedor: string
  DataEmissao: string
  DataLancamento: string
  ValorTotalNF: number
  ValorFreteNF: number
  ValorTotalPedido: number
  FreteTotalPedido: number
  Planejador: string
  PlanejadorNome: string
  DifFrete: boolean
  DifValorUN: boolean
  ItemSemPedido: boolean
  ItemIndefinido: boolean
  LoteFit: boolean
  SemLote: boolean
  Lancada: boolean
  Codigo: string
  Mensagem: string
  MaterialDocument: string
  DocumentYear: string
}

export interface PedidoItem {
  'Referência': string
  Fornecedor: string
  Centro: string
  Pedido: string
  Item: number
  'Código': string
  'Descrição': string
  'Data Pedido': string
  Saldo: number
  'Qtd Pendente': number
  'UMB Ped': string
  'Valor UN': number
  'Frete UN': number
  Divisor: string
  Planejador: string
  Status: string
  'Valor UN NF': number
  'Frete UN NF': number
  'Qtd NF': number
  Lote?: string
  Validade?: string
  'UMB Forn'?: string
  UmbMigo?: string
  MigoConverter?: number
  NfItemIndex?: number
  NfChave?: string
  Contagem?: number
}

// ── Configuração do app ──────────────────────────────────────────────────────

export interface Config {
  githubToken: string
  owner: string
  repo: string
  itensPath: string
  usuario: string
}

// ── Análise de itens para registro ──────────────────────────────────────────

export type ItemStatus = 'novo' | 'existe' | 'conflito'

export interface ItemAnalise {
  referencia: string
  codigoSAP: string
  descricao: string
  fornecedor: string
  fator: number | null
  status: ItemStatus
  conflito?: { codigoExistente: string; fatorExistente: number | null }
  incluir: boolean
}
