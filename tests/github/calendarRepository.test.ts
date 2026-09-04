import assert from 'node:assert/strict'
import test from 'node:test'
import type { CalendarRaw } from '../../src/domain/src/index'
import {
  calendarDocumentPath,
  GitHubCalendarRepository,
  GitHubJsonStore,
  type RepositoryContentClient,
} from '../../src/github/src/index'

class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, { sha: string; content: string }>()
  reads = 0

  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    this.reads += 1
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }

  async putContent(): Promise<{ sha: string }> {
    throw new Error('Calendar read tests must not write')
  }
}

const raw: CalendarRaw = {
  y: 15,
  r: {
    league: [
      {
        a: 3,
        n: 1,
        g: [
          { i: 'done', n: 1, h: 'Alpha', o: 'one', a: 'Beta', u: 'two', r: {
            h: { v: 70, d: false, g: false, o: false },
            a: { v: 60, d: false, g: false, o: false },
            i: false,
            g: 1,
            l: 0,
          } },
          { i: 'pending', n: 2, h: 'Gamma', o: 'three', a: 'Delta', u: 'four', r: null },
        ],
      },
    ],
  },
}

test('builds a canonical repository-per-group calendar path', () => {
  assert.equal(
    calendarDocumentPath('serie-a', 15),
    'data/groups/seasons/15/leagues/serie-a/calendar.json',
  )
  assert.throws(() => calendarDocumentPath('', 15))
  assert.throws(() => calendarDocumentPath('serie-a', 0))
})

test('replaces legacy Calendar repository reads with GitHubJsonStore', async () => {
  const client = new FakeContentClient()
  const path = calendarDocumentPath('serie-a', 15)
  client.files.set(`KeyserDSoze/Fantazone.Demo/${path}@main`, {
    sha: 'calendar-sha',
    content: JSON.stringify(raw),
  })
  const repository = new GitHubCalendarRepository(new GitHubJsonStore(client), {
    owner: 'KeyserDSoze',
    repo: 'Fantazone.Demo',
    ref: 'main',
  })

  const calendar = await repository.getCalendar('serie-a', 15)
  const pending = await repository.getPendingGames('serie-a', 15)
  const alphaGames = await repository.getGamesForTeam('serie-a', 15, 'alpha')

  assert.equal(calendar?.year, 15)
  assert.deepEqual(pending.map(game => game.id), ['pending'])
  assert.deepEqual(alphaGames.map(game => game.id), ['done'])
  assert.equal(client.reads, 1, 'subsequent helper queries should reuse the JSON store cache')
})
