import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  FantaSoccerRole,
  IdentityRole,
  LeagueType,
  PlayerInTeamStatus,
  Role,
  type Calendar,
  type Group,
  type HallOfFame,
  type Rank,
  type RealPlayers,
  type Team,
} from '../../src/domain/src/index'
import {
  GROUP_DOCUMENT_PATH,
  calendarDocumentPath,
  hallOfFameDocumentPath,
  realPlayersDocumentPath,
  seasonRankDocumentPath,
  seasonTeamDocumentPath,
} from '../../src/github/src/index'
import { rebuildGroupHallOfFame } from '../../src/jobs/src/hallOfFameRebuild'

const OWNER = 'owner@example.com'
const RIVAL = 'rival@example.com'

test('rebuilds one cross-season Hall of Fame document from canonical group data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-hall-of-fame-'))
  await writeJson(join(root, GROUP_DOCUMENT_PATH), group())

  for (const year of [14, 15]) {
    await writeJson(join(root, realPlayersDocumentPath(year)), master(year))
    await writeJson(join(root, seasonRankDocumentPath('league', year)), rank(year === 14 ? 12 : 20))
    await writeJson(join(root, calendarDocumentPath('league', year)), calendar(year, year === 14))
    await writeJson(join(root, seasonTeamDocumentPath('main', year, OWNER)), team(OWNER, `Champion ${year}`))
    await writeJson(join(root, seasonTeamDocumentPath('main', year, RIVAL)), team(RIVAL, `Rival ${year}`))
  }

  const result = await rebuildGroupHallOfFame({ groupRepoRoot: root, platformRepoRoot: root, now: new Date('2026-09-06T12:00:00Z') })

  assert.equal(result.currentSeason, 15)
  assert.deepEqual(result.leagues[0].seasons, [15, 14])
  const hall = await readJson<HallOfFame>(join(root, hallOfFameDocumentPath('league')))
  assert.equal(hall.allTimeRankings.find(item => item.owner === OWNER)?.point, 32)
  assert.deepEqual(hall.winningTeams[0], { owner: OWNER, teamName: 'Owner 14', wins: { '@': [14] } })
  assert.equal(hall.winningPlayers[0].player.name, 'Champion 14')
  assert.equal(hall.recordGame?.year, 14)
  assert.equal(hall.recordPlayer, null)
  assert.equal(hall.playerWithMostPointsInYear, null)
})

function master(year: number): RealPlayers {
  return {
    year,
    players: [`Champion ${year}`, `Rival ${year}`].map(name => ({
      name,
      team: { name: 'Roma', abbreviation: 'ROM' },
      role: Role.Forward,
      isActive: true,
      visible: true,
    })),
  }
}

function group(): Group {
  return {
    id: 'g', name: 'Group',
    users: [OWNER, RIVAL].map(email => ({ username: email, email, role: IdentityRole.Participant })),
    baskets: [{
      id: 'main', name: 'Main',
      years: [14, 15].map(year => ({
        year,
        teams: [
          { name: `Owner ${year}`, owner: OWNER, additionalOwners: [] },
          { name: `Rival ${year}`, owner: RIVAL, additionalOwners: [] },
        ],
      })),
    }],
    leagues: [{
      id: 'league', name: 'League', isMain: true, type: LeagueType.League, basketsId: ['main'],
      years: [14, 15].map(year => ({ year, type: LeagueType.League, settings: DefaultLeagueSetting })),
    }],
  }
}

function rank(ownerPoint: number): Rank {
  const row = (owner: string, point: number) => ({
    name: owner, owner, point, victories: 1, draws: 0, defeats: 0,
    goal: point, sufferedGoal: 0, valuePoint: point * 2, sufferedValuePoint: 0,
    plusMoney: 0, money: 0, valueAssets: 0,
  })
  return { serieADay: 38, rounds: { '@': [row(OWNER, ownerPoint), row(RIVAL, 1)] } }
}

function calendar(year: number, complete: boolean): Calendar {
  return {
    year,
    rounds: { '@': [{
      number: 38, serieADay: 38,
      games: [{
        id: `game-${year}`, number: 1, home: 'Owner', homeOwner: OWNER, away: 'Rival', awayOwner: RIVAL,
        result: complete ? {
          home: { value: 72, defensiveBonus: false, goodPeople: false, ownGoal: false },
          away: { value: 65, defensiveBonus: false, goodPeople: false, ownGoal: false },
          isCancelled: false, homeGoals: 2, awayGoals: 1,
        } : null,
      }],
    }] },
  }
}

function team(owner: string, playerName: string): Team {
  return {
    name: owner, owner, additionalOwners: [], moneyFromRank: 0, lastUpdate: null,
    players: [{
      name: playerName,
      team: { name: 'Roma', abbreviation: 'ROM' },
      role: Role.Forward, isActive: true, visible: true,
      price: 10, revenue: 10, status: PlayerInTeamStatus.Active, position: FantaSoccerRole.Forward,
    }],
  }
}

async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T }
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
