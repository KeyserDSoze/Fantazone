import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'

test('builds one deterministic gzip pack with Git blob SHAs for every valid repository JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'fantazone-group-pack-'))
  try {
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
    mkdirSync(join(root, 'config'), { recursive: true })
    mkdirSync(join(root, 'data', 'groups'), { recursive: true })
    writeFileSync(join(root, 'config', 'group.json'), '{"name":"Amici"}\n')
    writeFileSync(join(root, 'data', 'groups', 'rank.json'), '{"rank":[1,2,3]}\n')
    writeFileSync(join(root, 'data', 'broken.json'), '{broken')

    const script = resolve(process.cwd(), 'scripts/build-group-offline-pack.mjs')
    execFileSync(process.execPath, [script, root], { stdio: 'ignore' })
    const first = readFileSync(join(root, '.fantazone', 'offline', 'group-snapshot.json.gz'))
    execFileSync(process.execPath, [script, root], { stdio: 'ignore' })
    const second = readFileSync(join(root, '.fantazone', 'offline', 'group-snapshot.json.gz'))

    assert.deepEqual(second, first, 'unchanged JSON content must produce the same gzip pack')

    const pack = JSON.parse(gunzipSync(first).toString('utf8')) as {
      version: number
      files: Record<string, { sha: string; value: unknown; bytes: number }>
    }
    assert.equal(pack.version, 1)
    assert.deepEqual(Object.keys(pack.files), ['config/group.json', 'data/groups/rank.json'])
    assert.deepEqual(pack.files['config/group.json'].value, { name: 'Amici' })
    assert.deepEqual(pack.files['data/groups/rank.json'].value, { rank: [1, 2, 3] })
    assert.match(pack.files['config/group.json'].sha, /^[0-9a-f]{40}$/)
    assert.match(pack.files['data/groups/rank.json'].sha, /^[0-9a-f]{40}$/)
    assert.equal(pack.files['config/group.json'].bytes, Buffer.byteLength('{"name":"Amici"}\n'))
    assert.equal(pack.files['data/groups/rank.json'].bytes, Buffer.byteLength('{"rank":[1,2,3]}\n'))
    assert.equal('data/broken.json' in pack.files, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
