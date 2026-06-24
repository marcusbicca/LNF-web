// Parsing tolerante do JSON colado.
//
// O JSON do LNF-Coreon costuma chegar pela área de transferência e pode vir:
//   • em uma única linha (válido — JSON.parse já aceita)
//   • "quebrado" por wrap da colagem, com \r/\n inseridos no meio dos tokens
//     (ex.: "forn\necedores": ...). Quebras de linha cruas dentro de strings
//     são inválidas em JSON, então JSON.parse falha. Removê-las costuma
//     reconstruir o conteúdo original.
//
// parseLenient tenta o parse direto; se falhar, remove \r/\n e tenta de novo.
// Em caso de sucesso, format() devolve a versão indentada para reexibição.

export function parseLenient<T = unknown>(texto: string): T {
  const t = (texto ?? '').trim()
  if (!t) throw new Error('JSON vazio')

  try {
    return JSON.parse(t) as T
  } catch (erroOriginal) {
    // Conserta quebras de linha espúrias (colagem com wrap).
    const limpo = t.replace(/\r/g, '').replace(/\n/g, '')
    try {
      return JSON.parse(limpo) as T
    } catch {
      throw erroOriginal // erro original aponta melhor a posição
    }
  }
}

export function format(valor: unknown): string {
  return JSON.stringify(valor, null, 2)
}
