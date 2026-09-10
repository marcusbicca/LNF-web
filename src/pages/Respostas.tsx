import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'
import {
  SolicitacoesService,
  encerrada,
  type Solicitacao,
  type StatusSolicitacao,
  type Execucao,
} from '../services/solicitacoes'

// ─────────────────────────────────────────────────────────────────────────────
// Respostas — a fila de solicitações e o que cada uma devolveu.
//
// O PROBLEMA DE VISUALIZAÇÃO. O 'resultado' é o JSON cru que a pipe devolveu, e
// cada pipe devolve uma forma diferente: o 'executar' traz uma lista de NFs com
// itens dentro, o 'nf_status' traz um objeto raso, o 'ping' traz duas chaves.
// Não dá para escrever uma tela por pipe — seriam 85, e a 86ª nasceria sem.
//
// A SAÍDA É ACHATAR POR ESTRUTURA, E NÃO POR NOME. O visualizador varre o JSON
// e classifica cada nó:
//
//   array de objetos  → TABELA, com uma coluna por chave vista
//   objeto            → lista de pares chave/valor, e recursão nos filhos
//   escalar           → uma linha
//
// Isso funciona para qualquer pipe, inclusive as que ainda não existem, porque
// não depende de conhecer nome nenhum.
//
// CSV E NÃO XLSX. Cada tabela desce como CSV — Excel abre direto, com o BOM que
// faz ele respeitar os acentos. Gerar .xlsx de verdade exigiria uma biblioteca
// pesada num app que hoje tem só React como dependência de runtime, e o ganho
// seria formatação que ninguém pediu.
// ─────────────────────────────────────────────────────────────────────────────

type Json = unknown

const STATUS_COR: Record<StatusSolicitacao, string> = {
  pendente: 'text-zinc-400',
  executando: 'text-blue-400',
  concluida: 'text-green-400',
  erro: 'text-red-400',
  expirada: 'text-amber-500',
}

// ── quantas linhas buscar ───────────────────────────────────────────────────
//
// Era 100, fixo no código. Cem é muito mais do que se olha na prática, e cada
// leitura custa um run do fluxo — com a auto-atualização ligada, um a cada 5
// segundos, trazendo noventa linhas que ninguém leu.
//
// Os degraus são poucos de propósito: um campo livre convidaria a digitar 5000,
// e a tela não tem paginação para sustentar isso.
const LIMITES = [10, 25, 50, 100, 250]
const LIMITE_PADRAO = 25
const LIMITE_KEY = 'lnf.respostas.limite'
const PESSOA_KEY = 'lnf.respostas.porPessoa'

// ── universal: uma linha, ou uma por pessoa ─────────────────────────────────
//
// Uma solicitação universal roda em TODAS as máquinas, e na tabela ela era uma
// linha só, com Executor vazio — porque a coluna 'executor' da solicitação
// nunca é preenchida nesse caso. Quem executou e o que cada um respondeu vive
// em `solicitacoes_execucoes`, uma linha por máquina.
//
// As duas visões respondem perguntas diferentes, e por isso as duas existem:
//
//   agregado   "o que essa ação fez?"      — uma linha, e o detalhe traz as N
//   por pessoa "quem respondeu o quê?"     — N linhas, cada uma como se fosse
//                                            uma solicitação individual
//
// A de por pessoa SINTETIZA uma Solicitacao a partir de cada execução. Não é
// truque: é o que faz o visualizador de JSON, o CSV e a duração — que já
// existem e funcionam — servirem sem nenhuma linha nova.
function comoSolicitacao(s: Solicitacao, e: Execucao): Solicitacao {
  return {
    ...s,
    status: e.status,
    executor: e.executor,
    maquina: e.maquina,
    iniciado_em: e.iniciado_em,
    terminado_em: e.terminado_em,
    resultado: e.resultado,
    erro: e.erro,
  }
}

function dt(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('pt-BR')
}

