import { useState } from 'react'
import { AppProvider } from './context/AppContext'
import { Layout, type Page } from './components/Layout'
import { Mapeamento } from './pages/Mapeamento'
import { Cadastros } from './pages/Cadastros'
import { Tabelas } from './pages/Tabelas'
import { Historico } from './pages/Historico'
import { Configuracoes } from './pages/Configuracoes'
import { Solicitacoes } from './pages/Solicitacoes'
import { Respostas } from './pages/Respostas'

export default function App() {
  const [page, setPage] = useState<Page>('mapeamento')

  return (
    <AppProvider>
      <Layout page={page} onNavigate={setPage}>
        {page === 'mapeamento' && <Mapeamento />}
        {page === 'cadastros' && <Cadastros />}
        {page === 'tabelas' && <Tabelas />}
        {page === 'historico' && <Historico />}
        {page === 'solicitacoes' && <Solicitacoes />}
        {page === 'respostas' && <Respostas />}
        {page === 'config' && <Configuracoes />}
      </Layout>
    </AppProvider>
  )
}
