// ─────────────────────────────────────────────────────────────────────────────
// A resposta do 'get_ultimo_executar' virando estado da tela de Lançamento.
//
// ── de onde vem cada campo ───────────────────────────────────────────────────
// O mapa não foi inventado: é o que Analise.UsarUltimoExecutar escreve na
// planilha, campo a campo, lido do .xlam publicado no LNF-dist. As três fontes:
//
//   PedidosDict            → a grade B2:Q, via ExportarPedidosParaPlanilha
//   Nfs[chave]             → o painel S2:S14 e os sinais de divergência
//   ItensSemPedido / DivergenciasValorUN / DivergenciasFrete
//                          → as três grades da aba Diferenças
//
// ── uma diferença deliberada em relação ao VBA ───────────────────────────────
// Lá, metade do cabeçalho (número da NF, emissão, valor total, frete) sai do
// xml_Data — o XML que está aberto NA MÁQUINA. Aqui não há XML: a resposta
// chegou pela rede, de outra pessoa.
//
// Mas ela não precisa: o NfResumo já carrega NumeroNF, SerieNF, DataEmissao,
// DataLancamento, ValorTotalNF e ValorFreteNF. O VBA lê do XML porque o tem em
// mãos, não porque a resposta não traga. Então este mapeamento é mais completo
// que o do VBA, e não menos — e funciona para uma NF de qualquer máquina.
//
// O que realmente não vem: 'Txt. cabeç.', que no VBA é Format$(Date) — a data
// de HOJE, na máquina de quem lançou. Não é dado da NF, é carimbo do momento.
// Fica vazio, porque inventar o "hoje" de quem está olhando seria pior.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  Divergencias,
  DadosNf,
  EstadoLancamento,
  ItemLancamento,
  SinaisNf,
} from '../types/lancamento'

// O formato do fio. Deliberadamente frouxo: é JSON de outra máquina, possivelmente
// de um Coreon mais novo que esta tela. Campo que não conhecemos é ignorado;
// campo que falta vira vazio. Nada aqui pode lançar.
type Bruto = Record<string, unknown>

const obj = (v: unknown): Bruto => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Bruto) : {})
const arr = (v: unknown): Bruto[] => (Array.isArray(v) ? v.map(obj) : [])
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1'

// Número tolerante: a resposta serializa double como número, mas o histórico
// deste projeto tem valor chegando como texto com vírgula decimal (é o que o
// `Replace(..., ".", ",")` do VBA denuncia). Aceitar os dois custa uma linha.
function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim().replace(/\s/g, '')
  // "1.234,56" → "1234.56" ; "1234.56" fica ; "1234,56" → "1234.56"
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const r = Number(norm)
  return Number.isFinite(r) ? r : null
}

const num = (v: unknown): number => n(v) ?? 0

// Os nomes das chaves são os do dicionário do VBA — com acento, com espaço, e
// é assim que o Coreon serializa. Estão aqui uma vez só.
const K = {
  pedido: 'Pedido',
  centro: 'Centro',
  deposito: 'Depósito',
  codigo: 'Código',
  descricao: 'Descrição',
  referencia: 'Referência',
  item: 'Item',
  qtdNf: 'Qtd NF',
  umbForn: 'UMB Forn',
  lote: 'Lote',
  validade: 'Validade',
  qtdPendente: 'Qtd Pendente',
  umbPed: 'UMB Ped',
  valorUn: 'Valor UN',
  valorUnNf: 'Valor UN NF',
  freteUn: 'Frete UN',
  status: 'Status',
  nfChave: 'NfChave',
  planejador: 'Planejador',
} as const

export interface ResultadoImport {
  estado: EstadoLancamento
  /** Chaves de NF presentes na resposta. Mais de uma = multi-NF. */
  chaves: string[]
  avisos: string[]
}

