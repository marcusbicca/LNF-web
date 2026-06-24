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
