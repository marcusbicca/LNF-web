import { useEffect, useState, type ReactNode } from 'react'

export type Page =
  | 'lancamento'
  | 'mapeamento'
  | 'cadastros'
  | 'tabelas'
  | 'solicitacoes'
  | 'respostas'
  | 'historico'
  | 'presenca'
  | 'config'

// ── as páginas viram DADO ────────────────────────────────────────────────────
//
// Eram oito blocos de <button> idênticos a menos do rótulo, cada um repetindo a
// mesma expressão de classe. Acrescentar uma página era copiar catorze linhas e
// lembrar de trocar as três ocorrências do nome — e agora há dois lugares que
// desenham a mesma navegação (a barra e a gaveta), o que dobraria a cópia.
const PAGINAS: Array<{ id: Page; rotulo: string }> = [
  { id: 'lancamento',   rotulo: 'Lançamento' },
  { id: 'mapeamento',   rotulo: 'Mapeamento' },
  { id: 'cadastros',    rotulo: 'Cadastros' },
  { id: 'tabelas',      rotulo: 'Tabelas' },
  { id: 'solicitacoes', rotulo: 'Solicitações' },
  { id: 'respostas',    rotulo: 'Respostas' },
  { id: 'historico',    rotulo: 'Histórico / Debug' },
  { id: 'presenca',     rotulo: 'Presença' },
  { id: 'config',       rotulo: 'Configurações' },
]

interface LayoutProps {
  page: Page
  onNavigate: (p: Page) => void
  children: ReactNode
}

export function Layout({ page, onNavigate, children }: LayoutProps) {
  const [gaveta, setGaveta] = useState(false)

  // Esc fecha. Uma gaveta que só fecha pelo botão que a abriu é uma gaveta que
  // prende — e no celular o gesto de voltar não existe dentro de um SPA.
  useEffect(() => {
    if (!gaveta) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setGaveta(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [gaveta])

  const ir = (p: Page) => { onNavigate(p); setGaveta(false) }

  const atual = PAGINAS.find((p) => p.id === page)?.rotulo ?? ''

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
        {/* ── o menu do celular ──────────────────────────────────────────────
            Só abaixo de md. No desktop a barra de baixo cabe inteira e uma
            gaveta seria um clique a mais para chegar ao mesmo lugar. */}
        <button
          onClick={() => setGaveta(true)}
          className="md:hidden -ml-1 p-1 text-zinc-400 hover:text-white"
          aria-label="Abrir menu"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
          </svg>
        </button>

        <span className="text-lg font-bold tracking-wide">LNF Web</span>
        <span className="text-xs text-zinc-500 font-mono">v0.1</span>

        {/* No celular a barra de baixo some, e com ela o rótulo do lugar onde
            se está. Sem isto, a tela perde o próprio nome. */}
        <span className="md:hidden ml-auto text-xs text-zinc-500 truncate">{atual}</span>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>

      {/* ── a barra de baixo, agora só no desktop ─────────────────────────────
          Ela tinha overflow-x-auto: nove abas não cabem na largura de um
          celular, então ficava uma barra que ROLA na horizontal — o gesto mais
          fácil de não descobrir que existe, e as últimas abas viviam fora da
          tela. No desktop a largura sobra e ela continua sendo o caminho mais
          curto; no celular quem faz esse papel é a gaveta. */}
      <nav className="shrink-0 bg-zinc-950 border-t border-zinc-800 hidden md:flex safe-area-pb">
        {PAGINAS.map((p) => (
          <button
            key={p.id}
            onClick={() => ir(p.id)}
            className={`flex-1 min-w-0 whitespace-nowrap py-4 text-sm font-medium transition-colors ${
              page === p.id ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {p.rotulo}
          </button>
        ))}
      </nav>

      {/* ── a gaveta ──────────────────────────────────────────────────────────
          Montada só quando aberta: fechada, ela não existe no DOM nem intercepta
          toque nenhum. */}
      {gaveta && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setGaveta(false)}
          />

          {/* Largura em vw com teto: num celular estreito ela precisa deixar
              ver que há tela atrás (é o que diz que dá para fechar tocando
              fora), e num tablet não deve virar meia página de menu. */}
          <div className="relative w-[78vw] max-w-[17rem] h-full bg-zinc-950 border-r border-zinc-800 flex flex-col">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center">
              <span className="text-sm font-semibold text-zinc-300">Navegar</span>
              <button
                onClick={() => setGaveta(false)}
                className="ml-auto p-1 text-zinc-500 hover:text-white"
                aria-label="Fechar menu"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* overflow-y-auto e não x: rolar na vertical é o gesto que se
                descobre sozinho, e foi trocar de eixo que resolveu o problema
                todo. */}
            <div className="flex-1 overflow-y-auto py-2 safe-area-pb">
              {PAGINAS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => ir(p.id)}
                  className={`w-full text-left px-4 py-3 text-sm font-medium border-l-2 transition-colors ${
                    page === p.id
                      ? 'text-green-400 border-green-400 bg-zinc-900'
                      : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  {p.rotulo}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
