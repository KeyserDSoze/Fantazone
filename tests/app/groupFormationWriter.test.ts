import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FantaSoccerRole,
  IdentityRole,
  PlayerInTeamStatus,
  Role,
  getPlayerKey,
  type AuthenticatedGroupSession,
  type Calendar,
  type Group,
  type Player,
  type Team,
  type UserOfAGroup,
} from '../../src/domain/src/index'
import {
  GitHubApiError,
  GROUP_DOCUMENT_PATH,
  calendarDocumentPath,
  dayTeamDocumentPath,
  seasonTeamDocumentPath,
  type RepositoryContentClient,
} from '../../src/github/src/index'
import {
  FormationAuthorizationError,
  FormationLockedError,
  FormationValidationError,
} from '../../src/app/services/groupFormationWriter'
import { GroupSessionRuntime } from '../../src/app/services/groupSessionRuntime'

type StoredFile = { sha: string; content: string }
class FakeContentClient implements RepositoryContentClient {
  readonly files = new Map<string, StoredFile>()
  writes = 0
  lastWriteSha: string | undefined
  async tryGetContent(owner: string, repo: string, path: string, ref?: string) {
    return this.files.get(key(owner, repo, path, ref)) ?? null
  }
  async putContent(owner: string, repo: string, path: string, text: string, _message: string, sha?: string, branch?: string) {
    this.writes += 1
    this.lastWriteSha = sha
    const fileKey = key(owner, repo, path, branch)
    const current = this.files.get(fileKey)
    if (current && !sha) throw new GitHubApiError(422, 'file already exists')
    if (current && sha !== current.sha) throw new GitHubApiError(409, 'stale sha')
    if (!current && sha) throw new GitHubApiError(409, 'file disappeared')
    const nextSha = `write-${this.writes}`
    this.files.set(fileKey, { sha: nextSha, content: text })
    return { sha: nextSha }
  }
}

const group: Group = {
  id: 'amici',
  name: 'Amici',
  leagues: [],
  users: [
    { username: 'Owner', email: 'owner@example.com', role: IdentityRole.Participant },
    { username: 'Co', email: 'coowner@example.com', role: IdentityRole.Participant },
    { username: 'Other', email: 'other@example.com', role: IdentityRole.Participant },
    { username: 'Admin', email: 'admin@example.com', role: IdentityRole.Participant | IdentityRole.SuperAdmin },
  ],
  baskets: [{
    id: 'main',
    name: 'Principale',
    years: [{ year: 2026, teams: [{ name: 'Owner Team', owner: 'owner@example.com', additionalOwners: ['coowner@example.com'] }] }],
  }],
}

const calendar: Calendar = {
  year: 2026,
  rounds: {
    '@': [{
      serieADay: 4,
      number: 2,
      games: [{ id: 'game-1', number: 1, home: 'Owner Team', homeOwner: 'owner@example.com', away: 'Away', awayOwner: 'away@example.com', result: null }],
    }],
  },
}

const connection = {
  token: 'token',
  groupName: 'Amici',
  repository: {
    name: 'Fantazone.Amici', full_name: 'KeyserDSoze/Fantazone.Amici', private: true,
    owner: { login: 'KeyserDSoze' }, default_branch: 'main',
  },
}

function put(client: FakeContentClient, path: string, value: unknown, sha = `sha-${path}`) {
  client.files.set(key('KeyserDSoze', 'Fantazone.Amici', path, 'main'), { sha, content: JSON.stringify(value) })
}

async function fixture(includeDay = false) {
  const client = new FakeContentClient()
  const team = makeTeam()
  put(client, GROUP_DOCUMENT_PATH, group)
  put(client, calendarDocumentPath('league-a', 2026), calendar)
  put(client, seasonTeamDocumentPath('main', 2026, 'owner@example.com'), team, 'sha-season')
  if (includeDay) put(client, dayTeamDocumentPath('main', 2026, 4, 'owner@example.com'), team, 'sha-day')
  return { client, team, runtime: await GroupSessionRuntime.open(connection, client) }
}

function session(email: string): AuthenticatedGroupSession {
  const member = group.users.find(user => user.email === email) as UserOfAGroup
  return { group, member, identity: { provider: 'microsoft', subject: email, email } }
}

const swap = [
  { playerKey: getPlayerKey('Fwd starter 1'), position: FantaSoccerRole.Tribune },
  { playerKey: getPlayerKey('Fwd tribune 1'), position: FantaSoccerRole.Forward },
]

test('creates TeamDay from the season Team and changes only formation positions', async () => {
  const { client, runtime } = await fixture()
  const result = await runtime.formationWriter.saveGameFormation({
    session: session('owner@example.com'), leagueId: 'league-a', season: 2026, gameId: 'game-1',
    owner: 'owner@example.com', nextSerieADay: 4, positions: swap,
  })
  assert.equal(result.source, 'season-fallback')
  assert.equal(client.lastWriteSha, undefined)
  const day = JSON.parse(client.files.get(key('KeyserDSoze', 'Fantazone.Amici', dayTeamDocumentPath('main', 2026, 4, 'owner@example.com'), 'main'))!.content) as Team
  assert.equal(day.players.find(player => player.name === 'Fwd starter 1')?.position, FantaSoccerRole.Tribune)
  assert.equal(day.players.find(player => player.name === 'Fwd starter 1')?.price, 10)
  assert.ok(day.lastUpdate)
  const season = JSON.parse(client.files.get(key('KeyserDSoze', 'Fantazone.Amici', seasonTeamDocumentPath('main', 2026, 'owner@example.com'), 'main'))!.content) as Team
  assert.equal(season.players.find(player => player.name === 'Fwd starter 1')?.position, FantaSoccerRole.Forward)
  assert.equal(season.lastUpdate, null)
})

