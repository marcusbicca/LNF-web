import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Config, ItensJson } from '../types'
import type { CentrosJson } from '../utils/empresa'
import { SupabaseService } from '../services/supabase'

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

  // ── os centros, só para leitura ────────────────────────────────────────
  //
  // Vive aqui e não em cada tela porque TRÊS precisam da mesma coisa pelo
  // mesmo motivo: as solicitações (conversão, mapeamento, fornecedor)
  // guardam o CENTRO, e a empresa se calcula a partir dele. Carregar em três
  // lugares seria três chamadas para a mesma resposta.
  //
  // Falha em silêncio: fica null, o empresaDoCentro cai na empresa padrão e
  // diz que caiu. Nenhuma tela existe para mostrar centro — não é motivo
  // para nenhuma delas deixar de abrir.
  centros: CentrosJson
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
      const svc = new SupabaseService(config)
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
    if (!config) throw new Error('Configuração ausente')
    const svc = new SupabaseService(config)
    const novoSha = await svc.gravarArquivo(config.itensPath, novoItens, itensSha ?? '', mensagem)
    setItens(novoItens)
    setItensSha(novoSha)
  }

  // Configurado = tem QUALQUER um dos dois transportes. Antes isto olhava só o
  // paUrl, e com apenas a Edge preenchida a tela ficava vazia para sempre — sem
  // erro, sem carregar, sem nada dizendo por quê.
  const temTransporte = !!(config?.edgeUrl || config?.paUrl)

  useEffect(() => {
    if (temTransporte) void carregarItens()
  }, [temTransporte, carregarItens])

  const [centros, setCentros] = useState<CentrosJson>(null)

  useEffect(() => {
    if (!temTransporte) { setCentros(null); return }

    let cancelado = false
    void (async () => {
      try {
        const svc = new SupabaseService(config)
        const { data } = await svc.lerArquivo('centros.json')
        if (!cancelado) setCentros(data as CentrosJson)
      } catch {
        // Sem centros o empresaDoCentro cai no padrão e DIZ que caiu
        // ('fora-do-cadastro'), então quem lê a tela não confunde "é fleury"
        // com "não deu para saber". Derrubar a tela por isso seria pior.
        if (!cancelado) setCentros(null)
      }
    })()

    return () => { cancelado = true }
  }, [temTransporte, config?.edgeUrl, config?.edgeChave, config?.paUrl, config?.usuario])

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
        centros,
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
