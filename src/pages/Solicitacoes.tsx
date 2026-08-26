import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'
import {
  SolicitacoesService,
  lerCatalogo,
  coagir,
  novaSessaoId,
  TTL_SESSAO_MIN,
  type Catalogo,
  type Pipe,
  type Solicitacao,
  type Universal,
} from '../services/solicitacoes'

// ─────────────────────────────────────────────────────────────────────────────
// Solicitações — pedir a um Coreon que execute algo.
//
// O fluxo tem três passos, e a tela os mostra em ordem porque cada um depende
// do anterior:
//
//   1. ABRIR SESSÃO. Manda 'iniciar_sessao' sem destinatário. O primeiro Coreon
//      desperto pega e responde com quem é ele (executor/máquina) e, se pedido,
//      o catálogo de todas as pipes. É daí que os formulários saem — nada é
//      escrito à mão nesta tela, senão a lista estaria errada na versão
//      seguinte do Coreon.
//
//   2. ESCOLHER A SESSÃO. Ou a que acabou de abrir, ou uma anterior ainda viva.
//      A sessão amarra os passos: o 'executar' enxerga os XMLs que o
//      'set_xml_path' carregou.
//
//   3. PREENCHER E ENVIAR. Os campos vêm do catálogo, com o controle certo por
//      tipo (checkbox para booleano, área de texto para lista, etc.).
//
// POR QUE O DESTINATÁRIO É FIXADO DO 2º PASSO EM DIANTE: a sessão vive na
// MEMÓRIA da máquina que atendeu o 1º. Mandar o 2º sem endereço deixaria outra
// máquina pegar — e ela não tem o estado.
// ─────────────────────────────────────────────────────────────────────────────

const CAT_KEY = 'lnf_catalogo_pipes'
const SESS_KEY = 'lnf_sessao_remota'

interface SessaoAtiva {
  id: string
  executor: string
  maquina: string
  versaoCoreon: string
  loginSap: string
  aberta: string
  /**
   * Último uso — o relógio que conta, porque o TTL do Coreon é de
   * INATIVIDADE, não de idade. Uma sessão aberta de manhã e usada agora está
   * viva; uma aberta e abandonada há 40 min, não.
   */
  usada: string
}

/** Minutos desde um carimbo ISO. */
function idadeMin(iso: string, agora: number): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? Infinity : (agora - t) / 60_000
}

function vencida(s: SessaoAtiva, agora: number): boolean {
  return idadeMin(s.usada || s.aberta, agora) >= TTL_SESSAO_MIN
}

function haQuanto(iso: string, agora: number): string {
  const m = idadeMin(iso, agora)
  if (!Number.isFinite(m)) return '—'
  if (m < 1) return 'agora'
  if (m < 60) return `há ${Math.floor(m)} min`
  return `há ${Math.floor(m / 60)} h`
}

