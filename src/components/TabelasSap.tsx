// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de tabelas do SAP — e o "Buscar campos" que o preenche sozinho
//
// ── o que esta tela resolve ─────────────────────────────────────────────────
//
// Montar um read_table exige o nome EXATO de cada campo, e errar um faz a RFC
// recusar a chamada inteira. Até agora isso dependia de decorar, de ter a SE11
// à mão, ou de confiar no que alguém digitou num modelo meses atrás.
//
// Aqui a tabela é cadastrada com nome e descrição, e os campos ficam VAZIOS até
// alguém clicar em Buscar campos. Aí uma solicitação vai para o primeiro Coreon
// disponível, que lê o dicionário de dados do próprio SAP e devolve a lista —
// com o rótulo de cada campo e a marca de quais formam a chave.
//
// A partir daí, montar a consulta é marcar caixas.
//
// ── por que o catálogo mora no Supabase, e por empresa ──────────────────────
//
// Os modelos de read_table vivem no localStorage: são de quem os criou, e some
// tudo ao limpar os dados do site. Um catálogo não pode ser assim — quem
// descobre os campos de uma tabela descobre para todo mundo, e descobrir custa
// uma ida ao SAP.
//
// Por empresa porque tabela Z é do cliente: uma ZMM do Fleury não existe no
// Pardini. E os campos também, o que parece desperdício (MSEG é MSEG) e não é:
// cada instalação tem seus appends, e release diferente tem coluna diferente.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'
import { SolicitacoesService, novaSessaoId } from '../services/solicitacoes'
import { EMPRESA_PADRAO } from '../utils/empresa'
import {
  listar,
  salvarTabela,
  salvarCampos,
  removerTabela,
  buscarCampos,
  type TabelaSap,
  type CampoSap,
} from '../services/tabelasSap'

const CHAVE_EMPRESA = 'lnf.tabelasSap.empresa'

// Os códigos que o Coreon conhece (EmpresaService). Não há tela de cadastro de
// empresa, e inventar uma aqui criaria catálogo órfão que ninguém mais vê.
const EMPRESAS = ['fleury', 'pardini'] as const

const quando = (iso: string | null) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('pt-BR')
}

