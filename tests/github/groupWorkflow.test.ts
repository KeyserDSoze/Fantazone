import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GROUP_RECALCULATION_WORKFLOW,
  GROUP_RECALCULATION_WORKFLOW_PATH,
  ensureGroupInitialized,
  type GroupSetupClient,
} from '../../src/github/src/index'

const repo: any = {
  name: 'Fantazone.Amici',
  full_name: 'KeyserDSoze/Fantazone.Amici',
  owner: { login: 'KeyserDSoze' },
  default_branch: 'main',
}

test('group bootstrap installs the self-contained recalculation workflow idempotently', async () => {
  const files = new Map<string, { sha: string; content: string }>()
  let writes = 0
  const client: GroupSetupClient = {
    async discoverFantazoneRepositories() { return [] },
    async createRepository() { throw new Error('not used') },
    async tryGetContent(owner, repository, path) {
      return files.get(`${owner}/${repository}/${path}`) ?? null
    },
    async putContent(owner, repository, path, content) {
      writes += 1
      files.set(`${owner}/${repository}/${path}`, { sha: `sha-${writes}`, content })
      return { sha: `sha-${writes}` }
    },
  }

  await ensureGroupInitialized(client, repo, 'Amici', { initialAdmin: { email: 'admin@example.com' } })
  const firstWrites = writes
  const workflow = files.get(`KeyserDSoze/Fantazone.Amici/${GROUP_RECALCULATION_WORKFLOW_PATH}`)?.content

  assert.equal(workflow, GROUP_RECALCULATION_WORKFLOW)
  assert.match(workflow!, /recalculate-day/)
  assert.match(workflow!, /recalculate-all/)
  assert.match(workflow!, /repository: KeyserDSoze\/Fantazone/)
  assert.match(workflow!, /FANTAZONE_GROUP_REPO_ROOT/)
  assert.match(workflow!, /git status --porcelain -- data/)

  await ensureGroupInitialized(client, repo, 'Amici')
  assert.equal(writes, firstWrites, 'bootstrap must not rewrite existing workflow/config files')
})

test('group bootstrap reports missing workflow-write permission clearly', async () => {
  const files = new Map<string, { sha: string; content: string }>()
  const client: GroupSetupClient = {
    async discoverFantazoneRepositories() { return [] },
    async createRepository() { throw new Error('not used') },
    async tryGetContent(owner, repository, path) {
      return files.get(`${owner}/${repository}/${path}`) ?? null
    },
    async putContent(owner, repository, path, content) {
      if (path === GROUP_RECALCULATION_WORKFLOW_PATH) throw new Error('403 workflow scope required')
      files.set(`${owner}/${repository}/${path}`, { sha: 'sha', content })
      return { sha: 'sha' }
    },
  }

  await assert.rejects(
    ensureGroupInitialized(client, repo, 'Amici', { initialAdmin: { email: 'admin@example.com' } }),
    /deve poter modificare i workflow/,
  )
})