export function Solicitacoes() {
  const { config } = useApp()
  const svc = useMemo(
    () => (config ? new SupabaseService(config.paUrl, config.usuario) : null),
    [config],
  )
  const sol = useMemo(
    () => (svc ? new SolicitacoesService(svc, config?.usuario ?? '') : null),
    [svc, config],
  )

  // Catálogo e sessão sobrevivem a um F5: o catálogo custa uma ida ao Coreon e
  // não muda dentro de uma versão; a sessão continua viva lá por 30 min.
  const [catalogo, setCatalogo] = useState<Catalogo | null>(() => {
    const s = localStorage.getItem(CAT_KEY)
    return s ? (JSON.parse(s) as Catalogo) : null
  })
  // A sessão guardada só volta se AINDA couber no TTL. Sem esta conta, um F5
  // no dia seguinte restaurava uma sessão morta há horas e a tela seguia
  // oferecendo enviar coisas para ela.
  const [sessao, setSessao] = useState<SessaoAtiva | null>(() => {
    const s = localStorage.getItem(SESS_KEY)
    if (!s) return null
    try {
      const g = JSON.parse(s) as SessaoAtiva
      if (vencida(g, Date.now())) {
        localStorage.removeItem(SESS_KEY)
        return null
      }
      return g
    } catch {
      localStorage.removeItem(SESS_KEY)
      return null
    }
  })

  // Relógio da tela. Uma sessão não vence só quando a página carrega: ela vence
  // enquanto a aba fica aberta, e a tela tem que acompanhar.
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (sessao && vencida(sessao, agora)) {
      setSessao(null)
      localStorage.removeItem(SESS_KEY)
    }
  }, [agora, sessao])

  const [sessoes, setSessoes] = useState<
    Array<{ sessaoId: string; executor: string | null; ultima: string; qtd: number }>
  >([])

  const [incluirPipes, setIncluirPipes] = useState(true)
  const [sapUsuario, setSapUsuario] = useState('')

  // ── para QUEM abrir a sessão ──────────────────────────────────────────────
  //
  // Vazio = a solicitação circula e o primeiro Coreon que a ler fica com ela.
  // Serve para "quero uma máquina qualquer", que é o caso de sondar o catálogo.
  //
  // Preenchido = só a máquina daquele usuário Windows pega. É o caso que
  // importa quando alguém RECLAMA de um problema: a sessão precisa cair na
  // máquina dele, e não na primeira que estiver de olho na fila.
  //
  // Quem filtra é o banco, na pegar_solicitacao — aqui é só a coluna
  // 'destinatario' da linha.
  const [destinatario, setDestinatario] = useState('')
  const [sapSenha, setSapSenha] = useState('')

  const [acao, setAcao] = useState('')
  const [valores, setValores] = useState<Record<string, string>>({})
  const [marcados, setMarcados] = useState<Record<string, boolean>>({})

  // Fila local: os passos que o usuário montou antes de enviar. Só vira
  // solicitação no banco quando ele manda — assim dá para revisar a sequência
  // inteira antes de disparar.
  const [fila, setFila] = useState<Array<{ acao: string; payload: Record<string, unknown> }>>([])
  const [universais, setUniversais] = useState<Universal[]>([])

  const [ocupado, setOcupado] = useState<string | null>(null)
  const [progresso, setProgresso] = useState<string>('')
  const [erro, setErro] = useState<string | null>(null)
  const [ultima, setUltima] = useState<Solicitacao | null>(null)

  const pipe: Pipe | null = useMemo(
    () => catalogo?.pipes.find((p) => p.acao === acao) ?? null,
    [catalogo, acao],
  )

  // O serviço já corta pelo TTL na hora da consulta, mas a lista não pode
  // congelar no instante do fetch: uma sessão que estava a 29 min quando a
  // página carregou está morta cinco minutos depois, e a tela ainda a
  // ofereceria. O corte vale de novo a cada tique do relógio.
  const sessoesVivas = useMemo(
    () => sessoes.filter((s) => idadeMin(s.ultima, agora) < TTL_SESSAO_MIN),
    [sessoes, agora],
  )

  useEffect(() => {
    if (catalogo) localStorage.setItem(CAT_KEY, JSON.stringify(catalogo))
  }, [catalogo])
  useEffect(() => {
    if (sessao) localStorage.setItem(SESS_KEY, JSON.stringify(sessao))
  }, [sessao])

  const carregarSessoes = useCallback(async () => {
    if (!sol) return
    try {
      setSessoes(await sol.sessoesRecentes())
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [sol])

  const carregarUniversais = useCallback(async () => {
    if (!sol) return
    try {
      setUniversais(await sol.listarUniversais(true))
    } catch {
      // A view é da 0021. Sem ela, a seção some — e o resto da tela continua.
      setUniversais([])
    }
  }, [sol])

  useEffect(() => {
    void carregarSessoes()
    void carregarUniversais()
  }, [carregarSessoes, carregarUniversais])

  // ── 1. abrir sessão ────────────────────────────────────────────────────────
  async function abrirSessao() {
    if (!sol) return
    setErro(null)
    setOcupado('abrir')
    setProgresso('Criando solicitação…')

    try {
      const id = novaSessaoId(config?.usuario ?? '')
      const t0 = Date.now()
      const pronta = await sol.criarEAguardar(
        {
          acao: 'iniciar_sessao',
          sessaoId: id,
          payload: { IncluirPipes: incluirPipes },
          destinatario: destinatario.trim().toLowerCase() || undefined,
          sapUsuario: sapUsuario || undefined,
          sapSenha: sapSenha || undefined,
        },
        {
          onTick: (s) => {
            const seg = Math.round((Date.now() - t0) / 1000)
            setProgresso(
              !s
                ? `Solicitação enviada, aguardando aparecer… (${seg}s)`
                : s.status === 'pendente'
                  // Com destinatário, "ninguém pegou" quase sempre quer dizer
                  // "o Coreon daquela pessoa não está no ar" — e não "está
                  // lento". Dizer o nome poupa a espera até o timeout.
                  ? destinatario
                    ? `Esperando o Coreon de ${destinatario.trim()} pegar… (${seg}s)`
                    : `Aguardando uma máquina pegar… (${seg}s)`
                  : `${s.executor ?? '?'} está executando… (${seg}s)`,
            )
          },
        },
      )

      if (pronta.status !== 'concluida')
        throw new Error(pronta.erro || `A solicitação terminou como '${pronta.status}'.`)

      const cat = lerCatalogo(pronta.resultado)
      if (!cat) throw new Error('Resposta sem catálogo — o Coreon não devolveu Sucesso.')

      setSessao({
        id: cat.sessaoId || id,
        executor: cat.executor || pronta.executor || '',
        maquina: cat.maquina || pronta.maquina || '',
        versaoCoreon: cat.versaoCoreon,
        loginSap: cat.loginSap,
        aberta: new Date().toISOString(),
        usada: new Date().toISOString(),
      })
      // Sem pipes na resposta (IncluirPipes desmarcado), preserva o catálogo
      // que já estava guardado — ele não muda dentro de uma versão.
      if (cat.pipes.length) setCatalogo(cat)
      setProgresso('')
      void carregarSessoes()
    } catch (e) {
      setErro((e as Error).message)
      setProgresso('')
    } finally {
      setOcupado(null)
    }
  }

  // ── escotilha: pegar o catálogo de uma resposta que JÁ chegou ─────────────
  //
  // A resposta do 'iniciar_sessao' fica gravada na solicitação, então ela
  // continua disponível mesmo que a espera ao vivo tenha falhado. Isto lê a
  // última que deu certo e monta o catálogo a partir dela — o mesmo dado, só
  // que buscado depois em vez de esperado na hora.
  //
  // Existe porque a espera ao vivo depende de rede, fluxo e tempo, e o
  // catálogo não deveria depender de nada disso para chegar até a tela.
  async function recuperarUltima() {
    if (!sol) return
    setErro(null)
    setOcupado('recuperar')
    setProgresso('Procurando a última sessão concluída…')

    try {
      const rows = await sol.listar({
        limit: 20,
        filtros: 'acao=eq.iniciar_sessao&status=eq.concluida',
      })

      for (const r of rows) {
        const cat = lerCatalogo(r.resultado)
        if (!cat) continue

        // O catálogo e a sessão vêm da mesma resposta mas têm validades
        // diferentes, e tratá-los como um só era o que fazia esta escotilha
        // ressuscitar sessão morta: o catálogo de pipes não vence (só muda de
        // versão do Coreon para versão), a sessão vence em 30 min parada.
        if (cat.pipes.length) setCatalogo(cat)

        const quando = r.terminado_em || r.criado_em
        if (idadeMin(quando, Date.now()) >= TTL_SESSAO_MIN) {
          setProgresso(
            `Catálogo recuperado, mas a última sessão (${cat.sessaoId || r.sessao_id}) ` +
              `é de ${haQuanto(quando, Date.now())} e já venceu. Abra uma nova.`,
          )
          return
        }

        setSessao({
          id: cat.sessaoId || r.sessao_id || '',
          executor: cat.executor || r.executor || '',
          maquina: cat.maquina || r.maquina || '',
          versaoCoreon: cat.versaoCoreon,
          loginSap: cat.loginSap,
          aberta: quando,
          usada: quando,
        })
        setProgresso('')
        return
      }

      throw new Error(
        'Nenhum iniciar_sessao concluído encontrado. Abra uma sessão primeiro.',
      )
    } catch (e) {
      setErro((e as Error).message)
      setProgresso('')
    } finally {
      setOcupado(null)
    }
  }

  // Monta o payload do formulário atual. Compartilhado por enviar e enfileirar,
  // para os dois nunca divergirem no tratamento de tipo.
  function payloadAtual(): Record<string, unknown> {
    const o: Record<string, unknown> = {}
    if (!pipe) return o
    for (const c of pipe.campos) {
      const v = coagir(c.tipo, valores[c.nome] ?? '', marcados[c.nome] ?? false)
      if (v !== undefined) o[c.nome] = v
    }
    return o
  }

  function limparFormulario() {
    setValores({})
    setMarcados({})
  }

  /**
   * Renova o relógio de inatividade da sessão. Chamado depois de todo envio
   * bem-sucedido, porque é isso que o Coreon faz do lado dele (Escopo() escreve
   * UltimoUso a cada uso). Sem isto, uma sessão em uso ativo sumiria da tela
   * 30 min depois de ABERTA, mesmo estando viva lá.
   */
  function marcarUso() {
    setSessao((s) => (s ? { ...s, usada: new Date().toISOString() } : s))
  }

  // ── sequência: enfileira aqui, dispara tudo de uma vez ────────────────────
  function enfileirar() {
    if (!pipe) return
    setFila((f) => [...f, { acao: pipe.acao, payload: payloadAtual() }])
    limparFormulario()
  }

  async function enviarFila() {
    if (!sol || !sessao || !fila.length) return
    setErro(null)
    setOcupado('fila')
    setProgresso(`Enfileirando ${fila.length} passo(s)…`)

    try {
      // Todas de uma vez, sem esperar entre elas. Quem garante a ordem é o
      // banco: a segunda só fica reservável quando a primeira CONCLUIR, e só
      // para a máquina que pegou a primeira.
      await sol.criarSequencia(
        sessao.id,
        fila.map((f) => ({
          acao: f.acao,
          payload: f.payload,
          destinatario: sessao.executor || undefined,
        })),
      )
      setFila([])
      marcarUso()
      setProgresso(
        'Sequência enviada. Ela roda passo a passo na máquina da sessão — ' +
          'acompanhe na aba Respostas.',
      )
      void carregarSessoes()
    } catch (e) {
      setErro((e as Error).message)
      setProgresso('')
    } finally {
      setOcupado(null)
    }
  }

  // ── universal: vale para todos, fica em pé ────────────────────────────────
  async function enviarUniversal() {
    if (!sol || !pipe) return
    setErro(null)
    setOcupado('universal')
    setProgresso('Criando solicitação universal…')

    try {
      // Sem sessão e sem destinatário de propósito: ela roda em TODAS as
      // máquinas, uma vez em cada. E não se espera por ela aqui — ela termina
      // quando você a encerra, não quando alguém executa.
      await sol.criar({ acao: pipe.acao, payload: payloadAtual(), universal: true })
      limparFormulario()
      setProgresso('')
      void carregarUniversais()
    } catch (e) {
      setErro((e as Error).message)
      setProgresso('')
    } finally {
      setOcupado(null)
    }
  }

  async function encerrar(id: number) {
    if (!sol) return
    setErro(null)
    setOcupado('encerrar')
    try {
      await sol.encerrarUniversal(id)
      await carregarUniversais()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  // ── 3. enviar ──────────────────────────────────────────────────────────────
  async function enviar() {
    if (!sol || !pipe || !sessao) return
    setErro(null)
    setOcupado('enviar')
    setProgresso('Criando solicitação…')

    try {
      const payload = payloadAtual()

      const t0 = Date.now()
      const pronta = await sol.criarEAguardar(
        {
          acao: pipe.acao,
          payload,
          sessaoId: sessao.id,
          // Endereçada: a sessão está na memória DESTA máquina.
          destinatario: sessao.executor || undefined,
        },
        {
          onTick: (s) => {
            const seg = Math.round((Date.now() - t0) / 1000)
            setProgresso(
              !s
                ? `Solicitação enviada, aguardando aparecer… (${seg}s)`
                : s.status === 'pendente'
                  ? `Na fila de ${sessao.executor}… (${seg}s)`
                  : `Executando… (${seg}s)`,
            )
          },
        },
      )

      setUltima(pronta)
      marcarUso()
      setProgresso('')
      void carregarSessoes()

      // A sessão sumiu do lado de lá enquanto esta tela ainda a exibia
      // (Coreon reiniciado, teto de sessões). O Coreon disse com todas as
      // letras; guardar isso para nós seria repetir o problema que esta
      // mudança veio resolver.
      if (/SESSAO_EXPIRADA/i.test(pronta.erro ?? '')) {
        setSessao(null)
        localStorage.removeItem(SESS_KEY)
        void carregarSessoes()
      }
    } catch (e) {
      setErro((e as Error).message)
      setProgresso('')
    } finally {
      setOcupado(null)
    }
  }

  if (!config)
    return (
      <div className="p-4 text-zinc-400">
        Configure a URL do Power Automate em <b>Configurações</b>.
      </div>
    )

  return (
    <div className="p-4 space-y-6 max-w-3xl">
      {/* ── 1. sessão ─────────────────────────────────────────────────────── */}
      <section className="border border-zinc-800 rounded p-4 space-y-3">
        <h2 className="font-semibold">1. Sessão</h2>

        {sessao ? (
          <div className="bg-zinc-900 rounded p-3 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-green-400 font-mono">{sessao.id}</span>
              <span
                className="text-xs text-zinc-500"
                title={`Vence com ${TTL_SESSAO_MIN} min sem uso`}
              >
                vence em {Math.max(0, Math.ceil(TTL_SESSAO_MIN - idadeMin(sessao.usada, agora)))} min
              </span>
              <button
                onClick={() => {
                  setSessao(null)
                  localStorage.removeItem(SESS_KEY)
                }}
                className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
              >
                trocar
              </button>
            </div>
            <div className="text-zinc-400">
              {sessao.executor} · {sessao.maquina} · Coreon {sessao.versaoCoreon}
              {sessao.loginSap && <> · SAP {sessao.loginSap}</>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">
            Nenhuma sessão. Abra uma nova ou escolha uma recente abaixo.
          </p>
        )}

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={incluirPipes}
              onChange={(e) => setIncluirPipes(e.target.checked)}
            />
            Carregar catálogo de pipes
            {catalogo && (
              <span className="text-xs text-zinc-500">
                (já tem {catalogo.pipes.length}, de {catalogo.versaoCoreon})
              </span>
            )}
          </label>

          <input
            value={destinatario}
            onChange={(e) => setDestinatario(e.target.value)}
            placeholder="Abrir na máquina de… (usuário Windows; vazio = a primeira que pegar)"
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm w-full"
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              value={sapUsuario}
              onChange={(e) => setSapUsuario(e.target.value)}
              placeholder="Usuário SAP (opcional)"
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
            />
            <input
              type="password"
              value={sapSenha}
              onChange={(e) => setSapSenha(e.target.value)}
              placeholder="Senha SAP (opcional)"
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
            />
          </div>
          <p className="text-xs text-zinc-500">
            Com um destinatário, só a máquina <em>daquele</em> usuário pega a sessão — e ela
            fica esperando até ele abrir o Coreon. Vazio, vale a primeira que ler.
          </p>
          <p className="text-xs text-zinc-500">
            Sem credencial, roda com o login que o operador daquela máquina já validou.
            Com credencial, o SAP é acessado em seu nome e o histórico registra você. A
            senha é apagada do banco assim que uma máquina pega a solicitação.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={abrirSessao}
              disabled={!!ocupado}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-40 rounded px-3 py-1.5 text-sm"
            >
              {ocupado === 'abrir' ? 'Abrindo…' : 'Abrir sessão'}
            </button>
            <button
              onClick={recuperarUltima}
              disabled={!!ocupado}
              title="Lê o catálogo da última sessão que concluiu, sem abrir outra"
              className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded px-3 py-1.5 text-sm"
            >
              {ocupado === 'recuperar' ? 'Procurando…' : 'Recuperar última'}
            </button>
          </div>
        </div>

        {sessoesVivas.length > 0 && (
          <div className="pt-2 border-t border-zinc-800">
            <div className="text-xs text-zinc-500 mb-1">Sessões ainda vivas</div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {sessoesVivas.map((s) => (
                <button
                  key={s.sessaoId}
                  onClick={() =>
                    setSessao({
                      id: s.sessaoId,
                      executor: s.executor ?? '',
                      maquina: '',
                      versaoCoreon: '',
                      loginSap: '',
                      aberta: s.ultima,
                      usada: s.ultima,
                    })
                  }
                  className={`w-full text-left text-xs font-mono px-2 py-1 rounded hover:bg-zinc-800 ${
                    sessao?.id === s.sessaoId ? 'bg-zinc-800 text-green-400' : 'text-zinc-400'
                  }`}
                >
                  {s.sessaoId} · {s.executor ?? '—'} · {s.qtd} ·{' '}
                  <span className="text-zinc-600">{haQuanto(s.ultima, agora)}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-600 mt-1">
              Só aparecem as usadas nos últimos {TTL_SESSAO_MIN} min — é o que o Coreon
              guarda. Se ele reiniciou nesse meio-tempo, a sessão já não existe lá e a
              primeira solicitação volta com SESSAO_EXPIRADA.
            </p>
          </div>
        )}
      </section>

      {/* ── 2. ação ───────────────────────────────────────────────────────── */}
      <section className="border border-zinc-800 rounded p-4 space-y-3">
        <h2 className="font-semibold">2. Ação</h2>

        {!catalogo ? (
          <p className="text-sm text-zinc-400">
            Abra uma sessão com <b>Carregar catálogo de pipes</b> marcado para ver as
            ações disponíveis.
          </p>
        ) : (
          <>
            <select
              value={acao}
              onChange={(e) => {
                setAcao(e.target.value)
                setValores({})
                setMarcados({})
                setUltima(null)
              }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm"
            >
              <option value="">— escolha —</option>
              {catalogo.pipes.map((p) => (
                <option key={p.acao} value={p.acao}>
                  {p.acao}
                  {p.campos.length ? ` (${p.campos.length})` : ''}
                </option>
              ))}
            </select>

            {pipe && pipe.origem === 'inferido' && (
              <p className="text-xs text-amber-500">
                Campos inferidos do código do Coreon — nomes corretos na maioria dos
                casos, mas não garantidos como um contrato declarado.
              </p>
            )}
            {pipe && pipe.campos.length === 0 && (
              <p className="text-xs text-zinc-500">Esta ação não recebe campos.</p>
            )}

            {pipe?.campos.map((c) => (
              <Campo
                key={c.nome}
                nome={c.nome}
                tipo={c.tipo}
                valor={valores[c.nome] ?? ''}
                marcado={marcados[c.nome] ?? false}
                onTexto={(v) => setValores((o) => ({ ...o, [c.nome]: v }))}
                onMarcar={(v) => setMarcados((o) => ({ ...o, [c.nome]: v }))}
              />
            ))}

            <button
              onClick={enviar}
              disabled={!!ocupado || !pipe || !sessao}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-40 rounded px-3 py-1.5 text-sm"
            >
              {ocupado === 'enviar' ? 'Enviando…' : 'Enviar agora'}
            </button>

            <button
              onClick={enfileirar}
              disabled={!!ocupado || !pipe}
              title="Acrescenta este passo à sequência, sem enviar ainda"
              className="ml-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded px-3 py-1.5 text-sm"
            >
              + à sequência
            </button>

            <button
              onClick={enviarUniversal}
              disabled={!!ocupado || !pipe}
              title="Vale para TODOS os usuários e fica em pé até você encerrar"
              className="ml-2 bg-amber-800 hover:bg-amber-700 disabled:opacity-40 rounded px-3 py-1.5 text-sm"
            >
              {ocupado === 'universal' ? 'Criando…' : 'Enviar a todos'}
            </button>

            {!sessao && pipe && (
              <p className="text-xs text-amber-500">Abra ou escolha uma sessão primeiro.</p>
            )}
          </>
        )}
      </section>

      {/* ── sequência montada ──────────────────────────────────────────────── */}
      {fila.length > 0 && (
        <section className="border border-zinc-800 rounded p-4 space-y-3">
          <h2 className="font-semibold">Sequência ({fila.length})</h2>
          <p className="text-xs text-zinc-500">
            Vão todas de uma vez, mas rodam <b>em ordem</b> e na <b>mesma máquina</b>. Se
            uma falhar, as seguintes não saem — corrija e reenvie só ela.
          </p>

          <ol className="space-y-1 text-sm">
            {fila.map((f, i) => (
              <li key={i} className="flex items-start gap-2 bg-zinc-900 rounded px-2 py-1">
                <span className="text-zinc-600">{i + 1}.</span>
                <span className="font-mono">{f.acao}</span>
                <span className="text-xs text-zinc-500 truncate flex-1" title={JSON.stringify(f.payload)}>
                  {Object.keys(f.payload).length
                    ? Object.keys(f.payload).join(', ')
                    : '(sem campos)'}
                </span>
                <button
                  onClick={() => setFila((x) => x.filter((_, j) => j !== i))}
                  className="text-xs text-zinc-500 hover:text-red-400"
                >
                  remover
                </button>
              </li>
            ))}
          </ol>

          <div className="flex gap-2">
            <button
              onClick={enviarFila}
              disabled={!!ocupado || !sessao}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-40 rounded px-3 py-1.5 text-sm"
            >
              {ocupado === 'fila' ? 'Enviando…' : `Enviar sequência (${fila.length})`}
            </button>
            <button
              onClick={() => setFila([])}
              disabled={!!ocupado}
              className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded px-3 py-1.5 text-sm"
            >
              Limpar
            </button>
          </div>
        </section>
      )}

      {/* ── universais em circulação ───────────────────────────────────────── */}
      {universais.length > 0 && (
        <section className="border border-amber-900/50 rounded p-4 space-y-3">
          <h2 className="font-semibold text-amber-500">
            Em circulação para todos ({universais.length})
          </h2>
          <p className="text-xs text-zinc-500">
            Enquanto houver uma aberta, toda máquina desperta consulta a cada minuto.
            Encerre quando terminar de circular.
          </p>

          {universais.map((u) => (
            <div key={u.id} className="bg-zinc-900 rounded p-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-zinc-600">#{u.id}</span>
                <span className="font-mono">{u.acao}</span>
                <span className="ml-auto text-xs text-zinc-500">
                  {u.concluidas}/{u.usuarios}
                  {u.com_erro > 0 && <span className="text-red-400"> · {u.com_erro} com erro</span>}
                </span>
              </div>

              <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
                <div
                  className="h-full bg-green-600"
                  style={{ width: `${u.usuarios ? (u.concluidas / u.usuarios) * 100 : 0}%` }}
                />
              </div>

              {u.faltam.length > 0 && (
                <div className="text-xs text-zinc-500">
                  <span className="text-zinc-600">faltam:</span> {u.faltam.join(', ')}
                </div>
              )}

              <button
                onClick={() => encerrar(u.id)}
                disabled={!!ocupado}
                className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded px-3 py-1 text-xs"
              >
                Encerrar
              </button>
            </div>
          ))}
        </section>
      )}

      {progresso && (
        <div className="text-sm text-zinc-400 border border-zinc-800 rounded p-3">
          {progresso}
        </div>
      )}
      {erro && (
        <div className="text-sm text-red-400 border border-red-900 bg-red-950/30 rounded p-3">
          {erro}
        </div>
      )}
      {ultima && (
        <div className="text-sm border border-zinc-800 rounded p-3 space-y-1">
          <div>
            <span className="text-zinc-500">#{ultima.id}</span>{' '}
            <span className={ultima.status === 'concluida' ? 'text-green-400' : 'text-red-400'}>
              {ultima.status}
            </span>{' '}
            <span className="text-zinc-500">
              por {ultima.executor} em{' '}
              {ultima.terminado_em && ultima.iniciado_em
                ? Math.round(
                    (new Date(ultima.terminado_em).getTime() -
                      new Date(ultima.iniciado_em).getTime()) / 1000,
                  ) + 's'
                : '—'}
            </span>
          </div>
          {ultima.erro && <div className="text-red-400">{ultima.erro}</div>}
          <div className="text-xs text-zinc-500">
            Veja a resposta completa na aba <b>Respostas</b>.
          </div>
        </div>
      )}
    </div>
  )
}

// ── um campo, com o controle que o tipo pede ─────────────────────────────────
function Campo({
  nome,
  tipo,
  valor,
  marcado,
  onTexto,
  onMarcar,
}: {
  nome: string
  tipo: string
  valor: string
  marcado: boolean
  onTexto: (v: string) => void
  onMarcar: (v: boolean) => void
}) {
  const t = tipo.toLowerCase()

  if (t === 'booleano')
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={marcado} onChange={(e) => onMarcar(e.target.checked)} />
        <span className="font-mono">{nome}</span>
      </label>
    )

  const rotulo = (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-sm">{nome}</span>
      <span className="text-xs text-zinc-600">{tipo}</span>
    </div>
  )

  if (t.startsWith('opcao[')) {
    const opcoes = tipo.slice(6, -1).split(',').map((s) => s.trim()).filter(Boolean)
    return (
      <div className="space-y-1">
        {rotulo}
        <select
          value={valor}
          onChange={(e) => onTexto(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
        >
          <option value="">—</option>
          {opcoes.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    )
  }

  // Lista, objeto e mapa são multilinha: caminho de rede tem espaço e vírgula
  // no meio, então uma linha por item é o único separador seguro.
  if (t.startsWith('lista<') || t === 'objeto' || t.startsWith('mapa<')) {
    const ehLista = t.startsWith('lista<')
    return (
      <div className="space-y-1">
        {rotulo}
        <textarea
          value={valor}
          onChange={(e) => onTexto(e.target.value)}
          rows={3}
          placeholder={ehLista ? 'um por linha' : 'JSON'}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm font-mono"
        />
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {rotulo}
      <input
        type={t === 'data' ? 'date' : t === 'numero' ? 'number' : 'text'}
        value={valor}
        onChange={(e) => onTexto(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
      />
    </div>
  )
}
