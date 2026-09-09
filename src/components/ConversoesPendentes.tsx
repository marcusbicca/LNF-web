import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import { QuemPediu } from './QuemPediu'
import { SupabaseService } from '../services/supabase'
import type { FatorEntry, ItensJson } from '../types'
import {
  convVazia,
  convsToJson,
  escreverConv,
  explicarMotivo,
  reconstruirConvs,
  resolverConv,
  sugerirConv,
  type ConvEditavel,
} from '../utils/conversao'

// ─────────────────────────────────────────────────────────────────────────────
// ConversoesPendentes — os materiais que o Executar marcou como suspeitos de
// cadastro errado, e a correção deles no mesmo lugar.
//
// ── DOIS tipos na mesma fila, e por quê ─────────────────────────────────────
//
// tipo='conversao'  quantidade E valor divergiram na mesma linha (abaixo).
// tipo='umb_migo'   a conta não fechou: depois da conversão a quantidade que
//                   iria para o MIGO ficou quebrada, ou o SAP recusou por
//                   unidade de medida.
//
// É a mesma pergunta com dois sintomas — "este material está cadastrado de um
// jeito que não fecha com a realidade" — e quem analisa é a mesma pessoa, com o
// mesmo material na frente. Duas telas obrigariam a olhar em dois lugares para
// descobrir que o problema era um só; muitas vezes ele É um só, porque a
// conversão errada é justamente o que produz a quantidade quebrada.
//
// Por isso o 'tipo' entra na CHAVE (fornecedor, codigo, referencia, tipo): o
// mesmo material pode estar nos dois, e um sobrescrevendo o outro perderia
// metade do caso.
//
// ── de onde vem ─────────────────────────────────────────────────────────────
//
// O Coreon grava em solicitacoes_conversao quando, na MESMA linha da NF, a
// quantidade diverge do saldo do pedido E o valor unitário diverge. Cada metade
// sozinha tem explicação inocente — entrega parcial, reajuste —, mas as duas
// juntas quase sempre são conversão: a NF veio em caixa e o pedido está em
// unidade, ou o contrário.
//
// Quem detecta é o EXECUTAR, e ele para o lançamento ali mesmo (bloqueio
// DifValorUN). Esta fila existe porque quem CADASTRA conversão não é quem lança,
// não está naquela tela, e sem isto a mesma divergência voltava toda semana.
//
// ── o cadastro é lido AQUI, e não vem no payload ────────────────────────────
//
// A solicitação carrega só o que é fato daquela NF: quantidades, valores,
// unidades e o fator que estava valendo na hora. As conversões cadastradas NÃO
// viajam com ela — se viajassem, seriam um retrato do cadastro de ontem, e
// quem abrisse a fila amanhã decidiria em cima dele. Elas são lidas do cache de
// materiais que o app já mantém, na hora de olhar.
//
// É a diferença entre esse fator antigo e o cadastro atual que explica o caso,
// e ela sumiria se os dois viessem da mesma fonte.
//
// ── por que os dois fatores aparecem lado a lado ────────────────────────────
//
// razão das quantidades = saldo ÷ qtd da NF
// razão dos valores     = valor da NF ÷ valor do pedido
//
// Numa conversão errada os dois dão o MESMO número — é a mesma caixa contada de
// dois jeitos. Quando só um bate, não é conversão: é preço errado, ou entrega
// parcial que por acaso caiu junto de um reajuste.
//
// Estas razões são de DIAGNÓSTICO e não são o fator que se grava. O do cadastro
// é NF ÷ saldo, com de/para orientados — ver sugerirConv. São da mesma NF e
// respondem perguntas diferentes; trocá-las grava a conversão invertida.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

