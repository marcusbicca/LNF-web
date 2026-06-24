import { useState, type ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import type { Config } from '../types'

export function Configuracoes() {
  const { config, salvarConfig, carregarItens, carregandoItens, erroItens, itens } = useApp()

  const [form, setForm] = useState<Config>({
    githubToken: config?.githubToken ?? '',
    owner: config?.owner ?? 'marcusbicca',
    repo: config?.repo ?? 'LNF-files',
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
        <Field label="GitHub Token (Fine-grained ou Classic com repo)">
          <input
            type="password"
            value={form.githubToken}
            onChange={e => set('githubToken', e.target.value)}
            placeholder="ghp_..."
            className="input"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner">
            <input
              value={form.owner}
              onChange={e => set('owner', e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Repositório">
            <input
              value={form.repo}
              onChange={e => set('repo', e.target.value)}
              className="input"
            />
          </Field>
        </div>

        <Field label="Caminho do itens.json">
          <input
            value={form.itensPath}
            onChange={e => set('itensPath', e.target.value)}
            placeholder="itens.json"
            className="input"
          />
        </Field>

        <Field label="Usuário (aparece nos commits)">
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
          <p>✅ Conectado ao repositório</p>
          <p className="text-zinc-400">
            {Object.keys(itens).length} fornecedores · {' '}
            {Object.values(itens).reduce((acc, f) => acc + Object.keys(f.Itens).length, 0)} itens SAP
          </p>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-500 space-y-1">
        <p className="font-medium text-zinc-400">Permissões necessárias no token:</p>
        <p>• Contents: Read and Write (para ler e commitar itens.json)</p>
        <p>• Metadata: Read (obrigatório pelo GitHub)</p>
      </div>
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
