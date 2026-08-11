import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import type { Config } from '../types'
import { SupabaseService } from '../services/supabase'
import { GitHubService } from '../services/github'
import {
  importarLnfFiles,
  IMPORT_DEFAULTS,
  type ImportStepResult,
} from '../services/importLnfFiles'
import {
  lerChamadasPa,
  limparChamadasPa,
  observarPa,
  relatorioPa,
  resumir,
  type PaCall,
} from '../services/paLog'

export function Configuracoes() {
  const { config, salvarConfig, carregarItens, carregandoItens, erroItens, itens } = useApp()

  const [form, setForm] = useState<Config>({
    paUrl: config?.paUrl ?? '',
    itensPath: config?.itensPath ?? 'itens.json',
    usuario: config?.usuario ?? '',
  })

  function set(field: keyof Config, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  return (
    <div className="p-4 space-y-5 max-w-lg mx-auto">
      <h2 className="text-xl font-bold">Configurações</h2>

      <div className="space-y-4">
        <Field label="URL do Power Automate (leitura e escrita)">
          <input
            type="password"
            value={form.paUrl}
            onChange={e => set('paUrl', e.target.value)}
            placeholder="https://...powerautomate.../invoke?..."
            className="input"
          />
        </Field>

        <Field label="Usuário (autoriza quem pode gravar)">
          <input
            value={form.usuario}
            onChange={e => set('usuario', e.target.value)}
            placeholder="seu.login"
            className="input"
          />
        </Field>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => salvarConfig(form)}
          className="flex-1 bg-green-600 hover:bg-green-500 text-white font-medium py-2.5 rounded-lg transition-colors"
        >
          Salvar
        </button>
        <button
          onClick={() => void carregarItens()}
          disabled={carregandoItens || !config}
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white font-medium py-2.5 rounded-lg transition-colors"
        >
          {carregandoItens ? 'Carregando...' : 'Testar Conexão'}
        </button>
      </div>

      {erroItens && (
        <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">
          ❌ {erroItens}
        </div>
      )}

      {itens && !erroItens && (
        <div className="bg-green-950 border border-green-800 rounded-lg p-3 text-green-300 text-sm space-y-1">
          <p>✅ Conectado via Power Automate</p>
          <p className="text-zinc-400">
            {Object.keys(itens).length} fornecedores ·{' '}
            {Object.values(itens).reduce((acc, f) => acc + Object.keys(f).length, 0)} itens SAP
          </p>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-500 space-y-1">
        <p className="font-medium text-zinc-400">Como funciona:</p>
        <p>• O secret do Supabase fica no fluxo do Power Automate — nunca no browser.</p>
        <p>• A leitura e a escrita passam pelo mesmo fluxo (op SELECT/UPSERT/DELETE).</p>
        <p>• O campo "Usuário" vai no pedido de escrita; o fluxo decide quem pode gravar.</p>
      </div>

      <DiagnosticoPa />

      <ImportarLnfFiles paUrl={form.paUrl} usuario={form.usuario} />
    </div>
  )
}

// ── Diagnóstico do Power Automate ────────────────────────────────────────────
// Mostra o par pedido/resposta de cada chamada ao fluxo.
//
// Existe porque com "Entradas e Saídas Seguras" ligada na ação do fluxo, o
// histórico de execução do Power Automate marca a run como bem-sucedida e
// esconde exatamente os dois corpos. Deste lado nada é escondido.
//
// A URL do fluxo não aparece aqui de propósito: ela carrega a chave de
// invocação, e este painel foi feito pra ser copiado e colado.
function DiagnosticoPa() {
  const [aberto, setAberto] = useState(false)
  const [expandida, setExpandida] = useState<number | null>(null)
  const [copiado, setCopiado] = useState(false)

  const chamadas = useSyncExternalStore(observarPa, lerChamadasPa)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(relatorioPa())
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      /* clipboard bloqueada: o texto continua visível na tela */
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setAberto(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800/60 transition-colors"
      >
        <span className="font-medium">
          🔍 Diagnóstico do Power Automate
          {chamadas.length > 0 && (
            <span className="ml-2 text-xs text-zinc-500">({chamadas.length})</span>
          )}
        </span>
        <span className="text-zinc-500">{aberto ? '▲' : '▼'}</span>
      </button>

      {aberto && (
        <div className="p-3 border-t border-zinc-800 space-y-3">
          <p className="text-xs text-zinc-500">
            Cada chamada ao fluxo, com o corpo enviado e o corpo recebido — o que a opção
            "Entradas e Saídas Seguras" esconde do histórico do Power Automate. Fica só nesta
            aba e some ao recarregar a página. A URL do fluxo não é registrada.
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => void copiar()}
              disabled={chamadas.length === 0}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white text-sm py-2 rounded-lg transition-colors"
            >
              {copiado ? '✅ Copiado' : 'Copiar tudo'}
            </button>
            <button
              onClick={limparChamadasPa}
              disabled={chamadas.length === 0}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white text-sm py-2 rounded-lg transition-colors"
            >
              Limpar
            </button>
          </div>

          {chamadas.length === 0 ? (
            <p className="text-xs text-zinc-600 text-center py-3">
              Nenhuma chamada ainda nesta sessão.
            </p>
          ) : (
            <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800">
              {chamadas.map(c => (
                <LinhaPa
                  key={c.id}
                  chamada={c}
                  aberta={expandida === c.id}
                  onToggle={() => setExpandida(v => (v === c.id ? null : c.id))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LinhaPa({
  chamada,
  aberta,
  onToggle,
}: {
  chamada: PaCall
  aberta: boolean
  onToggle: () => void
}) {
  const c = chamada
  // HTTP 200 com erro no corpo é o caso que importa: o status engana, o corpo não.
  const cor = c.erro ? 'text-red-300' : c.status >= 200 && c.status < 300 ? 'text-zinc-300' : 'text-amber-300'

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-zinc-800/60 transition-colors text-left"
      >
        <span className={`font-mono ${cor} truncate`}>
          {c.erro ? '❌' : '✅'} {c.op} {c.tabela}
        </span>
        <span className="text-xs text-zinc-500 font-mono shrink-0">
          {c.status || '—'} · {c.ms}ms · {c.quando.toLocaleTimeString()}
        </span>
      </button>

      {aberta && (
        <div className="px-3 pb-3 space-y-2">
          {c.erro && (
            <div className="bg-red-950 border border-red-800 rounded p-2 text-xs text-red-300 whitespace-pre-wrap">
              {c.erro}
            </div>
          )}
          <Bloco titulo="Enviado" texto={c.pedido} />
          <Bloco titulo="Recebido" texto={c.resposta || '(corpo vazio)'} />
        </div>
      )}
    </div>
  )
}

function Bloco({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-1">{titulo}</p>
      <pre className="bg-zinc-950 border border-zinc-800 rounded p-2 text-xs text-zinc-400 overflow-x-auto max-h-60 whitespace-pre-wrap break-all">
        {resumir(texto)}
      </pre>
    </div>
  )
}

// ── Importação única LNF-files → Supabase ────────────────────────────────────
function ImportarLnfFiles({ paUrl, usuario }: { paUrl: string; usuario: string }) {
  const [aberto, setAberto] = useState(false)
  const [ghToken, setGhToken] = useState('')
  const [owner, setOwner] = useState(IMPORT_DEFAULTS.owner)
  const [repo, setRepo] = useState(IMPORT_DEFAULTS.repo)
  const [rodando, setRodando] = useState(false)
  const [resultados, setResultados] = useState<ImportStepResult[]>([])
  const [erro, setErro] = useState<string | null>(null)

  async function importar() {
    setErro(null)
    if (!paUrl) {
      setErro('Preencha a URL do Power Automate acima antes de importar.')
      return
    }
    if (!ghToken.trim()) {
      setErro('Informe um GitHub token com leitura do LNF-files.')
      return
    }
    if (
      !window.confirm(
        'Importar os dados do LNF-files para o Supabase? É um upsert (não apaga o ' +
          'que já existe, mas sobrescreve linhas com o mesmo identificador).',
      )
    ) {
      return
    }

    setRodando(true)
    setResultados([])
    try {
      const sb = new SupabaseService(paUrl, usuario)
      const gh = new GitHubService(ghToken.trim(), owner.trim(), repo.trim())
      await importarLnfFiles(
        sb,
        gh,
        { ...IMPORT_DEFAULTS, owner: owner.trim(), repo: repo.trim() },
        r => setResultados(prev => [...prev, r]),
      )
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setRodando(false)
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setAberto(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800/60 transition-colors"
      >
        <span className="font-medium">⚙️ Importar do LNF-files (uso único)</span>
        <span className="text-zinc-500">{aberto ? '▲' : '▼'}</span>
      </button>

      {aberto && (
        <div className="p-3 border-t border-zinc-800 space-y-3">
          <p className="text-xs text-zinc-500">
            Puxa forn.json, itens.json, centros.json, usersList.json e termos_globais.json do
            GitHub e faz upsert no Supabase (via Power Automate). Use quando o LNF-files tiver
            dados mais novos que o banco. Fornecedores são importados antes dos materiais (FK).
          </p>

          <Field label="GitHub Token (leitura do LNF-files)">
            <input
              type="password"
              value={ghToken}
              onChange={e => setGhToken(e.target.value)}
              placeholder="github_pat_... (não é salvo)"
              className="input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Owner">
              <input value={owner} onChange={e => setOwner(e.target.value)} className="input" />
            </Field>
            <Field label="Repositório">
              <input value={repo} onChange={e => setRepo(e.target.value)} className="input" />
            </Field>
          </div>

          <button
            onClick={() => void importar()}
            disabled={rodando}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-medium py-2.5 rounded-lg transition-colors"
          >
            {rodando ? 'Importando...' : 'Importar agora'}
          </button>

          {erro && (
            <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">
              ❌ {erro}
            </div>
          )}

          {resultados.length > 0 && (
            <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800">
              {resultados.map(r => (
                <div key={r.etapa} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className={r.ok ? 'text-zinc-300' : 'text-red-300'}>
                    {r.ok ? '✅' : '❌'} {r.etapa}
                  </span>
                  <span className="text-xs text-zinc-500 font-mono">
                    {r.ok ? `${r.linhas} linha(s)` : r.detalhe}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-zinc-400 mb-1.5">{label}</label>
      {children}
    </div>
  )
}
