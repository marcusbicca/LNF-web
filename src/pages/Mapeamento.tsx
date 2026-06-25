import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import type { CadastroJson, FatorEntry, ItensJson, PedidoItem } from '../types'
import { format, parseLenient } from '../utils/json'

// ─────────────────────────────────────────────────────────────────────────────
// Mapeamento — porta web do MapearMaterialForm do LNF-Coreon.
//
// Cruza itens da NF que ficaram "Sem pedido" (cb1) com itens do pedido SAP que
// não foram consumidos (Qtd NF == 0, cb2), monta a conversão de UMB e grava o
// cadastro no itens.json do fornecedor.
//
// Convenção de conversão (espelha ExecutarService.ProcessarConversao):
//   • fator (campo)  = conv.fator gravado no JSON
//   • runtime "conversao": universal → fator ; dirA(de=NF) → 1/fator ;
//                          dirB(de=Pedido) → fator
//   • qtdSAP        = QtdNF / conversao
//   • valorNF_conv  = ValorUNNF * conversao
// ─────────────────────────────────────────────────────────────────────────────

interface ItemNf {
  id: string
  nfChave: string
  referencia: string
  codigo: string
  descricao: string
  qtdNF: number
  umbForn: string
  valorUNNF: number
}

interface ItemPedido {
  id: string
  fornecedor: string
  deduKey: string
  pedido: string
  item: string
  codigo: string
  descricao: string
  refs: string[]
  refPrimaria: string
  qtdPendente: number
  umbPed: string
  valorUN: number
  semCadastro: boolean
}

interface Vinculo {
  id: string
  nf: ItemNf
  pedido: ItemPedido
  fator: number
  umbsIguais: boolean
  de: string
  para: string
  // já existia no itens.json ao carregar (mostrado como "já registrado",
  // não é reescrito no Registrar a menos que seja refeito).
  preexistente?: boolean
}

// ── Helpers numéricos (espelham ParseNum / Num do form C#) ───────────────────

function parseNum(s: string): number {
  if (!s || !s.trim()) return 0
  const r = parseFloat(s.trim().replace(',', '.'))
  return Number.isFinite(r) ? r : 0
}

// "0.######" invariante: até 6 casas, sem zeros à direita.
function num(v: number): string {
  if (!Number.isFinite(v)) return '0'
  return parseFloat(v.toFixed(6)).toString()
}

function str(d: PedidoItem, k: string): string {
  const v = (d as unknown as Record<string, unknown>)[k]
  return v === undefined || v === null ? '' : String(v)
}

function dbl(d: PedidoItem, k: string): number {
  const v = (d as unknown as Record<string, unknown>)[k]
  if (v === undefined || v === null) return 0
  if (typeof v === 'number') return v
  const r = parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(r) ? r : 0
}

// UMB sem o asterisco de conversão.
function umbBase(s: string): string {
  return (s ?? '').replace(/\*+$/, '').trim()
}

// ── Carga das listas a partir do PedidosDict ─────────────────────────────────

interface CargaResultado {
  fornecedor: string
  cb1: ItemNf[]
  cb2: ItemPedido[]
  // NfChave → conjunto de Pedidos que aquela NF tocou (linhas consumidas).
  nfPedidos: Record<string, string[]>
}

function pedidoReal(pedido: string): boolean {
  return (
    pedido !== '' &&
    pedido !== 'Sem pedido' &&
    pedido !== 'Excedente' &&
    pedido !== 'Finalizado' &&
    pedido !== 'Lançado'
  )
}

