const API = 'https://api.github.com'
const PREFIX = 'Fantazone.'

export type GitHubRepo = {
  name: string
  full_name: string
  private: boolean
  html_url?: string
  owner: { login: string }
  default_branch: string
  permissions?: { pull?: boolean; push?: boolean; admin?: boolean }
}

export type GitHubContentWriteResult = {
  sha: string
}

export type GitHubWorkflowRun = {
  id: number
  name: string
  path: string
  display_title: string
  run_number: number
  event: string
  status: string
  conclusion: string | null
  head_branch: string | null
  head_sha: string
  html_url: string
  created_at: string
  updated_at: string
  run_started_at?: string | null
  actor?: { login: string } | null
  head_commit?: { id: string; message: string; timestamp: string } | null
}

export type GitHubWorkflowRunsPage = {
  total_count: number
  workflow_runs: GitHubWorkflowRun[]
}

export class GitHubApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

export class GitHubClient {
  constructor(private readonly token?: string) {}

  private requireToken(): void {
    if (!this.token) {
      throw new GitHubApiError(401, 'A GitHub access token is required for this operation')
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    }

    if (this.token) headers.Authorization = `Bearer ${this.token}`
    if (init.headers) Object.assign(headers, init.headers as Record<string, string>)

    const response = await fetch(`${API}${path}`, {
      ...init,
      headers,
    })
    if (!response.ok) {
      throw new GitHubApiError(response.status, await response.text())
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  async validateToken(): Promise<{ login: string }> {
    this.requireToken()
    return this.request('/user')
  }

  async getRepository(owner: string, repo: string): Promise<GitHubRepo> {
    this.requireToken()
    return this.request<GitHubRepo>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)
  }

  async discoverFantazoneRepositories(): Promise<GitHubRepo[]> {
    this.requireToken()
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

  async createRepository(input: { name: string; description?: string; isPrivate?: boolean }): Promise<GitHubRepo> {
    this.requireToken()
    return this.request('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        description: input.description,
        private: input.isPrivate ?? false,
        auto_init: true,
      }),
    })
  }

  async dispatchWorkflow(
    owner: string,
    repo: string,
    workflowId: string,
    ref: string,
    inputs: Record<string, string> = {},
  ): Promise<void> {
    this.requireToken()
    const normalizedWorkflow = workflowId.trim()
    const normalizedRef = ref.trim()
    if (!normalizedWorkflow || !normalizedRef) throw new Error('Workflow id and ref are required')
    await this.request<void>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(normalizedWorkflow)}/dispatches`,
      { method: 'POST', body: JSON.stringify({ ref: normalizedRef, inputs }) },
    )
  }

  /** Reads recent GitHub Actions runs. Authentication is optional for public repositories. */
  async listWorkflowRuns(
    owner: string,
    repo: string,
    options: { page?: number; perPage?: number; branch?: string } = {},
  ): Promise<GitHubWorkflowRunsPage> {
    const page = positiveInteger(options.page ?? 1, 'page')
    const perPage = Math.min(100, positiveInteger(options.perPage ?? 50, 'perPage'))
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) })
    const branch = options.branch?.trim()
    if (branch) params.set('branch', branch)
    return this.request<GitHubWorkflowRunsPage>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?${params.toString()}`,
    )
  }

  /**
   * Reads repository content. Authentication is optional so public Fantazone data can
   * be consumed without forcing the application to own a GitHub credential.
   */
  async getContent(owner: string, repo: string, path: string, ref?: string): Promise<{ sha: string; content: string }> {
    const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : ''
    const result = await this.request<{ sha: string; content: string; encoding: string }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}${suffix}`)
    if (result.encoding !== 'base64') throw new Error(`Unsupported content encoding ${result.encoding}`)
    const content = decodeBase64Utf8(result.content.replace(/\n/g, ''))
    return { sha: result.sha, content }
  }

  async tryGetContent(owner: string, repo: string, path: string, ref?: string): Promise<{ sha: string; content: string } | null> {
    try {
      return await this.getContent(owner, repo, path, ref)
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) return null
      throw error
    }
  }

  async putContent(
    owner: string,
    repo: string,
    path: string,
    text: string,
    message: string,
    sha?: string,
    branch?: string,
  ): Promise<GitHubContentWriteResult> {
    this.requireToken()
    const result = await this.request<{ content: { sha: string } | null }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message,
          content: encodeBase64Utf8(text),
          ...(sha ? { sha } : {}),
          ...(branch ? { branch } : {}),
        }),
      },
    )

    if (!result.content?.sha) throw new Error(`GitHub did not return a content SHA for ${path}`)
    return { sha: result.content.sha }
  }
}

export function normalizeGroupName(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`)
  return value
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
