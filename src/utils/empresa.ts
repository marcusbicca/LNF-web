// ─────────────────────────────────────────────────────────────────────────────
// De quem é este centro
//
// Espelha FornecedorService.EmpresaDoCentro do LNF-Coreon, e tem que continuar
// espelhando: se as duas respostas divergirem, a tela vai dizer que a nota foi
// conferida com a régua de um cliente e o Coreon vai ter usado a de outro.
//
// A regra tem TRÊS degraus, e a ordem é o que importa:
//
//   1. centros.empresa preenchida  →  é ela
//   2. vazia, mas centro_pardini   →  'pardini'
//   3. nem uma nem outra           →  a empresa padrão ('fleury')
//
// O segundo degrau parece redundante e não é: o centro_pardini marcava os
// centros do Pardini muito antes de a coluna 'empresa' existir, e é ele que
// impede um centro criado hoje — sem empresa preenchida — de ser conferido com
// a régua do Fleury sem ninguém perceber.
//
// ── por que isto vive aqui, e não numa coluna do banco ──────────────────────
//
// Porque é REGRA, não dado. Guardar o resultado em cada solicitação criaria uma
// segunda cópia dela, que envelhece sozinha: mudar a empresa de um centro
// passaria a não mudar o que as solicitações antigas dizem, e não haveria como
// saber qual das duas respostas é a verdadeira. O centro é o fato; a empresa se
// calcula a partir dele, sempre agora. Ver a migração 0044.
// ─────────────────────────────────────────────────────────────────────────────

export const EMPRESA_PADRAO = 'fleury'

// O shape que o centroRowToLegacy produz. Só o que esta regra precisa.
export interface CentroLegado {
  Empresa?: string
  CentroPardini?: boolean
}

export type CentrosJson = { Centros?: Record<string, CentroLegado> } | null | undefined

// De onde a resposta veio. É texto de diagnóstico e nada mais depende dele —
// mas quando a régua sai errada, a primeira pergunta é justamente qual dos três
// degraus respondeu: uma coluna em branco e um centro fora do cadastro produzem
// a mesma 'fleury', por motivos opostos.
export type OrigemEmpresa = 'coluna' | 'pardini' | 'padrao' | 'sem-centro' | 'fora-do-cadastro'

export interface Empresa {
  codigo: string
  origem: OrigemEmpresa
}

export function empresaDoCentro(centro: string | null | undefined, centros: CentrosJson): Empresa {
  const c = (centro ?? '').trim()
  if (c === '') return { codigo: EMPRESA_PADRAO, origem: 'sem-centro' }

  const mapa = centros?.Centros
  if (!mapa) return { codigo: EMPRESA_PADRAO, origem: 'fora-do-cadastro' }

  // O JSON preserva a grafia de quem cadastrou; o centro que vem da solicitação
  // veio da NF. Procura exato primeiro, depois sem diferenciar caixa.
  const alvo = c.toLowerCase()
  const chave = mapa[c] !== undefined
    ? c
    : Object.keys(mapa).find(k => k.trim().toLowerCase() === alvo)

  if (chave === undefined) return { codigo: EMPRESA_PADRAO, origem: 'fora-do-cadastro' }

  const info = mapa[chave]
  const empresa = (info?.Empresa ?? '').trim()
  if (empresa !== '') return { codigo: empresa, origem: 'coluna' }
  if (info?.CentroPardini) return { codigo: 'pardini', origem: 'pardini' }

  return { codigo: EMPRESA_PADRAO, origem: 'padrao' }
}

// O texto do título (tooltip) que explica de onde a resposta veio. Sem isto, um
// "fleury" que na verdade quer dizer "não sei" fica indistinguível de um
// "fleury" declarado — e a diferença é o que se procura quando algo sai errado.
export function explicarEmpresa(e: Empresa, centro: string | null | undefined): string {
  switch (e.origem) {
    case 'coluna':
      return `Empresa declarada no cadastro do centro ${centro}.`
    case 'pardini':
      return `O centro ${centro} não tem empresa declarada, mas está marcado como centro_pardini.`
    case 'padrao':
      return `O centro ${centro} não tem empresa declarada nem marca de Pardini — vale a empresa padrão (${EMPRESA_PADRAO}).`
    case 'sem-centro':
      return `A solicitação não registrou centro (linha anterior à migração 0044, ou execução sem centro identificável). Vale a empresa padrão (${EMPRESA_PADRAO}).`
    case 'fora-do-cadastro':
      return `O centro ${centro} não está no cadastro carregado — vale a empresa padrão (${EMPRESA_PADRAO}).`
  }
}
