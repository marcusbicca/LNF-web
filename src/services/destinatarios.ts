// ─────────────────────────────────────────────────────────────────────────────
// Conferência do destinatário — o erro de digitação que vira espera infinita
//
// ── o caso que motivou ──────────────────────────────────────────────────────
//
// Uma sessão foi aberta para "marq". O usuário chama-se "marqu". A solicitação
// ficou 'pendente' por horas, e a investigação passou por gatilho, view,
// cadência e janela antes de chegar à letra que faltava.
//
// Não havia como o erro aparecer: o pegar_solicitacao compara
// lower(btrim(destinatario)) com o usuário Windows da máquina, por igualdade
// exata. Nome que não existe simplesmente nunca casa — e "nunca casa" e "a
// máquina está desligada" produzem exatamente o mesmo silêncio.
//
// ── por que aqui, e não uma FK no banco ─────────────────────────────────────
//
// Uma foreign key de solicitacoes.destinatario para usuarios.username
// funcionaria e seria pior por dois motivos.
//
// O primeiro é que ela não conserta nada: recusa o insert com um erro de banco,
// e quem digitou continua sem saber que a diferença era um 'u'. O que resolve é
// a SUGESTÃO, e sugestão é coisa de tela.
//
// O segundo é que destinatario não é, a rigor, uma chave estrangeira de
// usuarios: o que ele endereça é o usuário WINDOWS da máquina. Os dois
// coincidem hoje porque o gate do Coreon exige que o usuário Windows esteja na
// tabela, mas são conceitos diferentes, e amarrá-los no esquema transformaria
// uma coincidência em contrato.
//
// Então: avisa, sugere e deixa passar. Bloquear seria trocar um silêncio por
// uma parede — e há o caso raro em que se quer endereçar uma máquina que ainda
// não sincronizou o cadastro.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseService } from './supabase'

export interface Conferencia {
  /** O nome existe no cadastro. */
  existe: boolean
  /** Candidatos parecidos, do mais para o menos provável. Vazio se existe. */
  sugestoes: string[]
}

/** Os usernames cadastrados, em minúsculas. */
export async function carregarUsuarios(svc: SupabaseService): Promise<string[]> {
  const rows = await svc.lerLinhas('usuarios', { order: 'username.asc' })
  return rows
    .map((r) => String(r.username ?? '').trim().toLowerCase())
    .filter(Boolean)
}

// ── distância de edição, limitada ───────────────────────────────────────────
//
// Levenshtein comum, com um teto: acima de 2 edições não é mais engano de
// digitação, é outro nome. Sugerir "renan.dsilva" para quem digitou "marq"
// seria pior que não sugerir nada — a pessoa perde tempo conferindo um palpite
// que nasceu de ruído.
function distancia(a: string, b: string, teto: number): number {
  if (Math.abs(a.length - b.length) > teto) return teto + 1

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const atual = [i]
    let melhorDaLinha = i

    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo)
      atual.push(v)
      if (v < melhorDaLinha) melhorDaLinha = v
    }

    // Poda: se a melhor célula da linha já passou do teto, nenhuma linha
    // seguinte volta para baixo dele. Evita percorrer a matriz inteira para
    // cada um dos ~40 usuários a cada tecla digitada.
    if (melhorDaLinha > teto) return teto + 1
    anterior = atual
  }

  return anterior[b.length]
}

export function conferir(nome: string, cadastrados: string[]): Conferencia {
  const alvo = (nome ?? '').trim().toLowerCase()
  if (!alvo) return { existe: true, sugestoes: [] } // vazio = "a primeira que pegar"

  if (cadastrados.includes(alvo)) return { existe: true, sugestoes: [] }

  // Prefixo primeiro: "marq" → "marqu" é o caso real, e ele não é um erro de
  // digitação qualquer — é um nome digitado pela metade. Vem antes de qualquer
  // vizinho por distância.
  const porPrefixo = cadastrados.filter((u) => u.startsWith(alvo) || alvo.startsWith(u))

  const porDistancia = cadastrados
    .filter((u) => !porPrefixo.includes(u))
    .map((u) => ({ u, d: distancia(alvo, u, 2) }))
    .filter((x) => x.d <= 2)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.u)

  return { existe: false, sugestoes: [...porPrefixo, ...porDistancia].slice(0, 3) }
}
