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