function carregarDados(dict: Record<string, PedidoItem[]>): CargaResultado {
  let fornecedor = ''
  const cb1Dict = new Map<string, ItemNf>()
  const cb2Dict = new Map<string, ItemPedido>()
  const nfPedidos = new Map<string, Set<string>>()

  for (const [refKey, linhas] of Object.entries(dict)) {
    if (!linhas) continue
    for (const linha of linhas) {
      const pedido = str(linha, 'Pedido')
      if (!fornecedor) fornecedor = str(linha, 'Fornecedor')

      // Linha consumida pela NF (tem NfChave + pedido real): registra o vínculo
      // NF → pedido, usado depois para escopar a lista da direita por NF.
      const nfChaveLinha = str(linha, 'NfChave')
      if (nfChaveLinha && pedidoReal(pedido)) {
        let set = nfPedidos.get(nfChaveLinha)
        if (!set) {
          set = new Set<string>()
          nfPedidos.set(nfChaveLinha, set)
        }
        set.add(pedido)
      }

      if (pedido === 'Sem pedido') {
        const refNF = str(linha, 'Referência')
        const nfChave = str(linha, 'NfChave')
        const key = nfChave + '||' + refNF
        if (!cb1Dict.has(key)) {
          cb1Dict.set(key, {
            id: 'nf:' + key,
            nfChave,
            referencia: refNF,
            codigo: str(linha, 'Código'),
            descricao: str(linha, 'Descrição'),
            qtdNF: dbl(linha, 'Qtd NF'),
            umbForn: str(linha, 'UMB Forn'),
            valorUNNF: dbl(linha, 'Valor UN NF'),
          })
        }
      } else if (pedidoReal(pedido) && dbl(linha, 'Qtd NF') === 0) {
        const item = str(linha, 'Item')
        const deduKey = pedido + '|' + item
        let ip = cb2Dict.get(deduKey)
        if (!ip) {
          ip = {
            id: 'ped:' + deduKey,
            fornecedor: str(linha, 'Fornecedor'),
            deduKey,
            pedido,
            item,
            codigo: str(linha, 'Código'),
            descricao: str(linha, 'Descrição'),
            refs: [],
            refPrimaria: '',
            qtdPendente: dbl(linha, 'Qtd Pendente'),
            umbPed: str(linha, 'UMB Ped'),
            valorUN: dbl(linha, 'Valor UN'),
            semCadastro: false,
          }
          cb2Dict.set(deduKey, ip)
        }
        if (refKey && !ip.refs.some(r => r.toLowerCase() === refKey.toLowerCase())) {
          ip.refs.push(refKey)
        }
        if (refKey.toLowerCase() === 'sem cadastro') ip.semCadastro = true
      }
    }
  }

  // RefPrimaria: "Sem cadastro" se presente, senão a 1ª ref real.
  for (const ip of cb2Dict.values()) {
    ip.refPrimaria = ip.semCadastro
      ? 'Sem cadastro'
      : ip.refs.find(r => r.toLowerCase() !== 'sem cadastro') ?? ip.refs[0] ?? ''
  }

  const nfPedidosObj: Record<string, string[]> = {}
  for (const [chave, set] of nfPedidos) nfPedidosObj[chave] = [...set]

  return {
    fornecedor,
    cb1: [...cb1Dict.values()],
    cb2: [...cb2Dict.values()],
    nfPedidos: nfPedidosObj,
  }
}

// Reordena CB2: "Sem cadastro" primeiro; depois por proximidade de preço com
// o item da NF selecionado (espelha o reordenamento do Lv1_SelectionChanged).
function sortCb2(list: ItemPedido[], ref: ItemNf | null): ItemPedido[] {
  if (!ref) return list
  return [...list].sort((a, b) => {
    const sa = a.semCadastro ? 0 : 1
    const sb = b.semCadastro ? 0 : 1
    if (sa !== sb) return sa - sb
    return Math.abs(a.valorUN - ref.valorUNNF) - Math.abs(b.valorUN - ref.valorUNNF)
  })
}

// Runtime "conversao" a partir do campo fator + orientação de/para.
function conversaoRuntime(fator: number, umbsIguais: boolean, de: string, umbNf: string): number {
  if (fator <= 0) return 1
  if (umbsIguais) return fator
  // dirA: de == fromUMB (NF) → 1/f ; dirB: de == toUMB (Ped) → f
  if (de.trim().toLowerCase() === umbNf.toLowerCase()) return fator !== 0 ? 1 / fator : 1
  return fator
}

// Reconstrói o estado de conversão (fator/de/para) a partir do que está
// gravado no itens.json (lista vazia = sem conversão; só fator = universal;
// com de/para = direcional).
function reconstruirConv(conv: FatorEntry[] | undefined): {
  fator: number
  umbsIguais: boolean
  de: string
  para: string
} {
  if (!conv || conv.length === 0) return { fator: 1, umbsIguais: true, de: '', para: '' }
  const c = conv[0]
  if ((c.de && c.de !== '') || (c.para && c.para !== '')) {
    return { fator: c.fator ?? 1, umbsIguais: false, de: c.de ?? '', para: c.para ?? '' }
  }
  return { fator: c.fator ?? 1, umbsIguais: true, de: '', para: '' }
}

// Procura a chave (case-insensitive) do fornecedor no itens.json.
function acharFornecedorKey(itens: ItensJson, fornecedor: string): string | null {
  const f = fornecedor.trim().toLowerCase()
  return Object.keys(itens).find(k => k.trim().toLowerCase() === f) ?? null
}

// Serializa uma conversão no formato do itens.json (espelha ConverterConversao).
function convToJson(de: string, para: string, fator: number): FatorEntry {
  const o: FatorEntry = {}
  if (de) o.de = de
  if (para) o.para = para
  if (fator !== 0 && fator !== 1) o.fator = fator
  return o
}

