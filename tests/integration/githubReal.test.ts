import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GitHubApiError,
  GitHubClient,
  GitHubJsonStore,
  RepositoryWriteConflictError,
} from '../../src/github/src/index'

const token = requiredEnv('FANTAZONE_TEST_PAT')
const repository = process.env.FANTAZONE_TEST_REPOSITORY?.trim() || 'KeyserDSoze/Fantazone.IntegrationTests'
const [owner, repo, extra] = repository.split('/')
if (!owner || !repo || extra) throw new Error('FANTAZONE_TEST_REPOSITORY must be owner/repo')

const location = {
  owner,
  repo,
  path: 'integration/github-json-store-canary.json',
}

test('real GitHub repository supports authenticated read/write and optimistic SHA conflicts', async () => {
  const client = new GitHubClient(token)
  const identity = await client.validateToken()
  assert.ok(identity.login)

  try {
    const metadata = await client.getRepository(owner, repo)
    assert.equal(metadata.full_name.toLowerCase(), repository.toLowerCase())
    assert.equal(metadata.permissions?.push, true, `${repository} must grant push permission to the integration PAT`)
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new Error(
        `Integration repository ${repository} does not exist or is not visible to FANTAZONE_TEST_PAT. ` +
        'Create the dedicated repository and scope the fine-grained PAT to Contents: Read and write.',
      )
    }
    throw error
  }

  const writer = new GitHubJsonStore(client)
  const contender = new GitHubJsonStore(client)
  const run = process.env.GITHUB_RUN_ID?.trim() || `local-${Date.now()}`

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

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for real GitHub integration tests`)
  return value
}
