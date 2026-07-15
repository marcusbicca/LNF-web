import { useState, type ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import type { Config } from '../types'
import { SupabaseService } from '../services/supabase'
import { GitHubService } from '../services/github'
import {
  importarLnfFiles,
  IMPORT_DEFAULTS,
  type ImportStepResult,
} from '../services/importLnfFiles'

export function Configuracoes() {
  const { config, salvarConfig, carregarItens, carregandoItens, erroItens, itens } = useApp()

  const [form, setForm] = useState<Config>({
    supabaseUrl: config?.supabaseUrl ?? 'https://bfcwxdivewyjspfvupfr.supabase.co',
    supabaseKey: config?.supabaseKey ?? '',
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
        <Field label="Supabase URL">
          <input
            value={form.supabaseUrl}
            onChange={e => set('supabaseUrl', e.target.value)}
            placeholder="https://xxxx.supabase.co"
            className="input"
          />
        </Field>

        <Field label="Supabase Key (secret key p/ gravar)">
          <input
            type="password"
            value={form.supabaseKey}
            onChange={e => set('supabaseKey', e.target.value)}
            placeholder="sb_secret_..."
            className="input"
          />
        </Field>

        <Field label="Usuário (identifica quem cadastrou)">
          <input
            value={form.usuario}
            onChange={e => set('usuario', e.target.value)}
            placeholder="Seu nome"
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
          <p>✅ Conectado ao Supabase</p>
          <p className="text-zinc-400">
            {Object.keys(itens).length} fornecedores ·{' '}
            {Object.values(itens).reduce((acc, f) => acc + Object.keys(f).length, 0)} itens SAP
          </p>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-500 space-y-1">
        <p className="font-medium text-zinc-400">Sobre a Supabase Key:</p>
        <p>• Para ler e gravar cadastros, use a <span className="text-zinc-300">secret key</span> (service_role).</p>
        <p>• A publishable/anon key só lê (RLS bloqueia escrita).</p>
        <p>• A key fica só no localStorage deste navegador.</p>
      </div>

      <ImportarLnfFiles supabaseUrl={form.supabaseUrl} supabaseKey={form.supabaseKey} />
    </div>
  )
}

// ── Importação única LNF-files → Supabase ────────────────────────────────────
function ImportarLnfFiles({
  supabaseUrl,
  supabaseKey,
}: {
  supabaseUrl: string
  supabaseKey: string
}) {
  const [aberto, setAberto] = useState(false)
  const [ghToken, setGhToken] = useState('')
  const [owner, setOwner] = useState(IMPORT_DEFAULTS.owner)
  const [repo, setRepo] = useState(IMPORT_DEFAULTS.repo)
  const [rodando, setRodando] = useState(false)
  const [resultados, setResultados] = useState<ImportStepResult[]>([])
  const [erro, setErro] = useState<string | null>(null)

  async function importar() {
    setErro(null)
    if (!supabaseUrl || !supabaseKey) {
      setErro('Preencha a Supabase URL e a secret key acima antes de importar.')
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
      const sb = new SupabaseService(supabaseUrl, supabaseKey)
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
            GitHub e faz upsert no Supabase. Use quando o LNF-files tiver dados mais novos que o
            banco. Fornecedores são importados antes dos materiais (FK).
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
