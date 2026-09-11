import { useEffect, useState } from 'react'
import { AppProvider } from './context/AppContext'
import { Layout, type Page } from './components/Layout'
import { Lancamento } from './pages/Lancamento'
import { Mapeamento } from './pages/Mapeamento'
import { Cadastros } from './pages/Cadastros'
import { Tabelas } from './pages/Tabelas'
import { Historico } from './pages/Historico'
import { Configuracoes } from './pages/Configuracoes'
import { Solicitacoes } from './pages/Solicitacoes'
import { Respostas } from './pages/Respostas'

// ─────────────────────────────────────────────────────────────────────────────
// Trocar de aba não pode apagar o trabalho
//
// Era `{page === 'x' && <X />}`: sair da aba DESMONTA o componente, e com ele
// vai todo o estado. Na tela de Lançamento isso custava caro — uma análise que
// levou minutos para chegar da máquina de outra pessoa sumia porque alguém
// quis conferir uma resposta na aba ao lado.
//
// ── por que não montar tudo desde o começo ──────────────────────────────────
//
// Porque cada página busca os dados dela no primeiro render. Montar as oito de
// uma vez faria a abertura do app disparar as consultas de todas — e, na conta
// que importa neste projeto, cada consulta é um run do fluxo do Power
// Automate, pago pela cota de uma pessoa só.
//
// ── então: monta na PRIMEIRA visita, e não desmonta mais ────────────────────
//
// Página nunca aberta não existe no DOM e não consulta nada. Aberta uma vez,
// fica — escondida com o atributo hidden, que preserva o estado, os campos
// preenchidos e a posição da rolagem.
//
// O invólucro precisa de h-full: a tela de Lançamento pede lg:h-full para
// caber sem rolagem, e h-full resolve contra o PAI. Um wrapper sem altura
// quebraria a conta e a página voltaria a rolar.
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState<Page>('mapeamento')
  const [visitadas, setVisitadas] = useState<Page[]>(['mapeamento'])

  useEffect(() => {
    setVisitadas((v) => (v.includes(page) ? v : [...v, page]))
  }, [page])

  const painel = (p: Page, conteudo: React.ReactNode) =>
    visitadas.includes(p) ? (
      <div key={p} className={p === page ? 'h-full' : 'hidden'}>
        {conteudo}
      </div>
    ) : null

  return (
    <AppProvider>
      <Layout page={page} onNavigate={setPage}>
        {painel('lancamento', <Lancamento />)}
        {painel('mapeamento', <Mapeamento />)}
        {painel('cadastros', <Cadastros />)}
        {painel('tabelas', <Tabelas />)}
        {painel('historico', <Historico />)}
        {painel('solicitacoes', <Solicitacoes />)}
        {painel('respostas', <Respostas />)}
        {painel('config', <Configuracoes />)}
      </Layout>
    </AppProvider>
  )
}
