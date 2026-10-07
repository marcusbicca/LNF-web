// Busca de usuário no diretório da empresa, por um fluxo do Power Automate.
//
// O fluxo recebe { usuario: "<username>@<tenant>" } e devolve o que o
// diretório tiver (nome, e-mail, cargo...). username é o do cadastro; tenant é
// o da empresa do usuário — empresas.tenant, achada pelo primeiro centro dele.
// A URL fica no localStorage, como a do fluxo principal (Configurações).

import { empresaDoCentro, type CentrosJson } from '../utils/empresa'

// Fleury e Pardini estão no mesmo diretório; vale enquanto empresas.tenant
// estiver vazio.
export const TENANT_PADRAO = 'grupofleury.com.br'

export function tenantDoUsuario(
  centros: string[],
  centrosJson: CentrosJson,
  tenants: Record<string, string>,
): { tenant: string; empresa: string } {
  const empresa = empresaDoCentro(centros.find(c => c.trim() !== ''), centrosJson).codigo
  const t = (tenants[empresa] ?? '').trim().replace(/^@/, '')
  return { tenant: t || TENANT_PADRAO, empresa }
}

export async function buscarUsuarioNoFluxo(
  url: string,
  username: string,
  tenant: string,
): Promise<unknown> {
  const usuario = `${username.trim()}@${tenant}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario }),
  })
  const texto = await r.text()
  if (!r.ok) throw new Error(`fluxo respondeu ${r.status}: ${texto.slice(0, 300)}`)
  try {
    return JSON.parse(texto)
  } catch {
    return texto
  }
}

// Nome de exibição da resposta, se vier em algum dos formatos comuns do Graph.
export function nomeDaResposta(r: unknown): string {
  if (!r || typeof r !== 'object') return ''
  const o = r as Record<string, unknown>
  for (const k of ['displayName', 'DisplayName', 'nome', 'name', 'Nome']) {
    if (typeof o[k] === 'string' && (o[k] as string).trim()) return (o[k] as string).trim()
  }
  for (const k of ['body', 'resposta', 'resultado', 'value']) {
    const n = nomeDaResposta(Array.isArray(o[k]) ? (o[k] as unknown[])[0] : o[k])
    if (n) return n
  }
  return ''
}
