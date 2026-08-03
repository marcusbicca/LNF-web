// ─────────────────────────────────────────────────────────────────────────────
// Importação ÚNICA: LNF-files (GitHub) → Supabase.
//
// O LNF-files recebeu atualizações que ainda não estão no Supabase. Esta função
// lê os JSONs atuais do repositório e faz UPSERT nas tabelas (sync-in, sem
// deletar nada — é aditivo/idempotente). Ordem respeita a FK: fornecedores
// antes de materiais.
//
// termos_globais é a única com replace-all (não tem chave natural; a versão do
// GitHub é autoritativa).
//
// Uso único: exposto por um botão na tela de Configurações. Precisa de um token
// GitHub (leitura do LNF-files) + a secret key do Supabase (escrita).
// ─────────────────────────────────────────────────────────────────────────────

import { GitHubService } from './github'
import {
  SupabaseService,
  buildFornRow,
  buildMaterialRow,
  buildCentroRow,
  buildUsuarioRow,
} from './supabase'

export interface ImportOpts {
  owner: string
  repo: string
  fornPath: string
  itensPath: string
  centrosPath: string
  usuariosPath: string
  termosPath: string
}

export const IMPORT_DEFAULTS: ImportOpts = {
  owner: 'marcusbicca',
  repo: 'LNF-files',
  fornPath: 'json/forn.json',
  itensPath: 'json/itens.json',
  centrosPath: 'json/centros.json',
  usuariosPath: 'json/usersList.json',
  termosPath: 'json/termos_globais.json',
}

export interface ImportStepResult {
  etapa: string
  ok: boolean
  linhas: number
  detalhe?: string
}

type Row = Record<string, unknown>
type Obj = Record<string, unknown>

function asObj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {}
}

export async function importarLnfFiles(
  sb: SupabaseService,
  gh: GitHubService,
  opts: ImportOpts,
  onProgress?: (r: ImportStepResult) => void,
): Promise<ImportStepResult[]> {
  const resultados: ImportStepResult[] = []
  const registrar = (r: ImportStepResult) => {
    resultados.push(r)
    onProgress?.(r)
  }

  // 1) fornecedores (antes de materiais por causa da FK)
  await passo(registrar, 'Fornecedores', async () => {
    const { data } = await gh.lerArquivo(opts.fornPath)
    const src = asObj(data)
    const rows: Row[] = Object.entries(src).map(([nome, o]) => buildFornRow(nome, asObj(o)))
    await sb.upsertBruto('fornecedores', rows, 'nome')
    return rows.length
  })

  // 2) materiais
  await passo(registrar, 'Materiais', async () => {
    const { data } = await gh.lerArquivo(opts.itensPath)
    const src = asObj(data)
    const rows: Row[] = []
    for (const [forn, itens] of Object.entries(src)) {
      for (const [cod, item] of Object.entries(asObj(itens))) {
        rows.push(buildMaterialRow(forn, cod, asObj(item)))
      }
    }
    await sb.upsertBruto('materiais', rows, 'fornecedor,codigo')
    return rows.length
  })

  // 3) centros
  await passo(registrar, 'Centros', async () => {
    const { data } = await gh.lerArquivo(opts.centrosPath)
    const centros = asObj(asObj(data).Centros)
    const rows: Row[] = Object.entries(centros).map(([c, o]) => buildCentroRow(c, asObj(o)))
    await sb.upsertBruto('centros', rows, 'centro')
    return rows.length
  })

  // 4) usuários
  await passo(registrar, 'Usuários', async () => {
    const { data } = await gh.lerArquivo(opts.usuariosPath)
    const src = asObj(data)
    const rows: Row[] = Object.entries(src).map(([u, o]) => buildUsuarioRow(u, asObj(o)))
    await sb.upsertBruto('usuarios', rows, 'username')
    return rows.length
  })

  // 5) termos globais (replace-all; arquivo pode não existir)
  await passo(registrar, 'Termos globais', async () => {
    let data: unknown
    try {
      ;({ data } = await gh.lerArquivo(opts.termosPath))
    } catch {
      return 0 // arquivo ausente → nada a importar
    }
    const src = asObj(data)
    await sb.replaceTermosGlobais({
      TermosGenericos: (src.TermosGenericos as Array<{ Tipo?: string; Texto?: string }>) ?? [],
      FimTermos: (src.FimTermos as Array<{ Tipo?: string; Texto?: string }>) ?? [],
    })
    const gen = Array.isArray(src.TermosGenericos) ? src.TermosGenericos.length : 0
    const fim = Array.isArray(src.FimTermos) ? src.FimTermos.length : 0
    return gen + fim
  })

  return resultados
}

async function passo(
  registrar: (r: ImportStepResult) => void,
  etapa: string,
  fn: () => Promise<number>,
): Promise<void> {
  try {
    const linhas = await fn()
    registrar({ etapa, ok: true, linhas })
  } catch (e) {
    registrar({ etapa, ok: false, linhas: 0, detalhe: (e as Error).message })
  }
}
