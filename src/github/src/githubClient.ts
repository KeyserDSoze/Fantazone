const API = 'https://api.github.com'
const PREFIX = 'Fantazone.'

export type GitHubRepo = {
  name: string
  full_name: string
  owner: { login: string }
  default_branch: string
  permissions?: { pull?: boolean; push?: boolean; admin?: boolean }
}

export class GitHubApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export class GitHubClient {
  constructor(private readonly token: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${this.token}`,
        ...init.headers,
      },
    })
    if (!response.ok) {
      throw new GitHubApiError(response.status, await response.text())
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  async validateToken(): Promise<{ login: string }> {
    return this.request('/user')
  }

  async discoverFantazoneRepositories(): Promise<GitHubRepo[]> {
    const found: GitHubRepo[] = []
    for (let page = 1; ; page += 1) {
      const repos = await this.request<GitHubRepo[]>(`/user/repos?per_page=100&page=${page}&sort=full_name&direction=asc`)
      found.push(...repos.filter(x => x.name.startsWith(PREFIX)))
      if (repos.length < 100) break
    }
    return found
  }

  async findGroup(groupName: string): Promise<GitHubRepo | undefined> {
    const expected = `${PREFIX}${normalizeGroupName(groupName)}`
    return (await this.discoverFantazoneRepositories()).find(x => x.name.toLowerCase() === expected.toLowerCase())
  }

  async getContent(owner: string, repo: string, path: string, ref?: string): Promise<{ sha: string; content: string; etag?: string }> {
    const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : ''
    const result = await this.request<{ sha: string; content: string; encoding: string }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}${suffix}`)
    if (result.encoding !== 'base64') throw new Error(`Unsupported content encoding ${result.encoding}`)
    const content = decodeBase64Utf8(result.content.replace(/\n/g, ''))
    return { sha: result.sha, content }
  }

  async putContent(owner: string, repo: string, path: string, text: string, message: string, sha?: string, branch?: string): Promise<void> {
    await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: encodeBase64Utf8(text), ...(sha ? { sha } : {}), ...(branch ? { branch } : {}) }),
    })
  }
}

export function normalizeGroupName(value: string): string {
  return value.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '')
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach(x => { binary += String.fromCharCode(x) })
  return btoa(binary)
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
