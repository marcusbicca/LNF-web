import { useMemo, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// LogViewer — o log do Coreon deixa de ser um <pre> e vira algo navegável.
//
// ── por que dá para fazer isto sem tocar no Coreon ──────────────────────────
//
// O LogService já escreve uma linha estruturada, sempre no mesmo formato:
//
//   [2026-08-27 14:03:22] [INFO ] [SapNcoService.BuscarNfSap] [SAP RFC] mensagem
//    └─ data/hora        └─ nível └─ módulo.função            └─ etiqueta
//
// Os três primeiros colchetes vêm do próprio LogService; o quarto é a etiqueta
// que quem escreveu a linha pôs à mão ([CICLO], [SAP RFC], [EXPURGO], [HTTP]…).
// Tudo o que esta tela mostra sai daí — nenhuma coluna nova no Supabase,
// nenhuma mudança no Coreon, e funciona com os logs que JÁ estão gravados.
//
// ── linhas de continuação ────────────────────────────────────────────────────
//
// Nem toda linha do arquivo é um registro. Um stack trace, ou o despejo de
// parâmetros de uma falha de RFC, ocupa dez linhas que pertencem ao registro
// anterior. Quebrá-las em registros soltos jogaria fora justamente a parte que
// explica o erro — e elas não têm nível nem etiqueta para filtrar. Então tudo
// que não começa com data entra como continuação de quem veio antes, e some ou
// aparece JUNTO com ele.
//
// ── cor ─────────────────────────────────────────────────────────────────────
//
// A cor da etiqueta e a do módulo saem de um hash do próprio texto. É de
// propósito: uma lista fixa de cores por etiqueta teria que ser mantida à mão, e
// a etiqueta seguinte que alguém inventar no Coreon nasceria sem cor. Do hash,
// [CICLO] é sempre do mesmo tom, hoje e no log de daqui a um ano, sem ninguém
// cadastrar nada.
// ─────────────────────────────────────────────────────────────────────────────

type Registro = {
  id: number
  hora: string        // HH:mm:ss (a data completa fica em dataHora)
  dataHora: string
  nivel: string       // INFO | WARN | ERROR | DEBUG
  modulo: string      // SapNcoService
  funcao: string      // BuscarNfSap
  tag: string         // SAP RFC  (vazio quando a linha não tem etiqueta)
  msg: string
  extras: string[]    // linhas de continuação
  busca: string       // tudo em minúsculas, pré-computado para o filtro
}

// [data] [nível] [módulo.função] resto
const RE_LINHA = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s*\[([^\]]*)\]\s*\[([^\]]*)\]\s*([\s\S]*)$/
// Etiqueta no começo da mensagem: [SAP RFC], [CICLO]… Aceita espaço e acento,
// recusa o que tiver ':' ou '=' (que costuma ser dado, não etiqueta).
const RE_TAG = /^\[([^\]:=]{1,24})\]\s*([\s\S]*)$/

function parse(conteudo: string): { registros: Registro[]; cabecalho: string[] } {
  const linhas = (conteudo ?? '').split(/\r?\n/)
  const registros: Registro[] = []
  const cabecalho: string[] = []
  let id = 0

  for (const linha of linhas) {
    const m = RE_LINHA.exec(linha)
    if (!m) {
      // Antes do primeiro registro é o cabeçalho que o DebugPaService escreve
      // (usuário, data, motivo, PID). Depois dele, é continuação.
      if (registros.length === 0) {
        if (linha.trim()) cabecalho.push(linha)
      } else if (linha.length > 0) {
        registros[registros.length - 1].extras.push(linha)
      }
      continue
    }

    const [, dataHora, nivelBruto, origem, resto] = m
    const ponto = origem.lastIndexOf('.')
    const modulo = ponto > 0 ? origem.slice(0, ponto) : origem
    const funcao = ponto > 0 ? origem.slice(ponto + 1) : ''

    const t = RE_TAG.exec(resto)
    const tag = t ? t[1].trim() : ''
    const msg = t ? t[2] : resto

    registros.push({
      id: id++,
      hora: dataHora.slice(11),
      dataHora,
      nivel: nivelBruto.trim().toUpperCase(),
      modulo,
      funcao,
      tag,
      msg,
      extras: [],
      busca: '',
    })
  }

  // A string de busca inclui as continuações: procurar por "NOT_AUTHORIZED"
  // tem que achar o registro cujo despejo de parâmetros contém a palavra,
  // mesmo que o título da linha não a tenha.
  for (const r of registros)
    r.busca = (r.dataHora + ' ' + r.nivel + ' ' + r.modulo + ' ' + r.funcao + ' ' +
               r.tag + ' ' + r.msg + ' ' + r.extras.join(' ')).toLowerCase()

  return { registros, cabecalho }
}

