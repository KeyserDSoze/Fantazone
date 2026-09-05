import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  GroupHelper,
  LeagueType,
  calculateDefinitiveDay,
  calculateRankFromCalendar,
  getCurrentSeasonYear,
  progressLeagueCalendar,
  type Calendar,
  type Group,
  type LeagueSetting,
  type Rank,
  type Team,
  type VotedRealPlayers,
} from '@fantazone/domain'
import {
  GROUP_DOCUMENT_PATH,
  calendarDocumentPath,
  dailyRankDocumentPath,
  dayTeamDocumentPath,
  decodeVotedRealPlayers,
  isGroupDocument,
  seasonRankDocumentPath,
  serieAVoteDocumentPath,
} from '@fantazone/github'

export type GroupRecalculationOptions = {
  groupRepoRoot: string
  platformRepoRoot: string
  season?: number
  day?: number
  now?: Date
}

export type GroupLeagueRecalculationResult = {
  leagueId: string
  calculatedSerieADays: number[]
  progressionChanged: boolean
  calendarPath: string
  rankPath: string
  dailyRankPaths: string[]
}

export type GroupRecalculationResult = {
  season: number
  leagues: GroupLeagueRecalculationResult[]
}

export async function recalculateGroupDay(options: GroupRecalculationOptions): Promise<GroupRecalculationResult> {
  if (!options.day || !Number.isInteger(options.day) || options.day < 1 || options.day > 38) {
    throw new Error('recalculate-day requires a Serie A day between 1 and 38')
  }
  return recalculateGroup({ ...options, requiredDay: options.day })
}

export async function recalculateGroupAll(options: GroupRecalculationOptions): Promise<GroupRecalculationResult> {
  return recalculateGroup({ ...options, requiredDay: null })
}

async function recalculateGroup(
  options: GroupRecalculationOptions & { requiredDay: number | null },
): Promise<GroupRecalculationResult> {
  const season = options.season ?? getCurrentSeasonYear(options.now ?? new Date())
  assertSeason(season)
  const group = await readGroup(options.groupRepoRoot)
  const results: GroupLeagueRecalculationResult[] = []

  for (const league of group.leagues) {
    if (!league.years.some(year => year.year === season)) continue
    const calendarPath = resolve(options.groupRepoRoot, calendarDocumentPath(league.id, season))
    const calendar = await readOptionalJson<Calendar>(calendarPath)
    if (!calendar) continue
    if (calendar.year !== season) {
      throw new Error(`Calendar ${league.id} year mismatch: expected ${season}, found ${calendar.year}`)
    }

    const annual = GroupHelper.getAnnualLeague(group, league.id, season)
    if (!annual) continue
    const settings = annual.settings
    const leagueType = GroupHelper.getAnnualType(league, season)
    const candidateDays = uniqueSerieADays(calendar)
      .filter(day => options.requiredDay == null || day === options.requiredDay)
    if (options.requiredDay != null && !candidateDays.includes(options.requiredDay)) continue

    const calculatedSerieADays: number[] = []
    for (const serieADay of candidateDays) {
      const officialVotes = await readOfficialVotes(options.platformRepoRoot, season, serieADay)
      if (!officialVotes) {
        if (options.requiredDay != null) {
          throw new Error(
            `Official votes ${season}/${serieADay} non trovati. Esegui prima ingest-final-votes; nessun risultato fantasy è stato scritto.`,
          )
        }
        continue
      }

      let changed = false
      for (const [roundKey, days] of Object.entries(calendar.rounds)) {
        for (let index = 0; index < days.length; index += 1) {
          const day = days[index]
          if (day.serieADay !== serieADay) continue
          const teamsByOwner = await loadTeamsForDay(options.groupRepoRoot, group, season, day)
          days[index] = calculateDefinitiveDay({
            day,
            teamsByOwner,
            officialVotes,
            leagueType,
            settings,
            mode: 'force',
          })
          changed = true
        }
        calendar.rounds[roundKey] = days
      }
      if (changed) calculatedSerieADays.push(serieADay)
    }

    const excludedRounds = excludedRankRounds(leagueType)
    const rank = calculateRankFromCalendar(calendar, settings, excludedRounds)
    const progression = progressLeagueCalendar({ calendar, rank, leagueType })
    if (calculatedSerieADays.length === 0 && !progression.changed && options.requiredDay == null) continue

    await writeJson(calendarPath, progression.calendar)
    const rankPath = resolve(options.groupRepoRoot, seasonRankDocumentPath(league.id, season))
    await writeJson(rankPath, rank)
    const dailyRankPaths = await rebuildDailyRanks(
      options.groupRepoRoot,
      league.id,
      season,
      progression.calendar,
      settings,
      leagueType,
      rank,
    )

    results.push({
      leagueId: league.id,
      calculatedSerieADays,
      progressionChanged: progression.changed,
      calendarPath,
      rankPath,
      dailyRankPaths,
    })
  }

  return { season, leagues: results }
}