// ── o corpo da pipe, tirado dos envelopes ───────────────────────────────────
//
// A coluna 'resultado' NUNCA guarda o ExecutarResponse cru. Quem grava é o
// SolicitacaoRemotaService.Concluir, e ele embrulha:
//
//   resultado = { duracao_seg: 12.3, resposta: <corpo da pipe> }
//
// A duração não vem da pipe — é cronometrada por quem chamou —, então ela só
// caberia por fora. O preço é que todo leitor precisa saber disso, e quem não
// sabia lia `resultado.Nfs`, achava undefined e concluía "sem NFs na resposta"
// para uma resposta inteira e correta. Falha caladíssima: a lista abria, as
// linhas apareciam, e todas mentiam do mesmo jeito.
//
// Fica numa função só, exportada, porque são três leitores (o mapeamento
// abaixo, o filtro e o resumo da lista de reabrir) e um quarto vai aparecer.
// O lerCatalogo já fazia isso sozinho, para o mesmo envelope — era o único que
// tinha esbarrado nele.
//
// Descasca o que se conhece, na ordem em que aparece, e PARA assim que o objeto
// se parece com um ExecutarResponse — nada de descascar um corpo legítimo que
// por acaso tenha um campo com nome de envelope.
export function corpoDaResposta(bruto: unknown): Record<string, unknown> {
  let v: unknown = bruto

  // Três voltas cobre { resultado: { duracao_seg, resposta: {...} } }, que é o
  // pior caso real. O teto existe só para que um objeto cíclico ou um formato
  // inesperado não rode para sempre.
  for (let i = 0; i < 3; i++) {
    // jsonb chega desserializado pelo PostgREST, mas o mesmo campo passa por
    // dois transportes (Edge Function e fluxo do PA) e por colar-JSON à mão.
    // Aceitar texto custa três linhas.
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v)
      } catch {
        return {}
      }
      continue
    }

    const o = obj(v)
    if (o.Nfs || o.PedidosDict) return o

    const dentro = o.resposta ?? o.resultado ?? o.Resultado
    if (dentro === undefined || dentro === null) return o
    v = dentro
  }

  return obj(v)
}

/**
 * Traduz a resposta. `chaveEscolhida` seleciona a NF quando a resposta é
 * multi-NF; omitida, usa a primeira.
 *
 * `centrosDoUsuario` não vem na resposta — é de quem está OLHANDO, não de quem
 * executou. Quem chama informa; vazio desliga o realce de centro, que é melhor
 * que pintar de vermelho a lista errada.
 */