// Aplica os vínculos no itens.json (espelha AplicarItemNoDict/UpsertItens).
// Ao gravar uma referência, remove-a de qualquer OUTRO código do mesmo
// fornecedor (refazer limpo: uma referência mapeia para um único código).
function aplicarVinculos(base: ItensJson, fornecedor: string, vinculos: Vinculo[]): ItensJson {
  const novo = JSON.parse(JSON.stringify(base)) as ItensJson
  const fkey = acharFornecedorKey(novo, fornecedor) ?? fornecedor
  if (!novo[fkey]) novo[fkey] = { Configuracoes: {}, Itens: {} }
  const itens = novo[fkey].Itens

  for (const v of vinculos) {
    const cod = (v.pedido.codigo ?? '').trim()
    const ref = (v.nf.referencia ?? '').trim()
    if (!cod || !ref) continue

    // Remove a referência de outros códigos (e descarta itens que ficarem vazios).
    for (const c of Object.keys(itens)) {
      if (c === cod) continue
      const refs = itens[c].referencias
      if (!refs) continue
      const k = Object.keys(refs).find(r => r.toLowerCase() === ref.toLowerCase())
      if (k) {
        delete refs[k]
        if (Object.keys(refs).length === 0) delete itens[c]
      }
    }

    if (!itens[cod]) itens[cod] = { referencias: {}, descricao: v.pedido.descricao }
    else if (v.pedido.descricao) itens[cod].descricao = v.pedido.descricao

    // Fator 1 não é gravado: a referência é criada com lista vazia.
    const convs: FatorEntry[] = []
    if (Math.abs(v.fator - 1) > 1e-9 && v.fator > 0) {
      convs.push(
        v.umbsIguais
          ? convToJson('', '', v.fator)
          : convToJson(v.de, v.para, v.fator),
      )
    }

    // Evita duplicar a mesma ref com casing diferente.
    const existK = Object.keys(itens[cod].referencias).find(r => r.toLowerCase() === ref.toLowerCase())
    if (existK && existK !== ref) delete itens[cod].referencias[existK]
    itens[cod].referencias[ref] = convs
  }

  return novo
}

// ─────────────────────────────────────────────────────────────────────────────

