// ─────────────────────────────────────────────────────────────────────────────
// FotonAdmin — cliente da Edge Function foton-admin (projeto Supabase foton-licencas)
//
// Mesmo modelo da lnf-api: a chave de administrador viaja no cabeçalho
// x-foton-chave e é a função que confere a chave, decide e registra cada
// operação. O secret do banco nunca vem para o browser.
//
// A conexão (URL + chave) é SEPARADA da do LNF e fica só no localStorage deste
// navegador — mesma exposição da chave da lnf-api, que também fica aqui.
// ─────────────────────────────────────────────────────────────────────────────

export type TabelaFoton = 'acessos' | 'dispositivos' | 'genericos' | 'senhas' | 'registros'
export type Linha = Record<string, unknown>

export interface ConexaoFoton {
  url: string
  chave: string
}

export interface ResumoFoton {
  acessos: number
  bloqueados: number
  computadores: number
  pendentes: number
  senhas_ativas: number
  liberacoes_24h: number
  recusas_24h: number
}

const CHAVE_STORAGE = 'foton-admin-conexao'
export const URL_PADRAO = 'https://aaioabmgfstlyrwmdkmh.supabase.co/functions/v1/foton-admin'

export function lerConexao(): ConexaoFoton {
  try {
    const s = localStorage.getItem(CHAVE_STORAGE)
    if (s) return { url: URL_PADRAO, chave: '', ...(JSON.parse(s) as Partial<ConexaoFoton>) }
  } catch {
    // storage indisponível ou corrompido: volta ao padrão
  }
  return { url: URL_PADRAO, chave: '' }
}

export function salvarConexao(c: ConexaoFoton) {
  try {
    localStorage.setItem(CHAVE_STORAGE, JSON.stringify(c))
  } catch {
    // sem storage: a conexão vale só nesta sessão
  }
}

export class FotonAdmin {
  constructor(private readonly conexao: ConexaoFoton) {}

  private async chamar<T>(corpo: Record<string, unknown>): Promise<T> {
    if (!this.conexao.url || !this.conexao.chave) throw new Error('Informe a URL e a chave de administrador do Fóton.')
    let resp: Response
    try {
      resp = await fetch(this.conexao.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-foton-chave': this.conexao.chave },
        body: JSON.stringify(corpo),
      })
    } catch (e) {
      throw new Error(`Sem resposta da foton-admin (${(e as Error).message}).`)
    }
    const texto = await resp.text()
    let dados: unknown = null
    try {
      dados = texto ? JSON.parse(texto) : null
    } catch {
      // resposta não-JSON: cai no erro abaixo
    }
    if (!resp.ok) {
      const msg = (dados as { erro?: string } | null)?.erro ?? texto.slice(0, 200)
      throw new Error(`${resp.status}: ${msg || 'erro na foton-admin'}`)
    }
    return dados as T
  }

  resumo() {
    return this.chamar<ResumoFoton>({ op: 'resumo' })
  }

  listar(tabela: TabelaFoton, limite?: number) {
    return this.chamar<Linha[]>({ op: 'listar', tabela, limite })
  }

  salvar(tabela: TabelaFoton, linha: Linha) {
    return this.chamar<Linha | null>({ op: 'salvar', tabela, linha })
  }

  excluir(tabela: TabelaFoton, id: unknown) {
    return this.chamar<{ ok: boolean }>({ op: 'excluir', tabela, id })
  }

  /** Senha pessoal do usuário (para se identificar em login genérico, ex.: "Tecnova"). null = remover. */
  senhaPessoal(usuario: string, senha: string | null) {
    return this.chamar<{ acessos: number }>({ op: 'senha_pessoal', usuario, senha })
  }

  novaSenha(descricao: string, senha: string, tenant?: string) {
    return this.chamar<{ id: number }>({ op: 'nova_senha', descricao, senha, tenant: tenant || null })
  }
}
