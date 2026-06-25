import type { ReactNode } from 'react'

export type Page = 'mapeamento' | 'cadastros' | 'config'

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
          onClick={() => onNavigate('mapeamento')}
          className={`flex-1 py-4 text-sm font-medium transition-colors ${
            page === 'mapeamento' ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Mapeamento
        </button>
        <button
          onClick={() => onNavigate('cadastros')}
          className={`flex-1 py-4 text-sm font-medium transition-colors ${
            page === 'cadastros' ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Cadastros
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
