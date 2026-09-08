import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { selectFilesForCollisionMode, writeFilesAtomically } from '../../scripts/migration/github-writer.mjs'

const files = [{ path: 'a.json', content: '{}' }, { path: 'b.json', content: '{}' }]
const existing = new Map([['a.json', 'sha-a']])
const sha256 = value => createHash('sha256').update(value).digest('hex')

test('collision mode fails closed by default', () => {
  assert.throws(() => selectFilesForCollisionMode(files, existing, 'fail'), /already contains/)
})

test('preserve-existing skips only collisions', () => {
  const result = selectFilesForCollisionMode(files, existing, 'preserve')
  assert.deepEqual(result.files.map(x => x.path), ['b.json'])
  assert.deepEqual(result.collisions.map(x => x.path), ['a.json'])
  assert.deepEqual(result.forcedOverwrites, [])
})

test('preserve-existing can select an explicitly proven repair collision', () => {
  const repairFiles = [{ path: 'a.json', content: '{"year":13}', forceOverwrite: true }, { path: 'b.json', content: '{}' }]
  const result = selectFilesForCollisionMode(repairFiles, existing, 'preserve')
  assert.deepEqual(result.files.map(x => x.path), ['a.json', 'b.json'])
  assert.deepEqual(result.forcedOverwrites.map(x => x.path), ['a.json'])
})

test('overwrite retains colliding paths', () => {
  const result = selectFilesForCollisionMode(files, existing, 'overwrite')
  assert.deepEqual(result.files.map(x => x.path), ['a.json', 'b.json'])
})

class FakeApi {
  constructor(handler) { this.handler = handler; this.calls = [] }
  async request(method, path, body) { this.calls.push({ method, path, body }); return this.handler(method, path, body, this.calls) }
}

test('REST dry-run classifies an untouched imported collision as a safe update', async () => {
  const previousContent = '{"value":1}\n'
  const api = new FakeApi((method, path) => {
    if (method === 'GET' && path === '/repos/o/r') return { default_branch: 'main' }
    if (method === 'GET' && path.includes('/git/ref/heads/main')) return { object: { sha: 'head' } }
    if (method === 'GET' && path.endsWith('/git/commits/head')) return { tree: { sha: 'base-tree' } }
    if (method === 'GET' && path.includes('/git/trees/base-tree')) return { tree: [{ path: 'a.json', type: 'blob', sha: 'old-blob' }] }
    if (method === 'GET' && path.endsWith('/git/blobs/old-blob')) {
      return { encoding: 'base64', content: Buffer.from(previousContent).toString('base64') }
    }
    throw new Error(`unexpected ${method} ${path}`)
  })

  const result = await writeFilesAtomically({
    api,
    repository: 'o/r',
    branch: 'main',
    mode: 'preserve',
    apply: false,
    message: 'm',
    files: [{
      path: 'a.json',
      content: '{"value":2}\n',
      previousContentSha256: sha256(previousContent),
    }],
  })

  assert.equal(result.planned, 1)
  assert.deepEqual(result.safeUpdates, ['a.json'])
  assert.deepEqual(result.preservedCollisions, [])
})

test('REST dry-run preserves a collision when GitHub diverged from the previous import', async () => {
  const previousContent = '{"value":1}\n'
  const currentContent = '{"value":99}\n'
  const api = new FakeApi((method, path) => {
    if (method === 'GET' && path === '/repos/o/r') return { default_branch: 'main' }
    if (method === 'GET' && path.includes('/git/ref/heads/main')) return { object: { sha: 'head' } }
    if (method === 'GET' && path.endsWith('/git/commits/head')) return { tree: { sha: 'base-tree' } }
    if (method === 'GET' && path.includes('/git/trees/base-tree')) return { tree: [{ path: 'a.json', type: 'blob', sha: 'current-blob' }] }
    if (method === 'GET' && path.endsWith('/git/blobs/current-blob')) {
      return { encoding: 'base64', content: Buffer.from(currentContent).toString('base64') }
    }
    throw new Error(`unexpected ${method} ${path}`)
  })

  const result = await writeFilesAtomically({
    api,
    repository: 'o/r',
    branch: 'main',
    mode: 'preserve',
    apply: false,
    message: 'm',
    files: [{
      path: 'a.json',
      content: '{"value":2}\n',
      previousContentSha256: sha256(previousContent),
    }],
  })

  assert.equal(result.planned, 0)
  assert.deepEqual(result.safeUpdates, [])
  assert.deepEqual(result.preservedCollisions, ['a.json'])
})

