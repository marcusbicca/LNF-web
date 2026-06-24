# LNF Web — Memória do Projeto

> Documento gerado em 2026-06-24. Registra decisões, arquitetura e todo o código produzido na sessão de criação do projeto.

---

## 1. Contexto e Decisões

### Por que abandonar o LNF-android

O app Android (`LNF-android`) era um protótipo em Kotlin/Compose com dois problemas principais:
- Leitura/escrita de arquivos `.txt` locais em ANSI (Windows-1252), acoplado ao armazenamento do celular
- Não suportava iPhone
- Não refletia a evolução do LNF-Coreon (que passou a usar JSON e GitHub API)

### Por que Web App

- Roda no iPhone gratuitamente (Safari PWA)
- Deploy gratuito via GitHub Pages (repo público) ou Vercel/Netlify (repos privados)
- Acesso direto à GitHub API sem intermediário (PowerAutomate não é necessário)
- Mesmo código funciona em qualquer dispositivo

### Arquitetura de dados

```
LNF-Coreon (C#/.NET + SAPNCo.dll)
    │
    ├─ Lê/escreve SAP diretamente
    └─ Publica JSON no repo LNF-files via GitHub API
           │
           ├─ itens.json  ←─── LNF-Web lê e escreve (novas referências)
           └─ cadastroXXX.json ←─ output de lançamento de NF

LNF-Web (React PWA)
    │
    ├─ Lê itens.json do GitHub
    ├─ Recebe JSON de cadastro via clipboard (gerado pelo LNF-Coreon)
    └─ Registra novas referências gravando itens.json via GitHub API
```

### Integração SAP (restrição)

SAPNCo.dll é Windows-only e requer instalação em PC corporativo. Não é possível instalar self-hosted runner do GitHub Actions no PC corporativo. Portanto:

- **LNF-Web não chama SAP diretamente** — essa responsabilidade permanece no LNF-Coreon
- O fluxo de integração usa o GitHub como camada de dados compartilhada
- Futuro: comunicação LNF-Web ↔ LNF-Coreon pode usar GitHub como mensageria (arquivo de "fila" no repo)

### Token de segurança

O GitHub Token é digitado pelo usuário em runtime na tela Configurações e salvo **apenas no `localStorage` do navegador**. Nunca é hardcoded no código. O repositório `lnf-web` pode ser público sem expor nenhum dado sensível.

---

## 2. Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| UI | React 18 + TypeScript 5 |
| Bundler | Vite 5 |
| Estilo | Tailwind CSS 3 |
| Deploy | GitHub Actions → GitHub Pages |
| Dados | GitHub REST API (fetch nativo do browser) |
| PWA | manifest.json + meta tags apple |

---

## 3. Estrutura do Projeto

```
lnf-web/
├── .github/
│   └── workflows/
│       └── deploy.yml          # CI/CD: push main → build → GitHub Pages
├── public/
│   └── manifest.json           # PWA manifest
├── src/
│   ├── types/
│   │   └── index.ts            # Todas as interfaces TypeScript
│   ├── services/
│   │   └── github.ts           # GitHubService: lerArquivo / gravarArquivo
│   ├── context/
│   │   └── AppContext.tsx      # Estado global: config, itens, SHA
│   ├── components/
│   │   └── Layout.tsx          # Shell + navegação inferior
│   ├── pages/
│   │   ├── RegistroNF.tsx      # Tela principal
│   │   └── Configuracoes.tsx   # Token, owner, repo, usuario
│   ├── App.tsx                 # Roteamento entre páginas
│   ├── main.tsx                # Entry point React
│   └── index.css               # Tailwind + classe .input
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
└── package.json
```

---

## 4. Código-fonte Completo

### `package.json`

```json
{
  "name": "lnf-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.40",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.3",
    "vite": "^5.4.0"
  }
}
```

### `index.html`

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
    <meta name="theme-color" content="#000000" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <link rel="manifest" href="./manifest.json" />
    <title>LNF Web</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
})
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### `tailwind.config.js`

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

### `public/manifest.json`

