import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  CUP_FINALS_ROUND,
  DefaultLeagueSetting,
  IdentityRole,
  LeagueType,
  type Calendar,
  type CalendarGame,
  type Group,
} from '../../src/domain/src/index'
import { GROUP_DOCUMENT_PATH, calendarDocumentPath } from '../../src/github/src/index'
import { recalculateGroupAll } from '../../src/jobs/src/groupRecalculation'

const SEASON = 15
const LEAGUE = 'cup-a'
const BASKET = 'main'

test('recalculate-all advances a completed Cup even when no new official vote file is needed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-cup-progression-'))
  const groupRoot = join(root, 'group')
  const platformRoot = join(root, 'platform')
  const owners = Array.from({ length: 16 }, (_, index) => `owner${index + 1}@test.local`)
  const group: Group = {
    id: 'cup-group',
    name: 'Cup group',
    users: [{ username: 'Admin', email: owners[0], role: IdentityRole.SuperAdmin }],
    leagues: [{
      id: LEAGUE,
      name: 'Cup',
      isMain: true,
      type: LeagueType.Cup,
      basketsId: [BASKET],
      years: [{ year: SEASON, type: LeagueType.Cup, settings: DefaultLeagueSetting }],
    }],
    baskets: [{
      id: BASKET,
      name: 'Main',
      years: [{
        year: SEASON,
        teams: owners.map((owner, index) => ({ name: `Team ${index + 1}`, owner, additionalOwners: [] })),
      }],
    }],
  }
  const calendar: Calendar = {
    year: SEASON,
    rounds: Object.fromEntries(Array.from({ length: 4 }, (_, roundIndex) => {
      const offset = roundIndex * 4
      return [String.fromCharCode(65 + roundIndex), [{
        number: 12,
        serieADay: 14,
        games: [
          cancelledGame(offset + 1, offset + 2, 1),
          cancelledGame(offset + 3, offset + 4, 2),
        ],
      }]]
    })),
  }

  await writeJson(join(groupRoot, GROUP_DOCUMENT_PATH), group)
  await writeJson(join(groupRoot, calendarDocumentPath(LEAGUE, SEASON)), calendar)

  const result = await recalculateGroupAll({ groupRepoRoot: groupRoot, platformRepoRoot: platformRoot, season: SEASON })
  assert.equal(result.leagues.length, 1)
  assert.deepEqual(result.leagues[0].calculatedSerieADays, [])
  assert.equal(result.leagues[0].progressionChanged, true)

  const persisted = await readJson<Calendar>(join(groupRoot, calendarDocumentPath(LEAGUE, SEASON)))
  assert.deepEqual(persisted.rounds[CUP_FINALS_ROUND].map(day => day.games.length), [4, 4])
})

function cancelledGame(homeIndex: number, awayIndex: number, number: number): CalendarGame {
  return {
    id: `base-${homeIndex}-${awayIndex}`,
    number,
    home: `Team ${homeIndex}`,
    homeOwner: `owner${homeIndex}@test.local`,
    away: `Team ${awayIndex}`,
    awayOwner: `owner${awayIndex}@test.local`,
    result: {
      home: { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false },
      away: { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false },
      isCancelled: true,
      homeGoals: 0,
      awayGoals: 0,
    },
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}
