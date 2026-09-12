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

// ── as sementes chegando a quem já tem modelos salvos ───────────────────────
//
// A tela fazia `guardados.length > 0 ? guardados : [semente()]`. Correto para
// instalação nova e inútil para todo o resto: quem já tinha UM modelo salvo
// nunca mais veria os que viessem depois. E "os que vieram depois" é
// exatamente o caso agora.
//
// Então as sementes novas são ACRESCENTADAS, e as existentes ficam como estão
// — editar um modelo semeado é uso normal, e sobrescrever a edição de alguém
// para "atualizar" seria o pior jeito de entregar uma melhoria.
//
// O marcador guarda quais sementes esta instalação JÁ VIU. Sem ele, uma
// semente apagada de propósito voltaria em todo carregamento, para sempre —
// um modelo que não morre é mais irritante que um modelo que falta.
const CHAVE_SEMENTES = 'lnf.modelos.readtable.sementes.v1'

function jaVistas(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_SEMENTES) || '[]')
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

function marcarVistas(ids: string[]): void {
  try {
    localStorage.setItem(CHAVE_SEMENTES, JSON.stringify(ids))
  } catch {
    /* sem storage, a semente reaparece no próximo load — inofensivo */
  }
}

export function carregarComSementes(): ModeloReadTable[] {
  const todas = sementes()
  const ids = todas.map((s) => s.id)
  const guardados = carregar()

  if (guardados.length === 0) {
    marcarVistas(ids)
    return todas
  }

  const vistas = new Set(jaVistas())
  const tem = new Set(guardados.map((m) => m.id))
  const novas = todas.filter((s) => !vistas.has(s.id) && !tem.has(s.id))

  marcarVistas(ids)
  return novas.length > 0 ? [...guardados, ...novas] : guardados
}

// ═════════════════════════════════════════════════════════════════════════════
// OS MODELOS QUE JÁ VÊM PRONTOS
//
// Tela vazia não ensina o formato. Cada um destes é uma consulta que já foi
// precisa, e a descrição de cada campo carrega o que o nome esconde — é o que
// faz o modelo sobreviver a três meses de esquecimento.
//
// ── o que você precisa saber antes de confiar em qualquer um ────────────────
//
// Os nomes de campo aqui são os das tabelas MM padrão. Eu NÃO os conferi contra
// o SAP do Fleury — não há como daqui. Um campo que não exista faz a
// RFC_READ_TABLE recusar a chamada inteira, com o nome do campo no erro, então
// o conserto é óbvio quando acontece; mas acontece.
//
// E é para isso que existem os dois últimos modelos da lista. Eles leem o
// DICIONÁRIO DE DADOS do próprio SAP: DD02T diz quais tabelas existem e o que
// cada uma é, DD03L diz quais campos uma tabela tem. Com eles você confere
// qualquer campo — e monta modelo novo sem depender de eu ter lembrado certo.
//
// ── RFC_READ_TABLE não faz JOIN ─────────────────────────────────────────────
//
// Isso molda metade desta lista. "Movimentações de um usuário entre duas datas,
// filtrando o tipo de movimento" parece uma consulta e são DUAS: usuário e data
// vivem na MKPF (cabeçalho), tipo de movimento vive na MSEG (item), e não há
// como cruzá-las numa chamada. O caminho é rodar a primeira, pegar os números
// de documento, e alimentar a segunda. Os modelos abaixo dizem isso, cada um no
// seu lugar, porque descobrir sozinho custa uma tarde.
//
// ── MATNR vai com zeros à esquerda ──────────────────────────────────────────
//
// Material numérico é gravado em 18 caracteres preenchidos com zero: o 12345 é
// '000000000000012345'. Filtrar por '12345' não acha nada — e não dá erro, o
// que é pior. Vale para MARA, MARC, MARD, MSEG e MAKT.
// ═════════════════════════════════════════════════════════════════════════════

const AGORA = () => new Date().toISOString()

/** Todos os modelos que acompanham a instalação, na ordem em que aparecem. */
export function sementes(): ModeloReadTable[] {
  return [
    semente(),
    migoCabecalho(),
    materialGeral(),
    saldoPorDeposito(),
    movimentacoesDoMaterial(),
    movimentacoesDoUsuario(),
    camposDeUmaTabela(),
    tabelasPorDescricao(),
  ]
}

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