```json
{
  "name": "LNF Web",
  "short_name": "LNF",
  "description": "Suporte ao lançamento de Notas Fiscais",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### `.github/workflows/deploy.yml`

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npm run build

      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

      - id: deployment
        uses: actions/deploy-pages@v4
```

### `src/index.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  -webkit-tap-highlight-color: transparent;
}

body {
  background-color: #000;
  color: #fff;
  font-family: system-ui, -apple-system, sans-serif;
  overscroll-behavior: none;
}

@layer components {
  .input {
    @apply w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm
           focus:outline-none focus:border-green-500 transition-colors;
  }
}
```

### `src/main.tsx`

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

### `src/App.tsx`

```tsx
import { useState } from 'react'
import { AppProvider } from './context/AppContext'
import { Layout, type Page } from './components/Layout'
import { RegistroNF } from './pages/RegistroNF'
import { Configuracoes } from './pages/Configuracoes'

export default function App() {
  const [page, setPage] = useState<Page>('registro')

  return (
    <AppProvider>
      <Layout page={page} onNavigate={setPage}>
        {page === 'registro' ? <RegistroNF /> : <Configuracoes />}
      </Layout>
    </AppProvider>
  )
}
```

### `src/types/index.ts`

```ts
// ── itens.json ──────────────────────────────────────────────────────────────
// Estrutura: fornecedor → códigoSAP → { referencias, descricao }
// referencias: referência do fornecedor → array de fator (vazio = sem conversão)

export interface ItensJson {
  [fornecedor: string]: FornecedorData
}

export interface FornecedorData {
  Configuracoes: Record<string, unknown>
  Itens: Record<string, ItemSAP>
}

export interface ItemSAP {
  referencias: Record<string, FatorEntry[]>
  descricao: string
}

export interface FatorEntry {
  fator: number
}

// ── Cadastro JSON (output do LNF-Coreon) ────────────────────────────────────

export interface CadastroJson {
  Sucesso: boolean
  Codigo: string | null
  Mensagem: string
  Nfs: Record<string, NfInfo>
  PedidosDict: Record<string, PedidoItem[]>
  ItensSemPedido: unknown[]
  DivergenciasValorUN: unknown[]
  DivergenciasFrete: unknown[]
}

export interface NfInfo {
  ChaveNFe: string
  NumeroNF: string
  SerieNF: string
  Fornecedor: string
  DataEmissao: string
  DataLancamento: string
  ValorTotalNF: number
  ValorFreteNF: number
  ValorTotalPedido: number
  FreteTotalPedido: number
  Planejador: string
  PlanejadorNome: string
  DifFrete: boolean
  DifValorUN: boolean
  ItemSemPedido: boolean
  ItemIndefinido: boolean
  LoteFit: boolean
  SemLote: boolean
  Lancada: boolean
  Codigo: string
  Mensagem: string
  MaterialDocument: string
  DocumentYear: string
}

export interface PedidoItem {
  'Referência': string
  Fornecedor: string
  Centro: string
  Pedido: string
  Item: number
  'Código': string
  'Descrição': string
  'Data Pedido': string
  Saldo: number
  'Qtd Pendente': number
  'UMB Ped': string
  'Valor UN': number
  'Frete UN': number
  Divisor: string
  Planejador: string
  Status: string
  'Valor UN NF': number
  'Frete UN NF': number
  'Qtd NF': number
  Lote?: string
  Validade?: string
  'UMB Forn'?: string
  UmbMigo?: string
  MigoConverter?: number
  NfItemIndex?: number
  NfChave?: string
  Contagem?: number
}

// ── Configuração do app ──────────────────────────────────────────────────────

export interface Config {
  githubToken: string
  owner: string
  repo: string
  itensPath: string
  usuario: string
}

// ── Análise de itens para registro ──────────────────────────────────────────

export type ItemStatus = 'novo' | 'existe' | 'conflito'

export interface ItemAnalise {
  referencia: string
  codigoSAP: string
  descricao: string
  fornecedor: string
  fator: number | null
  status: ItemStatus
  conflito?: { codigoExistente: string; fatorExistente: number | null }
  incluir: boolean
}
```

### `src/services/github.ts`

```ts
export interface GitHubFileResult {
  data: unknown
  sha: string
}

