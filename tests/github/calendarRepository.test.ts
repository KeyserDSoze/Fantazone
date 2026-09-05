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
  readonly files = new Map<string, { sha: string; content: string }>()
  reads = 0
  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    this.reads += 1
    return this.files.get(`${owner}/${repo}/${path}@${ref ?? ''}`) ?? null
  }
  async putContent(): Promise<{ sha: string }> { throw new Error('Calendar read tests must not write') }
}

const calendar: Calendar = {
  year: 15,
  rounds: {
    league: [{
      serieADay: 3,
      number: 1,
      games: [
        { id: 'done', number: 1, home: 'Alpha', homeOwner: 'one', away: 'Beta', awayOwner: 'two', result: {
          home: { value: 70, defensiveBonus: false, goodPeople: false, ownGoal: false },
          away: { value: 60, defensiveBonus: false, goodPeople: false, ownGoal: false },
          isCancelled: false, homeGoals: 1, awayGoals: 0,
        } },
        { id: 'pending', number: 2, home: 'Gamma', homeOwner: 'three', away: 'Delta', awayOwner: 'four', result: null },
      ],
    }],
  },
}

test('builds a canonical repository-per-group calendar path', () => {
  assert.equal(calendarDocumentPath('serie-a', 15), 'data/groups/seasons/15/leagues/serie-a/calendar.json')
  assert.throws(() => calendarDocumentPath('', 15))
  assert.throws(() => calendarDocumentPath('serie-a', 0))
})

test('reads the readable Calendar document directly through GitHubJsonStore', async () => {
  const client = new FakeContentClient()
  const path = calendarDocumentPath('serie-a', 15)
  client.files.set(`KeyserDSoze/Fantazone.Demo/${path}@main`, { sha: 'calendar-sha', content: JSON.stringify(calendar) })
  const repository = new GitHubCalendarRepository(new GitHubJsonStore(client), { owner: 'KeyserDSoze', repo: 'Fantazone.Demo', ref: 'main' })

  assert.equal((await repository.getCalendar('serie-a', 15))?.year, 15)
  assert.deepEqual((await repository.getPendingGames('serie-a', 15)).map(game => game.id), ['pending'])
  assert.deepEqual((await repository.getGamesForTeam('serie-a', 15, 'alpha')).map(game => game.id), ['done'])
  assert.equal(client.reads, 1)
})
