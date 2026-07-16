import { useState } from 'react'
import { AppProvider } from './context/AppContext'
import { Layout, type Page } from './components/Layout'
import { Mapeamento } from './pages/Mapeamento'
import { Cadastros } from './pages/Cadastros'
import { Tabelas } from './pages/Tabelas'
import { Historico } from './pages/Historico'
import { Configuracoes } from './pages/Configuracoes'

export default function App() {
  const [page, setPage] = useState<Page>('mapeamento')

  return (
    <AppProvider>
      <Layout page={page} onNavigate={setPage}>
        {page === 'mapeamento' && <Mapeamento />}
        {page === 'cadastros' && <Cadastros />}
        {page === 'tabelas' && <Tabelas />}
        {page === 'historico' && <Historico />}
        {page === 'config' && <Configuracoes />}
      </Layout>
    </AppProvider>
  )
}
