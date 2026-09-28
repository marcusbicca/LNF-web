import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'

type Row = Record<string, unknown>

// ─────────────────────────────────────────────────────────────────────────────
// Painel de Controle — o singleton app_control (id=1) com CONTROLES DE PROPÓSITO,
// não um grid. A aba "Tabelas" já edita a linha crua; o valor aqui é:
//   • o kill-switch como três botões, com confirmação forte (digitar o status);
//   • versões-alvo rotuladas, com aviso de que disparam a auto-atualização;
//   • mensagem inicial como textarea, data de lançamento como date, toggles;
//   • agrupamento por assunto e dicas de faixa/limite.
//
// Escrita pela lnf-api (op UPSERT em app_control, gateado por barrarEscrita —
// mexer aqui exige o nível que a Edge define; sem ele, a gravação é recusada e
// o erro aparece na tela).
// ─────────────────────────────────────────────────────────────────────────────

type Status = 'ativo' | 'bloqueado' | 'eliminar'

const STATUS_INFO: Record<Status, { rotulo: string; cor: string; aviso: string }> = {
  ativo: {
    rotulo: 'Ativo',
    cor: 'green',
    aviso: 'Operação normal — todas as máquinas do parque funcionam.',
  },
  bloqueado: {
    rotulo: 'Bloqueado',
    cor: 'amber',
    aviso: 'RECUSA toda ação do parque (menos ping/status). Ninguém consegue lançar.',
  },
  eliminar: {
    rotulo: 'Eliminar',
    cor: 'red',
    aviso: 'Sinaliza desativação — no desenho do módulo em memória, é o gatilho da desinstalação. Use com muito cuidado.',
  },
}

