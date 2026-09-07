import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GitHubApiError,
  GitHubClient,
  GitHubJsonStore,
  RepositoryWriteConflictError,
} from '../../src/github/src/index'

const token = requiredEnv('FANTAZONE_TEST_PAT')
const repository = process.env.FANTAZONE_TEST_REPOSITORY?.trim() || 'KeyserDSoze/Fantazone.Test'
const [owner, repo, extra] = repository.split('/')
if (!owner || !repo || extra) throw new Error('FANTAZONE_TEST_REPOSITORY must be owner/repo')

const TEST_MARKER_PATH = '.fantazone-test.json'
const TEST_MARKER_CONTENT = `${JSON.stringify({
  version: 1,
  repository: 'KeyserDSoze/Fantazone.Test',
  purpose: 'Disposable real GitHub integration target for Fantazone',
  policy: 'Integration suites reuse main and start with a cleanup commit whose tree contains only this marker. Generated files remain available in Git history.',
}, null, 2)}\n`

const location = {
  owner,
  repo,
  path: 'integration/github-json-store-canary.json',
}

test('real GitHub repository supports reset, authenticated read/write and optimistic SHA conflicts', async () => {
  const client = new GitHubClient(token)
  const identity = await client.validateToken()
  assert.ok(identity.login)

  let defaultBranch = 'main'
  try {
    const metadata = await client.getRepository(owner, repo)
    assert.equal(metadata.full_name.toLowerCase(), repository.toLowerCase())
    assert.equal(metadata.permissions?.push, true, `${repository} must grant push permission to the integration PAT`)
    defaultBranch = metadata.default_branch || defaultBranch
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new Error(
        `Integration repository ${repository} does not exist or is not visible to FANTAZONE_TEST_PAT. ` +
        'Create the dedicated repository and scope the fine-grained PAT to Contents: Read and write.',
      )
    }
    throw error
  }

  const run = process.env.GITHUB_RUN_ID?.trim() || `local-${Date.now()}`
  await resetIntegrationRepository(token, owner, repo, defaultBranch, run)

  const marker = await client.getContent(owner, repo, TEST_MARKER_PATH, defaultBranch)
  assert.equal(marker.content, TEST_MARKER_CONTENT)
  assert.equal(await client.tryGetContent(owner, repo, location.path, defaultBranch), null)

  const writer = new GitHubJsonStore(client)
  const contender = new GitHubJsonStore(client)

  const baseline = await writer.writeJson(location, {
    version: 1,
    run,
    phase: 'baseline',
  }, `test: integration baseline ${run}`)

  const stale = await contender.readJson<{ version: number; run: string; phase: string }>(location, { refresh: true })
  assert.equal(stale.sha, baseline.sha)
  assert.equal(stale.value.phase, 'baseline')

  const winner = await writer.writeJson(location, {
    version: 1,
    run,
    phase: 'winner',
  }, `test: integration winner ${run}`, { expectedSha: stale.sha })
  assert.notEqual(winner.sha, stale.sha)

  await assert.rejects(
    contender.writeJson(location, {
      version: 1,
      run,
      phase: 'stale-writer',
    }, `test: stale integration writer ${run}`, { expectedSha: stale.sha }),
    error => error instanceof RepositoryWriteConflictError && (error.status === 409 || error.status === 422),
  )

  const canonical = await writer.readJson<{ version: number; run: string; phase: string }>(location, { refresh: true })
  assert.equal(canonical.sha, winner.sha)
  assert.equal(canonical.value.run, run)
  assert.equal(canonical.value.phase, 'winner')
})

async function resetIntegrationRepository(
  accessToken: string,
  repositoryOwner: string,
  repositoryName: string,
  branch: string,
  run: string,
): Promise<void> {
  const base = `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}`
  const ref = await integrationRequest<{ object: { sha: string } }>(
    accessToken,
    `${base}/git/ref/heads/${encodeURIComponent(branch)}`,
  )

  const blob = await integrationRequest<{ sha: string }>(accessToken, `${base}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: TEST_MARKER_CONTENT, encoding: 'utf-8' }),
  })

  const tree = await integrationRequest<{ sha: string }>(accessToken, `${base}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      tree: [{
        path: TEST_MARKER_PATH,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      }],
    }),
  })

  const commit = await integrationRequest<{ sha: string }>(accessToken, `${base}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `test: reset repository ${run}`,
      tree: tree.sha,
      parents: [ref.object.sha],
    }),
  })

  await integrationRequest(accessToken, `${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  })
}

async function integrationRequest<T = unknown>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  })
  if (!response.ok) throw new GitHubApiError(response.status, await response.text())
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for real GitHub integration tests`)
  return value
}