test('empty repository plus custom branch fails explicitly before bootstrap', async () => {
  const api = new FakeApi((method, path) => {
    if (method === 'GET' && path === '/repos/o/r') return { default_branch: 'main' }
    if (method === 'GET' && path.includes('/git/ref/heads/custom')) { const e = new Error('missing'); e.status = 404; throw e }
    throw new Error(`unexpected ${method} ${path}`)
  })
  await assert.rejects(() => writeFilesAtomically({ api, repository: 'o/r', branch: 'custom', files, message: 'm', apply: true }), /cannot be bootstrapped directly on custom branch/)
  assert.equal(api.calls.some(call => call.method === 'PUT'), false)
})

test('empty main repository bootstraps then removes marker in the atomic migration tree', async () => {
  let refReads = 0
  const api = new FakeApi((method, path, body) => {
    if (method === 'GET' && path === '/repos/o/r') return { default_branch: 'main' }
    if (method === 'GET' && path.includes('/git/ref/heads/main')) {
      refReads += 1
      if (refReads === 1) { const e = new Error('empty'); e.status = 409; throw e }
      return { object: { sha: 'bootstrap-commit' } }
    }
    if (method === 'PUT' && path.endsWith('/contents/.fantazone-migration-bootstrap')) return { content: { sha: 'marker' } }
    if (method === 'GET' && path.endsWith('/git/commits/bootstrap-commit')) return { tree: { sha: 'base-tree' } }
    if (method === 'GET' && path.includes('/git/trees/base-tree')) return { tree: [{ path: '.fantazone-migration-bootstrap', type: 'blob', sha: 'marker' }] }
    if (method === 'POST' && path.endsWith('/git/blobs')) return { sha: `blob-${body.content.length}` }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      assert.equal(body.base_tree, 'base-tree')
      assert.ok(body.tree.some(entry => entry.path === '.fantazone-migration-bootstrap' && entry.sha === null))
      return { sha: 'new-tree' }
    }
    if (method === 'POST' && path.endsWith('/git/commits')) return { sha: 'migration-commit' }
    if (method === 'PATCH' && path.includes('/git/refs/heads/main')) return { object: { sha: 'migration-commit' } }
    throw new Error(`unexpected ${method} ${path}`)
  })
  const result = await writeFilesAtomically({ api, repository: 'o/r', branch: 'main', files: [{ path: 'a.json', content: '{}' }], message: 'm', apply: true })
  assert.equal(result.commit, 'migration-commit')
  assert.equal(result.written, 1)
})

test('failed write after bootstrap cleans the marker best-effort', async () => {
  let refReads = 0
  const api = new FakeApi((method, path) => {
    if (method === 'GET' && path === '/repos/o/r') return { default_branch: 'main' }
    if (method === 'GET' && path.includes('/git/ref/heads/main')) {
      refReads += 1
      if (refReads === 1) { const e = new Error('empty'); e.status = 409; throw e }
      return { object: { sha: 'bootstrap-commit' } }
    }
    if (method === 'PUT' && path.endsWith('/contents/.fantazone-migration-bootstrap')) return {}
    if (method === 'GET' && path.endsWith('/git/commits/bootstrap-commit')) return { tree: { sha: 'base-tree' } }
    if (method === 'POST' && path.endsWith('/git/blobs')) throw new Error('blob upload failed')
    if (method === 'GET' && path.includes('/git/trees/base-tree')) return { tree: [{ path: '.fantazone-migration-bootstrap', type: 'blob', sha: 'marker' }] }
    if (method === 'GET' && path.includes('/contents/.fantazone-migration-bootstrap')) return { sha: 'marker' }
    if (method === 'DELETE' && path.endsWith('/contents/.fantazone-migration-bootstrap')) return {}
    throw new Error(`unexpected ${method} ${path}`)
  })
  await assert.rejects(() => writeFilesAtomically({ api, repository: 'o/r', branch: 'main', files: [{ path: 'a.json', content: '{}' }], message: 'm', apply: true }), /blob upload failed/)
  assert.ok(api.calls.some(call => call.method === 'DELETE' && call.path.endsWith('/contents/.fantazone-migration-bootstrap')))
})