export function Controle() {
  const { config } = useApp()
  const svc = useMemo(() => (config ? new SupabaseService(config) : null), [config])

  const [row, setRow] = useState<Row | null>(null)
  const [form, setForm] = useState<Row>({})
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!svc) return
    setCarregando(true)
    setErro(null)
    setStatus(null)
    try {
      const linhas = await svc.lerLinhas('app_control', { limit: 1 })
      const r = linhas[0] ?? { id: 1 }
      setRow(r)
      setForm(JSON.parse(JSON.stringify(r)) as Row)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [svc])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const set = (campo: string, val: unknown) => setForm(f => ({ ...f, [campo]: val }))

  const statusAtual = String(form.status ?? 'ativo') as Status
  const statusOriginal = String(row?.status ?? 'ativo') as Status
  const alterouStatusParaPerigoso =
    statusAtual !== statusOriginal && (statusAtual === 'bloqueado' || statusAtual === 'eliminar')

  async function salvar() {
    if (!svc) return

    // Confirmação forte quando o status muda para bloqueado/eliminar: digitar
    // exatamente o status. É o único campo cujo efeito é a frota inteira parar.
    if (alterouStatusParaPerigoso) {
      const digitado = window.prompt(
        `⚠️ Isto afeta TODA a frota.\n\n${STATUS_INFO[statusAtual].aviso}\n\n` +
          `Para confirmar, digite exatamente: ${statusAtual}`,
      )
      if (digitado !== statusAtual) {
        setStatus('⚠️ Confirmação não bateu — nada foi alterado.')
        return
      }
    }

    setSalvando(true)
    setStatus(null)
    try {
      // Envia só os campos gerenciados aqui (o upsert do PostgREST só toca as
      // colunas presentes, preservando as demais). id=1 é a chave do singleton.
      const payload: Row = {
        id: 1,
        status: statusAtual,
        versao_xlam: strOrNull(form.versao_xlam),
        versao_xlsm: strOrNull(form.versao_xlsm),
        versao_exe: strOrNull(form.versao_exe),
        data_lancamento: strOrNull(form.data_lancamento),
        mensagem_inicial: strOrNull(form.mensagem_inicial),
        nfs_por_segundo: numOrNull(form.nfs_por_segundo),
        carencia_dias: numOrNull(form.carencia_dias),
        meses_slip_padrao: numOrNull(form.meses_slip_padrao),
        sap_timeout_script_seg: numOrNull(form.sap_timeout_script_seg),
        sap_timeout_rfc_seg: numOrNull(form.sap_timeout_rfc_seg),
        depositos_estoque_bloqueado: strOrNull(form.depositos_estoque_bloqueado),
        canal_sempre_ativo: !!form.canal_sempre_ativo,
      }
      await svc.salvarLinha('app_control', payload, 'id')
      setRow(f => ({ ...(f ?? {}), ...payload }))
      setStatus('✅ Painel de controle salvo.')
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  if (!config) return <Aviso>Configure a conexão em Configurações para começar.</Aviso>

  return (
    <div className="p-4 space-y-5 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Painel de Controle</h2>
        <button
          onClick={() => void carregar()}
          disabled={carregando}
          className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded text-zinc-300"
        >
          {carregando ? 'Lendo...' : 'Recarregar'}
        </button>
      </div>

      {erro && (
        <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">❌ {erro}</div>
      )}

      {row && (
        <>
          {/* ── Estado da frota (kill-switch) ── */}
          <Secao titulo="Estado da frota" subtitulo="O kill-switch. Afeta todas as máquinas.">
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(STATUS_INFO) as Status[]).map(s => {
                const ativo = statusAtual === s
                const c = STATUS_INFO[s].cor
                return (
                  <button
                    key={s}
                    onClick={() => set('status', s)}
                    className={`py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
                      ativo
                        ? c === 'green'
                          ? 'bg-green-600 border-green-500 text-white'
                          : c === 'amber'
                            ? 'bg-amber-600 border-amber-500 text-white'
                            : 'bg-red-600 border-red-500 text-white'
                        : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {STATUS_INFO[s].rotulo}
                  </button>
                )
              })}
            </div>
            <p
              className={`text-xs mt-2 ${
                statusAtual === 'ativo'
                  ? 'text-zinc-500'
                  : statusAtual === 'bloqueado'
                    ? 'text-amber-400'
                    : 'text-red-400'
              }`}
            >
              {STATUS_INFO[statusAtual].aviso}
            </p>
            {alterouStatusParaPerigoso && (
              <p className="text-xs mt-1 text-zinc-500">
                Ao salvar, será pedido para você digitar <span className="font-mono">{statusAtual}</span> para confirmar.
              </p>
            )}
          </Secao>

          {/* ── Versões-alvo ── */}
          <Secao
            titulo="Versões-alvo"
            subtitulo="O parque se auto-atualiza para estas versões. Mude só ao publicar uma release."
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <CampoTexto label="xlam" value={form.versao_xlam} onChange={v => set('versao_xlam', v)} mono />
              <CampoTexto label="xlsm" value={form.versao_xlsm} onChange={v => set('versao_xlsm', v)} mono />
              <CampoTexto label="exe (Coreon)" value={form.versao_exe} onChange={v => set('versao_exe', v)} mono />
            </div>
          </Secao>

          {/* ── Operação ── */}
          <Secao titulo="Operação">
            <CampoTexto
              label="Mensagem inicial (aviso ao abrir o Lançador)"
              value={form.mensagem_inicial}
              onChange={v => set('mensagem_inicial', v)}
              textarea
            />
            <div className="grid grid-cols-2 gap-3">
              <CampoTexto
                label="Data de lançamento"
                value={form.data_lancamento}
                onChange={v => set('data_lancamento', v)}
                placeholder="dd.mm.aaaa ou vazio"
                mono
              />
              <CampoNumero
                label="NFs por segundo (teto do download)"
                value={form.nfs_por_segundo}
                onChange={v => set('nfs_por_segundo', v)}
                hint="nulo = 2; código limita a 10"
              />
            </div>
            <CampoTexto
              label="Depósitos de estoque bloqueado (separados por vírgula)"
              value={form.depositos_estoque_bloqueado}
              onChange={v => set('depositos_estoque_bloqueado', v)}
              placeholder="TRO,DVNF"
              mono
            />
          </Secao>

          {/* ── SAP / avançado ── */}
          <Secao titulo="SAP e limites" subtitulo="Mexa só se souber o efeito.">
            <div className="grid grid-cols-2 gap-3">
              <CampoNumero
                label="Timeout SAP GUI Scripting (s)"
                value={form.sap_timeout_script_seg}
                onChange={v => set('sap_timeout_script_seg', v)}
                hint="nulo = 20"
              />
              <CampoNumero
                label="Timeout RFC (s)"
                value={form.sap_timeout_rfc_seg}
                onChange={v => set('sap_timeout_rfc_seg', v)}
                hint="nulo = 120; 15..900"
              />
              <CampoNumero
                label="Meses do slip (padrão)"
                value={form.meses_slip_padrao}
                onChange={v => set('meses_slip_padrao', v)}
              />
              <CampoNumero
                label="Carência offline (dias)"
                value={form.carencia_dias}
                onChange={v => set('carencia_dias', v)}
                hint="padrão 14"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer mt-1">
              <input
                type="checkbox"
                checked={!!form.canal_sempre_ativo}
                onChange={e => set('canal_sempre_ativo', e.target.checked)}
                className="w-4 h-4 accent-green-500"
              />
              Canal remoto sempre ativo
            </label>
          </Secao>

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

          <button
            onClick={() => void salvar()}
            disabled={salvando}
            className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition-colors"
          >
            {salvando ? 'Salvando...' : 'Salvar painel de controle'}
          </button>
        </>
      )}
    </div>
  )
}

// ── helpers de valor ─────────────────────────────────────────────────────────
function strOrNull(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? null : s
}
function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── UI ───────────────────────────────────────────────────────────────────────
function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-6 text-center text-zinc-400 mt-12 space-y-2">
      <p className="text-4xl">🔑</p>
      <p>{children}</p>
    </div>
  )
}

function Secao({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string
  subtitulo?: string
  children: React.ReactNode
}) {
  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-zinc-200">{titulo}</h3>
        {subtitulo && <p className="text-xs text-zinc-500">{subtitulo}</p>}
      </div>
      {children}
    </div>
  )
}

function CampoTexto({
  label,
  value,
  onChange,
  mono,
  textarea,
  placeholder,
}: {
  label: string
  value: unknown
  onChange: (v: string) => void
  mono?: boolean
  textarea?: boolean
  placeholder?: string
}) {
  const cls = `w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500 ${
    mono ? 'font-mono' : ''
  }`
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">{label}</label>
      {textarea ? (
        <textarea
          value={value == null ? '' : String(value)}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className={cls + ' resize-y'}
        />
      ) : (
        <input
          value={value == null ? '' : String(value)}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={cls}
        />
      )}
    </div>
  )
}

function CampoNumero({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: unknown
  onChange: (v: string) => void
  hint?: string
}) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">{label}</label>
      <input
        type="number"
        value={value == null ? '' : String(value)}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
      />
      {hint && <p className="text-[11px] text-zinc-600 mt-0.5">{hint}</p>}
    </div>
  )
}