async function loadTeamsForDay(
  groupRepoRoot: string,
  group: Group,
  season: number,
  day: Calendar['rounds'][string][number],
): Promise<Map<string, Team | null>> {
  const owners = new Set(day.games.flatMap(game => [game.homeOwner, game.awayOwner]).filter(Boolean))
  const result = new Map<string, Team | null>()
  for (const owner of owners) {
    const basketId = GroupHelper.getBasketId(group, owner, season)
    if (!basketId) {
      result.set(owner, null)
      continue
    }
    const path = resolve(groupRepoRoot, dayTeamDocumentPath(basketId, season, day.serieADay, owner))
    result.set(owner, await readOptionalJson<Team>(path))
  }
  return result
}

async function rebuildDailyRanks(
  groupRepoRoot: string,
  leagueId: string,
  season: number,
  calendar: Calendar,
  settings: LeagueSetting,
  leagueType: LeagueType,
  seasonRank: Rank,
): Promise<string[]> {
  const maxDay = seasonRank.serieADay
  if (maxDay < 1) return []
  const paths: string[] = []
  for (const serieADay of uniqueSerieADays(calendar).filter(day => day <= maxDay)) {
    const truncated = truncateCalendar(calendar, serieADay)
    const dailyRank = calculateRankFromCalendar(truncated, settings, excludedRankRounds(leagueType))
    if (dailyRank.serieADay !== serieADay) continue
    const path = resolve(groupRepoRoot, dailyRankDocumentPath(leagueId, season, serieADay))
    await writeJson(path, dailyRank)
    paths.push(path)
  }
  return paths
}

function truncateCalendar(calendar: Calendar, throughSerieADay: number): Calendar {
  return {
    year: calendar.year,
    rounds: Object.fromEntries(
      Object.entries(calendar.rounds).map(([roundKey, days]) => [
        roundKey,
        days
          .filter(day => day.serieADay <= throughSerieADay)
          .map(day => structuredClone(day)),
      ]),
    ),
  }
}

export function excludedRankRounds(leagueType: LeagueType): string[] {
  switch (leagueType) {
    case LeagueType.Cup:
      return ['Finals']
    case LeagueType.NewCup:
      return ['Finals', 'Europa League', 'Supercoppa']
    default:
      return []
  }
}

function uniqueSerieADays(calendar: Calendar): number[] {
  return [...new Set(
    Object.values(calendar.rounds).flatMap(days => days.map(day => day.serieADay)),
  )].sort((a, b) => a - b)
}

async function readGroup(root: string): Promise<Group> {
  const path = resolve(root, GROUP_DOCUMENT_PATH)
  const value = await readRequiredJson<unknown>(path, 'Group')
  if (!isGroupDocument(value)) throw new Error(`Unsupported group JSON schema in ${path}`)
  return value
}

async function readOfficialVotes(root: string, season: number, day: number): Promise<VotedRealPlayers | null> {
  const path = resolve(root, serieAVoteDocumentPath('official', season, day))
  const value = await readOptionalJson<unknown>(path)
  return value == null ? null : decodeVotedRealPlayers(value, season, day)
}

async function readRequiredJson<T>(path: string, label: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if (isFileNotFound(error)) throw new Error(`${label} non trovato in ${path}`)
    throw error
  }
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if (isFileNotFound(error)) return null
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function assertSeason(season: number): void {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
