import test from 'node:test'
import assert from 'node:assert/strict'
import { selectFilesForCollisionMode } from '../../scripts/migration/github-writer.mjs'

const files = [{ path: 'a.json', content: '{}' }, { path: 'b.json', content: '{}' }]
const existing = new Map([['a.json', 'sha-a']])

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

import { writeFilesAtomically } from '../../scripts/migration/github-writer.mjs'

class FakeApi {
  constructor(handler) { this.handler = handler; this.calls = [] }
  async request(method, path, body) { this.calls.push({ method, path, body }); return this.handler(method, path, body, this.calls) }
}

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
    if (method === 'GET' && path.includes('/git/trees/base-tree')) return { tree: [{ path: '.fantazone-migration-bootstrap', type: 'blob', sha: 'marker' }] }
    if (method === 'POST' && path.endsWith('/git/blobs')) throw new Error('blob upload failed')
    if (method === 'GET' && path.includes('/contents/.fantazone-migration-bootstrap')) return { sha: 'marker' }
    if (method === 'DELETE' && path.endsWith('/contents/.fantazone-migration-bootstrap')) return {}
    throw new Error(`unexpected ${method} ${path}`)
  })
  await assert.rejects(() => writeFilesAtomically({ api, repository: 'o/r', branch: 'main', files: [{ path: 'a.json', content: '{}' }], message: 'm', apply: true }), /blob upload failed/)
  assert.ok(api.calls.some(call => call.method === 'DELETE' && call.path.endsWith('/contents/.fantazone-migration-bootstrap')))
})
