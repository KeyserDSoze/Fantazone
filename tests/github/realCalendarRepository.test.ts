import assert from 'node:assert/strict'
import test from 'node:test'
import { GitHubJsonStore, GitHubRealCalendarRepository, realCalendarDocumentPath, type RepositoryContentClient } from '../../src/github/src/index'
import type { RealCalendar } from '../../src/domain/src/index'

type StoredFile = { sha: string; content: string }

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, StoredFile>()
  writes = 0

  async tryGetContent(owner: string, repo: string, path: string, ref?: string): Promise<StoredFile | null> {
    return this.files.get(key(owner, repo, path, ref)) ?? null
  }

  async putContent(owner: string, repo: string, path: string, text: string, _message: string, sha?: string, branch?: string) {
    this.writes += 1
    const fileKey = key(owner, repo, path, branch)
    const current = this.files.get(fileKey)
    if (current && current.sha !== sha) throw new Error('stale sha')
    const next = { sha: `sha-${this.writes + 1}`, content: text }
    this.files.set(fileKey, next)
    return { sha: next.sha }
  }
}

const target = { owner: 'KeyserDSoze', repo: 'Fantazone', ref: 'main' }
const calendar: RealCalendar = {
  year: 2026,
  days: [{
    year: 2026,
    serieADay: 1,
    games: [{
      home: { name: 'Roma', abbreviation: 'ROM' },
      away: { name: 'Inter', abbreviation: 'INT' },
      date: '2026-08-22T18:45:00Z',
      homeGoals: null,
      awayGoals: null,
      delayed: false,
    }],
  }],
}

test('stores shared Serie A calendars outside every group repository namespace', () => {
  assert.equal(realCalendarDocumentPath(2026), 'data/serie-a/calendars/2026.json')
})

test('reads readable schema-v2 RealCalendar through the shared JSON cache', async () => {
  const client = new FakeContentClient()
  client.files.set(key(target.owner, target.repo, realCalendarDocumentPath(2026), target.ref), {
    sha: 'sha-1',
    content: JSON.stringify(calendar),
  })
  const repository = new GitHubRealCalendarRepository(new GitHubJsonStore(client), target)

  const first = await repository.getCalendarSnapshot(2026)
  const second = await repository.getCalendarSnapshot(2026)

  assert.equal(first?.value.days[0].games[0].home.name, 'Roma')
  assert.equal(first?.fromCache, false)
  assert.equal(second?.fromCache, true)
})

test('rejects compact legacy RealCalendar JSON instead of keeping a permanent mapper', async () => {
  const client = new FakeContentClient()
  client.files.set(key(target.owner, target.repo, realCalendarDocumentPath(2026), target.ref), {
    sha: 'sha-old',
    content: JSON.stringify({ y: 2026, d: [] }),
  })
  const repository = new GitHubRealCalendarRepository(new GitHubJsonStore(client), target)

  await assert.rejects(repository.getCalendar(2026), /schema v2 requires readable property names/)
})

test('writes the same readable domain contract for ingestion jobs', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubRealCalendarRepository(new GitHubJsonStore(client), target)
  await repository.writeCalendar(calendar, 'test: write real calendar')
  const stored = client.files.get(key(target.owner, target.repo, realCalendarDocumentPath(2026), target.ref))
  assert.ok(stored)
  const json = JSON.parse(stored.content)
  assert.equal(json.days[0].serieADay, 1)
  assert.equal(json.days[0].games[0].home.name, 'Roma')
  assert.equal('y' in json, false)
})

function key(owner: string, repo: string, path: string, ref?: string) {
  return `${owner}/${repo}/${path}@${ref ?? ''}`
}
