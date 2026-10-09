import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { QuemPediu } from '../components/QuemPediu'
import { SupabaseService } from '../services/supabase'
import { buscarUsuarioNoFluxo, lerPessoa, tenantDoUsuario } from '../services/usuariosPa'
import type { CentrosJson } from '../utils/empresa'

// ─────────────────────────────────────────────────────────────────────────────
// Cadastros — CRUD manual de fornecedores, usuários, centros e empresas,
// lendo/gravando direto no Supabase (via lnf-api; sem GitHub).
//
//   • forn.json      → tabela fornecedores (PK nome)      — shape legado
//   • usersList.json → tabela usuarios     (PK username)  — shape legado
//   • centros.json   → tabela centros      (PK centro)    — shape legado
//   • (tabela crua)  → tabela empresas     (PK codigo)    — via load()/lerLinhas
//
// As três primeiras leem reconstruindo o shape JSON legado (lerArquivo);
// empresas lê a tabela crua (load()). A escrita é sempre POR LINHA
// (upsert/delete por entidade) — nada de reescrever o "arquivo" inteiro.
//
// Cada entidade vira uma lista de { key, data }. Campos texto/número via input,
// listas via textarea (1 por linha) e booleanos via checkbox. Em centros, as
// impressoras Zebra (zebra_caminhos) têm editor próprio (ZebraEditor), que
// preserva o layout de ZPL de cada impressora; FornOverrides é preservado
// (não editável por campos simples).
// ─────────────────────────────────────────────────────────────────────────────

type Data = Record<string, unknown>

interface Entry {
  key: string
  data: Data
}

type FieldType = 'text' | 'number' | 'boolean' | 'list'

interface FieldSpec {
  path: string
  label: string
  type: FieldType
}

interface EntityConfig {
  id: 'fornecedores' | 'usuarios' | 'centros' | 'empresas'
  label: string
  // Entidades baseadas em arquivo legado (forn/usuarios/centros) leem via
  // lerArquivo(file)+parse. Entidades de TABELA CRUA (empresas) trazem um
  // load() próprio e não usam file/parse — a caixa "Arquivo:" some para elas.
  file?: string
  keyLabel: string
  parse?: (raw: unknown) => Entry[]
  load?: (svc: SupabaseService) => Promise<Entry[]>
  // Escrita por linha no Supabase. oldKey presente = rename (chave mudou).
  // Usuários pode devolver { enfileirado } quando o cadastro NOVO, abaixo de
  // dev, vira solicitação em vez de gravar — as demais entidades devolvem void.
  save: (
    svc: SupabaseService, key: string, data: Data, oldKey?: string,
  ) => Promise<void | { enfileirado: boolean; mensagem: string }>
  remove: (svc: SupabaseService, key: string) => Promise<void>
  // Recebem as linhas JÁ CARREGADAS porque uma delas depende dos dados: os
  // acessos do usuário são a união do catálogo com o que existe no banco.
  // As outras entidades ignoram o argumento.
  blank: (entries: Entry[]) => Data
  fields: (entries: Entry[]) => FieldSpec[]
}

// ── helpers de path ──────────────────────────────────────────────────────────
function getPath(obj: Data, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as Data)[k]),
    obj,
  )
}

function cloneSetPath(obj: Data, path: string, val: unknown): Data {
  const copy = JSON.parse(JSON.stringify(obj)) as Data
  const ks = path.split('.')
  const last = ks.pop() as string
  let o = copy
  for (const k of ks) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {}
    o = o[k] as Data
  }
  o[last] = val
  return copy
}

function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => String(x)) : []
}

// Só dígitos, 14 posições — mesma normalização do Coreon (FornecedorService),
// pra que o CNPJ gravado case com o lookup por CNPJ.
function normalizarCnpj(v: string): string | null {
  const d = (v ?? '').replace(/\D/g, '')
  if (!d) return null
  return d.length < 14 ? d.padStart(14, '0') : d
}

// Acrescenta um CNPJ à lista sem duplicar (compara normalizado).
function comCnpj(lista: string[], cnpj: string): string[] {
  const norm = normalizarCnpj(cnpj)
  if (!norm) return lista
  if (lista.some(x => normalizarCnpj(x) === norm)) return lista
  return [...lista, norm]
}

// Limpa o objeto do fornecedor antes de gravar: remove campos vazios/false/0
// e arrays de termos vazios (espelha o forn.json, que omite campos opcionais).
// Campos desconhecidos com valor "truthy" são preservados.
function pruneForn(d: Data): Data {
  const o: Data = {}
  for (const [k, v] of Object.entries(d)) {
    if (k === 'termos') {
      const t: Data = {}
      for (const [tk, tv] of Object.entries((v as Data) ?? {})) {
        const arr = asList(tv)
        if (arr.length) t[tk] = arr
      }
      if (Object.keys(t).length) o.termos = t
      continue
    }
    if (Array.isArray(v)) {
      const arr = v.map(String)
      if (arr.length) o[k] = arr
    } else if (typeof v === 'boolean') {
      if (v) o[k] = true
    } else if (typeof v === 'number') {
      if (v) o[k] = v
    } else if (typeof v === 'string') {
      if (v.trim()) o[k] = v
    } else if (v != null) {
      o[k] = v
    }
  }
  return o
}

