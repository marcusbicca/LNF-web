// Hash da senha do Coreon, calculado no navegador.
//
// Tem que ser BIT A BIT o que a lnf-api confere (pbkdf2 / coreonConferirSenha
// no index.ts): PBKDF2-SHA256, 256 bits, salt de 16 bytes, tudo em base64, e
// a senha crua (sem trim) em UTF-8. Mudar qualquer um destes lados sem o outro
// faz toda senha gravada daqui parar de bater no login do host.

export const ITER_PADRAO = 210000

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const c of bytes) s += String.fromCharCode(c)
  return btoa(s)
}

function deB64(texto: string): Uint8Array<ArrayBuffer> {
  const bin = atob(texto)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function hashSenhaCoreon(
  senha: string,
  iter = ITER_PADRAO,
): Promise<{ senha_hash: string; senha_salt: string; senha_iter: number }> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)))
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: deB64(salt), iterations: iter, hash: 'SHA-256' },
    base,
    256,
  )
  return { senha_hash: b64(new Uint8Array(bits)), senha_salt: salt, senha_iter: iter }
}
