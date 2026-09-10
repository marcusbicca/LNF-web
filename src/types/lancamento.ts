// ─────────────────────────────────────────────────────────────────────────────
// O contrato da tela de Lançamento.
//
// Não é invenção: é o que a aba "Lançamento" do xlsm carrega hoje, campo a
// campo. A referência é o par Layout.bas (endereços) + Analise.UsarUltimoExecutar
// (quem escreve), no xlam. Os comentários guardam a coluna de origem porque é
// por ela que se confere se algo ficou de fora na hora de portar.
//
// Este arquivo existe ANTES da lógica de propósito. Ele é a fronteira: a tela
// consome isto, e mais nada. Quem preenche pode ser o mock de hoje, a resposta
// do 'executar' via Coreon (WebView2) ou a via remota — a tela não sabe a
// diferença, e é isso que torna o porte uma troca de transporte.
// ─────────────────────────────────────────────────────────────────────────────

// Marcadores que o Coreon escreve NA COLUNA DO PEDIDO no lugar de um número —
// a linha existe, mas não corresponde a um item de pedido (Layout.MARCA_*).
export const MARCAS_PEDIDO = ['Sem pedido', 'Excedente', 'Finalizado'] as const
export type MarcaPedido = (typeof MARCAS_PEDIDO)[number]

// Idem para as outras duas colunas que carregam marcador em vez de dado.
export const MARCA_LOTE_ALT = 'Lote alt.'
export const MARCA_INDEFINIDO = 'Indefinido'

// ── tolerâncias ──────────────────────────────────────────────────────────────
// Vêm de Planilha.VerificarDiferencas, onde estavam soltas no meio do código
// como 2 e 1/2. Nomeadas aqui porque são regra de negócio, não detalhe visual:
// é o que decide se a NF "bate" com o pedido.
export const TOLERANCIA_TOTAL = 2 // R$, no confronto de totais e de frete
export const TOLERANCIA_LINHA = 0.5 // R$, no valor unitário × qtd de cada item

// ── a grade de itens (colunas B..Q da aba Lançamento) ────────────────────────
export interface ItemLancamento {
  id: string // não existe na planilha: lá a identidade é o número da linha
  pedido: string // B  — número do pedido ou uma MarcaPedido
  centro: string // C
  deposito: string // D  ← editável
  material: string // E  — MARCA_INDEFINIDO quando o Coreon não resolveu
  descricao: string // F
  referencia: string // G  — MARCA_LOTE_ALT quando o lote foi trocado
  item: string // H  — item do pedido no SAP
  qtdNf: number // I  ← editável
  umbForn: string // J
  lote: string // K  ← editável
  validade: string // L  ← editável (dd.mm.yyyy)
  qtdPendente: number // M
  umbPed: string // N
  valorUnPedido: number | null // O
  valorUnNf: number | null // P
  freteUnPedido: number | null // Q
}

// As colunas que o operador ajusta antes de lançar. Uma lista, e não um
// booleano por campo, porque a pergunta que a tela faz é sempre "esta coluna
// aceita edição?" — e uma lista responde isso num lugar só.
export const COLUNAS_EDITAVEIS = ['deposito', 'qtdNf', 'lote', 'validade'] as const
export type ColunaEditavel = (typeof COLUNAS_EDITAVEIS)[number]

// ── o painel de cabeçalho (S2:S14) ───────────────────────────────────────────
export interface DadosNf {
  nf: string // S2   número-série
  txtCabec: string // S3
  conhTransp: string // S4
  dataEmissao: string // S5
  dataLancamento: string // S6
  freteNf: number | null // S7
  valorTotalNf: number | null // S8
  valorProdutosPedido: number | null // S9
  totalFretePedido: number | null // S10
  totalPedido: number | null // S11  = S9 + S10
  planejador: string // S12
  dataProgramada: string // S13
  migo: string // S14
}

// ── os sinais que o Coreon devolve em Nfs[chave] ─────────────────────────────
// São FATOS apurados lá, não conclusões da tela. A única exceção é
// centroBloqueiaLancamento, que já é a consequência resolvida com as permissões
// do usuário — o cliente só escolhe a frase (ver a nota em UsarUltimoExecutar).
export interface SinaisNf {
  difFrete: boolean
  difValorUN: boolean
  itemSemPedido: boolean
  itemIndefinido: boolean
  difCentro: boolean
  centroBloqueiaLancamento: boolean
  semLote: boolean
  loteFit: boolean
  lancada: boolean
  mensagem: string
}

// ── a aba Diferenças, que são três grades independentes ──────────────────────
export interface DivergenciaValorUn {
  nfSerie: string
  pedido: string
  item: string
  valorUnNf: number | null
  divisor: string
}

export interface ItemSemPedido {
  nfSerie: string
  centroNf: string
  codigo: string
  referencia: string
  qtdNf: number
}

export interface DivergenciaFrete {
  nfSerie: string
  pedido: string
  itens: string[]
  valorFreteTotal: number | null
}

export interface Divergencias {
  valorUn: DivergenciaValorUn[]
  semPedido: ItemSemPedido[]
  frete: DivergenciaFrete[]
}

// ── as mensagens do feedback ─────────────────────────────────────────────────
// Hoje o xlam ACUMULA isto em célula (Cod forn!L2, ver CEL_FEEDBACK_TXT) e
// esvazia quando o JFeedback abre. Célula como buffer de mensagem é frágil —
// sobrevive a um crash, some num Limpar, e não distingue "não houve aviso" de
// "o buffer não foi escrito".
//
// Do lado do Coreon o lugar natural é o AppState: ele já é o dono do estado da
// sessão, já é limpo pelo clear_all e não depende de a planilha estar aberta.
// A tela consome uma LISTA, então a troca de origem não a alcança.
export type TomMensagem = 'erro' | 'aviso' | 'ok'

export interface MensagemFeedback {
  tom: TomMensagem
  texto: string
}

// ── o que há de errado com UMA linha ─────────────────────────────────────────
// A planilha responde isso com cor de célula, e só. Nomeando cada problema, a
// linha consegue dizer o que tem — que é o que falta quando o operador olha um
// vermelho e não sabe se é o centro, o valor ou o cadastro.
export type ProblemaLinha =
  | 'sem-pedido'
  | 'material-indefinido'
  | 'centro-nao-vinculado'
  | 'valor-divergente'
  | 'sem-lote'

export const ROTULO_PROBLEMA: Record<ProblemaLinha, string> = {
  'sem-pedido': 'Sem pedido',
  'material-indefinido': 'Sem cadastro',
  'centro-nao-vinculado': 'Centro não vinculado',
  'valor-divergente': 'Valor unitário divergente',
  'sem-lote': 'Sem lote',
}

// ── o estado inteiro de uma NF em conferência ────────────────────────────────
export interface EstadoLancamento {
  chaveNf: string
  fornecedor: string
  // Os centros vinculados ao usuário. A grade pinta de vermelho o centro que
  // não estiver aqui — é o CoreonCentros() de VerificarDiferencas.
  centrosDoUsuario: string[]
  pedidos: string[] // A15:A19, informados pelo operador
  itens: ItemLancamento[]
  dados: DadosNf
  sinais: SinaisNf
  divergencias: Divergencias
}
