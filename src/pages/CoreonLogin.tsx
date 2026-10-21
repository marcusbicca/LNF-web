import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'
import { hashSenhaCoreon } from '../utils/coreonSenha'

type Row = Record<string, unknown>

// ─────────────────────────────────────────────────────────────────────────────
// Login do Coreon — administração (nível 3 + chave de dev).
//
// Governa o login que o HOST pede ao usuário ATIVO antes de liberar o módulo:
//
//   • o botão de rollout  → app_control.login_obrigatorio. OFF (padrão) = nada
//     muda no parque; o PAYLOAD sai como sempre. ON = ativo numa máquina
//     autorizada passa a precisar de senha.
//   • autorização POR MÁQUINA (coreon_maquina): o primeiro acesso de um ativo
//     cria uma linha 'pendente' (e o dono recebe e-mail). Aqui você AUTORIZA
//     (a máquina passa a poder definir senha e logar) ou BLOQUEIA.
//   • senha do usuário (coreon_senha): aqui você RESETA — apaga a senha, e no
//     próximo login o usuário define outra (a máquina segue autorizada).
//   • cadastro DIRETO, sem esperar pedido: autoriza para um usuário qualquer
//     máquina que já apareceu em 'dispositivos' (qualquer host 2.0.0.x que
//     assina registra a máquina no PAYLOAD), e define a senha dele. O hash é
//     feito no navegador, igual ao da lnf-api (utils/coreonSenha.ts).
//
// Todas as tabelas são dev-only no lnf-api (leitura e escrita exigem nível 3 +
// chave de dev). Sem a chave em Configurações, a lnf-api recusa e o erro
// aparece aqui — nada é administrado "só" pelo nível.
// ─────────────────────────────────────────────────────────────────────────────

type StatusMaq = 'pendente' | 'autorizada' | 'bloqueada'

const PRIORIDADE: Record<string, number> = { pendente: 0, autorizada: 1, bloqueada: 2 }

const BADGE: Record<string, string> = {
  pendente: 'bg-amber-600/20 text-amber-300 border-amber-700',
  autorizada: 'bg-green-600/20 text-green-300 border-green-700',
  bloqueada: 'bg-red-600/20 text-red-300 border-red-700',
}

function quando(v: unknown): string {
  const s = typeof v === 'string' ? v : ''
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleString('pt-BR')
}

function curto(disp: unknown): string {
  const s = typeof disp === 'string' ? disp : ''
  return s ? s.slice(0, 8) + '…' : '—'
}