export class GitHubService {
  constructor(
    private token: string,
    private owner: string,
    private repo: string,
  ) {}

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    }
  }

  async lerArquivo(path: string): Promise<GitHubFileResult> {
    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`,
      { headers: this.headers() },
    )
    if (!res.ok) throw new Error(`Erro ${res.status}: ${res.statusText}`)

    const file = (await res.json()) as { content: string; sha: string }
    const binary = atob(file.content.replace(/\n/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const text = new TextDecoder('utf-8').decode(bytes)

    return { data: JSON.parse(text), sha: file.sha }
  }

  async gravarArquivo(
    path: string,
    conteudo: unknown,
    sha: string,
    mensagem: string,
  ): Promise<string> {
    const json = JSON.stringify(conteudo, null, 2)
    const bytes = new TextEncoder().encode(json)
    let binary = ''
    bytes.forEach(b => (binary += String.fromCharCode(b)))
    const content = btoa(binary)

    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({ message: mensagem, content, sha }),
      },
    )
    if (!res.ok) {
      const err = (await res.json()) as { message?: string }
      throw new Error(`Erro ${res.status}: ${err.message ?? res.statusText}`)
    }
    const result = (await res.json()) as { content: { sha: string } }
    return result.content.sha
  }
}
```

### `src/context/AppContext.tsx`

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Config, ItensJson } from '../types'
import { GitHubService } from '../services/github'

const CONFIG_KEY = 'lnf_config'

interface AppContextValue {
  config: Config | null
  salvarConfig: (c: Config) => void
  itens: ItensJson | null
  itensSha: string | null
  carregandoItens: boolean
  erroItens: string | null
  carregarItens: () => Promise<void>
  gravarItens: (novoItens: ItensJson, mensagem: string) => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(() => {
    const s = localStorage.getItem(CONFIG_KEY)
    return s ? (JSON.parse(s) as Config) : null
  })
  const [itens, setItens] = useState<ItensJson | null>(null)
  const [itensSha, setItensSha] = useState<string | null>(null)
  const [carregandoItens, setCarregandoItens] = useState(false)
  const [erroItens, setErroItens] = useState<string | null>(null)