// ═══════════════════════════════════════════════════════════════════════════
// ACESSOS — a lista de chaves vem dos DADOS, e não daqui.
//
// ── o que estava errado ────────────────────────────────────────────────────
//
// Esta lista era a verdade e tinha 10 chaves. Nenhuma das duas metades batia:
// faltavam 'sap', 'totvs' e 'beta', e sobravam quatro que ninguém lia —
// 'arquivosRestritos' (0047), 'cadastroUsuarios' (0048, quem decide isso é o
// nivel_adm) e 'compras'/'fiscal' (0049, funções nunca implementadas).
//
// Hoje o banco tem 9, e todas têm consumidor no Coreon.
//
// Não mostrá-las já era ruim; o estrago de verdade era outro. O blank() de
// usuário novo saía do acessosVazio(), com as 10 — então quem fosse criado
// pelo LNF-web nascia SEM 'sap', que os 38 usuários existentes têm como true.
//
// E chave ausente não é "false" por acaso: o gate lê `acessos->>sap = 'true'`,
// e ausente nunca é true. Usuário criado por aqui nascia sem SAP, em silêncio.
//
// ── como passa a funcionar ─────────────────────────────────────────────────
//
// Esta lista vira só o CATÁLOGO CONHECIDO — serve para a ORDEM e para o rótulo
// legível. As chaves de verdade são a UNIÃO dela com tudo que aparecer nos
// usuários carregados. Uma permissão nova passa a aparecer sozinha, assim que
// o primeiro usuário a tiver, sem ninguém precisar vir editar este arquivo.
// ═══════════════════════════════════════════════════════════════════════════
const ACESSOS_CONHECIDOS: string[] = [
  'sap',
  'almoxarifado',
  'cadastroFornecedores',
  'cadastroItens',
  'planejamento',
  'lancamentoFuturo',
  'internet',
  'totvs',
  'beta',
]

const ACESSO_LABELS: Record<string, string> = {
  sap: 'SAP',
  almoxarifado: 'Almoxarifado',
  cadastroFornecedores: 'Cadastro Fornecedores',
  cadastroItens: 'Cadastro Itens',
  planejamento: 'Planejamento',
  lancamentoFuturo: 'Lançamento Futuro',
  internet: 'Internet (MeuDanfe)',
  totvs: 'TOTVS',
  beta: 'Canal beta',
}