// ── MIGO, o cabeçalho ───────────────────────────────────────────────────────
// O par da MSEG. É aqui que moram a DATA e o USUÁRIO — a MSEG não tem nenhum
// dos dois, e é por isso que toda pergunta com "quando" ou "quem" começa por
// esta tabela.
function migoCabecalho(): ModeloReadTable {
  return {
    id: 'migo-cabecalho',
    nome: 'MIGO — cabeçalho (quem, quando)',
    tabela: 'MKPF',
    descricaoTabela:
      'Cabeçalho do documento de material. Um registro por MIGO; os itens estão na MSEG, ' +
      'ligados por MBLNR+MJAHR.',
    campos: [
      { nome: 'MBLNR', descricao: 'Nº do documento de material (a MIGO)' },
      { nome: 'MJAHR', descricao: 'Ano do documento' },
      { nome: 'BLART', descricao: 'Tipo de documento (WE entrada de mercadoria)' },
      { nome: 'BLDAT', descricao: 'Data do documento (a do papel)' },
      { nome: 'BUDAT', descricao: 'Data de LANÇAMENTO — é esta que conta para o período' },
      { nome: 'CPUDT', descricao: 'Data em que foi digitado no sistema' },
      { nome: 'CPUTM', descricao: 'Hora em que foi digitado' },
      { nome: 'USNAM', descricao: 'Usuário SAP que lançou' },
      { nome: 'XBLNR', descricao: 'Referência — costuma trazer o nº da NF' },
      { nome: 'BKTXT', descricao: 'Texto de cabeçalho' },
    ],
    filtro: "MBLNR = '5002365764'\nAND MJAHR = '2026'",
    camposChave: 'MBLNR, MJAHR',
    custom: false,
    atualizadoEm: AGORA(),
  }
}

// ── material, dados gerais ──────────────────────────────────────────────────
function materialGeral(): ModeloReadTable {
  return {
    id: 'material-geral',
    nome: 'Material — dados gerais',
    tabela: 'MARA',
    descricaoTabela:
      'Cadastro geral do material, válido para a empresa toda. A DESCRIÇÃO fica na MAKT ' +
      '(por idioma), os dados por centro na MARC, o estoque na MARD e as unidades ' +
      'alternativas na MARM. MATNR vai com zeros à esquerda, 18 posições.',
    campos: [
      { nome: 'MATNR', descricao: 'Código do material' },
      { nome: 'MTART', descricao: 'Tipo de material (ROH, HIBE, FERT…)' },
      { nome: 'MATKL', descricao: 'Grupo de mercadorias' },
      { nome: 'MEINS', descricao: 'UNIDADE BASE — é a dela que decide se aceita fração (ver T006)' },
      { nome: 'BRGEW', descricao: 'Peso bruto' },
      { nome: 'NTGEW', descricao: 'Peso líquido' },
      { nome: 'GEWEI', descricao: 'Unidade de peso' },
      { nome: 'XCHPF', descricao: 'X = material obrigado a LOTE' },
      { nome: 'LVORM', descricao: 'X = marcado para eliminação' },
      { nome: 'ERSDA', descricao: 'Data de criação do cadastro' },
      { nome: 'LAEDA', descricao: 'Data da última alteração' },
    ],
    filtro: "MATNR = '000000000000012345'",
    camposChave: 'MATNR',
    custom: false,
    atualizadoEm: AGORA(),
  }
}