function dbl(r: Row, k: string): number {
  const v = r[k]
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function txt(r: Row, k: string): string {
  const v = r[k]
  return v == null ? '' : String(v)
}

function num(d: number, casas = 4): string {
  if (!Number.isFinite(d)) return '—'
  return String(Math.round(d * 10 ** casas) / 10 ** casas)
}

// Acha a chave real (o JSON preserva a grafia de quem cadastrou; a solicitação
// traz a que veio da NF).
function acharChave(obj: Record<string, unknown> | undefined, alvo: string): string | null {
  if (!obj) return null
  const a = alvo.trim().toLowerCase()
  return Object.keys(obj).find(k => k.trim().toLowerCase() === a) ?? null
}

// Uma unidade alternativa que o SAP conhece para o material, como o Coreon leu
// da MARM. 'qtd' e 'inteiro' são conta DELE para a quantidade desta NF, não da
// MARM — e vêm NULOS quando não deu para calcular, que é o caso em que o SAP
// não tem a unidade que o Coreon está mandando. Nulo aqui é achado, não falha.
interface UmbSap {
  umb: string
  umrez: number
  umren: number
  qtd: number | null
  inteiro: boolean | null
}

function lerUmbsSap(v: unknown): UmbSap[] {
  let bruto = v
  if (typeof bruto === 'string') {
    try { bruto = JSON.parse(bruto) } catch { return [] }
  }
  if (!Array.isArray(bruto)) return []

  return bruto
    .map(x => {
      const o = (x ?? {}) as Row
      return {
        umb: txt(o, 'umb'),
        umrez: dbl(o, 'umrez'),
        umren: dbl(o, 'umren'),
        qtd: o.qtd == null ? null : dbl(o, 'qtd'),
        inteiro: typeof o.inteiro === 'boolean' ? o.inteiro : null,
      }
    })
    .filter(u => u.umb !== '')
}

interface Caso {
  row: Row
  fornecedor: string
  codigo: string
  referencia: string

  // Faz parte da CHAVE desde a 0028: o mesmo material pode ter os dois
  // problemas ao mesmo tempo — a conversão errada é, muitas vezes, o que
  // produz a quantidade fracionada. Sem ele aqui, os dois casos colidiriam na
  // seleção e o upsert de status não acharia constraint nenhuma.
  tipo: string
  ehUmbMigo: boolean

  // Só de tipo='umb_migo'. 'motivo' diz como o problema APARECEU (fracionada |
  // erro_sap); o tipo já disse o que corrigir.
  motivo: string
  umbMigoNaEpoca: string
  qtdConvertida: number
  erroSap: string
  umbsSap: UmbSap[]

  qtdNf: number
  qtdSaldo: number
  umbNf: string
  umbPedido: string
  valorNf: number
  valorPedido: number
  conversaoNaEpoca: string
  vezes: number
  nf: string
  pedido: string

  // Quem pediu. O Coreon já mandava os dois desde sempre (registrar_conversao_
  // suspeita recebe p_usuario e p_centro) — só não chegavam à tela.
  centro: string
  usuario: string

  // Os dois fatores da mesma suspeita. null quando o divisor é zero — e zero
  // aqui não é erro: é uma linha que não dá para julgar por este caminho.
  fatorQtd: number | null
  fatorValor: number | null
}

function montar(r: Row): Caso {
  const qtdNf = dbl(r, 'qtd_nf')
  const qtdSaldo = dbl(r, 'qtd_saldo')
  const valorNf = dbl(r, 'valor_nf')
  const valorPedido = dbl(r, 'valor_pedido')

  return {
    row: r,
    fornecedor: txt(r, 'fornecedor'),
    codigo: txt(r, 'codigo'),
    referencia: txt(r, 'referencia'),
    tipo: txt(r, 'tipo') || 'conversao',
    ehUmbMigo: (txt(r, 'tipo') || 'conversao') === 'umb_migo',
    motivo: txt(r, 'motivo'),
    umbMigoNaEpoca: txt(r, 'umb_migo'),
    qtdConvertida: dbl(r, 'qtd_convertida'),
    erroSap: txt(r, 'erro_sap'),
    umbsSap: lerUmbsSap(r['umbs_sap']),
    qtdNf,
    qtdSaldo,
    umbNf: txt(r, 'umb_nf'),
    umbPedido: txt(r, 'umb_pedido'),
    valorNf,
    valorPedido,
    conversaoNaEpoca: txt(r, 'conversao'),
    vezes: Math.max(1, Math.round(dbl(r, 'vezes'))),
    nf: txt(r, 'nf'),
    pedido: txt(r, 'pedido'),
    centro: txt(r, 'centro'),
    usuario: txt(r, 'usuario'),
    fatorQtd: qtdNf !== 0 ? qtdSaldo / qtdNf : null,
    fatorValor: valorPedido !== 0 ? valorNf / valorPedido : null,
  }
}

// A mesma tolerância por item que o Executar usa para bloquear (TolValorItem
// padrão da empresa). Subiu para cá porque agora dois lugares dependem dela: a
// simulação da tela e o encerramento automático.
const TOL_VALOR_ITEM = 0.5

// ── o caso já foi resolvido POR FORA? ────────────────────────────────────────
//
// Acontece o tempo todo: a pessoa corrige a conversão direto no mapeamento, ou
// numa planilha, e a suspeita continua na fila esperando alguém clicar em
// "corrigida". A fila enche de trabalho já feito, e o que sobra de verdade some
// no meio.
//
// ── por que NÃO é "a sugestão já existe no item" ────────────────────────────
//
// Essa é a leitura natural, e ela erra num caso que acontece de verdade: a
// conversão sugerida EXISTE, mas está depois de outra que casa com as mesmas
// unidades. Como vale a primeira que casa (ver resolverConv), ela nunca é
// alcançada — o cadastro continua quebrado, e um encerramento por comparação de
// texto arquivaria um problema real, que é o pior desfecho possível aqui.
//
// O que se pergunta é a pergunta que CRIOU o caso: com o cadastro de agora, os
// números daquela nota ainda divergem? É a mesma conta da simulação que a tela
// já mostra — se ela ficaria verde, acabou. Nenhum critério novo foi inventado,
// e é por isso que dá para confiar no automático sem revisar um a um.
//
// null = não dá para afirmar (material ou referência não estão no cadastro que
// esta máquina carregou). Na dúvida o caso FICA: fila com item a mais é
// incômodo, fila com item a menos é problema perdido.
function resolvidoNoCadastro(c: Caso, itens: ItensJson | null): boolean | null {
  // Só o tipo 'conversao'. O 'umb_migo' nasce de outro sintoma — quantidade que
  // ficou quebrada depois de converter, ou recusa do SAP por unidade — e nenhum
  // dos dois se confere relendo o cadastro. Encerrar por analogia seria chutar.
  if (c.tipo !== 'conversao') return false
  if (!itens) return null

  const kForn = acharChave(itens as unknown as Record<string, unknown>, c.fornecedor)
  const doForn = kForn ? (itens as ItensJson)[kForn] : undefined
  const kCod = acharChave(doForn as unknown as Record<string, unknown>, c.codigo)
  const item = kCod && doForn ? doForn[kCod] : undefined
  if (!item) return null

  const kRef = acharChave(item.referencias as unknown as Record<string, unknown>, c.referencia)
  if (!kRef) return null

  const convs = reconstruirConvs(item.referencias[kRef] as FatorEntry[] | undefined)
  if (convs.length === 0) return false

  const venc = resolverConv(convs, c.umbNf, c.umbPedido)
  const conversao = venc ? venc.conversao : 1
  if (!Number.isFinite(conversao) || conversao === 0) return false

  const qtdSap = c.qtdNf / conversao
  const dif = Math.abs((c.valorNf * conversao - c.valorPedido) * qtdSap)
  if (!Number.isFinite(dif)) return null

  return dif <= TOL_VALOR_ITEM
}

// Os dois fatores concordam? Tolerância relativa: 12 contra 12,0001 é o mesmo
// número contado de dois jeitos, e exigir igualdade exata reprovaria todos os
// casos reais — as duas contas passam por arredondamento de moeda.
function concordam(c: Caso): boolean {
  if (c.fatorQtd == null || c.fatorValor == null) return false
  const maior = Math.max(Math.abs(c.fatorQtd), Math.abs(c.fatorValor))
  if (maior === 0) return false
  return Math.abs(c.fatorQtd - c.fatorValor) / maior < 0.02
}

export function ConversoesPendentes() {
  const { config, itens, gravarItens } = useApp()

  const svc = useMemo(
    () => (config ? new SupabaseService(config.paUrl, config.usuario) : null),
    [config],
  )

  const [casos, setCasos] = useState<Caso[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)
  const [selId, setSelId] = useState<string | null>(null)

  // ── TODAS as conversões da referência, e não só a primeira ────────────────
  //
  // Era um único trio de/para/fator. A referência, porém, guarda uma LISTA — o
  // ExecutarService percorre e usa a primeira que casa com as unidades da nota.
  // Editando só a primeira e gravando uma lista de um elemento, corrigir a
  // conversão de caixa APAGAVA a de caixote, sem aviso e sem aparecer no diff.
  //
  // Agora a lista inteira entra na tela e a lista inteira sai dela.
  const [convs, setConvs] = useState<ConvEditavel[]>([])

  // A simulação. Nasce com os números da NF que gerou o caso e é editável: a
  // pergunta que se faz aqui não é só "o que aconteceu naquela nota", é "e se
  // fosse outra quantidade, este cadastro aguenta?".
  const [simQtd, setSimQtd] = useState('')
  const [simValorNf, setSimValorNf] = useState('')
  const [simValorPed, setSimValorPed] = useState('')
  const [simUmbNf, setSimUmbNf] = useState('')
  const [simUmbPed, setSimUmbPed] = useState('')

  // Edição da UmbMigo (casos tipo='umb_migo'). Separada do fator de propósito:
  // são duas correções diferentes no mesmo material, e um campo só faria uma
  // parecer a outra.
  const [umbMigo, setUmbMigo] = useState('')

  const chave = (c: Caso) => `${c.fornecedor} ${c.codigo} ${c.referencia} ${c.tipo}`
  const sel = useMemo(() => casos.find(c => chave(c) === selId) ?? null, [casos, selId])

  const carregar = useCallback(async () => {
    if (!svc) return
    setCarregando(true)
    setErro(null)
    try {
      const rows = await svc.lerLinhas('solicitacoes_conversao', {
        order: 'vezes.desc,updated_at.desc',
        filtros: 'status=eq.pendente',
        limit: 200,
      })
      setCasos(rows.map(montar))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [svc])

  useEffect(() => {
    if (config?.paUrl && aberto) void carregar()
  }, [config?.paUrl, aberto, carregar])

  // ── encerrar sozinho o que já foi corrigido por fora ──────────────────────
  //
  // Roda depois de cada carga, sobre a lista inteira — e não só sobre o caso
  // aberto. Se fosse só no selecionado, a fila continuaria mentindo sobre o
  // próprio tamanho: a pessoa veria "23 pendentes" e descobriria uma a uma que
  // metade já estava feita.
  //
  // ── por que ele avisa, em vez de só sumir ────────────────────────────────
  //
  // É uma escrita que tira coisa da fila de alguém. Fazer isso em silêncio é
  // como o encerramento automático perde a confiança: numa hora ele acerta e
  // ninguém vê, na outra ele erra e ninguém vê também. O nome de cada caso
  // encerrado fica na tela, e quem discordar reabre no Supabase.
  //
  // ── o ref não é otimização ───────────────────────────────────────────────
  //
  // Encerrar dispara um carregar(), que dispara este efeito de novo. Sem
  // memória do que já foi processado, dois casos viram um laço. A chave é a
  // mesma da seleção, então um caso reaberto à mão (com os números mudados)
  // seria reavaliado — o que está certo.
  const jaAvaliados = useRef<Set<string>>(new Set())
  const [encerradosSozinho, setEncerradosSozinho] = useState<string[]>([])

  useEffect(() => {
    if (!svc || !itens || casos.length === 0) return

    const alvos = casos.filter(
      c => !jaAvaliados.current.has(chave(c)) && resolvidoNoCadastro(c, itens) === true,
    )
    if (alvos.length === 0) {
      casos.forEach(c => jaAvaliados.current.add(chave(c)))
      return
    }

    let cancelado = false
    void (async () => {
      const fechados: string[] = []

      for (const c of alvos) {
        jaAvaliados.current.add(chave(c))
        try {
          await svc.salvarLinha(
            'solicitacoes_conversao',
            {
              fornecedor: c.fornecedor,
              codigo: c.codigo,
              referencia: c.referencia,
              tipo: c.tipo,
              status: 'corrigida',
            },
            'fornecedor,codigo,referencia,tipo',
          )
          fechados.push(`${c.codigo} · ${c.referencia}`)
        } catch {
          // Falhou? O caso fica na fila e alguém decide à mão. Não vale
          // interromper os outros nem gritar: o pior que acontece é a pessoa
          // ver um item que ela já resolveu, que é exatamente o de antes.
        }
      }

      if (cancelado || fechados.length === 0) return
      setEncerradosSozinho(prev => [...prev, ...fechados])
      setCasos(prev => prev.filter(c => !alvos.some(a => chave(a) === chave(c))))
      if (selId && alvos.some(a => chave(a) === selId)) setSelId(null)
    })()

    return () => { cancelado = true }
  }, [casos, itens, svc, selId])

  // ── o cadastro ATUAL do material selecionado ───────────────────────────────
  //
  // Do cache de materiais, não da solicitação. Recalculado a cada seleção, e de
  // novo depois de gravar — é o que garante que o que está na tela é o que está
  // no banco agora.
  const cadastro = useMemo(() => {
    if (!sel || !itens) return null

    const kForn = acharChave(itens as unknown as Record<string, unknown>, sel.fornecedor)
    const doForn = kForn ? (itens as ItensJson)[kForn] : undefined
    const kCod = acharChave(doForn as unknown as Record<string, unknown>, sel.codigo)
    const item = kCod && doForn ? doForn[kCod] : undefined

    if (!item) return { existe: false, descricao: '', umbMigo: '', refs: [] as Array<{ ref: string; conv: string; alvo: boolean }>, atual: undefined }

    const kRef = acharChave(item.referencias as unknown as Record<string, unknown>, sel.referencia)

    return {
      existe: true,
      descricao: item.descricao ?? '',
      umbMigo: item.UmbMigo ?? '',
      refs: Object.keys(item.referencias ?? {}).map(r => ({
        ref: r,
        conv: escreverConv(item.referencias[r]),
        alvo: kRef != null && r === kRef,
      })),
      atual: kRef ? item.referencias[kRef] : undefined,
      kForn,
      kCod,
      kRef,
    }
  }, [sel, itens])

  // Ao trocar de caso, o formulário passa a mostrar o que está cadastrado —
  // TODAS as conversões da referência, na ordem em que estão gravadas. A ordem
  // não é enfeite: é ela que decide qual vale (ver resolverConv).
  useEffect(() => {
    setConvs(reconstruirConvs(cadastro?.atual as FatorEntry[] | undefined))
  }, [cadastro?.atual, selId])

  // A simulação começa nos números da nota que gerou o caso. Semeada por CASO
  // (e não a cada mudança do cadastro) pelo mesmo motivo da UmbMigo logo abaixo:
  // gravar uma conversão não pode apagar o cenário que a pessoa estava testando.
  const semeadoSim = useRef<string | null>(null)
  useEffect(() => {
    if (selId == null || !sel) { semeadoSim.current = null; return }
    if (semeadoSim.current === selId) return
    semeadoSim.current = selId

    setSimQtd(String(sel.qtdNf))
    setSimValorNf(String(sel.valorNf))
    setSimValorPed(String(sel.valorPedido))
    setSimUmbNf(sel.umbNf)
    setSimUmbPed(sel.umbPedido)
  }, [selId, sel])

  // ── a UmbMigo escolhida sobrevive a gravar a conversão ───────────────────
  //
  // O campo é semeado com o que está cadastrado UMA vez por caso, e não a cada
  // mudança do cadastro. A diferença aparece no fluxo real do tipo unidade:
  // escolher "CX" na lista da MARM, gravar a conversão que dá fator a ela, e
  // ver o campo voltar para vazio porque o cadastro mudou — apagando justamente
  // a escolha que ainda ia ser gravada.
  //
  // O ref, e não um estado, porque isto não desenha nada: é memória de "já
  // semeei este caso".
  const semeado = useRef<string | null>(null)
  useEffect(() => {
    if (selId == null) { semeado.current = null; return }
    if (!cadastro?.existe) return
    if (semeado.current === selId) return
    semeado.current = selId
    setUmbMigo(cadastro.umbMigo ?? '')
  }, [selId, cadastro])

  // ── a UmbMigo escolhida vai converter alguma coisa? ───────────────────────
  //
  // O Coreon não deduz fator: ele procura, entre as conversões CADASTRADAS
  // daquela referência, uma que cite a UmbMigo em 'de' ou 'para' (é o
  // ResolverFatorUmbMigo). Não achando, o fator é 1 — a unidade muda na tela e
  // no MIGO, e a quantidade vai inteira do jeito que estava.
  //
  // Isso é um acidente caro e silencioso: lançar 12 CX onde eram 12 UN. Então a
  // tela pergunta antes, em vez de deixar descobrir depois.
  // Olha o que está NA TELA, não o que está gravado: quem acabou de digitar a
  // conversão que dá fator à UmbMigo precisa ver o aviso sumir na hora, e não
  // depois de gravar. Ler do cadastro fazia a tela avisar sobre um estado que a
  // pessoa já tinha corrigido na frente dela.
  const avisoUmbMigo = useMemo(() => {
    const u = umbMigo.trim()
    if (!u) return ''

    const liga = convs.some(
      c =>
        (c.de ?? '').trim().toLowerCase() === u.toLowerCase() ||
        (c.para ?? '').trim().toLowerCase() === u.toLowerCase(),
    )
    if (liga) return ''

    return `Nenhuma conversão desta referência cita "${u}". A unidade vai mudar, mas a QUANTIDADE não será convertida — cadastre a conversão junto, ou o MIGO recebe o número que já estava.`
  }, [umbMigo, convs])

  // ── a simulação ────────────────────────────────────────────────────────────
  //
  // Duas perguntas de uma vez: QUAL conversão o Coreon vai escolher para estas
  // unidades, e o que sai dela. A escolha é o que faltava — a tela mostrava um
  // fator sem dizer se era aquele que ia valer, e com mais de uma conversão na
  // referência isso é adivinhação.
  //
  // As contas são as do ExecutarService, e as mesmas do painel do mapeamento:
  //   qtdSAP     = qtd da NF ÷ conversao
  //   valor conv = valor UN da NF × conversao
  //   diverge    = |valor conv − valor do pedido| × qtdSAP  >  tolerância
  const sim = useMemo(() => {
    const qtd = Number(String(simQtd).replace(',', '.'))
    const vNf = Number(String(simValorNf).replace(',', '.'))
    const vPed = Number(String(simValorPed).replace(',', '.'))
    if (!Number.isFinite(qtd)) return null

    const venc = resolverConv(convs, simUmbNf, simUmbPed)
    const conversao = venc ? venc.conversao : 1

    const qtdSap = conversao !== 0 ? qtd / conversao : qtd
    const valorConv = (Number.isFinite(vNf) ? vNf : 0) * conversao
    const dif = Math.abs((valorConv - (Number.isFinite(vPed) ? vPed : 0)) * qtdSap)

    // TOL_VALOR_ITEM vem da empresa do centro e pode ser outra em outra régua —
    // por isso o rótulo na tela diz "referência", e não "regra". É a MESMA
    // constante que o encerramento automático usa: se os dois divergissem, a
    // tela mostraria vermelho num caso que ela mesma acabou de arquivar.
    return { venc, conversao, qtdSap, valorConv, dif, diverge: dif > TOL_VALOR_ITEM }
  }, [convs, simQtd, simValorNf, simValorPed, simUmbNf, simUmbPed])

  // Preenche fator e unidades pela MESMA regra do "Sugerir" do mapeamento.
  //
  // Repare que o número aqui NÃO é o "fator pela quantidade" mostrado acima: os
  // dois vêm da mesma NF mas respondem perguntas diferentes. Aquele é razão de
  // diagnóstico (saldo ÷ NF, para comparar com a razão dos valores); este é o
  // fator do CADASTRO (NF ÷ saldo, com de/para orientados). Foi confundir os
  // dois que fez a primeira versão desta tela sugerir o sentido invertido.
  function sugerir(i: number) {
    if (!sel) return
    const alvo = convs[i]
    if (!alvo) return

    const s = sugerirConv(sel.qtdNf, sel.qtdSaldo, sel.umbNf, sel.umbPedido, alvo.umbsIguais)
    if (!s) return

    mexer(i, {
      fator: Math.round(s.fator * 1e6) / 1e6,
      ...(s.umbsIguais ? {} : { de: s.de, para: s.para }),
    })
  }

  // ── mexer numa linha da lista ─────────────────────────────────────────────
  //
  // Sempre por CÓPIA, nunca alterando o objeto no lugar: o React compara por
  // identidade, e mudar o item dentro do array deixaria a tela mostrando o
  // valor velho até alguma outra coisa forçar o redesenho.
  function mexer(i: number, campos: Partial<ConvEditavel>) {
    setConvs(prev => prev.map((c, k) => (k === i ? { ...c, ...campos } : c)))
  }

  function adicionar() {
    setConvs(prev => [...prev, convVazia()])
  }

  function remover(i: number) {
    setConvs(prev => prev.filter((_, k) => k !== i))
  }

  // A ORDEM decide qual conversão vale — é a primeira que casa que ganha. Então
  // reordenar não é estética: é a forma de dizer "esta tem precedência sobre
  // aquela" quando as duas poderiam casar (uma universal antes de uma
  // direcional, por exemplo, faz a direcional nunca ser alcançada).
  function subir(i: number) {
    if (i <= 0) return
    setConvs(prev => {
      const n = [...prev]
      ;[n[i - 1], n[i]] = [n[i], n[i - 1]]
      return n
    })
  }

  // Inverte o sentido: troca de/para e o fator vira o seu inverso. O fato
  // descrito é o mesmo — "CX>UN 12" e "UN>CX 0,0833" —, mas só o primeiro se
  // confere de cabeça.
  function inverter(i: number) {
    const c = convs[i]
    if (!c || c.umbsIguais) return
    mexer(i, { de: c.para, para: c.de, fator: c.fator > 0 ? 1 / c.fator : c.fator })
  }

  async function marcar(novoStatus: 'corrigida' | 'ignorada') {
    if (!svc || !sel) return
    setStatus(null)
    try {
      await svc.salvarLinha(
        'solicitacoes_conversao',
        {
          fornecedor: sel.fornecedor,
          codigo: sel.codigo,
          referencia: sel.referencia,
          tipo: sel.tipo,
          status: novoStatus,
        },
        'fornecedor,codigo,referencia,tipo',
      )
      setStatus(novoStatus === 'corrigida' ? '✅ Marcada como corrigida.' : '✅ Ignorada.')
      setSelId(null)
      await carregar()
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    }
  }

  // Grava a conversão no material e só então marca a solicitação. Nessa ordem
  // de propósito: marcar primeiro e falhar na gravação tiraria o caso da fila
  // sem ter corrigido nada — e ninguém saberia que ficou por fazer.
  //
  // 'encerrar' existe por causa do caso de UNIDADE: lá a conversão não é o
  // conserto, é o INSUMO dele — é dela que o Coreon tira o fator da UmbMigo.
  // Encerrar o caso ao gravá-la fecharia a tela antes de a UmbMigo ser
  // escolhida, que é a metade que importa.
  async function gravar(encerrar = true) {
    if (!sel || !itens || !cadastro?.existe || !cadastro.kForn || !cadastro.kCod) return
    setStatus(null)

    // Recusa ANTES de gravar, e apontando a linha: uma lista com cinco
    // conversões e uma inválida precisa dizer QUAL, senão a pessoa confere as
    // cinco. O silêncio aqui seria pior que o erro — o convsToJson descartaria
    // a linha ruim e gravaria as outras, e ninguém saberia que faltou uma.
    for (let i = 0; i < convs.length; i++) {
      const c = convs[i]
      if (!Number.isFinite(c.fator) || c.fator <= 0) {
        setStatus(`❌ Conversão ${i + 1}: fator tem que ser um número maior que zero.`)
        return
      }
      if (!c.umbsIguais && (!c.de.trim() || !c.para.trim())) {
        setStatus(`❌ Conversão ${i + 1}: direcional precisa das duas unidades.`)
        return
      }
    }

    try {
      const novo: ItensJson = JSON.parse(JSON.stringify(itens))
      const item = novo[cadastro.kForn][cadastro.kCod]

      // A chave da referência é a que já existe no cadastro; só quando ela
      // ainda não existe é que a grafia da NF vira chave nova.
      const alvo = cadastro.kRef ?? sel.referencia
      item.referencias = item.referencias ?? {}

      // A LISTA INTEIRA, e não uma conversão só. Substituir continua sendo a
      // operação certa — mas agora o que substitui já contém tudo o que havia,
      // porque tudo o que havia entrou na tela. Era essa a metade que faltava:
      // gravar uma lista de um elemento apagava as demais.
      item.referencias[alvo] = convsToJson(convs)

      await gravarItens(novo, `conversões de ${sel.fornecedor}/${sel.codigo} (${alvo})`)

      if (!encerrar) {
        setStatus('✅ Conversão gravada. O caso segue aberto — grave a UmbMigo para encerrar.')
        return
      }

      await svc?.salvarLinha(
        'solicitacoes_conversao',
        {
          fornecedor: sel.fornecedor,
          codigo: sel.codigo,
          referencia: sel.referencia,
          tipo: sel.tipo,
          status: 'corrigida',
        },
        'fornecedor,codigo,referencia,tipo',
      )

      setStatus('✅ Conversão gravada e solicitação encerrada.')
      setSelId(null)
      await carregar()
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    }
  }

  // Grava a UmbMigo no material e só então encerra a solicitação — mesma ordem
  // do gravar() acima, e pelo mesmo motivo: encerrar primeiro e falhar na
  // gravação tiraria o caso da fila sem ter corrigido nada.
  //
  // Campo vazio APAGA a UmbMigo. É uma correção legítima: material que ganhou
  // UmbMigo por engano lança na unidade errada toda vez, e a forma de desfazer
  // isso tem de existir aqui, não só no mapeamento.
  async function gravarUmbMigo() {
    if (!sel || !itens || !cadastro?.existe || !cadastro.kForn || !cadastro.kCod) return
    setStatus(null)

    const u = umbMigo.trim()
    try {
      const novo: ItensJson = JSON.parse(JSON.stringify(itens))
      const item = novo[cadastro.kForn][cadastro.kCod]
      if (u) item.UmbMigo = u
      else delete item.UmbMigo

      await gravarItens(
        novo,
        u
          ? `UmbMigo ${u} de ${sel.fornecedor}/${sel.codigo}`
          : `UmbMigo removida de ${sel.fornecedor}/${sel.codigo}`,
      )

      await svc?.salvarLinha(
        'solicitacoes_conversao',
        {
          fornecedor: sel.fornecedor,
          codigo: sel.codigo,
          referencia: sel.referencia,
          tipo: sel.tipo,
          status: 'corrigida',
        },
        'fornecedor,codigo,referencia,tipo',
      )

      setStatus('✅ UmbMigo gravada e solicitação encerrada.')
      setSelId(null)
      await carregar()
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <section className="border border-zinc-800 rounded-lg mb-3">
      <button
        onClick={() => setAberto(a => !a)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold">
          Cadastros suspeitos
          {casos.length > 0 && (
            <span className="ml-2 text-xs font-mono text-amber-400">{casos.length}</span>
          )}
        </span>
        <span className="text-zinc-500 text-xs">{aberto ? '▾' : '▸'}</span>
      </button>

      {aberto && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-zinc-500">
            <strong className="text-zinc-400">conversão</strong>: quantidade <em>e</em> valor
            divergiram na mesma linha da NF — as duas juntas costumam ser conversão, cada uma
            sozinha, não.{' '}
            <strong className="text-zinc-400">unidade</strong>: a conta não fechou, e a unidade
            de lançamento é que está errada.
          </p>

          {erro && <p className="text-xs text-red-400 font-mono">{erro}</p>}
          {status && <p className="text-xs font-mono">{status}</p>}

          {/* O que o encerramento automático tirou da fila. Some só quando a
              pessoa fecha: uma mensagem que desaparece sozinha é a mesma coisa
              que não ter avisado. */}
          {encerradosSozinho.length > 0 && (
            <div className="text-xs rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-emerald-300">
                  {encerradosSozinho.length === 1
                    ? '1 caso já estava corrigido no cadastro e foi encerrado:'
                    : `${encerradosSozinho.length} casos já estavam corrigidos no cadastro e foram encerrados:`}
                </p>
                <button
                  onClick={() => setEncerradosSozinho([])}
                  className="text-zinc-500 hover:text-zinc-300 shrink-0"
                  title="Dispensar"
                >
                  ✕
                </button>
              </div>
              <ul className="mt-1 font-mono text-emerald-400/80 space-y-0.5">
                {encerradosSozinho.map(t => <li key={t}>· {t}</li>)}
              </ul>
              <p className="mt-1.5 text-zinc-500">
                A conversão que vale hoje já não faz os números daquela nota divergirem.
                Discordando, é só reabrir a linha em <code>solicitacoes_conversao</code>.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => void carregar()}
              disabled={carregando}
              className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
            >
              {carregando ? 'Carregando…' : 'Recarregar'}
            </button>
          </div>

          {casos.length === 0 && !carregando && (
            <p className="text-xs text-zinc-600">Nenhum cadastro suspeito pendente.</p>
          )}

          <ul className="space-y-1">
            {casos.map(c => {
              const id = chave(c)
              const bate = concordam(c)
              return (
                <li key={id}>
                  <button
                    onClick={() => setSelId(id === selId ? null : id)}
                    className={`w-full text-left px-3 py-2 rounded border text-xs ${
                      id === selId
                        ? 'border-green-600 bg-zinc-900'
                        : 'border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{c.fornecedor}/{c.codigo || '—'}</span>
                      <span className="text-zinc-500">{c.referencia}</span>
                      <span
                        className={`px-1.5 rounded text-[10px] uppercase tracking-wide ${
                          c.ehUmbMigo ? 'bg-sky-900 text-sky-300' : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {c.ehUmbMigo ? 'unidade' : 'conversão'}
                      </span>
                      {c.vezes > 1 && (
                        <span className="text-amber-400 font-mono">{c.vezes}×</span>
                      )}
                      {!c.ehUmbMigo && bate && <span className="text-green-400">razões batem</span>}
                    </div>
                    <div className="text-zinc-500 mt-0.5">
                      {c.ehUmbMigo ? (
                        <>
                          {num(c.qtdConvertida)} {c.umbPedido || c.umbNf} — não fecha em inteiro
                          {c.umbMigoNaEpoca && ` · UmbMigo ${c.umbMigoNaEpoca}`}
                        </>
                      ) : (
                        <>
                          NF {num(c.qtdNf)} {c.umbNf} contra saldo {num(c.qtdSaldo)} {c.umbPedido}
                          {' · '}
                          {num(c.valorNf)} contra {num(c.valorPedido)}
                        </>
                      )}
                    </div>
                    {/* De onde veio. Na LISTA e não só no detalhe: uma fila de
                        vinte casos costuma ser triada por origem antes de ser
                        analisada uma a uma. */}
                    <div className="mt-1">
                      <QuemPediu usuario={c.usuario} centro={c.centro} />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>

          {sel && (
            <div className="border border-zinc-800 rounded p-3 space-y-3">
              {/* ── o que aconteceu naquela NF ─────────────────────────── */}
              {sel.ehUmbMigo ? (
                <div className="text-xs space-y-1">
                  <div className="font-semibold text-zinc-300">Naquela NF</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-zinc-400">
                    <span>NF {sel.nf || '—'}</span>
                    <span>pedido {sel.pedido || '—'}</span>
                    <span className="col-span-2 text-amber-400">
                      quantidade: {num(sel.qtdConvertida)} {sel.umbPedido || sel.umbNf}
                    </span>
                    <span className="col-span-2">
                      UmbMigo na época: {sel.umbMigoNaEpoca || '(nenhuma)'}
                    </span>
                    <span className="col-span-2">
                      conversão valendo na época: {sel.conversaoNaEpoca || '(nenhuma)'}
                    </span>
                    {sel.erroSap && (
                      <span className="col-span-2 text-red-400">SAP: {sel.erroSap}</span>
                    )}
                  </div>
                  <p className="text-zinc-500">
                    {sel.motivo === 'erro_sap'
                      ? 'O SAP recusou o lançamento por unidade de medida — não há o que deduzir, ele disse.'
                      : 'Depois da conversão a quantidade ficou quebrada. Meia caixa não existe no estoque: se a conta deu isso, a unidade de lançamento é que está errada.'}
                  </p>
                </div>
              ) : (
                <div className="text-xs space-y-1">
                  <div className="font-semibold text-zinc-300">Naquela NF</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-zinc-400">
                    <span>NF {sel.nf || '—'}</span>
                    <span>pedido {sel.pedido || '—'}</span>
                    <span>razão das quantidades: {num(sel.fatorQtd ?? NaN)}</span>
                    <span>razão dos valores: {num(sel.fatorValor ?? NaN)}</span>
                    <span className="col-span-2">
                      conversão valendo na época: {sel.conversaoNaEpoca || '(nenhuma)'}
                    </span>
                  </div>
                  <p className="text-zinc-500">
                    {concordam(sel)
                      ? 'As duas razões dão o mesmo número — é a mesma caixa contada de dois jeitos, o que aponta para conversão.'
                      : 'As razões NÃO batem. Provavelmente não é conversão: veja preço, ou entrega parcial junto de reajuste.'}
                  </p>
                </div>
              )}

              {/* ── o que o SAP tem para o material ────────────────────── */}
              {sel.ehUmbMigo && (
                <div className="text-xs space-y-1">
                  <div className="font-semibold text-zinc-300">Unidades que o SAP tem (MARM)</div>

                  {sel.umbsSap.length === 0 && (
                    <p className="text-zinc-600">
                      A MARM não respondeu para este material — dá para corrigir mesmo assim,
                      só não há lista para escolher.
                    </p>
                  )}

                  <ul className="space-y-1">
                    {sel.umbsSap.map(u => (
                      <li key={u.umb}>
                        <button
                          onClick={() => setUmbMigo(u.umb)}
                          className={`w-full text-left px-2 py-1 rounded border font-mono ${
                            u.umb.trim().toLowerCase() === umbMigo.trim().toLowerCase()
                              ? 'border-green-600 bg-zinc-900'
                              : u.inteiro
                                ? 'border-green-900 hover:border-green-700'
                                : 'border-zinc-800 hover:border-zinc-700'
                          }`}
                        >
                          <span className="text-zinc-300">{u.umb}</span>
                          <span className="text-zinc-600"> ({num(u.umrez)}:{num(u.umren)})</span>
                          <span className="text-zinc-500">
                            {' · '}
                            {u.qtd == null ? 'sem base para calcular' : `${num(u.qtd)} nesta NF`}
                          </span>
                          {u.inteiro === true && <span className="text-green-400"> ✓ fecha</span>}
                          {u.inteiro === false && <span className="text-zinc-600"> quebra</span>}
                        </button>
                      </li>
                    ))}
                  </ul>

                  <p className="text-zinc-500">
                    Clique para preencher o campo abaixo. O fator do SAP está aí como
                    informação, não como verdade — quem calcula é a conversão cadastrada. Se os
                    dois discordarem, isso já é um caso.
                  </p>
                </div>
              )}

              {/* ── o que está cadastrado AGORA ────────────────────────── */}
              <div className="text-xs space-y-1">
                <div className="font-semibold text-zinc-300">Cadastrado agora</div>
                {!itens && <p className="text-zinc-500">Carregando materiais…</p>}
                {itens && !cadastro?.existe && (
                  <p className="text-amber-400">
                    Material não encontrado no cadastro ({sel.fornecedor}/{sel.codigo}).
                  </p>
                )}
                {cadastro?.existe && (
                  <>
                    <div className="text-zinc-400">{cadastro.descricao || '(sem descrição)'}</div>
                    <div className="font-mono text-zinc-500">
                      UmbMigo: {cadastro.umbMigo || '(nenhuma)'}
                    </div>
                    <ul className="font-mono text-zinc-400">
                      {cadastro.refs.length === 0 && <li className="text-zinc-600">(sem referências)</li>}
                      {cadastro.refs.map(r => (
                        <li key={r.ref} className={r.alvo ? 'text-green-400' : ''}>
                          {r.ref} → {r.conv || '(sem conversão)'}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {/* ── correção da UNIDADE ───────────────────────────────── */}
              {cadastro?.existe && sel.ehUmbMigo && (
                <div className="text-xs space-y-2">
                  <div className="font-semibold text-zinc-300">
                    Corrigir a UmbMigo de {sel.codigo}
                  </div>

                  <p className="text-zinc-500">
                    A UmbMigo vale para o MATERIAL inteiro, não só para esta referência — é a
                    unidade em que o MIGO vai receber o lançamento.
                  </p>

                  <div className="flex items-center gap-2">
                    <input
                      value={umbMigo}
                      onChange={e => setUmbMigo(e.target.value)}
                      placeholder="ex. CX"
                      className="w-28 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 font-mono"
                    />
                    <button
                      onClick={() => void gravarUmbMigo()}
                      className="px-3 py-1.5 rounded bg-green-700 hover:bg-green-600 font-medium"
                    >
                      {umbMigo.trim() ? 'Gravar UmbMigo' : 'Remover UmbMigo'}
                    </button>
                  </div>

                  {avisoUmbMigo && <p className="text-amber-400">{avisoUmbMigo}</p>}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => void marcar('corrigida')}
                      className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700"
                    >
                      Já corrigi por fora
                    </button>
                    <button
                      onClick={() => void marcar('ignorada')}
                      className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700"
                    >
                      Não é problema de unidade
                    </button>
                  </div>
                </div>
              )}

              {/* ── correção da CONVERSÃO ─────────────────────────────── */}
              {/*
                Aparece nos DOIS tipos. No caso de unidade ela não é o conserto,
                é o insumo dele: o Coreon só converte a quantidade para a UmbMigo
                se houver, nas conversões DESTA referência, uma que a cite. Sem
                este painel aqui, o aviso logo acima mandaria a pessoa para outra
                tela no meio da correção.
              */}
              {cadastro?.existe && (
                <div className="text-xs space-y-2">
                  <div className="font-semibold text-zinc-300">
                    {sel.ehUmbMigo
                      ? `Conversão de ${cadastro.kRef ?? sel.referencia} — é daqui que sai o fator da UmbMigo`
                      : `Corrigir ${cadastro.kRef ?? sel.referencia}`}
                  </div>

                  {/* ── a lista inteira, editável ────────────────────────
                      A referência guarda uma LISTA e o Coreon usa a PRIMEIRA
                      que casa. Por isso todas aparecem, na ordem gravada, com
                      a vencedora marcada: sem isso, "por que ele usou aquela
                      conversão?" só se responde lendo o código do Coreon. */}
                  {convs.length === 0 && (
                    <p className="text-zinc-600">
                      Nenhuma conversão cadastrada nesta referência — a quantidade da NF vai
                      inteira para o pedido.
                    </p>
                  )}

                  {convs.map((c, i) => {
                    const vence = sim?.venc?.indice === i
                    return (
                      <div
                        key={i}
                        className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 ${
                          vence ? 'border-green-700 bg-green-950/30' : 'border-zinc-800'
                        }`}
                      >
                        <span className="w-4 text-zinc-600">{i + 1}</span>

                        <label className="flex items-center gap-1 text-zinc-400">
                          <input
                            type="checkbox"
                            checked={c.umbsIguais}
                            onChange={e => mexer(i, { umbsIguais: e.target.checked })}
                          />
                          universal
                        </label>

                        {!c.umbsIguais && (
                          <>
                            <input
                              value={c.de}
                              onChange={e => mexer(i, { de: e.target.value })}
                              placeholder="de"
                              className="w-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 font-mono"
                            />
                            <span className="text-zinc-600">→</span>
                            <input
                              value={c.para}
                              onChange={e => mexer(i, { para: e.target.value })}
                              placeholder="para"
                              className="w-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 font-mono"
                            />
                          </>
                        )}

                        <input
                          value={String(c.fator)}
                          onChange={e =>
                            mexer(i, { fator: Number(e.target.value.replace(',', '.')) })
                          }
                          placeholder="fator"
                          className="w-24 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 font-mono"
                        />

                        {c.padraoOrigem && (
                          <span
                            className="text-amber-500 font-mono"
                            title="Casa por início da UMB do pedido. Nenhuma tela edita este campo — ele é preservado como está."
                          >
                            padrão {c.padraoOrigem}
                          </span>
                        )}

                        {vence && (
                          <span className="text-green-400" title={explicarMotivo(sim!.venc!.motivo)}>
                            é esta que vale
                          </span>
                        )}

                        <span className="flex-1" />

                        <button
                          onClick={() => sugerir(i)}
                          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                          title="Preenche fator e unidades pela NF e pelo saldo — mesma regra do botão Sugerir do mapeamento."
                        >
                          Sugerir
                        </button>
                        {!c.umbsIguais && (
                          <button
                            onClick={() => inverter(i)}
                            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                            title="Troca de/para e inverte o fator — o mesmo fato, escrito do jeito que se confere de cabeça."
                          >
                            Inverter
                          </button>
                        )}
                        <button
                          onClick={() => subir(i)}
                          disabled={i === 0}
                          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30"
                          title="A ORDEM decide: vale a primeira que casa. Subir dá precedência a esta."
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => remover(i)}
                          className="px-2 py-1 rounded bg-zinc-800 hover:bg-red-800"
                          title="Remover esta conversão"
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}

                  <button
                    onClick={adicionar}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                  >
                    + Adicionar conversão
                  </button>

                  {/* ── simular ──────────────────────────────────────────
                      Começa nos números da nota que gerou o caso e é
                      editável: a pergunta não é só "o que aconteceu naquela
                      nota", é "e se for outra quantidade, este cadastro
                      aguenta?". */}
                  <div className="rounded border border-zinc-800 p-2 space-y-2">
                    <div className="font-semibold text-zinc-300">Simular</div>

                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-0.5">
                        <span className="text-zinc-500">qtd NF</span>
                        <input
                          value={simQtd}
                          onChange={e => setSimQtd(e.target.value)}
                          className="w-24 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-zinc-500">UMB NF</span>
                        <input
                          value={simUmbNf}
                          onChange={e => setSimUmbNf(e.target.value)}
                          className="w-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-zinc-500">UMB pedido</span>
                        <input
                          value={simUmbPed}
                          onChange={e => setSimUmbPed(e.target.value)}
                          className="w-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-zinc-500">valor UN NF</span>
                        <input
                          value={simValorNf}
                          onChange={e => setSimValorNf(e.target.value)}
                          className="w-24 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-zinc-500">valor UN pedido</span>
                        <input
                          value={simValorPed}
                          onChange={e => setSimValorPed(e.target.value)}
                          className="w-24 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 font-mono"
                        />
                      </label>
                    </div>

                    {sim && (
                      <div className="font-mono space-y-0.5">
                        <div className={sim.venc ? 'text-zinc-400' : 'text-amber-400'}>
                          {sim.venc
                            ? `conversão ${sim.venc.indice + 1} — ${explicarMotivo(sim.venc.motivo)} → divisor ${num(sim.conversao)}`
                            : 'nenhuma conversão casa com estas unidades → a quantidade vai inteira'}
                        </div>
                        <div className="text-zinc-400">
                          qtd para o SAP: <span className="text-zinc-200">{num(sim.qtdSap)}</span>{' '}
                          {simUmbPed}
                        </div>
                        <div className="text-zinc-400">
                          valor UN convertido:{' '}
                          <span className="text-zinc-200">{num(sim.valorConv)}</span> · pedido{' '}
                          {num(Number(String(simValorPed).replace(',', '.')))}
                        </div>
                        <div className={sim.diverge ? 'text-red-400' : 'text-green-400'}>
                          {sim.diverge
                            ? `divergência de ${num(sim.dif, 2)} — acima da tolerância de referência (0,50), o Executar bloquearia`
                            : `diferença de ${num(sim.dif, 2)} — dentro da tolerância de referência (0,50)`}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => void gravar(!sel.ehUmbMigo)}
                      className={`px-3 py-1.5 rounded font-medium ${
                        sel.ehUmbMigo
                          ? 'bg-zinc-800 hover:bg-zinc-700'
                          : 'bg-green-700 hover:bg-green-600'
                      }`}
                    >
                      Gravar conversão
                    </button>

                    {!sel.ehUmbMigo && (
                      <>
                        <button
                          onClick={() => void marcar('corrigida')}
                          className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700"
                        >
                          Já corrigi por fora
                        </button>
                        <button
                          onClick={() => void marcar('ignorada')}
                          className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700"
                        >
                          Não é conversão
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