function duracao(s: Solicitacao): string {
  if (!s.iniciado_em || !s.terminado_em) return '—'
  const ms = new Date(s.terminado_em).getTime() - new Date(s.iniciado_em).getTime()
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function Respostas() {
  const { config } = useApp()
  const svc = useMemo(
    () => (config ? new SupabaseService(config) : null),
    [config],
  )
  const sol = useMemo(
    () => (svc ? new SolicitacoesService(svc, config?.usuario ?? '') : null),
    [svc, config],
  )

  const [linhas, setLinhas] = useState<Solicitacao[]>([])

  // As execuções das universais que estão na tela, por id da solicitação.
  // Vazio para as individuais — ver a nota do comoSolicitacao.
  const [execs, setExecs] = useState<Record<number, Execucao[]>>({})
  const [porPessoa, setPorPessoa] = useState<boolean>(() => {
    try { return localStorage.getItem(PESSOA_KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem(PESSOA_KEY, porPessoa ? '1' : '0') } catch { /* conforto */ }
  }, [porPessoa])
  const [sel, setSel] = useState<Solicitacao | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<string>('')
  const [autoAtualizar, setAutoAtualizar] = useState(false)

  // Guardado no localStorage porque é preferência de quem usa, não estado da
  // tela: quem trabalha com as últimas dez não quer reescolher a cada visita.
  // Em try/catch — navegador com armazenamento bloqueado não pode derrubar a
  // página por causa de uma preferência.
  const [limite, setLimite] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(LIMITE_KEY))
      return LIMITES.includes(n) ? n : LIMITE_PADRAO
    } catch {
      return LIMITE_PADRAO
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(LIMITE_KEY, String(limite))
    } catch {
      /* preferência é conforto; nunca derruba a tela */
    }
  }, [limite])

  const carregar = useCallback(async () => {
    if (!sol) return
    setCarregando(true)
    setErro(null)
    try {
      const f = filtroStatus ? `status=eq.${filtroStatus}` : undefined
      const rows = await sol.listar({ limit: limite, filtros: f })
      setLinhas(rows)

      // Uma consulta só para todas as linhas da tela. Falhar aqui não derruba
      // a lista: sem as execuções, as universais voltam a aparecer como uma
      // linha sem executor, que é o comportamento antigo.
      try {
        setExecs(await sol.execucoesDe(rows.map((r) => r.id)))
      } catch {
        setExecs({})
      }
      // Mantém a seleção apontando para a versão nova da mesma linha — sem
      // isso, um refresh durante uma execução congelaria o painel no estado
      // 'executando' e pareceria travado.
      setSel((s) => (s ? rows.find((r) => r.id === s.id) ?? s : null))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [sol, filtroStatus, limite])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // ── o que a tabela mostra ────────────────────────────────────────────────
  //
  // 'chave' existe porque no modo por pessoa o mesmo id aparece N vezes — e o
  // React precisa distinguir as linhas. 'exec' marca a linha sintética, para a
  // coluna Executor não repetir o rótulo "N máquinas".
  const exibidas = useMemo(() => {
    const out: Array<{ chave: string; s: Solicitacao; exec: boolean; n: number }> = []
    for (const l of linhas) {
      const es = execs[l.id] ?? []
      if (porPessoa && es.length > 0) {
        for (const e of es)
          out.push({ chave: `${l.id}|${e.executor}|${e.maquina}`, s: comoSolicitacao(l, e), exec: true, n: 0 })
      } else {
        out.push({ chave: String(l.id), s: l, exec: false, n: es.length })
      }
    }
    return out
  }, [linhas, execs, porPessoa])

  // Auto-atualização só enquanto houver algo em voo. Ligada o tempo todo, seria
  // uma chamada de fluxo a cada 5s por aba aberta — o mesmo desperdício que o
  // Coreon acabou de deixar de fazer.
  const emVoo = linhas.some((l) => !encerrada(l))
  useEffect(() => {
    if (!autoAtualizar || !emVoo) return
    const t = setInterval(() => void carregar(), 5000)
    return () => clearInterval(t)
  }, [autoAtualizar, emVoo, carregar])

  if (!config)
    return (
      <div className="p-4 text-zinc-400">
        Configure a URL do Power Automate em <b>Configurações</b>.
      </div>
    )

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void carregar()}
          disabled={carregando}
          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded px-3 py-1.5 text-sm"
        >
          {carregando ? 'Lendo…' : 'Atualizar'}
        </button>

        <select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm"
        >
          <option value="">todos os status</option>
          <option value="pendente">pendente</option>
          <option value="executando">executando</option>
          <option value="concluida">concluída</option>
          <option value="erro">erro</option>
          <option value="expirada">expirada</option>
        </select>

        <select
          value={limite}
          onChange={(e) => setLimite(Number(e.target.value))}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm"
          title="Quantas solicitações buscar. Cada leitura custa uma chamada do fluxo."
        >
          {LIMITES.map((n) => (
            <option key={n} value={n}>
              últimas {n}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={autoAtualizar}
            onChange={(e) => setAutoAtualizar(e.target.checked)}
          />
          Auto {emVoo ? '(a cada 5s)' : '(nada em voo)'}
        </label>

        {/* Só quando há universal à vista: para uma tela só de individuais o
            controle não muda nada, e um interruptor inerte confunde. */}
        {Object.keys(execs).length > 0 && (
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={porPessoa}
              onChange={(e) => setPorPessoa(e.target.checked)}
            />
            Universais: uma linha por pessoa
          </label>
        )}

        {/* Bateu no teto = provavelmente há mais. Sem este aviso, "25 linhas"
            se lê como "só existem 25", que é a leitura errada e silenciosa. */}
        <span className="text-xs text-zinc-600 ml-auto">
          {exibidas.length} linha(s){linhas.length === limite ? ' — no limite, pode haver mais' : ''}
        </span>
      </div>

      {erro && (
        <div className="text-sm text-red-400 border border-red-900 bg-red-950/30 rounded p-3">
          {erro}
        </div>
      )}

      <div className="overflow-x-auto border border-zinc-800 rounded">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              {['#', 'Ação', 'Status', 'Executor', 'Sessão', 'Criada', 'Duração'].map((h) => (
                <th key={h} className="text-left px-2 py-1.5 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exibidas.map(({ chave, s: l, exec, n }) => (
              <tr
                key={chave}
                onClick={() => setSel(l)}
                className={`cursor-pointer border-t border-zinc-900 hover:bg-zinc-900 ${
                  sel === l ? 'bg-zinc-900' : ''
                }`}
              >
                <td className="px-2 py-1 text-zinc-500">
                  {exec ? <span className="text-zinc-700">↳ {l.id}</span> : l.id}
                </td>
                <td className="px-2 py-1 font-mono">{l.acao}</td>
                <td className={`px-2 py-1 ${STATUS_COR[l.status]}`}>{l.status}</td>
                <td className="px-2 py-1 text-zinc-400">
                  {l.executor
                    ? l.executor
                    : n > 0
                      ? <span className="text-amber-500">{n} {n === 1 ? 'máquina' : 'máquinas'}</span>
                      : '—'}
                </td>
                <td className="px-2 py-1 font-mono text-xs text-zinc-500">
                  {l.sessao_id ?? '—'}
                </td>
                <td className="px-2 py-1 text-zinc-500 whitespace-nowrap">{dt(l.criado_em)}</td>
                <td className="px-2 py-1 text-zinc-500">{duracao(l)}</td>
              </tr>
            ))}
            {!exibidas.length && !carregando && (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-zinc-600">
                  Nenhuma solicitação.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {sel && (
        <Detalhe
          s={sel}
          // Só na visão agregada: no modo por pessoa a linha JÁ é de uma
          // máquina só, e repetir as N ali seria mostrar o contrário do que a
          // pessoa pediu ao trocar de visão.
          execucoes={!porPessoa ? (execs[sel.id] ?? []) : []}
          onFechar={() => setSel(null)}
        />
      )}
    </div>
  )
}

// ── painel de detalhe ────────────────────────────────────────────────────────
function Detalhe({
  s,
  execucoes = [],
  onFechar,
}: {
  s: Solicitacao
  /** As N máquinas, quando esta é a linha agregada de uma universal. */
  execucoes?: Execucao[]
  onFechar: () => void
}) {
  const [verBruto, setVerBruto] = useState(false)

  // O Coreon embrulha a resposta do pipe num envelope com a duração —
  // ver SolicitacaoRemotaService.ResultadoJson. Desembrulha para mostrar o que
  // interessa, mas guarda o envelope para o modo bruto.
  const env = (s.resultado ?? null) as Record<string, unknown> | null
  const resposta = env && typeof env === 'object' && 'resposta' in env ? env.resposta : env

  return (
    <div className="border border-zinc-800 rounded">
      <div className="flex items-center gap-3 px-3 py-2 bg-zinc-900 border-b border-zinc-800">
        <span className="font-mono text-sm">
          #{s.id} · {s.acao}
        </span>
        <span className={`text-sm ${STATUS_COR[s.status]}`}>{s.status}</span>
        <button
          onClick={() => setVerBruto((v) => !v)}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
        >
          {verBruto ? 'organizado' : 'JSON bruto'}
        </button>
        <button onClick={onFechar} className="text-xs text-zinc-500 hover:text-zinc-300">
          fechar
        </button>
      </div>

      <div className="p-3 space-y-4">
        <Pares
          titulo="Solicitação"
          pares={[
            ['Criada por', s.criado_por ?? '—'],
            ['Criada em', dt(s.criado_em)],
            ['Sessão', s.sessao_id ?? '—'],
            ['Destinatário', s.destinatario ?? '(qualquer máquina)'],
            ['Executor', s.executor ?? '—'],
            ['Máquina', s.maquina ?? '—'],
            ['Iniciada', dt(s.iniciado_em)],
            ['Terminada', dt(s.terminado_em)],
            ['Duração', duracao(s)],
            ['Login SAP', s.sap_usuario ?? '(o do operador)'],
            ['Senha no banco', s.tem_senha ? 'ainda presente' : 'apagada na reserva'],
          ]}
        />

        {s.erro && (
          <div className="text-sm text-red-400 border border-red-900 bg-red-950/30 rounded p-2">
            {s.erro}
          </div>
        )}

        {/* ── as N máquinas, agregadas ─────────────────────────────────────
            Cada uma com o MESMO visualizador do resultado individual: o JSON
            é achatado por estrutura, então serve para qualquer pipe. */}
        {execucoes.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-zinc-500">
              Respostas por máquina ({execucoes.length})
            </h3>
            {execucoes.map((e) => (
              <RespostaDeUm key={`${e.executor}|${e.maquina}`} e={e} />
            ))}
          </div>
        )}

        {verBruto ? (
          <pre className="text-xs bg-black border border-zinc-800 rounded p-3 overflow-x-auto">
            {JSON.stringify({ payload: s.payload, resultado: s.resultado }, null, 2)}
          </pre>
        ) : (
          <>
            <NoJson titulo="Enviado" valor={s.payload} caminho={`sol${s.id}-payload`} />
            <NoJson titulo="Resposta" valor={resposta} caminho={`sol${s.id}-resposta`} />
          </>
        )}
      </div>
    </div>
  )
}

function Pares({ titulo, pares }: { titulo: string; pares: Array<[string, string]> }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">{titulo}</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-sm">
        {pares.map(([k, v]) => (
          <div key={k} className="flex gap-2 min-w-0">
            <span className="text-zinc-500 shrink-0">{k}:</span>
            <span className="truncate" title={v}>
              {v}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── o visualizador genérico ──────────────────────────────────────────────────
//
// Recursivo, e a recursão termina porque todo JSON é finito. 'nivel' só existe
// para o recuo visual; não há teto de profundidade porque uma resposta de pipe
// não tem ciclos (veio de JSON).
function NoJson({
  titulo,
  valor,
  caminho,
  nivel = 0,
}: {
  titulo: string
  valor: Json
  caminho: string
  nivel?: number
}) {
  if (valor == null) return null

  // Array de objetos → tabela. É o caso que mais importa: itens de NF,
  // mensagens de retorno do SAP, divergências.
  if (Array.isArray(valor) && valor.length && valor.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
    return <Tabela titulo={titulo} linhas={valor as Record<string, Json>[]} nome={caminho} />
  }

  // Array de escalares → lista curta.
  if (Array.isArray(valor)) {
    if (!valor.length) return null
    return (
      <Secao titulo={`${titulo} (${valor.length})`} nivel={nivel}>
        <ul className="text-sm list-disc pl-5 text-zinc-300">
          {valor.map((v, i) => (
            <li key={i} className="font-mono break-all">
              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </li>
          ))}
        </ul>
      </Secao>
    )
  }

  if (typeof valor === 'object') {
    const entradas = Object.entries(valor as Record<string, Json>)
    const escalares = entradas.filter(([, v]) => v == null || typeof v !== 'object')
    const compostos = entradas.filter(([, v]) => v != null && typeof v === 'object')

    if (!escalares.length && !compostos.length) return null

    return (
      <Secao titulo={titulo} nivel={nivel}>
        {escalares.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-sm mb-2">
            {escalares.map(([k, v]) => (
              <div key={k} className="flex gap-2 min-w-0">
                <span className="text-zinc-500 shrink-0">{k}:</span>
                <span className="truncate font-mono" title={String(v)}>
                  {v === true ? '✓' : v === false ? '✗' : String(v ?? '')}
                </span>
              </div>
            ))}
          </div>
        )}
        {compostos.map(([k, v]) => (
          <NoJson key={k} titulo={k} valor={v} caminho={`${caminho}-${k}`} nivel={nivel + 1} />
        ))}
      </Secao>
    )
  }

  return (
    <Secao titulo={titulo} nivel={nivel}>
      <div className="text-sm font-mono break-all">{String(valor)}</div>
    </Secao>
  )
}

function Secao({
  titulo,
  nivel,
  children,
}: {
  titulo: string
  nivel: number
  children: React.ReactNode
}) {
  return (
    <div className={nivel > 0 ? 'mt-2 pl-3 border-l border-zinc-800' : ''}>
      <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">{titulo}</div>
      {children}
    </div>
  )
}

// ── tabela, com CSV ──────────────────────────────────────────────────────────
function Tabela({
  titulo,
  linhas,
  nome,
}: {
  titulo: string
  linhas: Record<string, Json>[]
  nome: string
}) {
  // A união das chaves, na ordem em que aparecem: linhas de um mesmo array
  // podem ter campos diferentes (o Coreon omite o que é default), e usar só as
  // chaves da primeira esconderia colunas.
  const colunas = useMemo(() => {
    const vistas: string[] = []
    for (const l of linhas) for (const k of Object.keys(l)) if (!vistas.includes(k)) vistas.push(k)
    return vistas
  }, [linhas])

  // Coluna cujo valor é objeto/array vira JSON compacto na célula — melhor que
  // "[object Object]", e o CSV leva o mesmo texto.
  const cel = (v: Json): string =>
    v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v === true ? '✓' : v === false ? '✗' : String(v)

  function baixarCsv() {
    const esc = (s: string) => (/[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s)
    const linhasCsv = [
      colunas.map(esc).join(';'),
      ...linhas.map((l) => colunas.map((c) => esc(cel(l[c]))).join(';')),
    ]
    // BOM: sem ele o Excel abre UTF-8 como Latin-1 e "Validade" vira "ValidÃ¡de".
    // ';' e não ',': é o separador que o Excel em pt-BR espera.
    const blob = new Blob(['﻿' + linhasCsv.join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${nome}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs uppercase tracking-wide text-zinc-500">
          {titulo} ({linhas.length})
        </span>
        <button
          onClick={baixarCsv}
          className="text-xs text-zinc-500 hover:text-green-400"
          title="Abre no Excel"
        >
          ↓ CSV
        </button>
      </div>
      <div className="overflow-x-auto border border-zinc-800 rounded">
        <table className="text-xs">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              {colunas.map((c) => (
                <th key={c} className="text-left px-2 py-1 font-medium whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} className="border-t border-zinc-900">
                {colunas.map((c) => (
                  <td key={c} className="px-2 py-1 whitespace-nowrap max-w-xs truncate" title={cel(l[c])}>
                    {cel(l[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


// ── a resposta de UMA máquina, dentro da linha agregada ──────────────────────
//
// Colapsada por padrão: uma universal em 39 máquinas abriria 39 blocos de JSON,
// e o que se quer ver primeiro é quem terminou e quem deu erro.
//
// Desembrulha o mesmo envelope que o Detalhe desembrulha ({resposta, ...}) —
// o Coreon usa o mesmo formato nos dois casos, então mostrar o envelope aqui e
// o conteúdo lá deixaria as duas telas discordando sobre o que é "o resultado".
function RespostaDeUm({ e }: { e: Execucao }) {
  const cor =
    e.status === 'concluida' ? 'text-green-400'
    : e.status === 'erro'    ? 'text-red-400'
    : 'text-amber-400'

  const env = (e.resultado ?? null) as Record<string, unknown> | null
  const resposta = env && typeof env === 'object' && 'resposta' in env ? env.resposta : env

  const ms =
    e.terminado_em && e.iniciado_em
      ? new Date(e.terminado_em).getTime() - new Date(e.iniciado_em).getTime()
      : null

  return (
    <details className="border border-zinc-800 rounded">
      <summary className="cursor-pointer px-2 py-1.5 text-sm flex items-center gap-2 flex-wrap hover:bg-zinc-900">
        <span className={cor}>●</span>
        <span className="font-mono">{e.executor || '(sem usuário)'}</span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-500 text-xs">{e.maquina || '(sem máquina)'}</span>
        <span className={`ml-auto text-xs ${cor}`}>{e.status}</span>
        {ms != null && <span className="text-zinc-600 text-xs">{(ms / 1000).toFixed(1)}s</span>}
      </summary>

      <div className="p-2 border-t border-zinc-800 space-y-2">
        {e.erro && (
          <div className="text-sm text-red-400 border border-red-900 bg-red-950/30 rounded p-2">
            {e.erro}
          </div>
        )}
        {resposta == null ? (
          <p className="text-xs text-zinc-600">Sem resultado.</p>
        ) : (
          <NoJson
            titulo="Resposta"
            valor={resposta}
            // O caminho identifica a árvore para o CSV e para o estado de
            // aberto/fechado. Sem o executor+máquina aqui, as N respostas de
            // uma universal colidiriam no mesmo caminho.
            caminho={`exec${e.solicitacao_id}-${e.executor}-${e.maquina}`}
          />
        )}
      </div>
    </details>
  )
}