// ── saldo por centro/depósito ───────────────────────────────────────────────
function saldoPorDeposito(): ModeloReadTable {
  return {
    id: 'saldo-deposito',
    nome: 'Saldo — por centro e depósito',
    tabela: 'MARD',
    descricaoTabela:
      'Estoque por material, centro e depósito. Uma linha por combinação, e o saldo vem ' +
      'QUEBRADO por situação — somar tudo não dá o disponível, porque bloqueado e ' +
      'qualidade não estão disponíveis. Para o saldo por LOTE, a tabela é a MCHB.',
    campos: [
      { nome: 'MATNR', descricao: 'Material (18 posições, com zeros à esquerda)' },
      { nome: 'WERKS', descricao: 'Centro' },
      { nome: 'LGORT', descricao: 'Depósito' },
      { nome: 'LABST', descricao: 'LIVRE UTILIZAÇÃO — é este o "saldo" do dia a dia' },
      { nome: 'INSME', descricao: 'Em controle de qualidade' },
      { nome: 'SPEME', descricao: 'Bloqueado' },
      { nome: 'UMLME', descricao: 'Em transferência (dentro do centro)' },
      { nome: 'EINME', descricao: 'Devolução a fornecedor' },
      { nome: 'RETME', descricao: 'Bloqueado por devolução' },
      { nome: 'LVORM', descricao: 'X = marcado para eliminação' },
    ],
    filtro: "WERKS = 'C039'\nAND MATNR = '000000000000012345'",
    camposChave: 'MATNR, WERKS, LGORT',
    custom: false,
    atualizadoEm: AGORA(),
  }
}

// ── movimentação de um item num centro ──────────────────────────────────────
function movimentacoesDoMaterial(): ModeloReadTable {
  return {
    id: 'mov-material-centro',
    nome: 'Movimentações — de um material num centro',
    tabela: 'MSEG',
    descricaoTabela:
      'Todo movimento daquele material naquele centro. ATENÇÃO: a MSEG não tem data. ' +
      'Para recortar por período, rode antes o modelo "Movimentações de um usuário no ' +
      'período" (ou qualquer consulta na MKPF por BUDAT), pegue os MBLNR e filtre aqui ' +
      'por eles — a RFC_READ_TABLE não faz JOIN.',
    campos: [
      { nome: 'MBLNR', descricao: 'Documento de material — leve à MKPF para saber a data' },
      { nome: 'MJAHR', descricao: 'Ano do documento' },
      { nome: 'ZEILE', descricao: 'Item dentro do documento' },
      { nome: 'BWART', descricao: 'Tipo de movimento (101 entrada, 102 estorno, 261 consumo…)' },
      { nome: 'SHKZG', descricao: 'S = débito (entrada), H = crédito (saída/estorno)' },
      { nome: 'MATNR', descricao: 'Material' },
      { nome: 'WERKS', descricao: 'Centro' },
      { nome: 'LGORT', descricao: 'Depósito' },
      { nome: 'CHARG', descricao: 'Lote' },
      { nome: 'MENGE', descricao: 'Quantidade — o SINAL não vem aqui, vem no SHKZG' },
      { nome: 'MEINS', descricao: 'Unidade de medida' },
      { nome: 'DMBTR', descricao: 'Valor em moeda interna' },
      { nome: 'EBELN', descricao: 'Pedido de compra de origem' },
      { nome: 'EBELP', descricao: 'Item do pedido' },
      { nome: 'SMBLN', descricao: 'Documento ESTORNADO por este — preenchido só em estorno' },
    ],
    filtro: "MATNR = '000000000000012345'\nAND WERKS = 'C039'",
    camposChave: 'MBLNR, MJAHR, ZEILE',
    custom: false,
    atualizadoEm: AGORA(),
  }
}

