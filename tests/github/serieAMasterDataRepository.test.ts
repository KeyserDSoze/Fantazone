import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GitHubJsonStore,
  GitHubRealPlayersRepository,
  GitHubRealTeamsRepository,
  realPlayersDocumentPath,
  realTeamsDocumentPath,
  type RepositoryContentClient,
} from '../../src/github/src/index'
import { Role, type RealPlayers, type RealTeams } from '../../src/domain/src/index'

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
const teams: RealTeams = {
  year: 15,
  teams: [
    { name: 'Inter', abbreviation: 'int' },
    { name: 'Roma', abbreviation: 'rom' },
  ],
}
const players: RealPlayers = {
  year: 15,
  players: [{
    name: 'Mario Rossi',
    team: teams.teams[1],
    role: Role.Forward,
    isActive: true,
    visible: true,
  }],
}

test('uses global readable paths outside group repository state', () => {
  assert.equal(realTeamsDocumentPath(15), 'data/serie-a/teams/15.json')
  assert.equal(realPlayersDocumentPath(15), 'data/serie-a/players/15.json')
})

test('reads and caches readable RealTeams and RealPlayers documents', async () => {
  const client = new FakeContentClient()
  client.files.set(key(target.owner, target.repo, realTeamsDocumentPath(15), target.ref), {
    sha: 'teams-sha',
    content: JSON.stringify(teams),
  })
  client.files.set(key(target.owner, target.repo, realPlayersDocumentPath(15), target.ref), {
    sha: 'players-sha',
    content: JSON.stringify(players),
  })
  const store = new GitHubJsonStore(client)
  const teamRepository = new GitHubRealTeamsRepository(store, target)
  const playerRepository = new GitHubRealPlayersRepository(store, target)

  assert.equal((await teamRepository.getTeamsSnapshot(15))?.value.teams[0].name, 'Inter')
  assert.equal((await teamRepository.getTeamsSnapshot(15))?.fromCache, true)
  assert.equal((await playerRepository.getPlayersSnapshot(15))?.value.players[0].name, 'Mario Rossi')
  assert.equal((await playerRepository.getPlayersSnapshot(15))?.fromCache, true)
})

test('writes readable schema-v2 master data for Actions and rejects compact legacy wrappers', async () => {
  const client = new FakeContentClient()
  const store = new GitHubJsonStore(client)
  const teamRepository = new GitHubRealTeamsRepository(store, target)
  const playerRepository = new GitHubRealPlayersRepository(store, target)

  await teamRepository.writeTeams(teams)
  await playerRepository.writePlayers(players)

  const storedTeams = JSON.parse(client.files.get(key(target.owner, target.repo, realTeamsDocumentPath(15), target.ref))!.content)
  const storedPlayers = JSON.parse(client.files.get(key(target.owner, target.repo, realPlayersDocumentPath(15), target.ref))!.content)
  assert.equal(storedTeams.teams[0].abbreviation, 'int')
  assert.equal(storedPlayers.players[0].team.name, 'Roma')
  assert.equal('t' in storedTeams, false)
  assert.equal('p' in storedPlayers, false)

  client.files.set(key(target.owner, target.repo, realPlayersDocumentPath(16), target.ref), {
    sha: 'legacy',
    content: JSON.stringify({ p: [] }),
  })
  await assert.rejects(playerRepository.getPlayers(16), /readable schema v2/)
})

function key(owner: string, repo: string, path: string, ref?: string) {
  return `${owner}/${repo}/${path}@${ref ?? ''}`
}