// ── cores ───────────────────────────────────────────────────────────────────
//
// Classes ESCRITAS POR EXTENSO, e não montadas com template string: o Tailwind
// varre o código-fonte procurando nomes de classe literais, e uma classe
// construída em tempo de execução simplesmente não vai para o CSS.
const PALETA = [
  'text-sky-300 bg-sky-500/10 border-sky-500/30',
  'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  'text-violet-300 bg-violet-500/10 border-violet-500/30',
  'text-amber-300 bg-amber-500/10 border-amber-500/30',
  'text-rose-300 bg-rose-500/10 border-rose-500/30',
  'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  'text-lime-300 bg-lime-500/10 border-lime-500/30',
  'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/30',
  'text-orange-300 bg-orange-500/10 border-orange-500/30',
  'text-teal-300 bg-teal-500/10 border-teal-500/30',
]

// djb2. Serve porque só precisa espalhar bem e ser estável entre sessões —
// não é hash criptográfico e nem precisa ser.
function corDe(texto: string): string {
  let h = 5381
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0
  return PALETA[Math.abs(h) % PALETA.length]
}

// Nível tem cor FIXA, e não do hash: erro é vermelho em todo lugar do mundo, e
// sortear uma cor para ERROR seria perder a única convenção que já existe.
const COR_NIVEL: Record<string, string> = {
  ERROR: 'text-red-300 bg-red-500/15 border-red-500/40',
  WARN: 'text-amber-300 bg-amber-500/15 border-amber-500/40',
  INFO: 'text-zinc-400 bg-zinc-500/10 border-zinc-600/40',
  DEBUG: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
}
function corNivel(n: string): string {
  return COR_NIVEL[n] ?? 'text-zinc-400 bg-zinc-500/10 border-zinc-600/40'
}

const COR_TEXTO_NIVEL: Record<string, string> = {
  ERROR: 'text-red-200',
  WARN: 'text-amber-200',
  DEBUG: 'text-blue-200',
}

// ── um grupo de fichas filtráveis ───────────────────────────────────────────

type FacetaProps = {
  titulo: string
  valores: Array<{ valor: string; n: number }>
  ativos: Set<string>
  aoAlternar: (v: string) => void
  colorir?: boolean
}