export function CoreonLogin() {
  const { config } = useApp()
  const svc = useMemo(() => (config ? new SupabaseService(config) : null), [config])

  const [loginOn, setLoginOn] = useState<boolean | null>(null)
  // app_control.sessao_obrigatoria: com o login ligado, a lnf-api só entrega
  // dado a quem abriu sessão com a senha (host 2.0.0.11+).
  const [sessaoOn, setSessaoOn] = useState<boolean | null>(null)
  const [maquinas, setMaquinas] = useState<Row[]>([])
  const [senhas, setSenhas] = useState<Row[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  // Cadastro direto
  const [dispositivos, setDispositivos] = useState<Row[]>([])
  const [usuarios, setUsuarios] = useState<Row[]>([])
  const [novoUsuario, setNovoUsuario] = useState('')
  const [novoDisp, setNovoDisp] = useState('')
  const [novaSenha, setNovaSenha] = useState('')
  const [novaSenha2, setNovaSenha2] = useState('')

  const comSenha = useMemo(() => {
    const set = new Set<string>()
    for (const s of senhas) {
      const u = typeof s.usuario === 'string' ? s.usuario : ''
      if (u) set.add(u.toLowerCase())
    }
    return set
  }, [senhas])

  const carregar = useCallback(async () => {
    if (!svc) return
    setCarregando(true)
    setErro(null)
    setMsg(null)
    try {
      const [ac, maq, sen, disp, usu] = await Promise.all([
        svc.lerLinhas('app_control', { select: '*', limit: 1 }),
        svc.lerLinhas('coreon_maquina', { order: 'solicitado_em.desc', limit: 1000 }),
        svc.lerLinhas('coreon_senha', { select: 'usuario,atualizado_em', order: 'atualizado_em.desc', limit: 1000 }),
        svc.lerLinhas('dispositivos', {
          select: 'id,usuario,maquina,versao_host,assinatura_ok,ultimo_em',
          order: 'ultimo_em.desc',
          limit: 1000,
        }),
        svc.lerLinhas('usuarios', { select: 'username,ativo', order: 'username.asc', limit: 1000 }),
      ])
      setDispositivos(disp)
      setUsuarios(usu)
      setLoginOn(ac[0]?.login_obrigatorio === true)
      setSessaoOn(ac[0]?.sessao_obrigatoria === true)
      // Pendentes primeiro, depois autorizadas, depois bloqueadas.
      const ordenadas = [...maq].sort((a, b) => {
        const pa = PRIORIDADE[String(a.status ?? '')] ?? 9
        const pb = PRIORIDADE[String(b.status ?? '')] ?? 9
        return pa - pb
      })
      setMaquinas(ordenadas)
      setSenhas(sen)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [svc])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const filtroMaq = (m: Row) =>
    `usuario=eq.${encodeURIComponent(String(m.usuario ?? ''))}` +
    `&dispositivo=eq.${encodeURIComponent(String(m.dispositivo ?? ''))}`

  async function mudarStatus(m: Row, novo: StatusMaq) {
    if (!svc || !config) return
    const chave = String(m.usuario) + '|' + String(m.dispositivo)
    setOcupado(chave)
    setErro(null)
    setMsg(null)
    try {
      const valores: Row = { status: novo }
      if (novo === 'autorizada') {
        valores.autorizado_em = new Date().toISOString()
        valores.autorizado_por = config.usuario ?? ''
      }
      await svc.atualizarLinha('coreon_maquina', filtroMaq(m), valores)
      setMsg(`✅ Máquina de ${String(m.usuario)} → ${novo}.`)
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  async function resetarSenha(usuario: string) {
    if (!svc) return
    if (
      window.prompt(
        `Resetar a senha do Coreon de "${usuario}"?\n\n` +
          'A senha será APAGADA. No próximo login, numa máquina autorizada, ele define outra.\n\n' +
          `Para confirmar, digite: ${usuario}`,
      ) !== usuario
    ) {
      setMsg('⚠️ Confirmação não bateu — nada foi alterado.')
      return
    }
    setOcupado('senha|' + usuario)
    setErro(null)
    setMsg(null)
    try {
      await svc.deletarLinha('coreon_senha', `usuario=eq.${encodeURIComponent(usuario)}`)
      setMsg(`✅ Senha de ${usuario} resetada.`)
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  // Máquinas conhecidas, as do usuário escolhido primeiro.
  const dispOrdenados = useMemo(() => {
    const u = novoUsuario.trim().toLowerCase()
    return [...dispositivos].sort((a, b) => {
      const ma = String(a.usuario ?? '').toLowerCase() === u ? 0 : 1
      const mb = String(b.usuario ?? '').toLowerCase() === u ? 0 : 1
      return ma - mb
    })
  }, [dispositivos, novoUsuario])

  async function autorizarDireto() {
    if (!svc || !config) return
    const usuario = novoUsuario.trim().toLowerCase()
    const d = dispositivos.find(x => String(x.id) === novoDisp)
    if (!usuario || !d) {
      setErro('Escolha o usuário e a máquina.')
      return
    }
    setOcupado('direto-maq')
    setErro(null)
    setMsg(null)
    try {
      // Upsert: se já havia pedido (pendente/bloqueada) para o par, vira autorizada.
      await svc.salvarLinha(
        'coreon_maquina',
        {
          usuario,
          dispositivo: String(d.id),
          status: 'autorizada',
          maquina: d.maquina ?? null,
          autorizado_em: new Date().toISOString(),
          autorizado_por: config.usuario ?? '',
        },
        'usuario,dispositivo',
      )
      setMsg(`✅ Máquina ${String(d.maquina ?? d.id)} autorizada para ${usuario}.`)
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  async function definirSenhaDireto() {
    if (!svc) return
    const usuario = novoUsuario.trim().toLowerCase()
    if (!usuario) {
      setErro('Escolha o usuário.')
      return
    }
    // Mesmo mínimo do COREON_DEFINIR_SENHA na lnf-api.
    if (novaSenha.length < 6) {
      setErro('A senha precisa de pelo menos 6 caracteres.')
      return
    }
    if (novaSenha !== novaSenha2) {
      setErro('As duas senhas não conferem.')
      return
    }
    if (
      comSenha.has(usuario) &&
      !window.confirm(`${usuario} já tem senha. Trocar pela nova?`)
    )
      return
    setOcupado('direto-senha')
    setErro(null)
    setMsg(null)
    try {
      const h = await hashSenhaCoreon(novaSenha)
      await svc.salvarLinha(
        'coreon_senha',
        { usuario, ...h, atualizado_em: new Date().toISOString() },
        'usuario',
      )
      setNovaSenha('')
      setNovaSenha2('')
      setMsg(`✅ Senha de ${usuario} definida. Passe a senha a ele: o host vai pedi-la na próxima abertura numa máquina autorizada.`)
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  async function alternarSessao() {
    if (!svc || sessaoOn === null) return
    const novo = !sessaoOn
    if (novo) {
      if (
        window.prompt(
          '⚠️ EXIGIR SESSÃO do login.\n\n' +
            'Com o login ligado, a lnf-api passa a NÃO entregar dado nenhum a um Lançador que não ' +
            'entrou com a senha nesta abertura — inclusive os que já estão abertos agora: eles se ' +
            'reiniciam para pedir a senha (módulo novo) ou ficam sem dados até reabrir (antigo).\n\n' +
            'Só ligue quando o versao_host do parque for 2.0.0.11+ (o host que abre a sessão). ' +
            'Antes disso, quem já loga hoje ficaria sem dados.\n\n' +
            'Para confirmar, digite: EXIGIR',
        ) !== 'EXIGIR'
      ) {
        setMsg('⚠️ Confirmação não bateu — a flag não mudou.')
        return
      }
    }
    setOcupado('sessao')
    setErro(null)
    setMsg(null)
    try {
      await svc.salvarLinha('app_control', { id: 1, sessao_obrigatoria: novo }, 'id')
      setSessaoOn(novo)
      setMsg(novo ? '✅ Sessão obrigatória LIGADA.' : '✅ Sessão obrigatória DESLIGADA.')
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  async function alternarLogin() {
    if (!svc || loginOn === null) return
    const novo = !loginOn
    if (novo) {
      if (
        window.prompt(
          '⚠️ LIGAR o login obrigatório do Coreon.\n\n' +
            'A partir daí, todo usuário ATIVO numa máquina autorizada precisa de SENHA ' +
            'para o host liberar o módulo. Só ligue quando os hosts já souberem logar ' +
            '(v2.0.0.4+) e as máquinas estiverem autorizadas.\n\n' +
            'Para confirmar, digite: LIGAR',
        ) !== 'LIGAR'
      ) {
        setMsg('⚠️ Confirmação não bateu — a flag não mudou.')
        return
      }
    }
    setOcupado('flag')
    setErro(null)
    setMsg(null)
    try {
      await svc.salvarLinha('app_control', { id: 1, login_obrigatorio: novo }, 'id')
      setLoginOn(novo)
      setMsg(novo ? '✅ Login obrigatório LIGADO.' : '✅ Login obrigatório DESLIGADO.')
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  if (!config)
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 text-zinc-300 text-sm">
          Configure a conexão em Configurações para começar.
        </div>
      </div>
    )

  const semChave = !config.chaveDev
  const pendentes = maquinas.filter(m => String(m.status) === 'pendente').length

  return (
    <div className="p-4 space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Login do Coreon</h2>
        <button
          onClick={() => void carregar()}
          disabled={carregando}
          className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded text-zinc-300"
        >
          {carregando ? 'Lendo...' : 'Recarregar'}
        </button>
      </div>

      {semChave && (
        <div className="bg-amber-950 border border-amber-800 rounded-lg p-3 text-amber-300 text-sm">
          Esta tela exige <strong>nível 3 + chave de dev</strong>. Preencha a chave de dev em
          Configurações — sem ela a lnf-api recusa a leitura e a escrita.
        </div>
      )}
      {erro && (
        <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">❌ {erro}</div>
      )}
      {msg && (
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-zinc-200 text-sm">{msg}</div>
      )}

      {/* ── Rollout: a flag ── */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold">Login obrigatório</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              <span className="font-mono">app_control.login_obrigatorio</span>. Desligado (padrão), nada
              muda no parque. Ligado, ativo em máquina autorizada precisa de senha.
            </p>
          </div>
          <button
            onClick={() => void alternarLogin()}
            disabled={loginOn === null || ocupado === 'flag'}
            className={`shrink-0 py-2 px-4 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-40 ${
              loginOn
                ? 'bg-green-600 border-green-500 text-white hover:bg-green-700'
                : 'bg-zinc-800 border-zinc-600 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            {loginOn === null ? '—' : loginOn ? 'LIGADO' : 'DESLIGADO'}
          </button>
        </div>
        <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-zinc-800">
          <div>
            <h3 className="font-semibold">Sem senha, sem dados</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              <span className="font-mono">app_control.sessao_obrigatoria</span>. Com o login ligado, a
              lnf-api recusa toda chamada de um Lançador que não entrou com a senha — inclusive os que já
              estavam abertos. Ligue só com o parque no host 2.0.0.11+.
            </p>
          </div>
          <button
            onClick={() => void alternarSessao()}
            disabled={sessaoOn === null || ocupado === 'sessao'}
            className={`shrink-0 py-2 px-4 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-40 ${
              sessaoOn
                ? 'bg-green-600 border-green-500 text-white hover:bg-green-700'
                : 'bg-zinc-800 border-zinc-600 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            {sessaoOn === null ? '—' : sessaoOn ? 'LIGADO' : 'DESLIGADO'}
          </button>
        </div>
      </section>

      {/* ── Cadastro direto ── */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Cadastrar sem pedido</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Autoriza uma máquina e define a senha sem esperar o pedido do host. A máquina precisa já ter
            aberto o Lançador uma vez (aparece em <span className="font-mono">dispositivos</span>).
          </p>
        </div>

        <label className="block text-xs text-zinc-400">
          Usuário
          <input
            list="coreon-usuarios"
            value={novoUsuario}
            onChange={e => setNovoUsuario(e.target.value)}
            placeholder="usuário do Windows"
            className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
          />
          <datalist id="coreon-usuarios">
            {usuarios.map(u => (
              <option key={String(u.username)} value={String(u.username)}>
                {u.ativo === false ? 'inativo' : ''}
              </option>
            ))}
          </datalist>
        </label>

        <div className="flex gap-2 items-end">
          <label className="flex-1 block text-xs text-zinc-400">
            Máquina
            <select
              value={novoDisp}
              onChange={e => setNovoDisp(e.target.value)}
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
            >
              <option value="">— escolha —</option>
              {dispOrdenados.map(d => (
                <option key={String(d.id)} value={String(d.id)}>
                  {String(d.maquina ?? '?')} · {String(d.usuario ?? '?')} · host {String(d.versao_host ?? '?')} ·{' '}
                  {quando(d.ultimo_em)}
                  {d.assinatura_ok === false ? ' · assinatura NÃO confere' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => void autorizarDireto()}
            disabled={ocupado === 'direto-maq' || !novoUsuario.trim() || !novoDisp}
            className="shrink-0 text-xs px-3 py-2 rounded bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white"
          >
            Autorizar máquina
          </button>
        </div>

        <div className="flex gap-2 items-end">
          <label className="flex-1 block text-xs text-zinc-400">
            Senha
            <input
              type="password"
              autoComplete="new-password"
              value={novaSenha}
              onChange={e => setNovaSenha(e.target.value)}
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
            />
          </label>
          <label className="flex-1 block text-xs text-zinc-400">
            Repetir
            <input
              type="password"
              autoComplete="new-password"
              value={novaSenha2}
              onChange={e => setNovaSenha2(e.target.value)}
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
            />
          </label>
          <button
            onClick={() => void definirSenhaDireto()}
            disabled={ocupado === 'direto-senha' || !novoUsuario.trim() || !novaSenha}
            className="shrink-0 text-xs px-3 py-2 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 text-white"
          >
            Definir senha
          </button>
        </div>
      </section>

      {/* ── Máquinas ── */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">
            Máquinas{' '}
            {pendentes > 0 && (
              <span className="ml-1 text-xs bg-amber-600/20 text-amber-300 border border-amber-700 rounded px-1.5 py-0.5">
                {pendentes} pendente{pendentes > 1 ? 's' : ''}
              </span>
            )}
          </h3>
          <span className="text-xs text-zinc-500">{maquinas.length} no total</span>
        </div>

        {maquinas.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhuma máquina registrada ainda.</p>
        ) : (
          <div className="space-y-2">
            {maquinas.map(m => {
              const st = String(m.status ?? '')
              const u = String(m.usuario ?? '')
              const chave = u + '|' + String(m.dispositivo ?? '')
              const busy = ocupado === chave
              return (
                <div
                  key={chave}
                  className="border border-zinc-800 rounded-lg p-3 bg-zinc-950/40 flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{u || '—'}</span>
                      <span className={`text-[11px] border rounded px-1.5 py-0.5 ${BADGE[st] ?? 'bg-zinc-700 text-zinc-300 border-zinc-600'}`}>
                        {st || '—'}
                      </span>
                      {comSenha.has(u.toLowerCase()) && (
                        <span className="text-[11px] text-zinc-400 border border-zinc-700 rounded px-1.5 py-0.5">com senha</span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1 space-x-3">
                      <span>{String(m.maquina ?? '—')}</span>
                      <span className="font-mono">disp {curto(m.dispositivo)}</span>
                    </div>
                    <div className="text-[11px] text-zinc-600 mt-0.5 space-x-3">
                      <span>pedido {quando(m.solicitado_em)}</span>
                      {m.autorizado_em ? <span>autorizado {quando(m.autorizado_em)}</span> : null}
                      {m.ultimo_login_em ? <span>último login {quando(m.ultimo_login_em)}</span> : null}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {st !== 'autorizada' && (
                      <button
                        onClick={() => void mudarStatus(m, 'autorizada')}
                        disabled={busy}
                        className="text-xs px-2.5 py-1.5 rounded bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white"
                      >
                        Autorizar
                      </button>
                    )}
                    {st !== 'bloqueada' && (
                      <button
                        onClick={() => void mudarStatus(m, 'bloqueada')}
                        disabled={busy}
                        className="text-xs px-2.5 py-1.5 rounded bg-red-800 hover:bg-red-700 disabled:opacity-40 text-white"
                      >
                        Bloquear
                      </button>
                    )}
                    {st === 'bloqueada' && (
                      <button
                        onClick={() => void mudarStatus(m, 'pendente')}
                        disabled={busy}
                        className="text-xs px-2.5 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200"
                      >
                        Pendente
                      </button>
                    )}
                    {comSenha.has(u.toLowerCase()) && (
                      <button
                        onClick={() => void resetarSenha(u)}
                        disabled={ocupado === 'senha|' + u}
                        className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-amber-300 border border-amber-800"
                      >
                        Resetar senha
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