export function TabelasSap({ onUsar }: { onUsar: (texto: string) => void }) {
  const { config } = useApp()

  const svc = useMemo(() => (config ? new SupabaseService(config) : null), [config])
  const sol = useMemo(
    () => (svc ? new SolicitacoesService(svc, config?.usuario ?? '') : null),
    [svc, config],
  )

  const [empresa, setEmpresa] = useState<string>(() => {
    try {
      return localStorage.getItem(CHAVE_EMPRESA) || EMPRESA_PADRAO
    } catch {
      return EMPRESA_PADRAO
    }
  })

  const [tabelas, setTabelas] = useState<TabelaSap[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const [aberta, setAberta] = useState<string | null>(null)
  const [buscando, setBuscando] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')

  // Os campos marcados, por tabela. Marcar é o que transforma o catálogo num
  // read_table — sem isso ele é só documentação.
  const [marcados, setMarcados] = useState<Record<string, Set<string>>>({})

  // Credencial do SAP de QUEM PEDE. Opcional: máquina que já está logada
  // atende sem isso. Quando vem, o Coreon usa esta no lugar da dele — a
  // consulta sai no nome de quem perguntou, não no de quem emprestou a máquina.
  const [sapUsuario, setSapUsuario] = useState('')
  const [sapSenha, setSapSenha] = useState('')
  const [mostrarCred, setMostrarCred] = useState(false)

  const [novaTabela, setNovaTabela] = useState('')
  const [novaDescricao, setNovaDescricao] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_EMPRESA, empresa)
    } catch {
      /* modo privado — a escolha vale só nesta aba */
    }
  }, [empresa])

  async function recarregar() {
    if (!svc) return
    setCarregando(true)
    setErro(null)
    try {
      setTabelas(await listar(svc, empresa))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    void recarregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc, empresa])

  async function adicionar() {
    const nome = novaTabela.trim().toUpperCase()
    if (!svc || !nome) return
    setErro(null)
    try {
      await salvarTabela(svc, {
        empresa,
        tabela: nome,
        descricao: novaDescricao.trim(),
        criadoPor: config?.usuario ?? '',
      })
      setNovaTabela('')
      setNovaDescricao('')
      setStatus(`${nome} cadastrada. Clique em "Buscar campos" para preencher.`)
      await recarregar()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  async function remover(t: TabelaSap) {
    if (!svc) return
    if (!confirm(`Tirar ${t.tabela} do catálogo de ${t.empresa}?`)) return
    setErro(null)
    try {
      await removerTabela(svc, t.empresa, t.tabela)
      await recarregar()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  async function buscar(t: TabelaSap) {
    if (!sol || !svc) {
      setErro('Configure o transporte em Configurações.')
      return
    }
    setBuscando(t.tabela)
    setErro(null)
    setStatus(null)
    try {
      const campos = await buscarCampos(sol, t.tabela, {
        sessaoId: novaSessaoId(config?.usuario ?? ''),
        sapUsuario: sapUsuario.trim() || undefined,
        sapSenha: sapSenha || undefined,
        onPasso: setStatus,
      })
      await salvarCampos(svc, t.empresa, t.tabela, campos, config?.usuario ?? '')
      setStatus(
        `${t.tabela}: ${campos.length} campo(s), ` +
          `${campos.filter((c) => c.chave).length} de chave. Guardado no catálogo.`,
      )
      setAberta(t.tabela)
      await recarregar()
    } catch (e) {
      setErro(`${t.tabela}: ${(e as Error).message}`)
      setStatus(null)
    } finally {
      setBuscando(null)
    }
  }

  function alternarCampo(tabela: string, campo: string) {
    setMarcados((m) => {
      const atual = new Set(m[tabela] ?? [])
      if (atual.has(campo)) atual.delete(campo)
      else atual.add(campo)
      return { ...m, [tabela]: atual }
    })
  }

  function marcarChaves(t: TabelaSap) {
    setMarcados((m) => ({
      ...m,
      [t.tabela]: new Set(t.campos.filter((c) => c.chave).map((c) => c.nome)),
    }))
  }

  // ── do catálogo para uma consulta ─────────────────────────────────────────
  //
  // CamposChave sai dos campos marcados como chave NA TABELA, e não dos que a
  // pessoa marcou para ver: são coisas diferentes. Quem pede MENGE e MEINS da
  // MSEG continua precisando de MBLNR+MJAHR+ZEILE como chave, senão o retorno
  // colapsa linhas diferentes numa só.
  function gerar(t: TabelaSap) {
    const escolhidos = [...(marcados[t.tabela] ?? [])]
    const campos = escolhidos.length > 0 ? escolhidos : t.campos.map((c) => c.nome)
    const chaves = t.campos.filter((c) => c.chave).map((c) => c.nome)

    const payload = {
      Acao: 'read_table',
      Tabela: t.tabela,
      Campos: campos,
      Filtro: ['-- uma cláusula por linha, ex.:', `-- ${chaves[0] ?? 'CAMPO'} = 'valor'`],
      CamposChave: chaves.length > 0 ? chaves : campos.slice(0, 1),
    }
    onUsar(JSON.stringify(payload, null, 2))
  }

  const visiveis = (tabelas ?? []).filter((t) => {
    const q = filtro.trim().toUpperCase()
    if (!q) return true
    return t.tabela.includes(q) || t.descricao.toUpperCase().includes(q)
  })

  return (
    <section className="border border-zinc-800 rounded p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Tabelas do SAP</h2>

        <select
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs"
          title="O catálogo é por empresa: tabela Z de um cliente não existe no outro."
        >
          {EMPRESAS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>

        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="filtrar…"
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs w-32"
        />

        <button
          onClick={() => void recarregar()}
          disabled={carregando}
          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs"
        >
          {carregando ? 'Lendo…' : 'Recarregar'}
        </button>

        <span className="text-xs text-zinc-600 ml-auto">
          {tabelas ? `${visiveis.length} de ${tabelas.length}` : ''}
        </span>
      </div>

      <p className="text-xs text-zinc-500">
        Os campos não são digitados: o <b>Buscar campos</b> manda uma solicitação ao primeiro
        Coreon livre, que lê o dicionário do próprio SAP (DD03L/DD04T) e devolve a lista com
        rótulo e chave. O que vier fica guardado para todo mundo.
      </p>

      {erro && (
        <div className="rounded border border-red-800/70 bg-red-950/30 px-3 py-2 text-sm text-red-200 break-words">
          {erro}
        </div>
      )}
      {status && <div className="text-xs text-emerald-400 break-words">{status}</div>}

      {/* ── credencial, escondida porque quase sempre não precisa ─────────── */}
      <div className="text-xs">
        <button
          onClick={() => setMostrarCred((v) => !v)}
          className="text-zinc-500 hover:text-zinc-300"
        >
          {mostrarCred ? '▾' : '▸'} Login do SAP (opcional)
        </button>
        {mostrarCred && (
          <div className="mt-2 flex flex-wrap gap-2 items-center">
            <input
              value={sapUsuario}
              onChange={(e) => setSapUsuario(e.target.value)}
              placeholder="usuário SAP"
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 w-36"
            />
            <input
              type="password"
              value={sapSenha}
              onChange={(e) => setSapSenha(e.target.value)}
              placeholder="senha"
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 w-36"
            />
            <span className="text-zinc-600">
              Em branco, vale o login da máquina que atender.
            </span>
          </div>
        )}
      </div>

      {/* ── a lista ───────────────────────────────────────────────────────── */}
      <div className="divide-y divide-zinc-800 border border-zinc-800 rounded">
        {visiveis.length === 0 && (
          <div className="px-3 py-3 text-sm text-zinc-500">
            {tabelas === null ? 'Carregando…' : 'Nenhuma tabela no catálogo desta empresa.'}
          </div>
        )}

        {visiveis.map((t) => {
          const nunca = t.camposEm === null
          const vazia = !nunca && t.campos.length === 0
          const marc = marcados[t.tabela] ?? new Set<string>()

          return (
            <div key={t.tabela}>
              <div className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  onClick={() => setAberta(aberta === t.tabela ? null : t.tabela)}
                  className="font-mono text-sm hover:text-white"
                >
                  {aberta === t.tabela ? '▾' : '▸'} {t.tabela}
                </button>

                {/* Os três estados são diferentes e a tela diz qual é qual:
                    nunca buscado, buscado e vazio (nome errado), e ok. */}
                {nunca ? (
                  <span className="text-xs text-amber-500">campos não buscados</span>
                ) : vazia ? (
                  <span className="text-xs text-red-400">
                    o SAP não conhece esta tabela — confira o nome
                  </span>
                ) : (
                  <span className="text-xs text-zinc-500">
                    {t.campos.length} campos
                    {quando(t.camposEm) ? ` · ${quando(t.camposEm)}` : ''}
                    {t.camposPor ? ` · ${t.camposPor}` : ''}
                  </span>
                )}

                <div className="ml-auto flex gap-1">
                  <button
                    onClick={() => void buscar(t)}
                    disabled={buscando !== null}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs"
                    title="Pergunta ao primeiro Coreon livre quais são os campos desta tabela."
                  >
                    {buscando === t.tabela ? 'Buscando…' : nunca ? 'Buscar campos' : 'Atualizar'}
                  </button>
                  <button
                    onClick={() => void remover(t)}
                    className="px-2 py-1 rounded text-zinc-600 hover:text-red-400 text-xs"
                    title="Tirar do catálogo"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {t.descricao && (
                <p className="px-3 pb-2 text-xs text-zinc-500">{t.descricao}</p>
              )}

              {aberta === t.tabela && t.campos.length > 0 && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button
                      onClick={() => marcarChaves(t)}
                      className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                    >
                      Marcar só as chaves
                    </button>
                    <button
                      onClick={() =>
                        setMarcados((m) => ({ ...m, [t.tabela]: new Set<string>() }))
                      }
                      className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                    >
                      Limpar
                    </button>
                    <button
                      onClick={() => gerar(t)}
                      className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700"
                      title="Monta o JSON do read_table com os campos marcados (ou todos)."
                    >
                      Gerar read_table ({marc.size || t.campos.length})
                    </button>
                  </div>

                  <div className="max-h-72 overflow-y-auto border border-zinc-800 rounded">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-zinc-900">
                        {t.campos.map((c: CampoSap) => (
                          <tr key={c.nome} className="hover:bg-zinc-900/60">
                            <td className="px-2 py-1 w-6">
                              <input
                                type="checkbox"
                                checked={marc.has(c.nome)}
                                onChange={() => alternarCampo(t.tabela, c.nome)}
                              />
                            </td>
                            <td className="px-2 py-1 font-mono whitespace-nowrap">
                              {c.nome}
                              {c.chave && (
                                <span
                                  className="ml-1 text-amber-500"
                                  title="Faz parte da chave — serve de CamposChave"
                                >
                                  🔑
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1 text-zinc-400">{c.descricao || '—'}</td>
                            <td className="px-2 py-1 text-zinc-600 whitespace-nowrap">
                              {c.tipo}
                              {c.tamanho ? ` ${c.tamanho}` : ''}
                              {c.decimais ? `,${c.decimais}` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── cadastrar uma tabela ──────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center text-xs">
        <input
          value={novaTabela}
          onChange={(e) => setNovaTabela(e.target.value.toUpperCase())}
          placeholder="TABELA"
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 font-mono w-32"
        />
        <input
          value={novaDescricao}
          onChange={(e) => setNovaDescricao(e.target.value)}
          placeholder="para que serve (opcional)"
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 flex-1 min-w-48"
        />
        <button
          onClick={() => void adicionar()}
          disabled={!novaTabela.trim()}
          className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40"
        >
          + tabela
        </button>
      </div>
    </section>
  )
}