test('updates an existing TeamDay with its freshly-read SHA', async () => {
  const { client, runtime } = await fixture(true)
  const result = await runtime.formationWriter.saveGameFormation({
    session: session('coowner@example.com'), leagueId: 'league-a', season: 2026, gameId: 'game-1',
    owner: 'owner@example.com', nextSerieADay: 4, positions: swap,
  })
  assert.equal(result.source, 'day')
  assert.equal(client.lastWriteSha, 'sha-day')
})

test('rejects a member that is neither owner nor additional owner', async () => {
  const { runtime } = await fixture()
  await assert.rejects(
    runtime.formationWriter.saveGameFormation({
      session: session('other@example.com'), leagueId: 'league-a', season: 2026, gameId: 'game-1',
      owner: 'owner@example.com', nextSerieADay: 4, positions: swap,
    }),
    FormationAuthorizationError,
  )
})

test('rejects a locked day for a normal owner', async () => {
  const { runtime } = await fixture(true)
  await assert.rejects(
    runtime.formationWriter.saveGameFormation({
      session: session('owner@example.com'), leagueId: 'league-a', season: 2026, gameId: 'game-1',
      owner: 'owner@example.com', nextSerieADay: 5, positions: swap,
    }),
    FormationLockedError,
  )
})

test('allows an explicit SuperAdmin override only for the live Serie A day', async () => {
  const { runtime } = await fixture(true)
  const saved = await runtime.formationWriter.saveGameFormation({
    session: session('admin@example.com'), leagueId: 'league-a', season: 2026, gameId: 'game-1',
    owner: 'owner@example.com', nextSerieADay: 5, liveSerieADay: 4, asAdmin: true, positions: swap,
  })
  assert.equal(saved.serieADay, 4)
})

test('rejects an invalid position-only payload before writing GitHub', async () => {
  const { client, runtime } = await fixture(true)
  await assert.rejects(
    runtime.formationWriter.saveGameFormation({
      session: session('owner@example.com'), leagueId: 'league-a', season: 2026, gameId: 'game-1', owner: 'owner@example.com',
      nextSerieADay: 4,
      positions: [{ playerKey: getPlayerKey('Fwd starter 1'), position: FantaSoccerRole.Tribune }],
    }),
    FormationValidationError,
  )
  assert.equal(client.writes, 0)
})

function makeTeam(): Team {
  const players: Player[] = []
  add(players, 'GK starter', Role.GoalKeeper, FantaSoccerRole.GoalKeeper, 1)
  add(players, 'GK backup', Role.GoalKeeper, FantaSoccerRole.BackupGoalKeeper, 1)
  add(players, 'Def starter', Role.Defensor, FantaSoccerRole.Defensor, 3)
  add(players, 'Def backup 1', Role.Defensor, FantaSoccerRole.FirstBackupDefensor, 1)
  add(players, 'Def backup 2', Role.Defensor, FantaSoccerRole.SecondBackupDefensor, 1)
  add(players, 'Def tribune', Role.Defensor, FantaSoccerRole.Tribune, 3)
  add(players, 'Mid starter', Role.Midfielder, FantaSoccerRole.Midfielder, 4)
  add(players, 'Mid backup 1', Role.Midfielder, FantaSoccerRole.FirstBackupMidfielder, 1)
  add(players, 'Mid backup 2', Role.Midfielder, FantaSoccerRole.SecondBackupMidfielder, 1)
  add(players, 'Mid tribune', Role.Midfielder, FantaSoccerRole.Tribune, 2)
  add(players, 'Fwd starter', Role.Forward, FantaSoccerRole.Forward, 3)
  add(players, 'Fwd backup 1', Role.Forward, FantaSoccerRole.FirstBackupForward, 1)
  add(players, 'Fwd backup 2', Role.Forward, FantaSoccerRole.SecondBackupForward, 1)
  add(players, 'Fwd tribune', Role.Forward, FantaSoccerRole.Tribune, 2)
  players.push(player('Sold player', Role.Forward, FantaSoccerRole.Tribune, PlayerInTeamStatus.Sold))
  return { name: 'Owner Team', owner: 'owner@example.com', additionalOwners: ['coowner@example.com'], players, moneyFromRank: 0, lastUpdate: null }
}

function add(target: Player[], prefix: string, role: Role, position: FantaSoccerRole, count: number) {
  for (let index = 1; index <= count; index += 1) target.push(player(`${prefix} ${index}`, role, position))
}

function player(name: string, role: Role, position: FantaSoccerRole, status = PlayerInTeamStatus.Active): Player {
  return { name, team: { name: 'Roma', abbreviation: 'ROM' }, role, isActive: true, visible: true, price: 10, revenue: 10, status, position }
}

function key(owner: string, repo: string, path: string, ref?: string) {
  return `${owner}/${repo}/${path}@${ref ?? ''}`
}
