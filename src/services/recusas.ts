// ─────────────────────────────────────────────────────────────────────────────
// Recusas de acesso — quem tentou e não pôde
//
// A Edge Function barra três coisas e as grava em recusas_acesso (ver a
// migration 0065 no LNF-Coreon). O 'portao' separa o que a mistura esconde:
//
//   cadastro  quem NÃO está na tabela usuarios — o intruso de verdade. Para
//             esses a função busca o perfil no diretório da empresa (nome,
//             cargo, setor…) para o dono saber quem é e decidir se cria o
//             cadastro (ex.: se for do almoxarifado).
//   internet  usuário legítimo esbarrando no MeuDanfe pago — permissão faltando.
//   escrita   usuário legítimo tentando escrever onde não pode.
//
// É uma linha por (usuario, portao) que ACUMULA: três batidas viram total=3,
// não três linhas.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseService } from './supabase'

export interface Recusa {
  usuario: string
  portao: string
  op: string | null
  motivo: string | null
  total: number
  primeiraEm: string | null
  ultimaEm: string | null
  // perfil do diretório — preenchido só para portao='cadastro'
  nomeCompleto: string | null
  cargo: string | null
  setor: string | null
  localTrabalho: string | null
  cidade: string | null
  estado: string | null
  pais: string | null
  /** null = não buscado; 'ok' = achou; 'nao_encontrado' = diretório não conhece. */
  perfilStatus: string | null
}

export async function carregarRecusas(svc: SupabaseService): Promise<Recusa[]> {
  const rows = await svc.lerLinhas('recusas_acesso', {
    select: '*',
    order: 'ultima_em.desc',
    limit: 500,
  })

  return rows.map((r) => ({
    usuario: String(r.usuario ?? '').trim().toLowerCase(),
    portao: String(r.portao ?? '').trim(),
    op: r.op != null ? String(r.op) : null,
    motivo: r.motivo != null ? String(r.motivo) : null,
    total: Number(r.total ?? 0) || 0,
    primeiraEm: r.primeira_em ? String(r.primeira_em) : null,
    ultimaEm: r.ultima_em ? String(r.ultima_em) : null,
    nomeCompleto: r.nome_completo != null ? String(r.nome_completo) : null,
    cargo: r.cargo != null ? String(r.cargo) : null,
    setor: r.setor != null ? String(r.setor) : null,
    localTrabalho: r.local_trabalho != null ? String(r.local_trabalho) : null,
    cidade: r.cidade != null ? String(r.cidade) : null,
    estado: r.estado != null ? String(r.estado) : null,
    pais: r.pais != null ? String(r.pais) : null,
    perfilStatus: r.perfil_status != null ? String(r.perfil_status) : null,
  }))
}

// "almoxarifado" em qualquer lugar do cargo/setor: é o sinal que o dono usa
// para decidir se vale criar o cadastro. Sem acento e sem caixa, porque o
// diretório escreve de tudo.
export function pareceAlmoxarifado(r: Recusa): boolean {
  const alvo = `${r.cargo ?? ''} ${r.setor ?? ''} ${r.localTrabalho ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return alvo.includes('almox')
}

// ─────────────────────────────────────────────────────────────────────────────
// Banimentos (migration 0079 no LNF-Coreon)
//
// Quem acumula recusas em 10 min é banido pela própria registrar_recusa: a
// lnf-api passa a recusar TUDO em nome dele, sem prazo. Só o dono libera, aqui.
// É por USUÁRIO, não por IP — o parque inteiro sai pelo mesmo endereço.
// ─────────────────────────────────────────────────────────────────────────────

export interface Banimento {
  usuario: string
  banidoEm: string | null
  portao: string | null
  motivo: string | null
  recusas: number | null
  /** 'automatico' (excesso de tentativas) | 'manual' (banido pelo dono). */
  origem: string
}

export async function carregarBanimentos(svc: SupabaseService): Promise<Banimento[]> {
  const rows = await svc.lerLinhas('banimentos', {
    select: '*',
    order: 'banido_em.desc',
    limit: 500,
  })
  return rows.map((r) => ({
    usuario: String(r.usuario ?? '').trim().toLowerCase(),
    banidoEm: r.banido_em ? String(r.banido_em) : null,
    portao: r.portao != null ? String(r.portao) : null,
    motivo: r.motivo != null ? String(r.motivo) : null,
    recusas: r.recusas != null ? Number(r.recusas) : null,
    origem: String(r.origem ?? 'automatico'),
  }))
}

// As duas exigem nível 3 com a chave de dev (a lnf-api confere).
export async function liberarBanimento(svc: SupabaseService, usuario: string): Promise<void> {
  await svc.rpc('liberar_banimento', { p_usuario: usuario })
}

export async function banirUsuario(svc: SupabaseService, usuario: string, motivo: string): Promise<void> {
  await svc.rpc('banir_usuario', { p_usuario: usuario, p_motivo: motivo })
}

// Busca por usuário, nome, cargo ou setor — sem acento e sem caixa.
export function semAcento(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function recusaCasa(r: Recusa, q: string): boolean {
  if (!q) return true
  const alvo = semAcento(
    [r.usuario, r.nomeCompleto, r.cargo, r.setor, r.localTrabalho, r.cidade, r.op, r.motivo]
      .filter(Boolean).join(' '),
  )
  return alvo.includes(semAcento(q))
}
