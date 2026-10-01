import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  FotonAdmin,
  lerConexao,
  salvarConexao,
  URL_PADRAO,
  type ConexaoFoton,
  type Linha,
  type ResumoFoton,
  type TabelaFoton,
} from '../services/fotonAdmin'

// ─────────────────────────────────────────────────────────────────────────────
// Fóton — quem pode usar o Fóton (app do Elétron) e em quais computadores.
//
// Fala só com a Edge Function foton-admin do projeto foton-licencas; é ela que
// confere a chave de administrador e decide cada gravação. Esta tela não sabe
// nada do banco do LNF e funciona mesmo sem a conexão do LNF configurada.
// ─────────────────────────────────────────────────────────────────────────────

type Sub = 'computadores' | 'acessos' | 'genericos' | 'senhas' | 'registros'

const SUBS: Array<{ id: Sub; rotulo: string }> = [
  { id: 'computadores', rotulo: 'Computadores' },
  { id: 'acessos', rotulo: 'Acessos' },
  { id: 'genericos', rotulo: 'Logins genéricos' },
  { id: 'senhas', rotulo: 'Senhas' },
  { id: 'registros', rotulo: 'Registros' },
]

export function Foton() {
  const [conexao, setConexao] = useState<ConexaoFoton>(() => lerConexao())
  const [editandoConexao, setEditandoConexao] = useState(() => !lerConexao().chave)
  const api = useMemo(() => new FotonAdmin(conexao), [conexao])

  const [sub, setSub] = useState<Sub>('computadores')
  const [resumo, setResumo] = useState<ResumoFoton | null>(null)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const tabela: TabelaFoton = sub === 'computadores' ? 'dispositivos' : sub

  const carregar = useCallback(async () => {
    if (!conexao.chave) return
    setCarregando(true)
    setErro(null)
    try {
      const [r, l] = await Promise.all([api.resumo(), api.listar(tabela, tabela === 'registros' ? 300 : 1000)])
      setResumo(r)
      setLinhas(l)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [api, conexao.chave, tabela])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Toda ação: grava, mostra o resultado e recarrega a lista.
  const agir = useCallback(
    async (acao: () => Promise<unknown>, ok: string) => {
      setErro(null)
      setAviso(null)
      try {
        await acao()
        setAviso(ok)
        await carregar()
      } catch (e) {
        setErro((e as Error).message)
      }
    },
    [carregar],
  )

  return (
    <div className="p-4 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Fóton — liberação de uso</h2>
        <div className="flex gap-2">
          <BotaoPequeno onClick={() => setEditandoConexao((v) => !v)}>Conexão</BotaoPequeno>
          <BotaoPequeno onClick={() => void carregar()} disabled={carregando || !conexao.chave}>
            {carregando ? 'Lendo...' : 'Atualizar'}
          </BotaoPequeno>
        </div>
      </div>

      {editandoConexao && (
        <PainelConexao
          inicial={conexao}
          onSalvar={(c) => {
            salvarConexao(c)
            setConexao(c)
            setEditandoConexao(false)
          }}
        />
      )}

      {erro && <Caixa tipo="erro">❌ {erro}</Caixa>}
      {aviso && !erro && <Caixa tipo="ok">✅ {aviso}</Caixa>}

      {resumo && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Numero rotulo="acessos ativos" valor={resumo.acessos} />
          <Numero rotulo="computadores" valor={resumo.computadores} />
          <Numero rotulo="aguardando aprovação" valor={resumo.pendentes} alerta={resumo.pendentes > 0} />
          <Numero rotulo="senhas ativas" valor={resumo.senhas_ativas} />
          <Numero rotulo="liberações 24h" valor={resumo.liberacoes_24h} />
          <Numero rotulo="recusas 24h" valor={resumo.recusas_24h} alerta={resumo.recusas_24h > 0} />
          <Numero rotulo="bloqueados" valor={resumo.bloqueados} />
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-zinc-800">
        {SUBS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            className={`px-3 py-1.5 text-sm rounded-t ${
              sub === s.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {s.rotulo}
            {s.id === 'computadores' && !!resumo?.pendentes && (
              <span className="ml-1.5 text-[10px] bg-amber-600 text-white rounded-full px-1.5">{resumo.pendentes}</span>
            )}
          </button>
        ))}
      </div>

      {!conexao.chave ? (
        <p className="text-sm text-zinc-500">Informe a chave de administrador em "Conexão".</p>
      ) : (
        <>
          {sub === 'computadores' && <Computadores linhas={linhas} api={api} agir={agir} />}
          {sub === 'acessos' && <Acessos linhas={linhas} api={api} agir={agir} />}
          {sub === 'genericos' && <Genericos linhas={linhas} api={api} agir={agir} />}
          {sub === 'senhas' && <Senhas linhas={linhas} api={api} agir={agir} />}
          {sub === 'registros' && <Registros linhas={linhas} />}
        </>
      )}
    </div>
  )
}

type PropsLista = {
  linhas: Linha[]
  api: FotonAdmin
  agir: (acao: () => Promise<unknown>, ok: string) => Promise<void>
}

// ── Conexão ──────────────────────────────────────────────────────────────────

function PainelConexao({ inicial, onSalvar }: { inicial: ConexaoFoton; onSalvar: (c: ConexaoFoton) => void }) {
  const [url, setUrl] = useState(inicial.url || URL_PADRAO)
  const [chave, setChave] = useState(inicial.chave)
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 space-y-3">
      <Campo rotulo="URL da foton-admin">
        <input value={url} onChange={(e) => setUrl(e.target.value)} className="input" />
      </Campo>
      <Campo rotulo="Chave de administrador">
        <input type="password" value={chave} onChange={(e) => setChave(e.target.value)} className="input" />
      </Campo>
      <p className="text-xs text-zinc-500">
        A chave é definida no SQL Editor do projeto foton-licencas com{' '}
        <code>select foton_definir_chave_admin('…');</code> e fica só neste navegador.
      </p>
      <button
        onClick={() => onSalvar({ url: url.trim(), chave })}
        className="w-full bg-green-600 hover:bg-green-500 text-white font-medium py-2 rounded-lg"
      >
        Salvar conexão
      </button>
    </div>
  )
}

// ── Computadores ─────────────────────────────────────────────────────────────

const SITUACAO: Record<string, { rotulo: string; cor: string }> = {
  liberado: { rotulo: 'liberado', cor: 'text-green-400' },
  pendente: { rotulo: 'aguardando aprovação', cor: 'text-amber-400' },
  bloqueado: { rotulo: 'bloqueado', cor: 'text-red-400' },
}

function Computadores({ linhas, api, agir }: PropsLista) {
  // Pendentes primeiro: é o que pede ação.
  const ordenadas = [...linhas].sort((a, b) => Number(b.situacao === 'pendente') - Number(a.situacao === 'pendente'))
  const mudar = (l: Linha, situacao: string) =>
    agir(() => api.salvar('dispositivos', { id: l.id, situacao }), `${String(l.maquina)}: ${SITUACAO[situacao].rotulo}.`)

  if (ordenadas.length === 0) return <Vazio>Nenhum computador pediu autorização ainda.</Vazio>
  return (
    <div className="space-y-2">
      {ordenadas.map((l) => {
        const s = SITUACAO[String(l.situacao)] ?? SITUACAO.liberado
        return (
          <Cartao key={String(l.id)} alerta={l.situacao === 'pendente'}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{String(l.maquina ?? '—')}</span>
              <span className="text-zinc-400">
                {String(l.dominio ?? '')}\{String(l.usuario ?? '')}
              </span>
              <span className={`ml-auto text-xs ${s.cor}`}>{s.rotulo}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 text-xs text-zinc-500">
              <span>último uso {fmt(l.ultimo_uso) || '—'}</span>
              <span>registrado {fmt(l.criado_em)}</span>
              {!!l.tenant && <span className="font-mono">tenant {String(l.tenant)}</span>}
              <span className="font-mono">id {String(l.id).slice(0, 12)}…</span>
            </div>
            {!!l.observacao && <p className="text-xs text-zinc-400">{String(l.observacao)}</p>}
            <div className="flex flex-wrap gap-2">
              {l.situacao !== 'liberado' && <BotaoPequeno onClick={() => void mudar(l, 'liberado')}>Liberar</BotaoPequeno>}
              {l.situacao !== 'bloqueado' && <BotaoPequeno onClick={() => void mudar(l, 'bloqueado')}>Bloquear</BotaoPequeno>}
              <BotaoPequeno
                perigo
                onClick={() =>
                  confirm(`Esquecer o computador ${String(l.maquina)}? Na próxima abertura ele será registrado de novo.`) &&
                  void agir(() => api.excluir('dispositivos', l.id), 'Computador removido.')
                }
              >
                Esquecer
              </BotaoPequeno>
            </div>
          </Cartao>
        )
      })}
    </div>
  )
}

// ── Acessos ──────────────────────────────────────────────────────────────────

function Acessos({ linhas, api, agir }: PropsLista) {
  const [novo, setNovo] = useState({ usuario: '', tenant: '', validade_dias: '7', exige_aprovacao: false, admin: false, observacao: '' })
  const criar = () =>
    agir(
      () =>
        api.salvar('acessos', {
          usuario: novo.usuario.trim(),
          tenant: novo.tenant.trim(),
          validade_dias: Number(novo.validade_dias) || 7,
          exige_aprovacao: novo.exige_aprovacao,
          admin: novo.admin && !!novo.usuario.trim(),
          observacao: novo.observacao.trim(),
        }),
      'Acesso criado.',
    ).then(() => setNovo({ usuario: '', tenant: '', validade_dias: '7', exige_aprovacao: false, admin: false, observacao: '' }))

  return (
    <div className="space-y-3">
      <Cartao>
        <p className="text-sm font-medium">Liberar</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <Campo rotulo="Usuário do Windows (vazio = todos do tenant)">
            <input value={novo.usuario} onChange={(e) => setNovo({ ...novo, usuario: e.target.value })} className="input" />
          </Campo>
          <Campo rotulo="Tenant M365 ou domínio (vazio = qualquer)">
            <input value={novo.tenant} onChange={(e) => setNovo({ ...novo, tenant: e.target.value })} className="input" />
          </Campo>
          <Campo rotulo="Dias sem internet">
            <input type="number" min={1} max={90} value={novo.validade_dias}
              onChange={(e) => setNovo({ ...novo, validade_dias: e.target.value })} className="input" />
          </Campo>
          <Campo rotulo="Observação">
            <input value={novo.observacao} onChange={(e) => setNovo({ ...novo, observacao: e.target.value })} className="input" />
          </Campo>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={novo.exige_aprovacao}
            onChange={(e) => setNovo({ ...novo, exige_aprovacao: e.target.checked })} />
          Computador novo precisa de aprovação (recomendado para liberar por tenant)
        </label>
        <label className={`flex items-center gap-2 text-sm ${novo.usuario.trim() ? 'text-zinc-300' : 'text-zinc-600'}`}>
          <input type="checkbox" checked={novo.admin && !!novo.usuario.trim()} disabled={!novo.usuario.trim()}
            onChange={(e) => setNovo({ ...novo, admin: e.target.checked })} />
          Administrador: pode usar "Editar banco" no Fóton (só para usuário com nome)
        </label>
        <button
          onClick={() => void criar()}
          disabled={!novo.usuario.trim() && !novo.tenant.trim()}
          className="bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          Liberar
        </button>
      </Cartao>

      {linhas.length === 0 && <Vazio>Nenhum acesso cadastrado.</Vazio>}
      {linhas.map((l) => (
        <Cartao key={String(l.id)} alerta={!l.ativo}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{l.usuario ? String(l.usuario) : 'todos do tenant'}</span>
            {!!l.tenant && <span className="font-mono text-xs text-zinc-400">{String(l.tenant)}</span>}
            <span className={`ml-auto text-xs ${l.ativo ? 'text-green-400' : 'text-red-400'}`}>
              {l.ativo ? 'liberado' : 'bloqueado'}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 text-xs text-zinc-500">
            <span>{String(l.validade_dias)} dias sem internet</span>
            {!!l.admin && <span className="text-green-400">administrador</span>}
            {!!l.usuario && (l.tem_senha
              ? <span className="text-green-400">tem senha pessoal</span>
              : <span>sem senha pessoal</span>)}
            {!!l.exige_aprovacao && <span className="text-amber-400">aprova computador novo</span>}
            {!!l.expira_em && <span>até {fmt(l.expira_em)}</span>}
            <span>origem {String(l.origem ?? '')}</span>
          </div>
          {!!l.observacao && <p className="text-xs text-zinc-400">{String(l.observacao)}</p>}
          <div className="flex flex-wrap gap-2">
            <BotaoPequeno onClick={() => void agir(() => api.salvar('acessos', { id: l.id, ativo: !l.ativo }),
              l.ativo ? 'Acesso bloqueado.' : 'Acesso liberado.')}>
              {l.ativo ? 'Bloquear' : 'Liberar'}
            </BotaoPequeno>
            <BotaoPequeno onClick={() => void agir(() => api.salvar('acessos', { id: l.id, exige_aprovacao: !l.exige_aprovacao }),
              'Atualizado.')}>
              {l.exige_aprovacao ? 'Não exigir aprovação' : 'Exigir aprovação de PC'}
            </BotaoPequeno>
            {!!l.usuario && <SenhaPessoal usuario={String(l.usuario)} tem={!!l.tem_senha} api={api} agir={agir} />}
            {!!l.usuario && (
              <BotaoPequeno onClick={() => void agir(() => api.salvar('acessos', { id: l.id, admin: !l.admin }),
                l.admin ? 'Deixou de ser administrador.' : 'Agora é administrador (vale na próxima abertura do Fóton).')}>
                {l.admin ? 'Tirar administrador' : 'Tornar administrador'}
              </BotaoPequeno>
            )}
            <BotaoPequeno
              perigo
              onClick={() => confirm('Excluir este acesso?') && void agir(() => api.excluir('acessos', l.id), 'Acesso excluído.')}
            >
              Excluir
            </BotaoPequeno>
          </div>
        </Cartao>
      ))}
    </div>
  )
}

// ── Logins genéricos ─────────────────────────────────────────────────────────

function Genericos({ linhas, api, agir }: PropsLista) {
  const [usuario, setUsuario] = useState('')
  const [dias, setDias] = useState('7')
  return (
    <div className="space-y-3">
      <Cartao>
        <p className="text-xs text-zinc-400">
          Logins do Windows compartilhados (ex.: Tecnova): a pessoa sempre se identifica com o usuário dela e a senha pessoal
          (defina em Acessos). Vale por alguns dias naquele computador. Nunca entram direto, mesmo com o tenant liberado.
        </p>
        <div className="grid grid-cols-[1fr_6rem_auto] gap-2 items-end">
          <Campo rotulo="Login">
            <input value={usuario} onChange={(e) => setUsuario(e.target.value)} className="input" />
          </Campo>
          <Campo rotulo="Dias">
            <input type="number" min={1} max={90} value={dias} onChange={(e) => setDias(e.target.value)} className="input" />
          </Campo>
          <button
            disabled={!usuario.trim()}
            onClick={() =>
              void agir(() => api.salvar('genericos', { usuario: usuario.trim(), validade_dias: Number(dias) || 7 }),
                'Login genérico salvo.').then(() => setUsuario(''))
            }
            className="bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Salvar
          </button>
        </div>
      </Cartao>
      {linhas.map((l) => (
        <Cartao key={String(l.usuario)}>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{String(l.usuario)}</span>
            <span className="text-xs text-zinc-500">{String(l.validade_dias)} dias por senha</span>
            {!!l.observacao && <span className="text-xs text-zinc-500">· {String(l.observacao)}</span>}
            <span className="ml-auto">
              <BotaoPequeno
                perigo
                onClick={() =>
                  confirm(`Tirar ${String(l.usuario)} dos logins genéricos?`) &&
                  void agir(() => api.excluir('genericos', l.usuario), 'Removido.')
                }
              >
                Remover
              </BotaoPequeno>
            </span>
          </div>
        </Cartao>
      ))}
    </div>
  )
}

// ── Senhas ───────────────────────────────────────────────────────────────────

function Senhas({ linhas, api, agir }: PropsLista) {
  const [descricao, setDescricao] = useState('')
  const [senha, setSenha] = useState('')
  const [tenant, setTenant] = useState('')
  return (
    <div className="space-y-3">
      <Cartao>
        <p className="text-sm font-medium">Nova senha de liberação</p>
        <p className="text-xs text-zinc-400">
          Quem tem login próprio no Windows e ainda não está liberado digita esta senha e fica liberado dali em diante.
          Não vale para login genérico (lá é usuário + senha pessoal). A senha é guardada só como hash e não aparece mais depois.
        </p>
        <div className="grid sm:grid-cols-3 gap-2">
          <Campo rotulo="Descrição">
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className="input" />
          </Campo>
          <Campo rotulo="Senha (mín. 8)">
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className="input" />
          </Campo>
          <Campo rotulo="Só no tenant (opcional)">
            <input value={tenant} onChange={(e) => setTenant(e.target.value)} className="input" />
          </Campo>
        </div>
        <button
          disabled={!descricao.trim() || senha.length < 8}
          onClick={() =>
            void agir(() => api.novaSenha(descricao.trim(), senha, tenant.trim()), 'Senha criada.').then(() => {
              setDescricao('')
              setSenha('')
              setTenant('')
            })
          }
          className="bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          Criar senha
        </button>
      </Cartao>
      {linhas.length === 0 && <Vazio>Nenhuma senha cadastrada.</Vazio>}
      {linhas.map((l) => (
        <Cartao key={String(l.id)} alerta={!l.ativo}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{String(l.descricao)}</span>
            {!!l.tenant && <span className="font-mono text-xs text-zinc-400">{String(l.tenant)}</span>}
            <span className={`ml-auto text-xs ${l.ativo ? 'text-green-400' : 'text-zinc-500'}`}>{l.ativo ? 'ativa' : 'desativada'}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 text-xs text-zinc-500">
            <span>usada {String(l.usos ?? 0)}{l.max_usos ? ` de ${String(l.max_usos)}` : ''} vez(es)</span>
            <span>criada {fmt(l.criado_em)}</span>
            {!!l.expira_em && <span>vence {fmt(l.expira_em)}</span>}
          </div>
          <div className="flex gap-2">
            <BotaoPequeno onClick={() => void agir(() => api.salvar('senhas', { id: l.id, ativo: !l.ativo }),
              l.ativo ? 'Senha desativada.' : 'Senha reativada.')}>
              {l.ativo ? 'Desativar' : 'Reativar'}
            </BotaoPequeno>
            <BotaoPequeno
              perigo
              onClick={() => confirm('Excluir esta senha?') && void agir(() => api.excluir('senhas', l.id), 'Senha excluída.')}
            >
              Excluir
            </BotaoPequeno>
          </div>
        </Cartao>
      ))}
    </div>
  )
}

// ── Registros ────────────────────────────────────────────────────────────────

const RESULTADO: Record<string, string> = {
  liberado: '✅ liberado',
  nao_cadastrado: '🔒 não cadastrado',
  generico: '🔒 login genérico (pediu usuário e senha)',
  senha_invalida: '❌ senha errada',
  muitas_tentativas: '⛔ muitas tentativas',
  bloqueado: '⛔ usuário bloqueado',
  pc_bloqueado: '⛔ computador bloqueado',
  pc_pendente: '⏳ computador aguardando aprovação',
  admin_chave_invalida: '⚠️ admin: chave errada',
}

function Registros({ linhas }: { linhas: Linha[] }) {
  const [filtro, setFiltro] = useState('')
  const f = filtro.trim().toLowerCase()
  const visiveis = f ? linhas.filter((l) => JSON.stringify(l).toLowerCase().includes(f)) : linhas
  return (
    <div className="space-y-2">
      <input placeholder="filtrar (usuário, máquina, resultado…)" value={filtro} onChange={(e) => setFiltro(e.target.value)} className="input" />
      {visiveis.length === 0 && <Vazio>Nada registrado.</Vazio>}
      <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg">
        {visiveis.map((l) => (
          <div key={String(l.id)} className="px-3 py-2 text-xs flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="text-zinc-500 w-36 shrink-0">{fmt(l.quando)}</span>
            <span className="w-56 shrink-0">{RESULTADO[String(l.resultado)] ?? String(l.resultado)}</span>
            <span className="text-zinc-300">
              {String(l.dominio ? `${String(l.dominio)}\\` : '')}{String(l.usuario ?? '')}
              {!!l.pessoa && <span className="text-green-400"> → {String(l.pessoa)}</span>}
            </span>
            <span className="text-zinc-400">{String(l.maquina ?? '')}</span>
            {!!l.versao && <span className="text-zinc-500">v{String(l.versao)}</span>}
            {!!l.detalhe && <span className="text-zinc-500 basis-full">{String(l.detalhe)}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── pedaços ──────────────────────────────────────────────────────────────────

function fmt(v: unknown): string {
  if (!v) return ''
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString()
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-zinc-400">{rotulo}</span>
      {children}
    </label>
  )
}

// Senha pessoal: quem usa um login genérico do Windows (ex.: "Tecnova") se identifica com usuário + esta senha.
function SenhaPessoal({ usuario, tem, api, agir }: { usuario: string; tem: boolean } & Omit<PropsLista, 'linhas'>) {
  const [aberto, setAberto] = useState(false)
  const [senha, setSenha] = useState('')
  if (!aberto)
    return (
      <BotaoPequeno onClick={() => setAberto(true)}>{tem ? 'Trocar senha pessoal' : 'Definir senha pessoal'}</BotaoPequeno>
    )
  const fechar = () => {
    setAberto(false)
    setSenha('')
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input type="password" autoComplete="new-password" placeholder="nova senha (mín. 8)" value={senha}
        onChange={(e) => setSenha(e.target.value)} className="input !w-48 !py-1 text-xs" />
      <BotaoPequeno disabled={senha.length < 8}
        onClick={() => void agir(() => api.senhaPessoal(usuario, senha), `Senha pessoal de ${usuario} definida.`).then(fechar)}>
        Salvar
      </BotaoPequeno>
      {tem && (
        <BotaoPequeno perigo
          onClick={() => confirm(`Remover a senha pessoal de ${usuario}? Ele não entra mais por login genérico.`) &&
            void agir(() => api.senhaPessoal(usuario, null), 'Senha pessoal removida.').then(fechar)}>
          Remover
        </BotaoPequeno>
      )}
      <BotaoPequeno onClick={fechar}>Cancelar</BotaoPequeno>
    </span>
  )
}

function Cartao({ children, alerta }: { children: ReactNode; alerta?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${alerta ? 'border-amber-800 bg-amber-950/20' : 'border-zinc-800 bg-zinc-900'}`}>
      {children}
    </div>
  )
}

function Caixa({ tipo, children }: { tipo: 'erro' | 'ok'; children: ReactNode }) {
  return (
    <div
      className={`rounded-lg p-3 text-sm border ${
        tipo === 'erro' ? 'bg-red-950 border-red-800 text-red-300' : 'bg-green-950 border-green-800 text-green-300'
      }`}
    >
      {children}
    </div>
  )
}

function Numero({ rotulo, valor, alerta }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${alerta ? 'border-amber-700 bg-amber-950/30' : 'border-zinc-800 bg-zinc-900'}`}>
      <p className={`text-lg font-mono ${alerta ? 'text-amber-300' : 'text-zinc-100'}`}>{valor}</p>
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{rotulo}</p>
    </div>
  )
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="text-sm text-zinc-500">{children}</p>
}

function BotaoPequeno({
  children,
  onClick,
  disabled,
  perigo,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  perigo?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-xs px-2.5 py-1 rounded disabled:opacity-40 ${
        perigo ? 'bg-red-950 hover:bg-red-900 text-red-300' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
      }`}
    >
      {children}
    </button>
  )
}
