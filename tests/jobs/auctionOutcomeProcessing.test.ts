import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  AuctionKind,
  DefaultLeagueSetting,
  IdentityRole,
  LeagueType,
  PlayerInTeamStatus,
  Role,
  type AuctionAssignmentOutcome,
  type Group,
  type RealPlayers,
  type SeasonTeamDocument,
  type Team,
} from '../../src/domain/src/index'
import {
  GROUP_DOCUMENT_PATH,
  auctionAssignmentOutcomeDocumentPath,
  realPlayersDocumentPath,
  seasonTeamDocumentPath,
} from '../../src/github/src/index'
import { processAuctionOutcomes } from '../../src/jobs/src/auctionOutcomeProcessing'

const SEASON = 15
const HOST = 'host@example.com'
const ALICE = 'alice@example.com'

async function fixture() {
  const groupRepoRoot = await mkdtemp(join(tmpdir(), 'fantazone-auction-group-'))
  const platformRepoRoot = await mkdtemp(join(tmpdir(), 'fantazone-auction-platform-'))
  await writeJson(join(groupRepoRoot, 'manifest.json'), { schemaVersion: 2, revision: 1, updating: false })
  await writeJson(join(groupRepoRoot, GROUP_DOCUMENT_PATH), group())
  await writeJson(join(groupRepoRoot, seasonTeamDocumentPath('main', SEASON, ALICE)), emptyTeam())
  const master: RealPlayers = {
    year: SEASON,
    players: [
      { name: 'Star Forward', team: { name: 'Roma', abbreviation: 'ROM' }, role: Role.Forward, isActive: true, visible: true },
      { name: 'Second Forward', team: { name: 'Milan', abbreviation: 'MIL' }, role: Role.Forward, isActive: true, visible: true },
    ],
  }
  await writeJson(join(platformRepoRoot, realPlayersDocumentPath(SEASON)), master)
  return { groupRepoRoot, platformRepoRoot }
}

test('applies pending outcomes in order so later assignments see earlier canonical roster changes', async () => {
  const roots = await fixture()
  const firstPath = auctionAssignmentOutcomeDocumentPath(SEASON, 'auction-1', 3)
  const secondPath = auctionAssignmentOutcomeDocumentPath(SEASON, 'auction-1', 6)
  await writeJson(join(roots.groupRepoRoot, firstPath), outcome(3, 'starforward', 25, '2026-09-06T16:00:03Z'))
  await writeJson(join(roots.groupRepoRoot, secondPath), outcome(6, 'secondforward', 30, '2026-09-06T16:01:03Z'))

  const result = await processAuctionOutcomes({ ...roots, season: SEASON, now: new Date('2026-09-06T17:00:00Z') })

  assert.deepEqual(result, {
    deferred: false,
    season: SEASON,
    processedOutcomes: 2,
    appliedOutcomes: 2,
    rejectedOutcomes: 0,
    changedTeams: 1,
  })
  const team = await readJson<SeasonTeamDocument>(join(roots.groupRepoRoot, seasonTeamDocumentPath('main', SEASON, ALICE)))
  assert.equal(team.version, 3)
  assert.deepEqual(team.players.map(player => player.playerKey), ['starforward', 'secondforward'])
  assert.equal(team.players[0].status, PlayerInTeamStatus.Active)
  assert.equal(team.players[1].price, 30)
  assert.equal('team' in team.players[0], false)
  assert.equal((await readJson<AuctionAssignmentOutcome>(join(roots.groupRepoRoot, firstPath))).status, 'applied')
  assert.equal((await readJson<AuctionAssignmentOutcome>(join(roots.groupRepoRoot, secondPath))).status, 'applied')
})

test('rejects a forged participant actor without touching the canonical team', async () => {
  const roots = await fixture()
  const path = auctionAssignmentOutcomeDocumentPath(SEASON, 'auction-1', 3)
  await writeJson(join(roots.groupRepoRoot, path), outcome(3, 'starforward', 25, '2026-09-06T16:00:03Z', ALICE))

  const result = await processAuctionOutcomes({ ...roots, season: SEASON, now: new Date('2026-09-06T17:00:00Z') })
  assert.equal(result.appliedOutcomes, 0)
  assert.equal(result.rejectedOutcomes, 1)
  assert.equal((await readJson<Team>(join(roots.groupRepoRoot, seasonTeamDocumentPath('main', SEASON, ALICE)))).players.length, 0)
  const rejected = await readJson<AuctionAssignmentOutcome>(join(roots.groupRepoRoot, path))
  assert.equal(rejected.status, 'rejected')
  assert.match(rejected.result?.message ?? '', /Admin|SuperAdmin/)
})

test('defers while repository revision is updating and leaves pending outcome untouched', async () => {
  const roots = await fixture()
  await writeJson(join(roots.groupRepoRoot, 'manifest.json'), { schemaVersion: 2, revision: 2, updating: true })
  const path = auctionAssignmentOutcomeDocumentPath(SEASON, 'auction-1', 3)
  await writeJson(join(roots.groupRepoRoot, path), outcome(3, 'starforward', 25, '2026-09-06T16:00:03Z'))

  const result = await processAuctionOutcomes({ ...roots, season: SEASON })
  assert.equal(result.deferred, true)
  assert.equal(result.processedOutcomes, 0)
  assert.equal((await readJson<AuctionAssignmentOutcome>(join(roots.groupRepoRoot, path))).status, 'pending')
})

function group(): Group {
  return {
    id: 'friends', name: 'Friends',
    users: [
      { username: 'Host', email: HOST, role: IdentityRole.Admin },
      { username: 'Alice', email: ALICE, role: IdentityRole.Participant },
    ],
    baskets: [{ id: 'main', name: 'Main', years: [{ year: SEASON, teams: [{ name: 'Alice FC', owner: ALICE, additionalOwners: [] }] }] }],
    leagues: [{
      id: 'league', name: 'League', isMain: true, type: LeagueType.League, basketsId: ['main'],
      years: [{ year: SEASON, type: LeagueType.League, settings: { ...DefaultLeagueSetting } }],
    }],
  }
}

function emptyTeam(): Team {
  return { name: 'Alice FC', owner: ALICE, additionalOwners: [], players: [], moneyFromRank: 0, lastUpdate: null }
}

function outcome(sequence: number, playerKey: string, price: number, assignedAt: string, actor = HOST): AuctionAssignmentOutcome {
  return {
    version: 1,
    auctionId: 'auction-1',
    sequence,
    leagueId: 'league',
    season: SEASON,
    kind: AuctionKind.Starting,
    actor,
    owner: ALICE,
    playerKey,
    price,
    substitutedPlayerKey: null,
    assignedAt,
    status: 'pending',
  }
}

async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T }
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