// Chave sem rótulo curado ainda precisa aparecer legível: camelCase vira
// "Camel Case". É o que deixa uma permissão nova utilizável na tela no dia em
// que nasce, sem esperar alguém vir aqui batizá-la.
function rotuloDeAcesso(k: string): string {
  if (ACESSO_LABELS[k]) return ACESSO_LABELS[k]
  const s = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Conhecidas primeiro, na ordem curada; o que aparecer nos dados e não estiver
// no catálogo entra depois, em ordem alfabética — para a tela não embaralhar a
// cada carga.
function chavesDeAcesso(entries: Entry[]): string[] {
  const vistas = new Set<string>()
  for (const e of entries) {
    const a = e.data?.acessos
    if (a && typeof a === 'object')
      for (const k of Object.keys(a as Record<string, unknown>)) vistas.add(k)
  }
  const novas = [...vistas].filter(k => !ACESSOS_CONHECIDOS.includes(k)).sort()
  return [...ACESSOS_CONHECIDOS, ...novas]
}

function acessosVazio(chaves: string[]): Record<string, boolean> {
  return Object.fromEntries(chaves.map(a => [a, false]))
}

// ── definição das entidades ──────────────────────────────────────────────────
const ENTIDADES: EntityConfig[] = [
  {
    id: 'fornecedores',
    label: 'Fornecedores',
    file: 'forn.json',
    keyLabel: 'Nome',
    parse: raw => {
      const obj = (raw as Record<string, Data>) ?? {}
      return Object.entries(obj).map(([k, v]) => ({
        key: k,
        data: JSON.parse(JSON.stringify(v ?? {})) as Data, // preserva tudo
      }))
    },
    save: (svc, key, data, oldKey) => svc.salvarFornecedor(key, pruneForn(data), oldKey),
    remove: (svc, key) => svc.removerFornecedor(key),
    blank: () => ({ cnpjs: [] }),
    fields: () => [
      { path: 'raizCNPJs', label: 'Raiz CNPJs', type: 'list' },
      { path: 'cnpjs', label: 'CNPJs', type: 'list' },
      { path: 'lifnrs', label: 'LIFNRs', type: 'list' },
      { path: 'ordem', label: 'Ordem', type: 'number' },
      { path: 'dateFormat', label: 'Date Format', type: 'text' },
      { path: 'refColuna', label: 'Ref Coluna', type: 'text' },
      { path: 'refUniversal', label: 'Ref Universal', type: 'text' },
      { path: 'fromUMBColumn', label: 'Coluna UMB', type: 'text' },
      { path: 'skipRefs', label: 'Skip Refs', type: 'list' },
      { path: 'infoXprod', label: 'Info Xprod', type: 'boolean' },
      { path: 'buscarRefNoXprod', label: 'Procurar referência cadastrada no det_xProd', type: 'boolean' },
      { path: 'freteComIPI', label: 'Frete com IPI', type: 'boolean' },
      { path: 'genericLoteForn', label: 'Generic Lote Forn', type: 'boolean' },
      { path: 'peinh1000PorDecimais', label: 'Peinh 1000 por Decimais', type: 'boolean' },
      { path: 'forcarPeinh1000', label: 'Forçar Peinh 1000', type: 'boolean' },
      // Preço da NF já vem na unidade convertida: o Coreon deixa de multiplicar
      // o preço pela conversão (a quantidade continua convertida normalmente).
      { path: 'precoNfJaConvertido', label: 'Preço NF já convertido', type: 'boolean' },
      { path: 'termos.lote', label: 'Termo · Lote', type: 'list' },
      { path: 'termos.fimLote', label: 'Termo · Fim Lote', type: 'list' },
      { path: 'termos.validade', label: 'Termo · Validade', type: 'list' },
      { path: 'termos.fimValidade', label: 'Termo · Fim Validade', type: 'list' },
      { path: 'termos.quantidade', label: 'Termo · Quantidade', type: 'list' },
      { path: 'termos.fimQuantidade', label: 'Termo · Fim Quantidade', type: 'list' },
      { path: 'termos.referencia', label: 'Termo · Referência', type: 'list' },
      { path: 'termos.fimReferencia', label: 'Termo · Fim Referência', type: 'list' },
      { path: 'termos.pedido', label: 'Termo · Pedido', type: 'list' },
    ],
  },
  {
    id: 'usuarios',
    label: 'Usuários',
    file: 'usersList.json',
    keyLabel: 'Usuário',
    parse: raw => {
      const obj = (raw as Record<string, Data>) ?? {}
      const brutos = Object.entries(obj)

      // A união é calculada ANTES de montar as linhas, sobre os dados crus:
      // assim toda linha sai com o MESMO conjunto de chaves, e o formulário
      // não muda de tamanho conforme o usuário selecionado.
      const chaves = chavesDeAcesso(
        brutos.map(([k, v]) => ({ key: k, data: v })),
      )

      // 'ativo' só chega quando quem lê é dev — a lnf-api esconde a coluna de
      // todo o resto. Presente em qualquer linha = a tela pode gerir o campo.
      const ehDev = brutos.some(([, v]) => typeof v.ativo === 'boolean')

      return brutos.map(([k, v]) => ({
        key: k,
        data: {
          nome: String(v.nome ?? ''),
          centros: asList(v.centros),
          acessos: { ...acessosVazio(chaves), ...((v.acessos as Record<string, boolean>) ?? {}) },
          nivelAdm: typeof v.nivelAdm === 'number' ? v.nivelAdm : 0,
          ...(ehDev ? { ativo: v.ativo !== false } : {}),
        },
      }))
    },
    // Sem acessosVazio() aqui: o 'data' já vem do parse (ou do blank) com o
    // conjunto completo. Reaplicar o catálogo por cima RESSUSCITARIA como
    // false uma chave que alguém tenha removido do banco de propósito.
    save: (svc, key, data, oldKey) =>
      svc.salvarUsuario(
        key,
        {
          nome: String(data.nome ?? ''),
          centros: asList(data.centros),
          acessos: (data.acessos as Record<string, boolean>) ?? {},
          nivelAdm: Number(data.nivelAdm) || 0,
          ...(typeof data.ativo === 'boolean' ? { ativo: data.ativo } : {}),
        },
        oldKey,
      ),
    remove: (svc, key) => svc.removerUsuario(key),
    blank: entries => ({
      nome: '',
      centros: [],
      acessos: acessosVazio(chavesDeAcesso(entries)),
      nivelAdm: 0,
      // Novo usuário criado por um dev nasce ativo; abaixo de dev o campo nem
      // aparece (e o cadastro vira solicitação, sem 'ativo').
      ...(entries.some(e => typeof e.data.ativo === 'boolean') ? { ativo: true } : {}),
    }),
    fields: entries => [
      { path: 'nome', label: 'Nome', type: 'text' },
      { path: 'nivelAdm', label: 'Nível Adm', type: 'number' },
      // 'Ativo' só aparece para o dev (quando 'ativo' veio na leitura). É o
      // liga/desliga de acesso por tempo indeterminado, sem descadastrar.
      ...(entries.some(e => typeof e.data.ativo === 'boolean')
        ? [{ path: 'ativo', label: 'Ativo (acesso liberado)', type: 'boolean' as const }]
        : []),
      { path: 'centros', label: 'Centros', type: 'list' },
      ...chavesDeAcesso(entries).map(a => ({
        path: `acessos.${a}`,
        label: rotuloDeAcesso(a),
        type: 'boolean' as const,
      })),
    ],
  },
  {
    id: 'centros',
    label: 'Centros',
    file: 'centros.json',
    keyLabel: 'Centro',
    parse: raw => {
      const obj = (raw as { Centros?: Record<string, Data> })?.Centros ?? {}
      return Object.entries(obj).map(([k, v]) => ({
        key: k,
        data: {
          Empresa: String(v.Empresa ?? ''),
          GenericLote: String(v.GenericLote ?? 'N'),
          GenericVal: String(v.GenericVal ?? '31.12.2099'),
          GenericLoteItems: asList(v.GenericLoteItems),
          Ceps: asList(v.Ceps),
          Cnpjs: asList(v.Cnpjs),
          CentroPardini: !!v.CentroPardini,
          // Impressoras Zebra do centro. Editáveis aqui (nome/caminho/dpi/
          // escuridão); o sub-objeto 'layouts' de cada uma é preservado.
          ZebraCaminhos: Array.isArray(v.ZebraCaminhos) ? v.ZebraCaminhos : [],
          FornOverrides: v.FornOverrides ?? null, // preservado
        },
      }))
    },
    save: (svc, key, data, oldKey) =>
      svc.salvarCentro(
        key,
        {
          Empresa: String(data.Empresa ?? ''),
          GenericLote: String(data.GenericLote ?? 'N'),
          GenericVal: String(data.GenericVal ?? '31.12.2099'),
          GenericLoteItems: asList(data.GenericLoteItems),
          Ceps: asList(data.Ceps),
          Cnpjs: asList(data.Cnpjs),
          CentroPardini: !!data.CentroPardini,
          ZebraCaminhos: Array.isArray(data.ZebraCaminhos) ? data.ZebraCaminhos : [],
          FornOverrides: data.FornOverrides ?? {},
        },
        oldKey,
      ),
    remove: (svc, key) => svc.removerCentro(key),
    blank: () => ({
      Empresa: '',
      GenericLote: 'N',
      GenericVal: '31.12.2099',
      GenericLoteItems: [],
      Ceps: [],
      Cnpjs: [],
      CentroPardini: false,
      ZebraCaminhos: [],
      FornOverrides: null,
    }),
    fields: () => [
      // Empresa é renderizada como <select> (EmpresaSelect) no formulário, com
      // as empresas cadastradas — a coluna tem FK, então texto livre erraria.
      { path: 'GenericLote', label: 'Generic Lote', type: 'text' },
      { path: 'GenericVal', label: 'Generic Val', type: 'text' },
      { path: 'GenericLoteItems', label: 'Generic Lote Items', type: 'list' },
      { path: 'Ceps', label: 'CEPs', type: 'list' },
      { path: 'Cnpjs', label: 'CNPJs', type: 'list' },
      { path: 'CentroPardini', label: 'Centro Pardini', type: 'boolean' },
    ],
  },
  {
    id: 'empresas',
    label: 'Empresas',
    keyLabel: 'Código',
    // Tabela crua (sem arquivo legado): lê e grava linha a linha.
    load: async svc => {
      const rows = await svc.lerLinhas('empresas', { order: 'codigo' })
      return rows.map(r => ({
        key: String(r.codigo ?? ''),
        data: {
          nome: String(r.nome ?? ''),
          tol_valor_total: Number(r.tol_valor_total ?? 0),
          tol_valor_item: Number(r.tol_valor_item ?? 0),
          preco_com_ipi: !!r.preco_com_ipi,
          tenant: String(r.tenant ?? ''),
        },
      }))
    },
    save: async (svc, key, data, oldKey) => {
      await svc.salvarLinha(
        'empresas',
        {
          codigo: key,
          nome: String(data.nome ?? ''),
          tol_valor_total: Number(data.tol_valor_total) || 0,
          tol_valor_item: Number(data.tol_valor_item) || 0,
          preco_com_ipi: !!data.preco_com_ipi,
          tenant: String(data.tenant ?? '').trim().replace(/^@/, '') || null,
        },
        'codigo',
      )
      if (oldKey && oldKey !== key)
        await svc.deletarLinha('empresas', `codigo=eq.${encodeURIComponent(oldKey)}`)
    },
    remove: (svc, key) => svc.deletarLinha('empresas', `codigo=eq.${encodeURIComponent(key)}`),
    blank: () => ({ nome: '', tol_valor_total: 2, tol_valor_item: 0.5, preco_com_ipi: false, tenant: '' }),
    fields: () => [
      { path: 'nome', label: 'Nome', type: 'text' },
      { path: 'tol_valor_total', label: 'Tolerância valor TOTAL da NF (R$)', type: 'number' },
      { path: 'tol_valor_item', label: 'Tolerância valor por ITEM (R$)', type: 'number' },
      { path: 'preco_com_ipi', label: 'Preço com IPI', type: 'boolean' },
      { path: 'tenant', label: 'Tenant do diretório (ex.: grupofleury.com.br)', type: 'text' },
    ],
  },
]

// Caminho do arquivo: mesma pasta do itens.json (config.itensPath).
function dirOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(0, i + 1) : ''
}