export function Mapeamento() {
  const { config, itens, carregandoItens, erroItens, gravarItens } = useApp()

  // Entrada de JSON
  const [jsonTexto, setJsonTexto] = useState('')
  const [mostrarTextarea, setMostrarTextarea] = useState(false)
  const [erroJson, setErroJson] = useState<string | null>(null)
  const [carregado, setCarregado] = useState(false)

  // Dados de trabalho
  const [fornecedor, setFornecedor] = useState('')
  const [cb1All, setCb1All] = useState<ItemNf[]>([])
  const [cb2All, setCb2All] = useState<ItemPedido[]>([])
  const [vinculos, setVinculos] = useState<Vinculo[]>([])
  // chave NFe → rótulo legível ("número - fornecedor")
  const [nfInfos, setNfInfos] = useState<Record<string, { numero: string; fornecedor: string }>>({})
  // chave NFe → pedidos que a NF tocou (escopo da lista da direita)
  const [nfPedidos, setNfPedidos] = useState<Record<string, string[]>>({})

  // Seleção
  const [nfSel, setNfSel] = useState<string | null>(null)
  const [cb1SelId, setCb1SelId] = useState<string | null>(null)
  const [cb2SelId, setCb2SelId] = useState<string | null>(null)

  // Conversão
  const [fator, setFator] = useState('1')
  const [de, setDe] = useState('')
  const [para, setPara] = useState('')

  // Commit
  const [commitando, setCommitando] = useState(false)
  const [statusCommit, setStatusCommit] = useState<string | null>(null)

  // ── NFs disponíveis (só as que têm ≥1 item "Sem pedido") ───────────────────
  const nfs = useMemo(() => {
    const set = new Set<string>()
    for (const it of cb1All) set.add(it.nfChave)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [cb1All])

  // cb1 filtrado pela NF selecionada
  const cb1 = useMemo(() => {
    if (nfSel === null) return cb1All
    return cb1All.filter(i => i.nfChave === nfSel)
  }, [cb1All, nfSel])

  const cb1Sel = useMemo(() => cb1.find(i => i.id === cb1SelId) ?? null, [cb1, cb1SelId])

  // Pedidos que a NF selecionada tocou (via linhas consumidas, que têm NfChave).
  // As linhas de pedido não consumido não têm NfChave, então casamos por Pedido.
  const pedidosDaNf = useMemo(
    () => (nfSel !== null ? new Set(nfPedidos[nfSel] ?? []) : null),
    [nfSel, nfPedidos],
  )

  // cb2 filtrado pelos pedidos da NF selecionada + reordenado pela seleção.
  const cb2 = useMemo(() => {
    const base = pedidosDaNf ? cb2All.filter(i => pedidosDaNf.has(i.pedido)) : cb2All
    return sortCb2(base, cb1Sel)
  }, [cb2All, pedidosDaNf, cb1Sel])

  const cb2Sel = useMemo(() => cb2.find(i => i.id === cb2SelId) ?? null, [cb2, cb2SelId])

  // Rótulo visível da NF: "[número] - [fornecedor]" (a chave segue no backend).
  const rotuloNf = useCallback(
    (chave: string) => {
      const info = nfInfos[chave]
      if (info) return `${info.numero}${info.fornecedor ? ' - ' + info.fornecedor : ''}`
      return chave === '' ? '(sem chave)' : chave
    },
    [nfInfos],
  )

  const umbNf = umbBase(cb1Sel?.umbForn ?? '')
  const umbPed = umbBase(cb2Sel?.umbPed ?? '')
  const umbsIguais = !!cb1Sel && !!cb2Sel && umbNf.toLowerCase() === umbPed.toLowerCase()
  const mostrarDePara = !!cb1Sel && !!cb2Sel && !umbsIguais

  // ── Parse do JSON ──────────────────────────────────────────────────────────
  const parseJson = useCallback(
    (texto: string) => {
      setErroJson(null)
      try {
        const parsed = parseLenient<CadastroJson>(texto)
        if (!parsed.PedidosDict) throw new Error('Campo PedidosDict ausente — JSON inválido')
        setJsonTexto(format(parsed))
        const { fornecedor: forn, cb1: c1, cb2: c2, nfPedidos: np } = carregarDados(parsed.PedidosDict)
        setNfPedidos(np)

        // Mapa chave NFe → rótulo legível, a partir das NFs do cadastro.
        const infos: Record<string, { numero: string; fornecedor: string }> = {}
        for (const nf of Object.values(parsed.Nfs ?? {})) {
          if (nf && nf.ChaveNFe) infos[nf.ChaveNFe] = { numero: nf.NumeroNF, fornecedor: nf.Fornecedor }
        }
        setNfInfos(infos)

        // Pré-vínculos: referências da NF que já estão no itens.json entram
        // direto na tabela de vínculos (marcadas "já registrado").
        const preVinculos: Vinculo[] = []
        const usadosCb1 = new Set<string>()
        const usadosCb2 = new Set<string>()
        const fkey = itens ? acharFornecedorKey(itens, forn) : null
        if (itens && fkey) {
          const Itens = itens[fkey].Itens
          for (const it1 of c1) {
            const ref = (it1.referencia ?? '').trim()
            if (!ref) continue
            let achado: { codigo: string; descricao: string; conv: FatorEntry[] } | null = null
            for (const [cod, item] of Object.entries(Itens)) {
              const refK = Object.keys(item.referencias ?? {}).find(
                r => r.toLowerCase() === ref.toLowerCase(),
              )
              if (refK) {
                achado = { codigo: cod, descricao: item.descricao, conv: item.referencias[refK] }
                break
              }
            }
            if (!achado) continue

            const recon = reconstruirConv(achado.conv)
            const ped = c2.find(p => p.codigo === achado!.codigo && !usadosCb2.has(p.id))
            const pedido: ItemPedido = ped ?? {
              id: 'pre:' + achado.codigo,
              fornecedor: forn,
              deduKey: 'pre|' + achado.codigo,
              pedido: '',
              item: '',
              codigo: achado.codigo,
              descricao: achado.descricao,
              refs: [],
              refPrimaria: '',
              qtdPendente: 0,
              umbPed: '',
              valorUN: 0,
              semCadastro: false,
            }
            if (ped) usadosCb2.add(ped.id)
            usadosCb1.add(it1.id)
            preVinculos.push({
              id: 'v:pre:' + it1.id,
              nf: it1,
              pedido,
              fator: recon.fator,
              umbsIguais: recon.umbsIguais,
              de: recon.de,
              para: recon.para,
              preexistente: true,
            })
          }
        }

        const c1Rest = c1.filter(i => !usadosCb1.has(i.id))
        const c2Rest = c2.filter(i => !usadosCb2.has(i.id))

        setFornecedor(forn)
        setCb1All(c1Rest)
        setCb2All(c2Rest)
        setVinculos(preVinculos)
        setCb1SelId(null)
        setCb2SelId(null)
        const nfList = [...new Set(c1Rest.map(i => i.nfChave))].sort((a, b) => a.localeCompare(b))
        setNfSel(nfList.length > 0 ? nfList[0] : null)
        setStatusCommit(null)
        setCarregado(true)
      } catch (e) {
        setErroJson((e as Error).message)
        setCarregado(false)
      }
    },
    [itens],
  )

  async function colarClipboard() {
    try {
      const texto = await navigator.clipboard.readText()
      setJsonTexto(texto)
      parseJson(texto)
    } catch {
      setErroJson('Não foi possível acessar a área de transferência. Use o campo manual.')
      setMostrarTextarea(true)
    }
  }

  function limpar() {
    setJsonTexto('')
    setErroJson(null)
    setCarregado(false)
    setFornecedor('')
    setCb1All([])
    setCb2All([])
    setNfInfos({})
    setNfPedidos({})
    setVinculos([])
    setNfSel(null)
    setCb1SelId(null)
    setCb2SelId(null)
    setStatusCommit(null)
  }

  // ── Seleção CB1: auto-match (a reordenação do CB2 é derivada) ──────────────
  function selecionarCb1(it: ItemNf) {
    setCb1SelId(it.id)

    // CB2 dos mesmos pedidos da NF, já reordenado pela proximidade de preço.
    const candidatos = sortCb2(
      pedidosDaNf ? cb2All.filter(p => pedidosDaNf.has(p.pedido)) : cb2All,
      it,
    )

    // Auto-match: alguma ref do CB2 aparece na descrição do item da NF?
    const descNf = (it.descricao ?? '').toLowerCase()
    let matchId: string | null = null
    for (const p of candidatos) {
      if (
        p.refs.some(
          r =>
            r.trim() !== '' &&
            r.toLowerCase() !== 'sem cadastro' &&
            descNf.includes(r.toLowerCase()),
        )
      ) {
        matchId = p.id
        break
      }
    }

    // Auto-seleciona o match, ou o primeiro.
    setCb2SelId(matchId ?? (candidatos.length > 0 ? candidatos[0].id : null))
  }

  // ── Preenche de/para e fator default ao mudar a seleção ────────────────────
  useEffect(() => {
    if (!cb1Sel || !cb2Sel) return
    if (mostrarDePara) {
      setDe(prevDe => {
        // só preenche se ambos vazios (mantém edição do usuário)
        if (prevDe === '' && para === '') {
          // padrão: de = UMB do pedido, para = UMB da NF
          // (fator = quantos [para] cabem em 1 [de]; ex.: 1 CX = 500 UND → fator 500)
          setPara(umbNf)
          return umbPed
        }
        return prevDe
      })
    } else {
      setDe('')
      setPara('')
    }
    setFator(prev => (prev.trim() === '' ? '1' : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cb1SelId, cb2SelId])

  // ── Conversão calculada ────────────────────────────────────────────────────
  const conv = useMemo(() => {
    if (!cb1Sel || !cb2Sel) return null
    const f = parseNum(fator)
    const conversao = conversaoRuntime(f, umbsIguais, de, umbNf)
    const qtdSAP = conversao !== 0 ? cb1Sel.qtdNF / conversao : cb1Sel.qtdNF
    const valorNfConv = cb1Sel.valorUNNF * conversao
    const valorPed = cb2Sel.valorUN
    const dif = Math.abs((valorNfConv - valorPed) * qtdSAP)
    return { valorNfConv, valorPed, qtdNfConv: qtdSAP, diverge: dif > 0.5 }
  }, [cb1Sel, cb2Sel, fator, de, umbsIguais, umbNf])

  // ── Ações de conversão ─────────────────────────────────────────────────────
  function swapDePara() {
    setDe(para)
    setPara(de)
  }

  // Fator fracionado → vira 1/fator e inverte de/para (mantém fator inteiro).
  function normalizarFatorFracionado() {
    const f = parseNum(fator)
    if (f <= 0 || f >= 1) return
    setFator(num(1 / f))
    if (!umbsIguais) swapDePara()
  }

  function inverterDePara() {
    if (umbsIguais) return
    swapDePara()
    const f = parseNum(fator)
    if (f > 0) setFator(num(1 / f))
  }

  function sugerir() {
    if (!cb1Sel || !cb2Sel) return
    if (cb1Sel.qtdNF === 0) return

    if (umbsIguais) {
      // universal: fator = QtdNF / QtdPed
      const f = cb2Sel.qtdPendente !== 0 ? cb1Sel.qtdNF / cb2Sel.qtdPendente : 1
      setFator(num(f))
      return
    }

    // de/para: orientação base de=UMB do pedido, para=UMB da NF →
    // fator = QtdNF / QtdPed (1 [pedido] = fator [NF]).
    setDe(umbPed)
    setPara(umbNf)
    const f = cb2Sel.qtdPendente !== 0 ? cb1Sel.qtdNF / cb2Sel.qtdPendente : 1
    if (f > 0 && f < 1) {
      // mantém fator inteiro: inverte + swap
      setFator(num(1 / f))
      setDe(umbNf)
      setPara(umbPed)
    } else {
      setFator(num(f))
    }
  }

  // ── Vincular / Desvincular ─────────────────────────────────────────────────
  function vincular() {
    if (!cb1Sel || !cb2Sel) {
      setStatusCommit('⚠️ Selecione um item em cada lista.')
      return
    }
    const referencia = (cb1Sel.referencia ?? '').trim()
    const codigo = (cb2Sel.codigo ?? '').trim()
    if (!referencia || !codigo) {
      setStatusCommit('⚠️ Código ou referência vazios.')
      return
    }

    const f = parseNum(fator)
    const v: Vinculo = {
      id: 'v:' + cb1Sel.id + '>' + cb2Sel.id + ':' + Date.now(),
      nf: cb1Sel,
      pedido: cb2Sel,
      fator: f > 0 ? f : 1,
      umbsIguais,
      de: umbsIguais ? '' : de.trim(),
      para: umbsIguais ? '' : para.trim(),
    }

    setVinculos(prev => [...prev, v])
    setCb1All(prev => prev.filter(i => i.id !== cb1Sel.id))
    setCb2All(prev => prev.filter(i => i.id !== cb2Sel.id))
    setCb1SelId(null)
    setCb2SelId(null)
    setStatusCommit(null)
  }

  function desvincular(v: Vinculo) {
    setVinculos(prev => prev.filter(x => x.id !== v.id))
    setCb1All(prev => [...prev, v.nf])
    // Pedido sintético (vínculo pré-existente sem linha de pedido real) não
    // volta para a lista de candidatos.
    if (!v.pedido.id.startsWith('pre:')) setCb2All(prev => [...prev, v.pedido])
  }

  const novosVinculos = vinculos.filter(v => !v.preexistente)

  // ── Registrar: grava apenas os vínculos novos/refeitos numa única escrita ──
  async function registrar() {
    if (novosVinculos.length === 0) {
      setStatusCommit('⚠️ Nenhum vínculo novo para registrar.')
      return
    }
    if (!fornecedor.trim()) {
      setStatusCommit('⚠️ Fornecedor não identificado.')
      return
    }
    if (!itens) return

    setCommitando(true)
    setStatusCommit(null)
    try {
      const novoItens = aplicarVinculos(itens, fornecedor, novosVinculos)
      const usuario = config?.usuario ?? 'LNF-Web'
      const n = novosVinculos.length
      const msg = `[${usuario}] Mapeamento ${fornecedor} — ${n} vínculo(s)`
      await gravarItens(novoItens, msg)
      // Os que acabaram de ser gravados passam a contar como "já registrado".
      setVinculos(prev => prev.map(v => (v.preexistente ? v : { ...v, preexistente: true })))
      setStatusCommit(`✅ ${n} vínculo(s) registrado(s) com sucesso`)
    } catch (e) {
      setStatusCommit(`❌ ${(e as Error).message}`)
    } finally {
      setCommitando(false)
    }
  }

  // ── Guardas ────────────────────────────────────────────────────────────────
  if (!config) {
    return (
      <div className="p-6 text-center text-zinc-400 mt-12 space-y-2">
        <p className="text-4xl">🔑</p>
        <p>
          Configure o GitHub Token em <span className="text-white font-medium">Configurações</span>{' '}
          para começar.
        </p>
      </div>
    )
  }
  if (carregandoItens) {
    return <div className="p-6 text-center text-zinc-400 mt-12">Carregando itens.json...</div>
  }
  if (erroItens) {
    return (
      <div className="p-6 text-center text-red-400 mt-12">
        <p className="font-medium">Erro ao carregar itens</p>
        <p className="text-sm mt-1">{erroItens}</p>
      </div>
    )
  }

  // ── Entrada de JSON ────────────────────────────────────────────────────────
  if (!carregado) {
    return (
      <div className="p-4 space-y-3 max-w-2xl mx-auto">
        <div className="flex gap-2">
          <button
            onClick={() => void colarClipboard()}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white py-3.5 rounded-lg font-medium transition-colors"
          >
            📋 Colar JSON do Clipboard
          </button>
          <button
            onClick={() => setMostrarTextarea(v => !v)}
            title="Campo manual"
            className="px-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-lg transition-colors"
          >
            {mostrarTextarea ? '▲' : '▼'}
          </button>
        </div>

        {mostrarTextarea && (
          <>
            <textarea
              value={jsonTexto}
              onChange={e => setJsonTexto(e.target.value)}
              placeholder='{"Sucesso": true, "PedidosDict": {...}}'
              rows={8}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-green-500 resize-none"
            />
            <button
              onClick={() => parseJson(jsonTexto)}
              className="w-full bg-green-700 hover:bg-green-600 text-white py-2.5 rounded-lg font-medium transition-colors"
            >
              Carregar
            </button>
          </>
        )}

        {erroJson && (
          <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">
            ❌ {erroJson}
          </div>
        )}

        <p className="text-xs text-zinc-500 pt-2">
          Cole o JSON gerado pelo LNF-Coreon. O mapeamento cruza itens da NF "Sem pedido" com itens
          do pedido não consumidos (Qtd NF = 0).
        </p>
      </div>
    )
  }

  // ── Tela principal ─────────────────────────────────────────────────────────
  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex justify-between items-center gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold truncate">Mapeamento · {fornecedor || '(sem fornecedor)'}</h2>
        </div>
        <button onClick={limpar} className="text-zinc-500 hover:text-zinc-300 text-sm shrink-0">
          ✕ Limpar
        </button>
      </div>

      {/* Seletor de NF */}
      {nfs.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-zinc-400 shrink-0">NF:</label>
          <select
            value={nfSel ?? ''}
            onChange={e => {
              setNfSel(e.target.value || null)
              setCb1SelId(null)
              setCb2SelId(null)
            }}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
          >
            {nfs.map(nf => (
              <option key={nf} value={nf}>
                {rotuloNf(nf)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Listas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Lista
          titulo={`Itens da NF sem pedido (${cb1.length})`}
          vazio="Nenhum item sem pedido nesta NF."
        >
          {cb1.map(it => (
            <LinhaItem
              key={it.id}
              selecionado={it.id === cb1SelId}
              onClick={() => selecionarCb1(it)}
              titulo={it.descricao}
              sub={`${it.codigo || '—'} · ${it.referencia}`}
            />
          ))}
        </Lista>

        <Lista
          titulo={`Itens do pedido não consumidos (${cb2.length})`}
          vazio="Nenhum item de pedido pendente."
        >
          {cb2.map(it => (
            <LinhaItem
              key={it.id}
              selecionado={it.id === cb2SelId}
              onClick={() => setCb2SelId(it.id)}
              titulo={it.descricao}
              sub={`${it.codigo} · ${it.refPrimaria}`}
              destaque={it.semCadastro}
            />
          ))}
        </Lista>
      </div>

      {/* Detalhe + conversão */}
      {cb1Sel && cb2Sel && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 space-y-3">
          <div className="space-y-2">
            <CampoRO label="Descrição" valor={cb2Sel.descricao} />
            <div className="grid grid-cols-2 gap-2">
              <CampoRO label="Código (pedido)" valor={cb2Sel.codigo} mono />
              <CampoRO label="Referência (NF)" valor={cb1Sel.referencia} mono />
              <CampoRO label="Qtd pedido" valor={`${num(cb2Sel.qtdPendente)} ${cb2Sel.umbPed}`} />
              <CampoRO label="Qtd NF (orig.)" valor={`${num(cb1Sel.qtdNF)} ${cb1Sel.umbForn}`} />
              <div className="col-span-2">
                <CampoRO
                  label="Qtd NF (conv.)"
                  valor={conv ? `${num(conv.qtdNfConv)} ${cb2Sel.umbPed}*` : ''}
                />
              </div>
              <CampoRO
                label="Valor un pedido"
                valor={conv ? num(conv.valorPed) : ''}
                cor={conv?.diverge ? 'red' : 'green'}
              />
              <CampoRO
                label="Valor un NF (conv.)"
                valor={conv ? num(conv.valorNfConv) : ''}
                cor={conv?.diverge ? 'red' : 'green'}
              />
            </div>
          </div>

          {/* Conversão */}
          <div className="border-t border-zinc-800 pt-3 space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Fator</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fator}
                  onChange={e => setFator(e.target.value)}
                  onBlur={normalizarFatorFracionado}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      normalizarFatorFracionado()
                      e.currentTarget.blur()
                    }
                  }}
                  className="w-24 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-green-500"
                />
              </div>

              {mostrarDePara && (
                <>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">De</label>
                    <input
                      type="text"
                      value={de}
                      readOnly
                      className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Para</label>
                    <input
                      type="text"
                      value={para}
                      readOnly
                      className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-300"
                    />
                  </div>
                  <button
                    onClick={inverterDePara}
                    className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-sm px-3 py-1.5 rounded transition-colors"
                  >
                    Inverter
                  </button>
                </>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={sugerir}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white text-sm py-2 rounded-lg transition-colors"
              >
                Sugestão
              </button>
              <button
                onClick={vincular}
                className="flex-1 bg-green-600 hover:bg-green-500 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                Vincular ↓
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vínculos */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-300">
          Vínculos ({vinculos.length}
          {vinculos.length > novosVinculos.length
            ? ` · ${vinculos.length - novosVinculos.length} já registrado(s)`
            : ''}
          )
        </h3>
        {vinculos.length === 0 ? (
          <p className="text-xs text-zinc-500">
            Nenhum vínculo. Selecione um par e clique em Vincular.
          </p>
        ) : (
          <div className="space-y-1.5">
            {vinculos.map(v => (
              <div
                key={v.id}
                className={`border rounded-lg p-2.5 flex items-center justify-between gap-3 ${
                  v.preexistente ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-900 border-zinc-700'
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm truncate flex items-center gap-2">
                    {v.preexistente && (
                      <span className="text-[10px] uppercase tracking-wide bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded shrink-0">
                        já registrado
                      </span>
                    )}
                    <span className="truncate">{v.pedido.descricao}</span>
                  </p>
                  <p className="text-xs text-zinc-400 font-mono mt-0.5">
                    {v.pedido.codigo} · <span className="text-white">{v.nf.referencia}</span> · fator{' '}
                    {num(v.fator)} · {v.umbsIguais ? 'universal' : `${v.de} → ${v.para}`}
                  </p>
                </div>
                <button
                  onClick={() => desvincular(v)}
                  className="text-zinc-500 hover:text-red-400 text-sm shrink-0"
                  title="Desvincular"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status */}
      {statusCommit && (
        <div
          className={`rounded-lg p-3 text-sm ${
            statusCommit.startsWith('✅')
              ? 'bg-green-950 border border-green-800 text-green-300'
              : statusCommit.startsWith('⚠️')
                ? 'bg-yellow-950 border border-yellow-800 text-yellow-300'
                : 'bg-red-950 border border-red-800 text-red-300'
          }`}
        >
          {statusCommit}
        </div>
      )}

      {/* Registrar */}
      <button
        onClick={() => void registrar()}
        disabled={commitando || novosVinculos.length === 0}
        className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-lg transition-colors"
      >
        {commitando
          ? 'Registrando no GitHub...'
          : `Registrar ${novosVinculos.length} vínculo(s) no GitHub`}
      </button>
    </div>
  )
}

// ── Subcomponentes ───────────────────────────────────────────────────────────

function Lista({
  titulo,
  vazio,
  children,
}: {
  titulo: string
  vazio: string
  children: React.ReactNode
}) {
  const arr = Array.isArray(children) ? children : [children]
  const temItens = arr.some(Boolean) && arr.flat().length > 0
  return (
    <div>
      <p className="text-sm font-semibold mb-1.5">{titulo}</p>
      <div className="border border-zinc-800 rounded-lg max-h-64 overflow-y-auto divide-y divide-zinc-800">
        {temItens ? children : <p className="text-xs text-zinc-500 p-3">{vazio}</p>}
      </div>
    </div>
  )
}

function LinhaItem({
  selecionado,
  onClick,
  titulo,
  sub,
  destaque,
}: {
  selecionado: boolean
  onClick: () => void
  titulo: string
  sub: string
  destaque?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 transition-colors ${
        selecionado ? 'bg-green-900/40' : 'hover:bg-zinc-800/60'
      }`}
    >
      <p className="text-sm leading-snug truncate">{titulo}</p>
      <p className={`text-xs font-mono mt-0.5 ${destaque ? 'text-yellow-400' : 'text-zinc-400'}`}>
        {sub}
      </p>
    </button>
  )
}

// Campo de detalhe: input não-editável, mas selecionável/copiável.
function CampoRO({
  label,
  valor,
  mono,
  cor,
}: {
  label: string
  valor: string
  mono?: boolean
  cor?: 'red' | 'green'
}) {
  const corTexto = cor === 'red' ? 'text-red-400 font-semibold' : cor === 'green' ? 'text-green-400 font-semibold' : 'text-zinc-100'
  return (
    <div className="min-w-0">
      <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">{label}</label>
      <input
        readOnly
        value={valor}
        onFocus={e => e.currentTarget.select()}
        className={`w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-2 text-sm ${mono ? 'font-mono' : ''} ${corTexto} focus:outline-none focus:border-green-500`}
      />
    </div>
  )
}
