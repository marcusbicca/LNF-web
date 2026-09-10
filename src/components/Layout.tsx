import type { ReactNode } from 'react'

export type Page =
  | 'lancamento'
  | 'mapeamento'
  | 'cadastros'
  | 'tabelas'
  | 'solicitacoes'
  | 'respostas'
  | 'historico'
  | 'config'

interface LayoutProps {
  page: Page
  onNavigate: (p: Page) => void
  children: ReactNode
}

export function Layout({ page, onNavigate, children }: LayoutProps) {
  return (
    // ── a casca vira uma coluna de altura FIXA ─────────────────────────────
    //
    // Era min-h-screen com a nav em position:fixed e um pb-20 no main para
    // compensá-la. Funciona, mas deixa a altura útil indefinida: uma página
    // não tem como dizer "eu ocupo o que sobrou" porque não existe um "o que
    // sobrou" — o corpo cresce e a barra flutua por cima.
    //
    // Com 100dvh e a nav como item do flex, o main passa a ter altura
    // resolvida. Quem quiser continuar rolando rola (o overflow-y-auto ficou),
    // e quem quiser caber na tela agora consegue pedir isso com h-full. É o
    // que a tela de Lançamento precisa.
    //
    // dvh, e não vh: no celular a barra do navegador entra e sai, e vh mede a
    // tela com ela escondida — o rodapé ficaria fora do alcance do dedo.
    <div className="h-[100dvh] overflow-hidden bg-black text-white flex flex-col">
      <header className="shrink-0 bg-black border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <span className="text-lg font-bold tracking-wide">LNF Web</span>
        <span className="text-xs text-zinc-500 font-mono">v0.1</span>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>

      <nav className="shrink-0 bg-zinc-950 border-t border-zinc-800 flex overflow-x-auto safe-area-pb">
        <button
          onClick={() => onNavigate('lancamento')}
          className={`flex-1 min-w-[6.5rem] whitespace-nowrap py-4 text-sm font-medium transition-colors ${
            page === 'lancamento' ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Lançamento
        </button>
        <button
          onClick={() => onNavigate('mapeamento')}
          className={`flex-1 min-w-[6.5rem] whitespace-nowrap py-4 text-sm font-medium transition-colors ${
            page === 'mapeamento' ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Mapeamento
        </button>
        <button
          onClick={() => onNavigate('cadastros')}
          className={`flex-1 min-w-[6.5rem] whitespace-nowrap py-4 text-sm font-medium transition-colors ${
            page === 'cadastros' ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Cadastros
        </button>
        <button
          onClick={() => onNavigate('tabelas')}
          className={`flex-1 min-w-[6.5rem] whitespace-nowrap py-4 text-sm font-medium transition-colors ${
            page === 'tabelas' ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Tabelas
        </button>
        <button
          onClick={() => onNavigate('solicitacoes')}
          className={`flex-1 min-w-[6.5rem] whitespace-nowrap py-4 text-sm font-medium transition-colors ${
            page === 'solicitacoes' ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Solicitações
        </button>
        <button
          onClick={() => onNavigate('respostas')}
          className={`flex-1 min-w-[6.5rem] whitespace-nowrap py-4 text-sm font-medium transition-colors ${
            page === 'respostas' ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Respostas
        </button>
        <button
          onClick={() => onNavigate('historico')}
          className={`flex-1 min-w-[6.5rem] whitespace-nowrap py-4 text-sm font-medium transition-colors ${
            page === 'historico' ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Histórico / Debug
        </button>
        <button
          onClick={() => onNavigate('config')}
          className={`flex-1 min-w-[6.5rem] whitespace-nowrap py-4 text-sm font-medium transition-colors ${
            page === 'config' ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Configurações
        </button>
      </nav>
    </div>
  )
}
