import assert from 'node:assert/strict'
import test from 'node:test'
import { GitHubClient, normalizeGroupName } from '../../src/github/src/githubClient'

test('normalizes a human group name to the Fantazone repository suffix', () => {
  assert.equal(normalizeGroupName('  Amici del Bar!  '), 'Amici-del-Bar')
  assert.equal(normalizeGroupName('Fanta è forte'), 'Fanta-e-forte')
  assert.equal(normalizeGroupName('.. Gruppo -- Uno ..'), 'Gruppo-Uno')
})

test('returns an empty suffix when a name has no supported repository characters', () => {
  assert.equal(normalizeGroupName('!!!'), '')
})

test('lists GitHub Actions workflow runs with bounded pagination and optional branch', async () => {
  const previousFetch = globalThis.fetch
  let requestedUrl = ''
  let requestedAuthorization: string | null = null
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(input)
    const headers = new Headers(init?.headers)
    requestedAuthorization = headers.get('Authorization')
    return new Response(JSON.stringify({
      total_count: 1,
      workflow_runs: [{
        id: 42,
        name: 'CI',
        path: '.github/workflows/ci.yml',
        display_title: 'test commit',
        run_number: 10,
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        head_branch: 'main',
        head_sha: 'abc123',
        html_url: 'https://github.com/KeyserDSoze/Fantazone/actions/runs/42',
        created_at: '2026-09-07T00:00:00Z',
        updated_at: '2026-09-07T00:01:00Z',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  try {
    const page = await new GitHubClient('secret').listWorkflowRuns('KeyserDSoze', 'Fantazone', {
      page: 2,
      perPage: 500,
      branch: 'main',
    })
    assert.equal(page.total_count, 1)
    assert.equal(page.workflow_runs[0].id, 42)
    assert.equal(requestedAuthorization, 'Bearer secret')
    assert.match(requestedUrl, /\/repos\/KeyserDSoze\/Fantazone\/actions\/runs\?/)
    assert.match(requestedUrl, /page=2/)
    assert.match(requestedUrl, /per_page=100/)
    assert.match(requestedUrl, /branch=main/)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('public workflow-run reads do not require a token', async () => {
  const previousFetch = globalThis.fetch
  let requestedAuthorization: string | null = 'unset'
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestedAuthorization = new Headers(init?.headers).get('Authorization')
    return new Response(JSON.stringify({ total_count: 0, workflow_runs: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const page = await new GitHubClient().listWorkflowRuns('KeyserDSoze', 'Fantazone')
    assert.equal(page.total_count, 0)
    assert.equal(requestedAuthorization, null)
  } finally {
    globalThis.fetch = previousFetch
  }
})
