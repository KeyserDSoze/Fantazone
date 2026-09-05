import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GitHubJsonStore,
  GitHubSerieAVoteRepository,
  GitHubStatPlayersRepository,
  serieAVoteDocumentPath,
  statPlayersDocumentPath,
  type RepositoryContentClient,
} from '../../src/github/src/index'
import {
  Role,
  createEmptyVote,
  type StatPlayers,
  type VotedRealPlayers,
} from '../../src/domain/src/index'

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
const votes: VotedRealPlayers = {
  year: 15,
  serieADay: 2,
  players: [{
    name: 'Mario Rossi',
    team: { name: 'Roma', abbreviation: 'rom' },
    role: Role.Forward,
    isActive: true,
    visible: true,
    vote: { ...createEmptyVote(Role.Forward), value: 6.5, hasVote: true, isFinal: true, goal: 1 },
  }],
}
const stats: StatPlayers = {
  year: 15,
  untilSerieADay: 2,
  players: [{
    ...votes.players[0],
    summatory: 6.5,
    fantaSummatory: 9.5,
    withVote: 1,
    withoutVote: 0,
    noPlayed: 1,
    withSpecial: 0,
    goals: 1,
    penalties: 0,
    assists: 0,
    stoppedPenalties: 0,
    sufferedGoals: 0,
    wrongedPenalties: 0,
    ownGoals: 0,
    yellowCards: 0,
    redCards: 0,
    enoughVotes: 1,
    manOfTheMatch: 0,
    injured: 0,
    games: [
      { serieADay: 2, vote: 6.5, positiveness: 2 },
      { serieADay: 1, vote: null, positiveness: -2 },
    ],
  }],
}
delete (stats.players[0] as { vote?: unknown }).vote

test('uses self-describing global vote and stats paths', () => {
  assert.equal(serieAVoteDocumentPath('official', 15, 2), 'data/serie-a/votes/official/15/2.json')
  assert.equal(serieAVoteDocumentPath('live', 15, 2), 'data/serie-a/votes/live/15/2.json')
  assert.equal(statPlayersDocumentPath(15), 'data/serie-a/stats/15.json')
})

test('reads/writes readable official votes and stats through shared GitHub JSON store', async () => {
  const client = new FakeContentClient()
  const store = new GitHubJsonStore(client)
  const voteRepository = new GitHubSerieAVoteRepository(store, target, 'official')
  const statsRepository = new GitHubStatPlayersRepository(store, target)

  await voteRepository.writeVotes(votes)
  await statsRepository.writeStats(stats)

  assert.equal((await voteRepository.getVotes(15, 2))?.players[0].vote?.goal, 1)
  assert.equal((await statsRepository.getStats(15))?.players[0].fantaSummatory, 9.5)

  const storedVote = JSON.parse(client.files.get(key(target.owner, target.repo, serieAVoteDocumentPath('official', 15, 2), target.ref))!.content)
  const storedStats = JSON.parse(client.files.get(key(target.owner, target.repo, statPlayersDocumentPath(15), target.ref))!.content)
  assert.equal(storedVote.players[0].vote.hasVote, true)
  assert.equal(storedStats.players[0].games[0].serieADay, 2)
  assert.equal('p' in storedVote, false)
})

test('rejects compact or mismatched vote/stat documents', async () => {
  const client = new FakeContentClient()
  client.files.set(key(target.owner, target.repo, serieAVoteDocumentPath('official', 15, 1), target.ref), {
    sha: 'legacy-vote', content: JSON.stringify({ p: [] }),
  })
  client.files.set(key(target.owner, target.repo, statPlayersDocumentPath(15), target.ref), {
    sha: 'legacy-stats', content: JSON.stringify({ p: [] }),
  })
  const store = new GitHubJsonStore(client)
  await assert.rejects(new GitHubSerieAVoteRepository(store, target, 'official').getVotes(15, 1), /readable schema v2/)
  await assert.rejects(new GitHubStatPlayersRepository(store, target).getStats(15), /readable schema v2/)
})

function key(owner: string, repo: string, path: string, ref?: string) {
  return `${owner}/${repo}/${path}@${ref ?? ''}`
}
