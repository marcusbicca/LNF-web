// ─────────────────────────────────────────────────────────────────────────────
// Modelos de read_table — consultas que você monta, guarda e reusa.
//
// ── o que um modelo guarda ALÉM do que o Coreon precisa ──────────────────────
// A descrição da tabela e a de cada campo NÃO vão no JSON. Elas existem para
// quem volta ao modelo em três meses: MSEG-SHKZG não diz nada, "S = débito
// (entrada), H = crédito (estorno)" diz tudo. Sem esse bilhete, o modelo se
// reduz a um payload que funciona e ninguém lembra por quê — e aí ele deixa de
// ser reusável e vira só um texto que se copia com medo.
//
// ── onde isto mora, e o que isso custa ───────────────────────────────────────
// localStorage: começa a funcionar sem migração, sem RLS e sem esperar deploy.
// O preço, dito na cara: é POR NAVEGADOR. O modelo criado no computador não
// aparece no celular, e limpar dados do site apaga tudo.
//
// Por isso todo o acesso passa por este módulo, e a tela nunca toca em
// localStorage direto. No dia em que valer a pena virar tabela no Supabase, é
// este arquivo que muda — e só ele.
// ─────────────────────────────────────────────────────────────────────────────

const CHAVE = 'lnf.modelos.readtable.v1'

export interface CampoModelo {
  /** Nome do campo no SAP, como vai no JSON. */
  nome: string
  /** Só para lembrar o que é. Nunca sai no payload. */
  descricao: string
}

export interface ModeloReadTable {
  id: string
  nome: string
  tabela: string
  /** Só para lembrar o que é. Nunca sai no payload. */
  descricaoTabela: string
  campos: CampoModelo[]
  /** Uma cláusula por linha, como o Coreon espera receber no array. */
  filtro: string
  /** Sem isto o read_table recusa: é a combinação que identifica cada linha. */
  camposChave: string
  /** true → Z_CUSTOM_READ_TABLE_ONE em vez de BBP_RFC_READ_TABLE. */
  custom: boolean
  atualizadoEm: string
}

export function modeloVazio(): ModeloReadTable {
  return {
    id: `m${Date.now().toString(36)}`,
    nome: '',
    tabela: '',
    descricaoTabela: '',
    campos: [{ nome: '', descricao: '' }],
    filtro: '',
    camposChave: '',
    custom: false,
    atualizadoEm: new Date().toISOString(),
  }
}

// ── o payload, e só o payload ────────────────────────────────────────────────
//
// Campo sem nome é descartado, e não vira string vazia no array: uma linha em
// branco no editor é linha que a pessoa ainda não preencheu, não um campo
// chamado "". O mesmo vale para as linhas do filtro.
//
// 'Custom' só aparece quando é true. O contrato tem default false, e mandar o
// default explícito faz o JSON crescer com o que não decide nada.
export function payloadDoModelo(m: ModeloReadTable): Record<string, unknown> {
  const p: Record<string, unknown> = {
    Acao: 'read_table',
    Tabela: m.tabela.trim(),
    Campos: m.campos.map((c) => c.nome.trim()).filter(Boolean),
    Filtro: m.filtro
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
    CamposChave: m.camposChave
      .split(/[,\n]/)
      .map((c) => c.trim())
      .filter(Boolean),
  }
  if (m.custom) p.Custom = true
  return p
}

export const jsonDoModelo = (m: ModeloReadTable) => JSON.stringify(payloadDoModelo(m), null, 2)

// As mesmas quatro recusas que o ProcessarReadTable devolve, conferidas aqui
// para aparecerem enquanto se digita — e não depois de uma ida à máquina do
// outro lado, que custa minutos.
export function problemasDoModelo(m: ModeloReadTable): string[] {
  const p = payloadDoModelo(m)
  const erros: string[] = []
  if (!m.tabela.trim()) erros.push('Falta a tabela.')
  if ((p.Campos as string[]).length === 0) erros.push('Nenhum campo preenchido.')
  if ((p.Filtro as string[]).length === 0)
    erros.push('Filtro é obrigatório — o Coreon recusa sem ele, para evitar leitura massiva.')
  if ((p.CamposChave as string[]).length === 0)
    erros.push('Faltam os campos-chave — é a combinação que identifica cada linha no retorno.')
  return erros
}

// ── persistência ─────────────────────────────────────────────────────────────
// Toda leitura tolera lixo: um JSON quebrado no storage (versão antiga, edição
// manual, escrita interrompida) não pode derrubar a página inteira.
export function carregar(): ModeloReadTable[] {
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (!bruto) return []
    const v = JSON.parse(bruto)
    return Array.isArray(v) ? (v as ModeloReadTable[]) : []
  } catch {
    return []
  }
}

export function salvar(modelos: ModeloReadTable[]): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(modelos))
  } catch {
    /* modo privado, cota estourada — a tela segue com o que tem em memória */
  }
}

// ── o primeiro modelo ────────────────────────────────────────────────────────
// Existe porque uma tela vazia não ensina o formato. Este é o de itens de MIGO,
// que foi o pedido que originou o editor — e serve de gabarito para os
// próximos: repare que a descrição de cada campo carrega o que o nome esconde.
export function semente(): ModeloReadTable {
  return {
    id: 'migo-itens',
    nome: 'MIGO — itens e valores',
    tabela: 'MSEG',
    descricaoTabela: 'Itens do documento de material. O cabeçalho fica na MKPF.',
    campos: [
      { nome: 'MBLNR', descricao: 'Nº do documento de material (a MIGO)' },
      { nome: 'MJAHR', descricao: 'Ano do documento' },
      { nome: 'ZEILE', descricao: 'Item dentro do documento' },
      { nome: 'BWART', descricao: 'Tipo de movimento (101 entrada, 102 estorno…)' },
      { nome: 'SHKZG', descricao: 'S = débito (entrada), H = crédito (estorno)' },
      { nome: 'MATNR', descricao: 'Material' },
      { nome: 'WERKS', descricao: 'Centro' },
      { nome: 'LGORT', descricao: 'Depósito' },
      { nome: 'CHARG', descricao: 'Lote' },
      { nome: 'MENGE', descricao: 'Quantidade' },
      { nome: 'MEINS', descricao: 'Unidade de medida' },
      { nome: 'DMBTR', descricao: 'VALOR em moeda interna — vem como texto, sinal pode vir no fim' },
      { nome: 'WAERS', descricao: 'Moeda' },
      { nome: 'EBELN', descricao: 'Pedido de compra de origem' },
      { nome: 'EBELP', descricao: 'Item do pedido' },
    ],
    filtro: "MBLNR = '5002365764'\nAND MJAHR = '2026'",
    camposChave: 'MBLNR, MJAHR, ZEILE',
    custom: false,
    atualizadoEm: new Date().toISOString(),
  }
}