function Faceta({ titulo, valores, ativos, aoAlternar, colorir }: FacetaProps) {
  if (valores.length === 0) return null
  return (
    <div className="flex items-start gap-2">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500 pt-1 w-16 shrink-0">
        {titulo}
      </span>
      <div className="flex flex-wrap gap-1">
        {valores.map(({ valor, n }) => {
          const on = ativos.has(valor)
          const cor = colorir ? corDe(valor) : 'text-zinc-300 bg-zinc-800 border-zinc-700'
          return (
            <button
              key={valor}
              onClick={() => aoAlternar(valor)}
              title={`${valor} — ${n} linha(s)`}
              className={`text-[11px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                on ? cor + ' ring-1 ring-white/40' : cor + ' opacity-50 hover:opacity-90'
              }`}
            >
              {valor}
              <span className="ml-1 opacity-60">{n}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── a tela ──────────────────────────────────────────────────────────────────

export function LogViewer({ conteudo }: { conteudo: string }) {
  const { registros, cabecalho } = useMemo(() => parse(conteudo), [conteudo])

  const [busca, setBusca] = useState('')
  const [niveis, setNiveis] = useState<Set<string>>(new Set())
  const [tags, setTags] = useState<Set<string>>(new Set())
  const [modulos, setModulos] = useState<Set<string>>(new Set())
  const [funcoes, setFuncoes] = useState<Set<string>>(new Set())
  const [mostrarExtras, setMostrarExtras] = useState(true)
  const [expandido, setExpandido] = useState<Set<number>>(new Set())
  // Texto, e não número: o campo precisa poder ficar VAZIO enquanto se digita,
  // e um estado numérico transforma "" em 0 a cada tecla.
  const [contexto, setContexto] = useState('')

  // As opções saem do conteúdo, ordenadas por frequência: a etiqueta que
  // aparece 300 vezes é a que se quer desligar primeiro para enxergar o resto.
  function contar(sel: (r: Registro) => string) {
    const m = new Map<string, number>()
    for (const r of registros) {
      const v = sel(r)
      if (v) m.set(v, (m.get(v) ?? 0) + 1)
    }
    return [...m.entries()]
      .map(([valor, n]) => ({ valor, n }))
      .sort((a, b) => b.n - a.n || a.valor.localeCompare(b.valor))
  }

  const optNiveis = useMemo(() => contar(r => r.nivel), [registros])
  const optTags = useMemo(() => contar(r => r.tag), [registros])
  const optModulos = useMemo(() => contar(r => r.modulo), [registros])
  // Função é a lista mais longa; sem um teto ela vira uma parede de fichas.
  const optFuncoes = useMemo(() => contar(r => r.funcao).slice(0, 40), [registros])

  // ── contexto: N linhas em volta de cada acerto ────────────────────────────
  //
  // Filtrar por ERROR mostra o erro e esconde o que estava acontecendo em
  // volta — que costuma ser onde está a explicação. Com N preenchido, cada
  // linha que passou no filtro traz N vizinhas de cada lado.
  //
  // Vizinhança é do LOG, não do resultado: as N linhas contadas são as que
  // estavam ali no arquivo, inclusive as que o filtro rejeitou. Contar sobre o
  // que sobrou do filtro devolveria "as N linhas filtradas mais próximas", que
  // não é vizinhança de nada.
  //
  // Acertos PRÓXIMOS não duplicam nem se atropelam: o que se marca é um
  // conjunto de índices. Dois erros a três linhas um do outro, com N=5, viram
  // um bloco contínuo — cada linha aparece uma vez, na ordem do arquivo. Era a
  // preocupação certa, e é o motivo de isto ser um Set e não uma concatenação
  // de fatias.
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const passa = (r: Registro) => {
      if (niveis.size && !niveis.has(r.nivel)) return false
      if (tags.size && !tags.has(r.tag)) return false
      if (modulos.size && !modulos.has(r.modulo)) return false
      if (funcoes.size && !funcoes.has(r.funcao)) return false
      if (q && !r.busca.includes(q)) return false
      return true
    }

    const n = Math.max(0, Math.min(Number(contexto) || 0, 50))
    const temFiltroAtivo =
      !!q || niveis.size > 0 || tags.size > 0 || modulos.size > 0 || funcoes.size > 0

    // Sem filtro nenhum, contexto não quer dizer nada: já está tudo na tela.
    if (n === 0 || !temFiltroAtivo) {
      return registros.filter(passa).map(r => ({ r, acerto: true }))
    }

    const manter = new Set<number>()
    for (let i = 0; i < registros.length; i++) {
      if (!passa(registros[i])) continue
      for (let j = Math.max(0, i - n); j <= Math.min(registros.length - 1, i + n); j++)
        manter.add(j)
    }

    return registros
      .map((r, i) => ({ r, i }))
      .filter(({ i }) => manter.has(i))
      .map(({ r }) => ({ r, acerto: passa(r) }))
  }, [registros, busca, niveis, tags, modulos, funcoes, contexto])

  function alternar(set: Set<string>, aplicar: (s: Set<string>) => void, v: string) {
    const novo = new Set(set)
    if (novo.has(v)) novo.delete(v)
    else novo.add(v)
    aplicar(novo)
  }

  function limpar() {
    setBusca('')
    setNiveis(new Set())
    setTags(new Set())
    setModulos(new Set())
    setFuncoes(new Set())
  }

  const temFiltro = !!busca || niveis.size > 0 || tags.size > 0 || modulos.size > 0 || funcoes.size > 0
  const acertos = useMemo(() => filtrados.filter(f => f.acerto).length, [filtrados])

  // Sem nenhuma linha reconhecida, o formato não é o do LogService (um trace do
  // NCo, por exemplo). Mostrar o texto cru é melhor que mostrar uma tela vazia
  // e sofisticada.
  if (registros.length === 0) {
    return (
      <pre className="max-h-96 overflow-auto bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-300 whitespace-pre-wrap break-words">
        {conteudo || '(vazio)'}
      </pre>
    )
  }

  return (
    <div className="space-y-2">
      {cabecalho.length > 0 && (
        <div className="text-[11px] font-mono text-zinc-500 bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1 whitespace-pre-wrap">
          {cabecalho.join('\n')}
        </div>
      )}

      <div className="space-y-1.5 bg-zinc-900/40 border border-zinc-800 rounded-lg p-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Procurar no texto das linhas..."
            className="flex-1 min-w-40 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-green-500"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 whitespace-nowrap">
            <input
              type="checkbox"
              checked={mostrarExtras}
              onChange={e => setMostrarExtras(e.target.checked)}
              className="accent-green-600"
            />
            detalhes das linhas
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 whitespace-nowrap"
                 title="Linhas do log mostradas antes e depois de cada linha que passou no filtro. Vazio = só as filtradas.">
            contexto ±
            <input
              value={contexto}
              onChange={e => setContexto(e.target.value.replace(/\D/g, '').slice(0, 2))}
              placeholder="0"
              inputMode="numeric"
              className="w-10 bg-zinc-900 border border-zinc-700 rounded px-1 py-1 text-xs text-center focus:outline-none focus:border-green-500"
            />
          </label>
          {temFiltro && (
            <button
              onClick={limpar}
              className="text-[11px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1 text-zinc-300"
            >
              Limpar filtros
            </button>
          )}
        </div>

        <Faceta titulo="nível" valores={optNiveis} ativos={niveis}
                aoAlternar={v => alternar(niveis, setNiveis, v)} />
        <Faceta titulo="etiqueta" valores={optTags} ativos={tags} colorir
                aoAlternar={v => alternar(tags, setTags, v)} />
        <Faceta titulo="módulo" valores={optModulos} ativos={modulos} colorir
                aoAlternar={v => alternar(modulos, setModulos, v)} />
        <Faceta titulo="função" valores={optFuncoes} ativos={funcoes}
                aoAlternar={v => alternar(funcoes, setFuncoes, v)} />

        <p className="text-[11px] text-zinc-500">
          {filtrados.length === registros.length
            ? `${registros.length} linha(s).`
            : `${filtrados.length} de ${registros.length} linha(s)` +
              (acertos < filtrados.length ? ` — ${acertos} no filtro, o resto é contexto.` : '.')}
        </p>
      </div>

      <div className="max-h-[32rem] overflow-auto bg-zinc-950 border border-zinc-800 rounded-lg divide-y divide-zinc-900">
        {filtrados.map(({ r, acerto }) => {
          const aberto = expandido.has(r.id)
          // Um despejo de RFC tem dezenas de linhas. Mostrar as primeiras dá o
          // contexto sem que UM registro empurre todo o resto para fora da tela.
          const limite = aberto ? r.extras.length : 6
          const extras = mostrarExtras ? r.extras.slice(0, limite) : []
          const sobraram = mostrarExtras ? r.extras.length - extras.length : 0
          return (
            // Linha de CONTEXTO fica apagada. Sem essa diferença o resultado
            // vira uma parede em que não se distingue o que casou com o filtro
            // do que veio junto — e aí o contexto atrapalha em vez de ajudar.
            <div
              key={r.id}
              className={`px-2 py-1 font-mono text-[11px] leading-relaxed hover:bg-zinc-900/60 ${
                acerto ? '' : 'opacity-45'
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-zinc-600" title={r.dataHora}>{r.hora}</span>
                <span className={`px-1 rounded border ${corNivel(r.nivel)}`}>{r.nivel}</span>
                {r.tag && (
                  <span className={`px-1 rounded border ${corDe(r.tag)}`}>{r.tag}</span>
                )}
                <span className={`px-1 rounded border ${corDe(r.modulo)}`}>{r.modulo}</span>
                {r.funcao && <span className="text-zinc-500">{r.funcao}</span>}
                <span className={`whitespace-pre-wrap break-words ${COR_TEXTO_NIVEL[r.nivel] ?? 'text-zinc-300'}`}>
                  {r.msg}
                </span>
              </div>
              {extras.length > 0 && (
                <pre className="mt-0.5 ml-4 pl-2 border-l border-zinc-800 text-zinc-500 whitespace-pre-wrap break-words">
                  {extras.join('\n')}
                </pre>
              )}
              {sobraram > 0 && (
                <button
                  onClick={() => {
                    const novo = new Set(expandido)
                    novo.add(r.id)
                    setExpandido(novo)
                  }}
                  className="ml-6 text-[11px] text-zinc-500 hover:text-zinc-300 underline"
                >
                  … mais {sobraram} linha(s)
                </button>
              )}
            </div>
          )
        })}
        {filtrados.length === 0 && (
          <p className="px-3 py-4 text-center text-zinc-500 text-xs">
            Nenhuma linha com esses filtros.
          </p>
        )}
      </div>
    </div>
  )
}