// ── movimentações de um usuário, num período ────────────────────────────────
//
// Este é o modelo com a pegadinha mais cara da lista, e por isso a descrição é
// a mais longa: a pergunta natural ("o que fulano movimentou em setembro, só
// entradas") junta três filtros que moram em DUAS tabelas sem JOIN possível.
function movimentacoesDoUsuario(): ModeloReadTable {
  return {
    id: 'mov-usuario-periodo',
    nome: 'Movimentações — de um usuário, por período (passo 1)',
    tabela: 'MKPF',
    descricaoTabela:
      'PASSO 1 de 2. Usuário e data só existem no cabeçalho, então é aqui que o recorte ' +
      'começa. O resultado é uma lista de MBLNR+MJAHR. Para filtrar por TIPO DE MOVIMENTO, ' +
      'leve esses números ao passo 2 (modelo "Movimentações de um material num centro", ' +
      'trocando o filtro por MBLNR e acrescentando BWART) — o tipo mora na MSEG, e a ' +
      'RFC_READ_TABLE não cruza tabelas. Datas são texto no formato AAAAMMDD.',
    campos: [
      { nome: 'MBLNR', descricao: 'Documento de material — a chave para o passo 2' },
      { nome: 'MJAHR', descricao: 'Ano do documento' },
      { nome: 'USNAM', descricao: 'Usuário SAP que lançou' },
      { nome: 'BUDAT', descricao: 'Data de lançamento (AAAAMMDD)' },
      { nome: 'CPUDT', descricao: 'Data de digitação — difere da BUDAT em lançamento retroativo' },
      { nome: 'CPUTM', descricao: 'Hora de digitação' },
      { nome: 'BLART', descricao: 'Tipo de documento' },
      { nome: 'XBLNR', descricao: 'Referência — costuma trazer o nº da NF' },
      { nome: 'BKTXT', descricao: 'Texto de cabeçalho' },
    ],
    filtro:
      "USNAM = 'FULANO'\n" +
      "AND BUDAT >= '20260901'\n" +
      "AND BUDAT <= '20260930'",
    camposChave: 'MBLNR, MJAHR',
    custom: false,
    atualizadoEm: AGORA(),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OS DOIS METAMODELOS — o SAP descrevendo a si mesmo
//
// Estes não respondem pergunta de negócio nenhuma, e são os mais úteis da
// lista: com eles você para de depender de alguém ter lembrado o nome certo de
// um campo. O dicionário de dados é tabela como qualquer outra, e a
// RFC_READ_TABLE lê.
//
// É também a resposta à pergunta "dá para pesquisar os campos de uma tabela
// SAP?": dá, e sem pipe nova — o read_table que já existe basta.
// ═══════════════════════════════════════════════════════════════════════════

function camposDeUmaTabela(): ModeloReadTable {
  return {
    id: 'dd-campos-da-tabela',
    nome: 'SAP — que campos esta tabela tem?',
    tabela: 'DD03L',
    descricaoTabela:
      'Dicionário de dados: uma linha por campo de uma tabela. Use para conferir um nome ' +
      'antes de montar um modelo — campo inexistente faz a RFC recusar a chamada inteira. ' +
      'Para o TEXTO de cada campo, pegue o ROLLNAME daqui e consulte a DD04T ' +
      "(filtro ROLLNAME = '<elemento>' AND DDLANGUAGE = 'P').",
    campos: [
      { nome: 'TABNAME', descricao: 'Tabela' },
      { nome: 'FIELDNAME', descricao: 'Campo' },
      { nome: 'POSITION', descricao: 'Ordem do campo na tabela' },
      { nome: 'KEYFLAG', descricao: 'X = faz parte da CHAVE (serve para CamposChave)' },
      { nome: 'ROLLNAME', descricao: 'Elemento de dados — é por ele que se acha o texto na DD04T' },
      { nome: 'DATATYPE', descricao: 'Tipo (CHAR, NUMC, DATS, QUAN, CURR…)' },
      { nome: 'LENG', descricao: 'Tamanho' },
      { nome: 'DECIMALS', descricao: 'Casas decimais' },
    ],
    filtro: "TABNAME = 'MSEG'",
    camposChave: 'TABNAME, FIELDNAME',
    custom: false,
    atualizadoEm: AGORA(),
  }
}

function tabelasPorDescricao(): ModeloReadTable {
  return {
    id: 'dd-tabelas-por-descricao',
    nome: 'SAP — que tabela é esta? (ou: procurar por nome)',
    tabela: 'DD02T',
    descricaoTabela:
      'Descrição das tabelas, por idioma. Serve para os dois sentidos: saber o que uma ' +
      "tabela é, ou procurar uma pelo nome (TABNAME LIKE 'MS%'). DDLANGUAGE 'P' é " +
      "português e 'E' inglês — nem toda tabela tem a tradução, então o inglês é o " +
      'fallback que sempre responde.',
    campos: [
      { nome: 'TABNAME', descricao: 'Tabela' },
      { nome: 'DDLANGUAGE', descricao: 'Idioma do texto' },
      { nome: 'DDTEXT', descricao: 'Descrição' },
    ],
    filtro: "TABNAME = 'MSEG'\nAND DDLANGUAGE = 'P'",
    camposChave: 'TABNAME, DDLANGUAGE',
    custom: false,
    atualizadoEm: AGORA(),
  }
}