export function Cadastros() {
  const { config, centros } = useApp()

  const [entId, setEntId] = useState<EntityConfig['id']>('fornecedores')
  const ent = useMemo(() => ENTIDADES.find(e => e.id === entId)!, [entId])

  const pathFor = useCallback(
    (e: EntityConfig) => {
      const override = localStorage.getItem('lnf_cadpath_' + e.id)
      if (override && override.trim()) return override.trim()
      return dirOf(config?.itensPath ?? 'itens.json') + e.file
    },
    [config?.itensPath],
  )

  const svc = useMemo(
    () => (config ? new SupabaseService(config) : null),
    [config],
  )

  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [filtro, setFiltro] = useState('')
  const [selKey, setSelKey] = useState<string | null>(null)
  const [form, setForm] = useState<{ key: string; data: Data }>({ key: '', data: {} })

  const [salvando, setSalvando] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  // Empresas cadastradas — para o <select> de empresa do centro (a coluna tem
  // FK, então oferecer as opções evita erro de FK por digitação).
  const [empresaOpcoes, setEmpresaOpcoes] = useState<Array<{ codigo: string; nome: string; tenant: string }>>([])
  useEffect(() => {
    if (!svc) return
    let vivo = true
    svc
      .lerLinhas('empresas', { select: 'codigo,nome,tenant', order: 'codigo' })
      .then(rows => {
        if (vivo)
          setEmpresaOpcoes(
            rows.map(r => ({
              codigo: String(r.codigo ?? ''),
              nome: String(r.nome ?? ''),
              tenant: String(r.tenant ?? ''),
            })),
          )
      })
      .catch(() => {
        /* empresas pode não carregar; o select cai para o valor atual + vazio */
      })
    return () => {
      vivo = false
    }
  }, [svc])

  // Solicitações de cadastro de fornecedor (tabela solicitacoes_forn, pendentes).
  const [solic, setSolic] = useState<Array<Record<string, unknown>>>([])
  const [solicCnpj, setSolicCnpj] = useState<string | null>(null) // solicitação (forn) sendo atendida
  const [solicUser, setSolicUser] = useState<string | null>(null) // solicitação (usuário) sendo atendida

  const carregarSolic = useCallback(async () => {
    const tabela =
      entId === 'fornecedores' ? 'solicitacoes_forn'
      : entId === 'usuarios' ? 'solicitacoes_usuario'
      : null
    if (!svc || !tabela) {
      setSolic([])
      return
    }
    try {
      setSolic(
        await svc.lerLinhas(tabela, {
          filtros: 'status=eq.pendente',
          order: 'created_at.desc',
          limit: 200,
        }),
      )
    } catch {
      setSolic([]) // tabela pode não existir / sem permissão — silencioso
    }
  }, [svc, entId])

  useEffect(() => {
    void carregarSolic()
  }, [carregarSolic])

  // Carrega a entidade selecionada (tabela do Supabase, via shape legado).
  const carregar = useCallback(async () => {
    if (!svc) return
    setCarregando(true)
    setErro(null)
    setStatus(null)
    setSelKey(null)
    try {
      let novas: Entry[]
      if (ent.load) {
        // Entidade de tabela crua (empresas): sem arquivo legado.
        setPath('')
        novas = await ent.load(svc)
      } else {
        const p = pathFor(ent)
        setPath(p)
        const { data } = await svc.lerArquivo(p)
        novas = ent.parse!(data)
      }
      setEntries(novas)
      // Form em branco COM o catálogo recém-carregado — nunca blank([]). O
      // campo é renderizado a partir das entries (que, no dev, trazem 'ativo'),
      // então o blank TEM que ver as mesmas entries: senão o form nasce sem
      // 'ativo', o checkbox aparece desmarcado por falta de valor, e um usuário
      // novo é salvo SEM 'ativo' — caindo no default true da coluna. Era esse o
      // bug: caixa desmarcada, usuário gravado como ativo.
      setForm({ key: '', data: ent.blank(novas) })
    } catch (e) {
      setErro((e as Error).message)
      setEntries([])
      setForm({ key: '', data: ent.blank([]) })
    } finally {
      setCarregando(false)
    }
  }, [svc, ent, pathFor])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const filtrados = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    const arr = f ? entries.filter(e => e.key.toLowerCase().includes(f)) : entries
    return [...arr].sort((a, b) => a.key.localeCompare(b.key))
  }, [entries, filtro])

  // Dev = a leitura de 'usuarios' trouxe a coluna 'ativo' (a lnf-api só a envia
  // ao dev). É o que libera o painel de solicitações de cadastro e o campo
  // 'ativo' — sem depender de o web conhecer o nível do usuário configurado.
  const ehDevUsuarios = useMemo(
    () => entId === 'usuarios' && entries.some(e => typeof e.data.ativo === 'boolean'),
    [entId, entries],
  )

  function selecionar(e: Entry) {
    setSelKey(e.key)
    setForm({ key: e.key, data: JSON.parse(JSON.stringify(e.data)) as Data })
    setStatus(null)
    setSolicCnpj(null)
    setSolicUser(null)
  }

  function novo() {
    setSelKey(null)
    setForm({ key: '', data: ent.blank(entries) })
    setStatus(null)
    setSolicCnpj(null)
    setSolicUser(null)
  }

  // "Cadastrar" a partir de uma solicitação: pré-preenche o nome como chave e
  // o CNPJ na lista.
  //
  // Se o nome JÁ existe, isto é COMPLEMENTO e não cadastro novo: carrega os
  // dados atuais do fornecedor e só ACRESCENTA o CNPJ. Sem isso o save gravaria
  // a linha com apenas esse CNPJ e o resto em branco — apagando as demais
  // filiais e toda a configuração de processamento do fornecedor.
  function cadastrarDeSolic(sol: Record<string, unknown>) {
    // Usuário: pré-preenche o formulário com o pedido; ao salvar (como dev), o
    // usuário é criado de fato e a solicitação é marcada 'aprovada'.
    if (entId === 'usuarios') {
      const username = String(sol.username ?? '').trim()
      const existente = entries.find(e => e.key.trim().toLowerCase() === username.toLowerCase())
      const data: Data = {
        nome: String(sol.nome ?? ''),
        centros: asList(sol.centros),
        nivelAdm: Number(sol.nivel_adm) || 0,
        acessos: {
          ...acessosVazio(chavesDeAcesso(entries)),
          ...((sol.acessos as Record<string, boolean>) ?? {}),
        },
        ativo: true,
      }
      setSelKey(existente ? existente.key : null)
      setForm({ key: username, data: existente ? { ...existente.data, ...data } : data })
      setSolicUser(username || null)
      setSolicCnpj(null)
      setStatus('ℹ️ Revise e salve para liberar o acesso deste usuário.')
      return
    }

    const cnpj = String(sol.cnpj ?? '')
    const nome = String(sol.nome ?? '').trim()

    const existente = entries.find(e => e.key.trim().toLowerCase() === nome.toLowerCase())
    if (existente) {
      const data = JSON.parse(JSON.stringify(existente.data)) as Data
      data.cnpjs = comCnpj(asList(data.cnpjs), cnpj)
      setSelKey(existente.key)
      setForm({ key: existente.key, data })
      setSolicCnpj(cnpj || null)
      setStatus(`ℹ️ "${existente.key}" já é cadastrado — CNPJ somado aos existentes. Revise e salve.`)
      return
    }

    setSelKey(null)
    setForm({ key: nome, data: { cnpjs: comCnpj([], cnpj) } })
    setSolicCnpj(cnpj || null)
    setStatus('ℹ️ Revise e salve para concluir o cadastro.')
  }

  async function ignorarSolic(sol: Record<string, unknown>) {
    if (!svc) return
    try {
      if (entId === 'usuarios') {
        const username = String(sol.username ?? '').trim()
        if (!username) return
        await svc.salvarLinha('solicitacoes_usuario', { username, status: 'recusada' }, 'username')
      } else {
        const cnpj = String(sol.cnpj ?? '')
        if (!cnpj) return
        await svc.salvarLinha('solicitacoes_forn', { cnpj, status: 'ignorado' }, 'cnpj')
      }
      await carregarSolic()
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    }
  }

  function setCampo(pathStr: string, val: unknown) {
    setForm(f => ({ ...f, data: cloneSetPath(f.data, pathStr, val) }))
  }

  // Recalcula a lista local após um save (com possível rename), espelhando o
  // que foi gravado por linha no Supabase.
  function aplicarLocal(key: string, data: Data = form.data): Entry[] {
    if (selKey && entries.some(e => e.key === selKey)) {
      let next = entries.map(e => (e.key === selKey ? { key, data } : e))
      if (key !== selKey) next = next.filter((e, i) => !(e.key === key && entries[i]?.key !== selKey))
      return next
    }
    if (entries.some(e => e.key === key)) {
      return entries.map(e => (e.key === key ? { key, data } : e))
    }
    return [...entries, { key, data }]
  }

  // Rede de segurança pro cadastro de fornecedor: o nome digitado já existe mas
  // NÃO é o registro aberto na tela (veio de "novo" ou de uma solicitação). O
  // save é por linha inteira, então gravar o form como está apagaria os CNPJs
  // das outras filiais e a configuração. Aqui o form é fundido SOBRE o cadastro
  // atual e os CNPJs entram somados — nome repetido complementa, não substitui.
  function fundirSeExistente(key: string, data: Data): Data {
    if (entId !== 'fornecedores') return data
    const existente = entries.find(e => e.key.trim().toLowerCase() === key.toLowerCase())
    if (!existente || existente.key === selKey) return data

    const base = JSON.parse(JSON.stringify(existente.data)) as Data
    for (const [k, v] of Object.entries(data)) base[k] = v

    let uniao = asList(existente.data.cnpjs)
    for (const c of asList(data.cnpjs)) uniao = comCnpj(uniao, c)
    base.cnpjs = uniao
    return base
  }

  async function salvar() {
    if (!svc) return
    const key = form.key.trim()
    if (!key) {
      setStatus(`⚠️ Informe o ${ent.keyLabel}.`)
      return
    }
    setSalvando(true)
    setStatus(null)
    try {
      const oldKey = selKey && selKey !== key ? selKey : undefined
      const dados = fundirSeExistente(key, form.data)
      const resultado = await ent.save(svc, key, dados, oldKey)

      // Cadastro de usuário NOVO abaixo de dev não gravou — virou solicitação.
      // Mostra a mensagem e não anuncia "salvo": o acesso ainda não existe.
      if (resultado && typeof resultado === 'object' && resultado.enfileirado) {
        setStatus(`📨 ${resultado.mensagem}`)
        return
      }

      setEntries(aplicarLocal(key, dados))
      setSelKey(key)
      setStatus(`✅ "${key}" salvo com sucesso`)

      // Se veio de uma solicitação de cadastro, marca como concluída/aprovada.
      if (entId === 'fornecedores' && solicCnpj) {
        try {
          await svc.salvarLinha('solicitacoes_forn', { cnpj: solicCnpj, status: 'cadastrado' }, 'cnpj')
          setSolicCnpj(null)
          await carregarSolic()
        } catch {
          /* não bloqueia o sucesso do cadastro */
        }
      }
      if (entId === 'usuarios' && solicUser) {
        try {
          await svc.salvarLinha(
            'solicitacoes_usuario', { username: solicUser, status: 'aprovada' }, 'username',
          )
          setSolicUser(null)
          await carregarSolic()
        } catch {
          /* não bloqueia o sucesso do cadastro */
        }
      }
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  async function remover() {
    if (!svc || !selKey) return
    if (!window.confirm(`Remover "${selKey}" de ${ent.label}?`)) return
    setSalvando(true)
    setStatus(null)
    try {
      await ent.remove(svc, selKey)
      setEntries(entries.filter(e => e.key !== selKey))
      const removido = selKey
      novo()
      setStatus(`✅ "${removido}" removido`)
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  // ── Guardas ────────────────────────────────────────────────────────────────
  if (!config) {
    return (
      <div className="p-6 text-center text-zinc-400 mt-12 space-y-2">
        <p className="text-4xl">🔑</p>
        <p>
          Configure a conexão do Supabase em{' '}
          <span className="text-white font-medium">Configurações</span> para começar.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 max-w-3xl mx-auto">
      {/* Seletor de entidade */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
        {ENTIDADES.map(e => (
          <button
            key={e.id}
            onClick={() => setEntId(e.id)}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              entId === e.id ? 'bg-green-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Caminho do arquivo (só para entidades baseadas em arquivo legado) */}
      {!ent.load && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500 shrink-0">Arquivo:</label>
          <input
            value={path}
            onChange={e => setPath(e.target.value)}
            onBlur={() => {
              localStorage.setItem('lnf_cadpath_' + ent.id, path)
              void carregar()
            }}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-green-500"
          />
        </div>
      )}

      {carregando && <p className="text-zinc-400 text-sm">Carregando {ent.label.toLowerCase()}...</p>}
      {erro && (
        <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">
          ❌ {erro}
        </div>
      )}

      {/* Solicitações de cadastro de fornecedor (pendentes) */}
      {entId === 'fornecedores' && solic.length > 0 && (
        <div className="border border-amber-800/60 bg-amber-950/30 rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-amber-300">
            {solic.length} solicitação(ões) de cadastro de fornecedor
          </p>
          <div className="divide-y divide-amber-900/40 max-h-56 overflow-y-auto">
            {solic.map(s => (
              <div key={String(s.cnpj)} className="flex items-center gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-zinc-100 truncate">{String(s.nome || '(sem nome)')}</p>
                  <p className="text-xs text-zinc-500">CNPJ {String(s.cnpj)}</p>
                  {/* usuário · centro · empresa, no mesmo formato das outras
                      filas. O centro passou a vir na 0044, e aqui ele sai do
                      dest_CNPJ da NF — que já estava resolvido antes mesmo de o
                      fornecedor ser procurado. Linhas anteriores mostram "—". */}
                  <div className="mt-0.5">
                    <QuemPediu
                      usuario={s.usuario == null ? '' : String(s.usuario)}
                      centro={s.centro == null ? '' : String(s.centro)}
                    />
                  </div>
                </div>
                <button
                  onClick={() => cadastrarDeSolic(s)}
                  className="px-2.5 py-1 bg-green-700 hover:bg-green-600 text-white rounded text-xs font-medium transition-colors"
                >
                  Cadastrar
                </button>
                <button
                  onClick={() => void ignorarSolic(s)}
                  className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded text-xs transition-colors"
                >
                  Ignorar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Solicitações de cadastro de usuário (pendentes) — só o dev enxerga */}
      {entId === 'usuarios' && ehDevUsuarios && solic.length > 0 && (
        <div className="border border-amber-800/60 bg-amber-950/30 rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-amber-300">
            {solic.length} solicitação(ões) de cadastro de usuário
          </p>
          <div className="divide-y divide-amber-900/40 max-h-56 overflow-y-auto">
            {solic.map(s => (
              <div key={String(s.username)} className="flex items-center gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-zinc-100 truncate">{String(s.username || '(sem usuário)')}</p>
                  <p className="text-xs text-zinc-500">
                    {String(s.nome || '(sem nome)')} · nível {Number(s.nivel_adm) || 0}
                    {s.solicitante ? ` · pedido por ${String(s.solicitante)}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => cadastrarDeSolic(s)}
                  className="px-2.5 py-1 bg-green-700 hover:bg-green-600 text-white rounded text-xs font-medium transition-colors"
                >
                  Aprovar
                </button>
                <button
                  onClick={() => void ignorarSolic(s)}
                  className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded text-xs transition-colors"
                >
                  Recusar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!carregando && !erro && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Lista de existentes */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={filtro}
                onChange={e => setFiltro(e.target.value)}
                placeholder={`Filtrar ${ent.label.toLowerCase()}...`}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
              />
              <button
                onClick={novo}
                className="px-3 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                + Novo
              </button>
            </div>
            <p className="text-xs text-zinc-500">{filtrados.length} de {entries.length}</p>
            <div className="border border-zinc-800 rounded-lg max-h-80 overflow-y-auto divide-y divide-zinc-800">
              {filtrados.map(e => (
                <button
                  key={e.key}
                  onClick={() => selecionar(e)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    e.key === selKey ? 'bg-green-900/40 text-white' : 'text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                >
                  {e.key || '(vazio)'}
                </button>
              ))}
              {filtrados.length === 0 && (
                <p className="text-xs text-zinc-500 p-3">Nenhum item.</p>
              )}
            </div>
          </div>

          {/* Formulário */}
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
                {ent.keyLabel}
              </label>
              <input
                value={form.key}
                onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                placeholder={selKey ? '' : `Novo ${ent.keyLabel.toLowerCase()}`}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
              />
            </div>

            {ent.id === 'centros' && (
              <EmpresaSelect
                value={form.data.Empresa}
                opcoes={empresaOpcoes}
                onChange={v => setCampo('Empresa', v)}
              />
            )}

            {ent.id === 'usuarios' && config?.usuariosPaUrl?.trim() && (
              <BuscaDiretorio
                url={config.usuariosPaUrl.trim()}
                username={form.key}
                centros={asList(form.data.centros)}
                centrosJson={centros}
                tenants={Object.fromEntries(empresaOpcoes.map(e => [e.codigo, e.tenant]))}
                onNome={n => setCampo('nome', n)}
              />
            )}

            {ent.fields(entries).map(f => (
              <Campo
                key={f.path}
                spec={f}
                value={getPath(form.data, f.path)}
                onChange={v => setCampo(f.path, v)}
              />
            ))}

            {ent.id === 'centros' && (
              <ZebraEditor
                value={form.data.ZebraCaminhos}
                onChange={v => setCampo('ZebraCaminhos', v)}
              />
            )}

            {ent.id === 'centros' && form.data.FornOverrides != null && (
              <p className="text-[11px] text-zinc-500">
                FornOverrides preservado (não editável aqui):{' '}
                <span className="font-mono">{JSON.stringify(form.data.FornOverrides)}</span>
              </p>
            )}

            {status && (
              <div
                className={`rounded-lg p-2.5 text-sm ${
                  status.startsWith('✅')
                    ? 'bg-green-950 border border-green-800 text-green-300'
                    : status.startsWith('⚠️')
                      ? 'bg-yellow-950 border border-yellow-800 text-yellow-300'
                      : 'bg-red-950 border border-red-800 text-red-300'
                }`}
              >
                {status}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => void salvar()}
                disabled={salvando}
                className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition-colors"
              >
                {salvando ? 'Salvando...' : selKey ? 'Salvar alterações' : 'Adicionar'}
              </button>
              {selKey && (
                <button
                  onClick={() => void remover()}
                  disabled={salvando}
                  className="px-4 bg-zinc-800 hover:bg-red-900 border border-zinc-700 disabled:opacity-40 text-zinc-300 hover:text-red-200 rounded-lg text-sm transition-colors"
                >
                  Remover
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Select de empresa do centro ──────────────────────────────────────────────
// centros.empresa tem FK para empresas.codigo, então oferecer as cadastradas
// (em vez de texto livre) evita erro de FK por digitação. Vazio = sem empresa
// (o Coreon cai no padrão via empresaDoCentro). O valor atual sempre aparece,
// mesmo que a lista não tenha carregado ou a empresa tenha sido removida.
function EmpresaSelect({
  value,
  opcoes,
  onChange,
}: {
  value: unknown
  opcoes: Array<{ codigo: string; nome: string }>
  onChange: (v: string) => void
}) {
  const atual = value == null ? '' : String(value)
  const codigos = opcoes.map(o => o.codigo)
  const extra =
    atual && !codigos.includes(atual)
      ? [{ codigo: atual, nome: atual + ' (não cadastrada)' }]
      : []
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">Empresa</label>
      <select
        value={atual}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
      >
        <option value="">(sem empresa — usa o padrão)</option>
        {[...opcoes, ...extra].map(o => (
          <option key={o.codigo} value={o.codigo}>
            {o.nome ? `${o.nome} (${o.codigo})` : o.codigo}
          </option>
        ))}
      </select>
    </div>
  )
}

// ── Editor de impressoras Zebra do centro ────────────────────────────────────
// Gerencia a LISTA de impressoras (zebra_caminhos): nome, caminho, dpi e
// escuridão. O sub-objeto 'layouts' de cada impressora (as coordenadas de ZPL
// da etiqueta) é PRESERVADO no spread — quem desenha o layout é a tela de
// etiquetas do Coreon; aqui se administra o parque de impressoras.
function ZebraEditor({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const lista = Array.isArray(value) ? (value as Data[]) : []

  const patch = (i: number, campo: string, val: unknown) =>
    onChange(lista.map((p, idx) => (idx === i ? { ...p, [campo]: val } : p)))
  const remover = (i: number) => onChange(lista.filter((_, idx) => idx !== i))
  const adicionar = () => onChange([...lista, { nome: '', caminho: '' }])

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">Impressoras Zebra</span>
        <button
          onClick={adicionar}
          className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-200 transition-colors"
        >
          + Impressora
        </button>
      </div>

      {lista.length === 0 && (
        <p className="text-xs text-zinc-600">Nenhuma impressora cadastrada neste centro.</p>
      )}

      {lista.map((p, i) => {
        const temLayout =
          p.layouts != null &&
          typeof p.layouts === 'object' &&
          Object.keys(p.layouts as Data).length > 0
        return (
          <div key={i} className="border border-zinc-800 rounded-lg p-2.5 space-y-2 bg-zinc-950/40">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">#{i + 1}</span>
              <button onClick={() => remover(i)} className="text-xs text-zinc-500 hover:text-red-300">
                Remover
              </button>
            </div>
            <MiniCampo label="Nome" value={p.nome} placeholder="Zebra 1" onChange={v => patch(i, 'nome', v)} />
            <MiniCampo
              label="Caminho / compartilhamento"
              value={p.caminho}
              placeholder="\\PC\Zebra1"
              mono
              onChange={v => patch(i, 'caminho', v)}
            />
            <div className="grid grid-cols-2 gap-2">
              <MiniCampo
                label="DPI (opcional)"
                value={p.dpi}
                type="number"
                placeholder="203"
                onChange={v => patch(i, 'dpi', v === '' ? undefined : Number(v))}
              />
              <MiniCampo
                label="Escuridão −30..30"
                value={p.escuridao}
                type="number"
                placeholder="0"
                onChange={v => patch(i, 'escuridao', v === '' ? undefined : Number(v))}
              />
            </div>
            {temLayout && (
              <p className="text-[11px] text-zinc-600">
                Layout de etiqueta configurado (preservado) — a posição dos campos é editada na tela
                de etiquetas do Coreon.
              </p>
            )}
          </div>
        )
      })}

      <p className="text-[11px] text-zinc-600">
        Nome e caminho identificam a impressora; o Coreon aceita uma impressora instalada ou um
        compartilhamento <span className="font-mono">{'\\\\PC\\Zebra'}</span>. O layout de ZPL fica no
        cadastro da impressora e é preservado ao salvar.
      </p>
    </div>
  )
}

function MiniCampo({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  mono,
}: {
  label: string
  value: unknown
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  mono?: boolean
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-zinc-500 mb-0.5">{label}</label>
      <input
        type={type}
        value={value == null ? '' : String(value)}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-green-500 ${
          mono ? 'font-mono' : ''
        }`}
      />
    </div>
  )
}

// ── Campo genérico ───────────────────────────────────────────────────────────
function Campo({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (spec.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
        <input
          type="checkbox"
          checked={!!value}
          onChange={e => onChange(e.target.checked)}
          className="w-4 h-4 accent-green-500"
        />
        {spec.label}
      </label>
    )
  }

  if (spec.type === 'list') {
    const txt = asList(value).join('\n')
    return (
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
          {spec.label} <span className="text-zinc-600">(1 por linha)</span>
        </label>
        <textarea
          value={txt}
          onChange={e =>
            onChange(
              e.target.value
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean),
            )
          }
          rows={3}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-green-500 resize-y"
        />
      </div>
    )
  }

  if (spec.type === 'number') {
    return (
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
          {spec.label}
        </label>
        <input
          type="number"
          value={value == null ? '' : String(value)}
          onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
        />
      </div>
    )
  }

  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
        {spec.label}
      </label>
      <input
        value={value == null ? '' : String(value)}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
      />
    </div>
  )
}

// ── Busca no diretório (fluxo do PA de usuários) ─────────────────────────────
// Envia { usuario: "<username>@<tenant>" }; o tenant vem da empresa do usuário
// (primeiro centro → empresa → empresas.tenant).
function BuscaDiretorio(props: {
  url: string
  username: string
  centros: string[]
  centrosJson: CentrosJson
  tenants: Record<string, string>
  onNome: (n: string) => void
}) {
  const { tenant } = tenantDoUsuario(props.centros, props.centrosJson, props.tenants)
  const alvo = props.username.trim() ? `${props.username.trim()}@${tenant}` : ''
  const [busy, setBusy] = useState(false)
  const [resp, setResp] = useState<unknown>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    setResp(null)
    setErro(null)
  }, [alvo])

  async function buscar() {
    setBusy(true)
    setErro(null)
    setResp(null)
    try {
      setResp(await buscarUsuarioNoFluxo(props.url, props.username, tenant))
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pessoa = lerPessoa(resp)
  return (
    <div className="rounded-lg border border-zinc-700 p-2.5 space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-zinc-400 text-xs flex-1 truncate font-mono">{alvo || 'informe o usuário'}</span>
        <button
          onClick={() => void buscar()}
          disabled={busy || !alvo}
          className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded text-xs"
        >
          {busy ? 'Buscando...' : 'Buscar no diretório'}
        </button>
      </div>
      {erro && <p className="text-red-300 text-xs">❌ {erro}</p>}
      {resp != null && !pessoa && (
        <p className="text-amber-300 text-xs">
          Não encontrado no diretório. Confira o usuário e a empresa (o tenant enviado está acima).
        </p>
      )}
      {pessoa && (
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-medium">{pessoa.nome}</div>
            <div className="text-xs text-zinc-400">
              {[pessoa.cargo, pessoa.setor, pessoa.local].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
          <button
            onClick={() => props.onNome(pessoa.nome)}
            className="px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-xs shrink-0"
          >
            Usar como nome
          </button>
        </div>
      )}
    </div>
  )
}