export function deUltimoExecutar(
  bruto: unknown,
  opts: { chaveEscolhida?: string; centrosDoUsuario?: string[] } = {},
): ResultadoImport {
  const avisos: string[] = []
  const r = corpoDaResposta(bruto)

  if (!r.Nfs && !r.PedidosDict)
    throw new Error(
      'Isto não parece a resposta de um get_ultimo_executar — faltam "Nfs" e "PedidosDict".',
    )

  if (r.Sucesso === false)
    avisos.push(`O Coreon respondeu sem sucesso${r.Mensagem ? `: ${txt(r.Mensagem)}` : '.'}`)

  const nfs = obj(r.Nfs)
  const chaves = Object.keys(nfs)
  const chave = opts.chaveEscolhida && nfs[opts.chaveEscolhida] ? opts.chaveEscolhida : chaves[0]
  const nf = obj(nfs[chave])

  if (chaves.length > 1)
    avisos.push(`A resposta traz ${chaves.length} NFs. Exibindo ${txt(nf.NumeroNF) || chave}.`)

  // ── a grade ────────────────────────────────────────────────────────────────
  const pedidosDict = obj(r.PedidosDict)
  const itens: ItemLancamento[] = []
  let ordem = 0

  for (const [ref, linhas] of Object.entries(pedidosDict)) {
    for (const linha of arr(linhas)) {
      // Multi-NF: cada linha carrega a NF que casou. Sem NfChave (single-NF), a
      // linha é da nota que estiver sendo exibida.
      const daLinha = txt(linha[K.nfChave])
      if (chaves.length > 1 && daLinha && daLinha !== chave) continue

      const qtdNf = num(linha[K.qtdNf])

      // A MESMA poda do ExportarPedidosParaPlanilha: item finalizado e sem
      // quantidade na nota não vira linha. Sem isto a grade ganha linhas que a
      // planilha nunca mostrou, e a conferência deixa de bater com a dela.
      if (txt(linha[K.status]) === 'Finalizado' && qtdNf === 0) continue

      // Lote, validade e os três valores só entram quando há quantidade — é o
      // `If linha("Qtd NF") > 0` do VBA. Numa linha zerada eles existem no
      // dicionário e NÃO vão para a planilha; copiá-los aqui mostraria dado que
      // o operador nunca viu.
      const temQtd = qtdNf > 0

      itens.push({
        id: `${ref}#${ordem++}`,
        pedido: txt(linha[K.pedido]),
        centro: txt(linha[K.centro]),
        deposito: txt(linha[K.deposito]) || '-',
        material: txt(linha[K.codigo]),
        descricao: txt(linha[K.descricao]),
        referencia: txt(linha[K.referencia]),
        item: txt(linha[K.item]),
        qtdNf,
        umbForn: temQtd ? txt(linha[K.umbForn]) : '',
        lote: temQtd ? txt(linha[K.lote]) : '',
        validade: temQtd ? txt(linha[K.validade]) : '',
        qtdPendente: num(linha[K.qtdPendente]),
        umbPed: txt(linha[K.umbPed]),
        valorUnPedido: temQtd ? n(linha[K.valorUn]) : null,
        valorUnNf: temQtd ? n(linha[K.valorUnNf]) : null,
        freteUnPedido: temQtd ? n(linha[K.freteUn]) : null,
      })
    }
  }

  // ── o cabeçalho ────────────────────────────────────────────────────────────
  const numeroNf = txt(nf.NumeroNF)
  const serie = txt(nf.SerieNF)
  const valorPed = n(nf.ValorTotalPedido)
  const fretePed = n(nf.FreteTotalPedido)

  const dados: DadosNf = {
    // O VBA monta "nNF-serie" e omite a série quando é 0 — mesma regra.
    nf: serie && serie !== '0' ? `${numeroNf}-${serie}` : numeroNf,
    txtCabec: '', // Format$(Date) no VBA: o "hoje" de quem lançou, não da NF
    conhTransp: txt(nf.ConhTransp),
    dataEmissao: txt(nf.DataEmissao),
    dataLancamento: txt(nf.DataLancamento),
    freteNf: n(nf.ValorFreteNF),
    valorTotalNf: n(nf.ValorTotalNF),
    valorProdutosPedido: valorPed,
    totalFretePedido: fretePed,
    // Soma explícita, como o VBA faz em CEL_TOTAL_PED: é o número que entra na
    // conferência contra o total da NF.
    totalPedido: valorPed === null && fretePed === null ? null : (valorPed ?? 0) + (fretePed ?? 0),
    planejador: txt(nf.PlanejadorNome) || txt(nf.Planejador),
    dataProgramada: txt(nf.DataPedidoMaisRecente || r.DataPedidoMaisRecente).slice(0, 10),
    migo: txt(nf.MaterialDocument),
  }

  // ── os sinais ──────────────────────────────────────────────────────────────
  // 'EmAprovacao' e 'AvisoPedidosEmAprovacao' são mais novos que o resto e não
  // têm campo próprio no EstadoLancamento. O aviso entra na mensagem, que é
  // onde o VBA também o joga (EscreverFeedback "Warning").
  const partesMsg = [txt(nf.Mensagem), bool(nf.EmAprovacao) ? txt(nf.AvisoPedidosEmAprovacao) : '']
    .map(s => s.trim())
    .filter(Boolean)

  const sinais: SinaisNf = {
    difFrete: bool(nf.DifFrete),
    difValorUN: bool(nf.DifValorUN),
    itemSemPedido: bool(nf.ItemSemPedido),
    itemIndefinido: bool(nf.ItemIndefinido),
    difCentro: bool(nf.DifCentro),
    centroBloqueiaLancamento: bool(nf.CentroBloqueiaLancamento),
    semLote: bool(nf.SemLote),
    loteFit: bool(nf.LoteFit),
    lancada: bool(nf.Lancada),
    mensagem: partesMsg.join(' · '),
  }

  // ── as divergências ────────────────────────────────────────────────────────
  // Vêm achatadas, com NfSerie em cada item. Em multi-NF filtra-se por ele — é
  // para isso que o campo existe.
  const nfSerie = dados.nf
  const daNf = (e: Bruto) => chaves.length <= 1 || !e.NfSerie || txt(e.NfSerie) === nfSerie

  const divergencias: Divergencias = {
    valorUn: arr(r.DivergenciasValorUN)
      .filter(daNf)
      .map(e => ({
        nfSerie: txt(e.NfSerie),
        pedido: txt(e.Pedido),
        item: txt(e.Item),
        valorUnNf: n(e.ValorUNNF),
        divisor: txt(e.Divisor),
      })),
    semPedido: arr(r.ItensSemPedido)
      .filter(daNf)
      .map(e => ({
        nfSerie: txt(e.NfSerie),
        centroNf: txt(e.CentroNF),
        codigo: txt(e.Codigo),
        referencia: txt(e.Referencia),
        qtdNf: num(e.QtdNF),
      })),
    frete: arr(r.DivergenciasFrete)
      .filter(daNf)
      .map(e => ({
        nfSerie: txt(e.NfSerie),
        pedido: txt(e.Pedido),
        itens: Array.isArray(e.Itens) ? (e.Itens as unknown[]).map(txt) : [],
        valorFreteTotal: n(e.ValorFreteTotal),
      })),
  }

  if (itens.length === 0) avisos.push('A resposta não trouxe nenhuma linha de item.')

  // Os pedidos não vêm na resposta (são entrada, não saída). Derivam-se das
  // linhas: é a lista que o operador digitou, reconstruída pelo que ela gerou.
  const pedidos = [...new Set(itens.map(i => i.pedido).filter(p => /^\d+$/.test(p)))]

  return {
    estado: {
      chaveNf: txt(nf.ChaveNFe) || chave,
      fornecedor: txt(nf.Fornecedor),
      centrosDoUsuario: opts.centrosDoUsuario ?? [],
      pedidos,
      itens,
      dados,
      sinais,
      divergencias,
    },
    chaves,
    avisos,
  }
}
