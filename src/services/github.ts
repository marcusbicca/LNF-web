export interface GitHubFileResult {
  data: unknown
  sha: string
}

export class GitHubService {
  constructor(
    private token: string,
    private owner: string,
    private repo: string,
  ) {}

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    }
  }

  async lerArquivo(path: string): Promise<GitHubFileResult> {
    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`,
      { headers: this.headers() },
    )
    if (!res.ok) throw new Error(`Erro ${res.status}: ${res.statusText}`)

    const file = (await res.json()) as { content: string; sha: string }
    // Decodifica base64 com suporte a UTF-8
    const binary = atob(file.content.replace(/\n/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const text = new TextDecoder('utf-8').decode(bytes)

    return { data: JSON.parse(text), sha: file.sha }
  }

  async gravarArquivo(
    path: string,
    conteudo: unknown,
    sha: string,
    mensagem: string,
  ): Promise<string> {
    const json = JSON.stringify(conteudo, null, 2)
    const bytes = new TextEncoder().encode(json)
    let binary = ''
    bytes.forEach(b => (binary += String.fromCharCode(b)))
    const content = btoa(binary)

    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({ message: mensagem, content, sha }),
      },
    )
    if (!res.ok) {
      const err = (await res.json()) as { message?: string }
      throw new Error(`Erro ${res.status}: ${err.message ?? res.statusText}`)
    }
    const result = (await res.json()) as { content: { sha: string } }
    return result.content.sha
  }
}
