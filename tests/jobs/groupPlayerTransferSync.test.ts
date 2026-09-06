import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  FantaSoccerRole,
  PlayerInTeamStatus,
  Role,
  type Group,
  type RealPlayers,
  type Team,
} from '../../src/domain/src/index'
import {
  GROUP_DOCUMENT_PATH,
  dayTeamDocumentPath,
  realPlayersDocumentPath,
  seasonTeamDocumentPath,
} from '../../src/github/src/index'
import { syncGroupPlayerTransfers } from '../../src/jobs/src/groupPlayerTransferSync'

const YEAR = 15
const OWNER = 'owner@example.com'
const BASKET = 'basket-a'

test('updates current canonical Teams from global RealPlayers but never rewrites frozen TeamDay snapshots', async () => {
  const groupRoot = await mkdtemp(join(tmpdir(), 'fantazone-transfer-group-'))
  const platformRoot = await mkdtemp(join(tmpdir(), 'fantazone-transfer-platform-'))
  await writeJson(join(groupRoot, GROUP_DOCUMENT_PATH), group())
  await writeJson(join(groupRoot, 'manifest.json'), { revision: 7, updating: false })
  await writeJson(join(platformRoot, realPlayersDocumentPath(YEAR)), master())

  const currentPath = join(groupRoot, seasonTeamDocumentPath(BASKET, YEAR, OWNER))
  const frozenPath = join(groupRoot, dayTeamDocumentPath(BASKET, YEAR, 1, OWNER))
  await writeJson(currentPath, team('Roma'))
  await writeJson(frozenPath, team('Roma'))

  const result = await syncGroupPlayerTransfers({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: YEAR })
  assert.deepEqual(result, {
    deferred: false,
    season: YEAR,
    inspectedTeams: 1,
    changedTeams: 1,
    changedPlayers: 1,
    missingTeams: 0,
  })

  const current = await readJson<Team>(currentPath)
  const frozen = await readJson<Team>(frozenPath)
  assert.equal(current.players[0].team.name, 'Milan')
  assert.equal(current.lastUpdate, '2026-09-01T10:00:00.000Z')
  assert.equal(frozen.players[0].team.name, 'Roma')
})

test('is a no-op for missing teams and defers while client manifest update is in progress', async () => {
  const groupRoot = await mkdtemp(join(tmpdir(), 'fantazone-transfer-group-'))
  const platformRoot = await mkdtemp(join(tmpdir(), 'fantazone-transfer-platform-'))
  await writeJson(join(groupRoot, GROUP_DOCUMENT_PATH), group())
  await writeJson(join(platformRoot, realPlayersDocumentPath(YEAR)), master())

  const missing = await syncGroupPlayerTransfers({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: YEAR })
  assert.equal(missing.inspectedTeams, 1)
  assert.equal(missing.missingTeams, 1)
  assert.equal(missing.changedTeams, 0)

  await writeJson(join(groupRoot, 'manifest.json'), { revision: 8, updating: true })
  const deferred = await syncGroupPlayerTransfers({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: YEAR })
  assert.deepEqual(deferred, {
    deferred: true,
    season: YEAR,
    inspectedTeams: 0,
    changedTeams: 0,
    changedPlayers: 0,
    missingTeams: 0,
  })
})

test('does not touch sold players or teams outside the requested season', async () => {
  const groupRoot = await mkdtemp(join(tmpdir(), 'fantazone-transfer-group-'))
  const platformRoot = await mkdtemp(join(tmpdir(), 'fantazone-transfer-platform-'))
  const value = group()
  value.baskets[0].years.push({ year: YEAR - 1, teams: [{ name: 'Old Team', owner: 'old@example.com', additionalOwners: [] }] })
  await writeJson(join(groupRoot, GROUP_DOCUMENT_PATH), value)
  await writeJson(join(platformRoot, realPlayersDocumentPath(YEAR)), master())

  const current = team('Roma')
  current.players[0].status = PlayerInTeamStatus.Sold
  const path = join(groupRoot, seasonTeamDocumentPath(BASKET, YEAR, OWNER))
  await writeJson(path, current)

  const result = await syncGroupPlayerTransfers({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: YEAR })
  assert.equal(result.inspectedTeams, 1)
  assert.equal(result.changedTeams, 0)
  assert.equal((await readJson<Team>(path)).players[0].team.name, 'Roma')
})

function group(): Group {
  return {
    id: 'g',
    name: 'Group',
    users: [],
    leagues: [],
    baskets: [{
      id: BASKET,
      name: 'Basket',
      years: [{ year: YEAR, teams: [{ name: 'Team', owner: OWNER, additionalOwners: [] }] }],
    }],
  }
}

function master(): RealPlayers {
  return {
    year: YEAR,
    players: [{
      name: 'Mario Rossi',
      team: { name: 'Milan', abbreviation: 'mil' },
      role: Role.Forward,
      isActive: true,
      visible: true,
    }],
  }
}

function team(realTeam: string): Team {
  return {
    name: 'Team',
    owner: OWNER,
    additionalOwners: [],
    moneyFromRank: 0,
    lastUpdate: '2026-09-01T10:00:00.000Z',
    players: [{
      name: 'Mario Rossi',
      team: { name: realTeam, abbreviation: realTeam.slice(0, 3).toLowerCase() },
      role: Role.Forward,
      isActive: true,
      visible: true,
      price: 10,
      revenue: 0,
      status: PlayerInTeamStatus.Active,
      position: FantaSoccerRole.Tribune,
    }],
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}
