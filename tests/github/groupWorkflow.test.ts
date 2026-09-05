import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GROUP_DOCUMENT_PATH,
  GROUP_RECALCULATION_WORKFLOW,
  GROUP_RECALCULATION_WORKFLOW_PATH,
  GROUP_REPOSITORY_METADATA_PATH,
  GROUP_REPOSITORY_RUNTIME_VERSION,
  ensureGroupInitialized,
  type GroupSetupClient,
} from '../../src/github/src/index'

const repo: any = {
  name: 'Fantazone.Amici',
  full_name: 'KeyserDSoze/Fantazone.Amici',
  owner: { login: 'KeyserDSoze' },
  default_branch: 'main',
}

class FakeSetupClient implements GroupSetupClient {
  readonly files = new Map<string, { sha: string; content: string }>()
  writes = 0
  failWorkflowWrites = false

  async discoverFantazoneRepositories() { return [] }
  async createRepository() { throw new Error('not used') }

  async tryGetContent(owner: string, repository: string, path: string) {
    return this.files.get(`${owner}/${repository}/${path}`) ?? null
  }

  async putContent(
    owner: string,
    repository: string,
    path: string,
    content: string,
    _message: string,
    sha?: string,
  ) {
    if (this.failWorkflowWrites && path === GROUP_RECALCULATION_WORKFLOW_PATH) {
      throw new Error('403 workflow scope required')
    }
    const key = `${owner}/${repository}/${path}`
    const current = this.files.get(key)
    if (current && sha && current.sha !== sha) throw new Error('fake stale sha')
    this.writes += 1
    const nextSha = `sha-${this.writes}`
    this.files.set(key, { sha: nextSha, content })
    return { sha: nextSha }
  }
}

function fileKey(path: string) {
  return `KeyserDSoze/Fantazone.Amici/${path}`
}

test('fresh group bootstrap installs the current group-owned runtime', async () => {
  const client = new FakeSetupClient()

  const result = await ensureGroupInitialized(client, repo, 'Amici', {
    initialAdmin: { email: 'admin@example.com' },
  })

  const workflow = client.files.get(fileKey(GROUP_RECALCULATION_WORKFLOW_PATH))?.content
  const metadata = JSON.parse(client.files.get(fileKey(GROUP_REPOSITORY_METADATA_PATH))!.content)

  assert.equal(result.runtimeVersion, GROUP_REPOSITORY_RUNTIME_VERSION)
  assert.equal(workflow, GROUP_RECALCULATION_WORKFLOW)
  assert.match(workflow!, /recalculate-day/)
  assert.match(workflow!, /recalculate-all/)
  assert.match(workflow!, /set-next-formations/)
  assert.match(workflow!, /repository: KeyserDSoze\/Fantazone/)
  assert.match(workflow!, /FANTAZONE_GROUP_REPO_ROOT/)
  assert.match(workflow!, /git status --porcelain -- data/)
  assert.equal(metadata.kind, 'fantazone-group')
  assert.equal(metadata.groupRuntimeVersion, GROUP_REPOSITORY_RUNTIME_VERSION)
  assert.ok(result.createdFiles.includes(GROUP_DOCUMENT_PATH))
  assert.ok(result.createdFiles.includes(GROUP_RECALCULATION_WORKFLOW_PATH))
  assert.ok(result.createdFiles.includes(GROUP_REPOSITORY_METADATA_PATH))
})

test('opening an already current group performs no writes', async () => {
  const client = new FakeSetupClient()
  await ensureGroupInitialized(client, repo, 'Amici', { initialAdmin: { email: 'admin@example.com' } })
  const firstWrites = client.writes

  const result = await ensureGroupInitialized(client, repo, 'Amici')

  assert.equal(client.writes, firstWrites)
  assert.deepEqual(result.createdFiles, [])
  assert.deepEqual(result.updatedManagedFiles, [])
})

test('runtime upgrade replaces only Fantazone-managed files and preserves group/custom data', async () => {
  const client = new FakeSetupClient()
  await ensureGroupInitialized(client, repo, 'Amici', { initialAdmin: { email: 'admin@example.com' } })

  const groupBefore = client.files.get(fileKey(GROUP_DOCUMENT_PATH))!.content
  client.files.set(fileKey(GROUP_RECALCULATION_WORKFLOW_PATH), {
    sha: 'old-workflow-sha',
    content: '# old Fantazone managed workflow\n',
  })
  client.files.set(fileKey(GROUP_REPOSITORY_METADATA_PATH), {
    sha: 'old-metadata-sha',
    content: JSON.stringify({
      schemaVersion: 2,
      kind: 'fantazone-group',
      groupName: 'Amici',
      groupRuntimeVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  })
  client.files.set(fileKey('.github/workflows/custom.yml'), {
    sha: 'custom-sha',
    content: 'name: My custom workflow\n',
  })
  client.files.set(fileKey('data/custom.json'), {
    sha: 'data-sha',
    content: '{"keep":true}\n',
  })

  const result = await ensureGroupInitialized(client, repo, 'Amici')
  const metadata = JSON.parse(client.files.get(fileKey(GROUP_REPOSITORY_METADATA_PATH))!.content)

  assert.equal(client.files.get(fileKey(GROUP_RECALCULATION_WORKFLOW_PATH))!.content, GROUP_RECALCULATION_WORKFLOW)
  assert.equal(metadata.groupRuntimeVersion, GROUP_REPOSITORY_RUNTIME_VERSION)
  assert.equal(metadata.createdAt, '2026-01-01T00:00:00.000Z')
  assert.equal(client.files.get(fileKey(GROUP_DOCUMENT_PATH))!.content, groupBefore)
  assert.equal(client.files.get(fileKey('.github/workflows/custom.yml'))!.content, 'name: My custom workflow\n')
  assert.equal(client.files.get(fileKey('data/custom.json'))!.content, '{"keep":true}\n')
  assert.deepEqual(result.updatedManagedFiles.sort(), [
    GROUP_RECALCULATION_WORKFLOW_PATH,
    GROUP_REPOSITORY_METADATA_PATH,
  ].sort())
})

test('group bootstrap and upgrade report missing workflow-write permission clearly', async () => {
  const client = new FakeSetupClient()
  client.failWorkflowWrites = true

  await assert.rejects(
    ensureGroupInitialized(client, repo, 'Amici', { initialAdmin: { email: 'admin@example.com' } }),
    /deve poter modificare i workflow/,
  )

  assert.equal(client.files.has(fileKey(GROUP_REPOSITORY_METADATA_PATH)), false, 'runtime version must not advance after a failed workflow install')
})
