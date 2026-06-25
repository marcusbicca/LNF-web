import { useState } from 'react'
import { AppProvider } from './context/AppContext'
import { Layout, type Page } from './components/Layout'
import { RegistroNF } from './pages/RegistroNF'
import { Mapeamento } from './pages/Mapeamento'
import { Cadastros } from './pages/Cadastros'
import { Configuracoes } from './pages/Configuracoes'

export default function App() {
  const [page, setPage] = useState<Page>('registro')

  return (
    <AppProvider>
      <Layout page={page} onNavigate={setPage}>
        {page === 'registro' && <RegistroNF />}
        {page === 'mapeamento' && <Mapeamento />}
        {page === 'cadastros' && <Cadastros />}
        {page === 'config' && <Configuracoes />}
      </Layout>
    </AppProvider>
  )
}
