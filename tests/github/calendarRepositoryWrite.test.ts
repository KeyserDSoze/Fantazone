import assert from 'node:assert/strict'
import test from 'node:test'
import type { Calendar } from '../../src/domain/src/index'
import {
  calendarDocumentPath,
  GitHubCalendarRepository,
  GitHubJsonStore,
  type RepositoryContentClient,
} from '../../src/github/src/index'

class FakeContentClient implements RepositoryContentClient {
  files = new Map<string, { sha: string; content: string }>()
  writes: Array<{ owner: string; repo: string; path: string; text: string; message: string; sha?: string; branch?: string }> = []

  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }

  async putContent(owner: string, repo: string, path: string, text: string, message: string, sha?: string, branch?: string) {
    this.writes.push({ owner, repo, path, text, message, sha, branch })
    const next = { sha: `sha-${this.writes.length}`, content: text }
    this.files.set(`${owner}/${repo}/${path}@${branch ?? 'main'}`, next)
    return { sha: next.sha }
  }
}

const calendar: Calendar = {
  year: 2026,
  rounds: {
    '@': [{ number: 1, serieADay: 3, games: [{ id: 'g1', number: 1, home: 'A', homeOwner: 'a', away: 'B', awayOwner: 'b', result: null }] }],
  },
}

test('writes the canonical calendar document with optimistic create semantics when requested', async () => {
  const client = new FakeContentClient()
  const repository = new GitHubCalendarRepository(
    new GitHubJsonStore(client),
    { owner: 'KeyserDSoze', repo: 'Fantazone.Demo', ref: 'main' },
  )
  const sha = await repository.writeCalendar('league-a', 2026, calendar, 'calendar: initialize', { createOnly: true })
  assert.equal(sha, 'sha-1')
  assert.equal(client.writes.length, 1)
  assert.equal(client.writes[0].path, calendarDocumentPath('league-a', 2026))
  assert.equal(client.writes[0].message, 'calendar: initialize')
  assert.deepEqual(JSON.parse(client.writes[0].text), calendar)
})