  function salvarConfig(c: Config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c))
    setConfig(c)
    setItens(null)
    setItensSha(null)
    setErroItens(null)
  }

  const carregarItens = useCallback(async () => {
    if (!config) return
    setCarregandoItens(true)
    setErroItens(null)
    try {
      const svc = new GitHubService(config.githubToken, config.owner, config.repo)
      const { data, sha } = await svc.lerArquivo(config.itensPath)
      setItens(data as ItensJson)
      setItensSha(sha)
    } catch (e) {
      setErroItens((e as Error).message)
    } finally {
      setCarregandoItens(false)
    }
  }, [config])

  async function gravarItens(novoItens: ItensJson, mensagem: string) {
    if (!config || !itensSha) throw new Error('Configuração ausente ou SHA inválido')
    const svc = new GitHubService(config.githubToken, config.owner, config.repo)
    const novoSha = await svc.gravarArquivo(config.itensPath, novoItens, itensSha, mensagem)
    setItens(novoItens)
    setItensSha(novoSha)
  }

  useEffect(() => {
    if (config?.githubToken) void carregarItens()
  }, [config?.githubToken, carregarItens])

  return (
    <AppContext.Provider
      value={{
        config,
        salvarConfig,
        itens,
        itensSha,
        carregandoItens,
        erroItens,
        carregarItens,
        gravarItens,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp fora de AppProvider')
  return ctx
}
```

### `src/components/Layout.tsx`

```tsx
import type { ReactNode } from 'react'

export type Page = 'registro' | 'config'

interface LayoutProps {
  page: Page
  onNavigate: (p: Page) => void
  children: ReactNode
}

export function Layout({ page, onNavigate, children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="bg-black border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <span className="text-lg font-bold tracking-wide">LNF Web</span>
        <span className="text-xs text-zinc-500 font-mono">v0.1</span>
      </header>

      <main className="flex-1 overflow-y-auto pb-20">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-800 flex safe-area-pb">
        <button
          onClick={() => onNavigate('registro')}
          className={`flex-1 py-4 text-sm font-medium transition-colors ${
            page === 'registro' ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Registro NF
        </button>
        <button
          onClick={() => onNavigate('config')}
          className={`flex-1 py-4 text-sm font-medium transition-colors ${
            page === 'config' ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Configurações
        </button>
      </nav>
    </div>
  )
}
```

### `src/pages/Configuracoes.tsx`

```tsx
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
            {Object.keys(itens).length} fornecedores ·{' '}
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
```

### `src/pages/RegistroNF.tsx`

```tsx
import { useCallback, useState } from 'react'
import { useApp } from '../context/AppContext'
import type { CadastroJson, FatorEntry, ItemAnalise, ItensJson, PedidoItem } from '../types'

function analisarItens(
  pedidosDict: Record<string, PedidoItem[]>,
  itens: ItensJson,
): ItemAnalise[] {
  const resultado: ItemAnalise[] = []
  const vistos = new Set<string>()

  for (const pedidos of Object.values(pedidosDict)) {
    for (const pedido of pedidos) {
      const key = `${pedido.Fornecedor}|${pedido['Código']}|${pedido['Referência']}`
      if (vistos.has(key)) continue
      vistos.add(key)

      const fornData = itens[pedido.Fornecedor]
      const itemData = fornData?.Itens[pedido['Código']]
      const refExiste = itemData !== undefined && pedido['Referência'] in itemData.referencias

      let status: ItemAnalise['status'] = 'novo'
      let conflito: ItemAnalise['conflito']
      let fator: number | null = null

      if (refExiste && itemData) {
        status = 'existe'
        const fatores: FatorEntry[] = itemData.referencias[pedido['Referência']]
        fator = fatores.length > 0 ? fatores[0].fator : null
      } else if (fornData) {
        for (const [cod, item] of Object.entries(fornData.Itens)) {
          if (cod !== pedido['Código'] && pedido['Referência'] in item.referencias) {
            status = 'conflito'
            const fatores: FatorEntry[] = item.referencias[pedido['Referência']]
            conflito = {
              codigoExistente: cod,
              fatorExistente: fatores.length > 0 ? fatores[0].fator : null,
            }
            break
          }
        }
      }

      resultado.push({
        referencia: pedido['Referência'],
        codigoSAP: pedido['Código'],
        descricao: pedido['Descrição'],
        fornecedor: pedido.Fornecedor,
        fator,
        status,
        conflito,
        incluir: status !== 'existe',
      })
    }
  }

  return resultado
}

function aplicarRegistros(base: ItensJson, itensParaAdd: ItemAnalise[]): ItensJson {
  const novo = JSON.parse(JSON.stringify(base)) as ItensJson

  for (const item of itensParaAdd) {
    if (!item.incluir) continue
    if (!novo[item.fornecedor]) novo[item.fornecedor] = { Configuracoes: {}, Itens: {} }
    if (!novo[item.fornecedor].Itens[item.codigoSAP]) {
      novo[item.fornecedor].Itens[item.codigoSAP] = { referencias: {}, descricao: item.descricao }
    }
    const fatores: FatorEntry[] = item.fator !== null ? [{ fator: item.fator }] : []
    novo[item.fornecedor].Itens[item.codigoSAP].referencias[item.referencia] = fatores
  }

  return novo
}

export function RegistroNF() {
  const { config, itens, carregandoItens, erroItens, gravarItens } = useApp()

  const [jsonTexto, setJsonTexto] = useState('')
  const [mostrarTextarea, setMostrarTextarea] = useState(false)
  const [cadastro, setCadastro] = useState<CadastroJson | null>(null)
  const [erroJson, setErroJson] = useState<string | null>(null)
  const [itensAnalise, setItensAnalise] = useState<ItemAnalise[]>([])
  const [commitando, setCommitando] = useState(false)
  const [statusCommit, setStatusCommit] = useState<string | null>(null)

  const parseJson = useCallback(
    (texto: string) => {
      setErroJson(null)
      try {
        const parsed = JSON.parse(texto) as CadastroJson
        if (!parsed.PedidosDict) throw new Error('Campo PedidosDict ausente — JSON inválido')
        setCadastro(parsed)
        if (itens) setItensAnalise(analisarItens(parsed.PedidosDict, itens))
      } catch (e) {
        setErroJson((e as Error).message)
        setCadastro(null)
      }
    },
    [itens],
  )

  async function colarClipboard() {
    try {
      const texto = await navigator.clipboard.readText()
      setJsonTexto(texto)
      parseJson(texto)
    } catch {
      setErroJson('Não foi possível acessar a área de transferência. Use o campo manual.')
      setMostrarTextarea(true)
    }
  }

  function limpar() {
    setJsonTexto('')
    setCadastro(null)
    setErroJson(null)
    setItensAnalise([])
    setStatusCommit(null)
  }

  function setFator(idx: number, valor: string) {
    setItensAnalise(prev =>
      prev.map((item, i) =>
        i === idx
          ? { ...item, fator: valor === '' ? null : parseFloat(valor.replace(',', '.')) || null }
          : item,
      ),
    )
  }

  function toggleIncluir(idx: number) {
    setItensAnalise(prev =>
      prev.map((item, i) => (i === idx ? { ...item, incluir: !item.incluir } : item)),
    )
  }

  async function registrar() {
    if (!itens || !cadastro) return
    setCommitando(true)
    setStatusCommit(null)
    try {
      const novoItens = aplicarRegistros(itens, itensAnalise)
      const novosCount = itensAnalise.filter(i => i.incluir).length
      const usuario = config?.usuario ?? 'LNF-Web'
      const nfs = Object.values(cadastro.Nfs).map(n => `NF${n.NumeroNF}`).join(', ')
      const msg = `[${usuario}] ${nfs} — ${novosCount} ref. adicionada(s)`
      await gravarItens(novoItens, msg)
      setStatusCommit(`✅ ${novosCount} referência(s) registrada(s) com sucesso`)
      setItensAnalise(prev =>
        prev.map(i => (i.incluir ? { ...i, status: 'existe' as const, incluir: false } : i)),
      )
    } catch (e) {
      setStatusCommit(`❌ ${(e as Error).message}`)
    } finally {
      setCommitando(false)
    }
  }

  if (!config) {
    return (
      <div className="p-6 text-center text-zinc-400 mt-12 space-y-2">
        <p className="text-4xl">🔑</p>
        <p>Configure o GitHub Token em <span className="text-white font-medium">Configurações</span> para começar.</p>
      </div>
    )
  }

  if (carregandoItens) {
    return <div className="p-6 text-center text-zinc-400 mt-12">Carregando itens.json...</div>
  }

  if (erroItens) {
    return (
      <div className="p-6 text-center text-red-400 mt-12">
        <p className="font-medium">Erro ao carregar itens</p>
        <p className="text-sm mt-1">{erroItens}</p>
      </div>
    )
  }

  const novos = itensAnalise.filter(i => i.status === 'novo')
  const conflitos = itensAnalise.filter(i => i.status === 'conflito')
  const existentes = itensAnalise.filter(i => i.status === 'existe')
  const selecionados = itensAnalise.filter(i => i.incluir)

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      {!cadastro && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => void colarClipboard()}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white py-3.5 rounded-lg font-medium transition-colors"
            >
              📋 Colar JSON do Clipboard
            </button>
            <button
              onClick={() => setMostrarTextarea(v => !v)}
              className="px-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-lg transition-colors"
            >
              {mostrarTextarea ? '▲' : '▼'}
            </button>
          </div>

          {mostrarTextarea && (
            <>
              <textarea
                value={jsonTexto}
                onChange={e => setJsonTexto(e.target.value)}
                placeholder='{"Sucesso": true, "PedidosDict": {...}}'
                rows={8}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-green-500 resize-none"
              />
              <button
                onClick={() => parseJson(jsonTexto)}
                className="w-full bg-green-700 hover:bg-green-600 text-white py-2.5 rounded-lg font-medium transition-colors"
              >
                Analisar
              </button>
            </>
          )}

          {erroJson && (
            <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-sm">
              ❌ {erroJson}
            </div>
          )}
        </div>
      )}

      {cadastro && (
        <>
          <div className="flex justify-between items-center">
            <h2 className="font-semibold">NFs Processadas</h2>
            <button onClick={limpar} className="text-zinc-500 hover:text-zinc-300 text-sm">
              ✕ Limpar
            </button>
          </div>

          {/* Cards de NF */}
          <div className="space-y-2">
            {Object.values(cadastro.Nfs).map(nf => (
              <div key={nf.ChaveNFe} className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">NF {nf.NumeroNF} · {nf.Fornecedor}</p>
                  <p className="text-xs text-zinc-400 mt-0.5 truncate">{nf.Mensagem}</p>
                  {(nf.SemLote || nf.DifValorUN || nf.DifFrete) && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {nf.SemLote && <Tag label="Sem Lote" color="yellow" />}
                      {nf.DifValorUN && <Tag label="Dif. Valor" color="orange" />}
                      {nf.DifFrete && <Tag label="Dif. Frete" color="orange" />}
                    </div>
                  )}
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${nf.Lancada ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                  {nf.Lancada ? 'Lançada' : 'Não lançada'}
                </span>
              </div>
            ))}
          </div>

          {novos.length === 0 && conflitos.length === 0 && (
            <div className="bg-green-950 border border-green-800 rounded-lg p-3 text-green-300 text-sm">
              ✅ Todas as {existentes.length} referência(s) já estão em itens.json
            </div>
          )}

          {novos.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-green-400">➕ Novas referências ({novos.length})</h3>
              {itensAnalise.map((item, idx) =>
                item.status === 'novo' ? (
                  <ItemCard key={`${item.fornecedor}|${item.codigoSAP}|${item.referencia}`} item={item} onFatorChange={v => setFator(idx, v)} onToggle={() => toggleIncluir(idx)} />
                ) : null,
              )}
            </div>
          )}

          {conflitos.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-yellow-400">⚠️ Conflitos — referência em outro código SAP ({conflitos.length})</h3>
              {itensAnalise.map((item, idx) =>
                item.status === 'conflito' ? (
                  <ItemCard key={`${item.fornecedor}|${item.codigoSAP}|${item.referencia}`} item={item} onFatorChange={v => setFator(idx, v)} onToggle={() => toggleIncluir(idx)} />
                ) : null,
              )}
            </div>
          )}

          {statusCommit && (
            <div className={`rounded-lg p-3 text-sm ${statusCommit.startsWith('✅') ? 'bg-green-950 border border-green-800 text-green-300' : 'bg-red-950 border border-red-800 text-red-300'}`}>
              {statusCommit}
            </div>
          )}

          {(novos.length > 0 || conflitos.length > 0) && (
            <button
              onClick={() => void registrar()}
              disabled={commitando || selecionados.length === 0}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-lg transition-colors"
            >
              {commitando ? 'Registrando no GitHub...' : `Registrar ${selecionados.length} referência(s) no GitHub`}
            </button>
          )}

          {existentes.length > 0 && (
            <details className="text-sm">
              <summary className="text-zinc-500 cursor-pointer hover:text-zinc-300 select-none">
                ✅ {existentes.length} referência(s) já existem em itens.json
              </summary>
              <div className="mt-2 space-y-0.5 pl-3 border-l border-zinc-800">
                {existentes.map(item => (
                  <p key={`${item.fornecedor}|${item.codigoSAP}|${item.referencia}`} className="text-xs text-zinc-500">
                    <span className="text-zinc-300 font-mono">{item.referencia}</span> — {item.descricao}
                  </p>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}

function ItemCard({ item, onFatorChange, onToggle }: { item: ItemAnalise; onFatorChange: (v: string) => void; onToggle: () => void }) {
  return (
    <div className={`bg-zinc-900 border rounded-lg p-3 space-y-2 ${item.status === 'conflito' ? 'border-yellow-700' : 'border-zinc-700'} ${!item.incluir ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={item.incluir} onChange={onToggle} className="mt-0.5 w-4 h-4 accent-green-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{item.descricao}</p>
          <p className="text-xs text-zinc-400 mt-0.5 font-mono">
            {item.fornecedor} · {item.codigoSAP} · <span className="text-white">{item.referencia}</span>
          </p>
          {item.conflito && (
            <p className="text-xs text-yellow-400 mt-1">
              ⚠️ Referência já mapeada para {item.conflito.codigoExistente}
              {item.conflito.fatorExistente !== null && ` (fator ${item.conflito.fatorExistente})`}
            </p>
          )}
        </div>
      </div>
      {item.incluir && (
        <div className="flex items-center gap-2 pl-7">
          <label className="text-xs text-zinc-400 shrink-0 w-10">Fator:</label>
          <input
            type="number"
            value={item.fator ?? ''}
            onChange={e => onFatorChange(e.target.value)}
            placeholder="Deixe vazio = sem conversão"
            step="any"
            min="0"
            className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-green-500"
          />
        </div>
      )}
    </div>
  )
}

function Tag({ label, color }: { label: string; color: 'yellow' | 'orange' }) {
  const cls = color === 'yellow' ? 'bg-yellow-900 text-yellow-300' : 'bg-orange-900 text-orange-300'
  return <span className={`text-xs px-1.5 py-0.5 rounded ${cls}`}>{label}</span>
}
```

---

## 5. Como Fazer Deploy

### Primeira vez

```bash
# A partir do bundle baixado nesta sessão
git clone lnf-web.bundle lnf-web
cd lnf-web
git remote add origin https://github.com/marcusbicca/lnf-web.git
git checkout -b main
git push -u origin main
```

Depois: `https://github.com/marcusbicca/lnf-web/settings/pages` → Source: **GitHub Actions**

O app ficará disponível em: **https://marcusbicca.github.io/lnf-web/**

### Próximas vezes

```bash
git add <arquivo>
git commit -m "mensagem"
git push
```

O GitHub Actions faz o build e deploy automaticamente (1-2 min).

---

## 6. Como Usar o App

1. Abra o app e vá em **Configurações**
2. Preencha:
   - **GitHub Token** — Fine-grained ou Classic com permissão `Contents: Read and Write`
   - **Owner** — `marcusbicca` (padrão)
   - **Repositório** — `LNF-files` (padrão)
   - **Caminho** — `itens.json` (padrão)
   - **Usuário** — seu nome (aparece nas mensagens de commit)
3. Clique **Salvar** e depois **Testar Conexão**
4. Vá para **Registro NF**
5. Cole o JSON gerado pelo LNF-Coreon (PedidosDict obrigatório)
6. Revise as novas referências, preencha fatores de conversão se necessário
7. Clique **Registrar no GitHub** — o `itens.json` é atualizado via commit

---

## 7. Roadmap Futuro

| Feature | Descrição |
|---------|-----------|
| Contagem de inventário | Nova tela para lançar contagens, gravar resultado no LNF-files |
| Comunicação LNF-Coreon | Usar GitHub como fila: LNF-Web grava pedido, Coreon lê e executa SAP |
| Ícones PWA | Criar `icon-192.png` e `icon-512.png` para instalação no iPhone |
| Busca de dados SAP | Via GitHub como intermediário (Coreon expõe dados em JSON) |

---

## 8. Estrutura do `itens.json`

```json
{
  "NOME DO FORNECEDOR": {
    "Configuracoes": {},
    "Itens": {
      "CODIGO_SAP": {
        "descricao": "Descrição do item",
        "referencias": {
          "REF-FORNECEDOR": [{ "fator": 1.0 }]
        }
      }
    }
  }
}
```

`fator` = quantidade de unidades SAP por unidade do fornecedor. Array vazio = sem conversão.

---

## 9. Permissões do GitHub Token

Token Fine-grained para o repo `LNF-files`:
- **Contents**: Read and Write
- **Metadata**: Read (obrigatório pelo GitHub)
