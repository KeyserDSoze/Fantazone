import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RealCalendarHelper,
  generatePlayerStatistics,
  getCurrentSeasonYear,
  type VotedRealPlayers,
} from '@fantazone/domain'
import {
  decodeRealCalendar,
  decodeRealPlayers,
  decodeVotedRealPlayers,
  realCalendarDocumentPath,
  realPlayersDocumentPath,
  serieAVoteDocumentPath,
  statPlayersDocumentPath,
} from '@fantazone/github'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export type PlayerStatsRebuildOptions = {
  season?: number
  day?: number
  repoRoot?: string
  now?: Date
}

export async function rebuildPlayerStats(options: PlayerStatsRebuildOptions = {}) {
  const now = options.now ?? new Date()
  const year = options.season ?? getCurrentSeasonYear(now)
  assertSeason(year)
  const repoRoot = options.repoRoot ?? REPO_ROOT

  const playersPath = resolve(repoRoot, realPlayersDocumentPath(year))
  const realPlayers = decodeRealPlayers(JSON.parse(await readRequired(playersPath, `RealPlayers ${year}`)), year)

  const untilSerieADay = options.day ?? await resolveLegacyUntilDay(repoRoot, year, now)
  assertDay(untilSerieADay)

  const officialVotesByDay = new Map<number, VotedRealPlayers | null>()
  for (let day = 1; day <= untilSerieADay; day += 1) {
    const path = resolve(repoRoot, serieAVoteDocumentPath('official', year, day))
    officialVotesByDay.set(day, await readOptionalVotes(path, year, day))
  }

  const stats = generatePlayerStatistics({ realPlayers, officialVotesByDay, untilSerieADay })
  const path = resolve(repoRoot, statPlayersDocumentPath(year))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(stats, null, 2)}\n`, 'utf8')
  return { stats, path }
}

/** Mirrors AllPlayersAndAllTeamsJob: calendar.LastDay?.SerieADay ?? 38. */
async function resolveLegacyUntilDay(repoRoot: string, year: number, now: Date): Promise<number> {
  const path = resolve(repoRoot, realCalendarDocumentPath(year))
  const calendar = decodeRealCalendar(JSON.parse(await readRequired(path, `RealCalendar ${year}`)), year)
  return RealCalendarHelper.getLastDay(calendar, now)?.serieADay ?? 38
}

async function readOptionalVotes(path: string, year: number, day: number): Promise<VotedRealPlayers | null> {
  try {
    return decodeVotedRealPlayers(JSON.parse(await readFile(path, 'utf8')), year, day)
  } catch (error) {
    if (isFileNotFound(error)) return null
    throw error
  }
}

async function readRequired(path: string, label: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isFileNotFound(error)) throw new Error(`${label} non trovato in ${path}.`)
    throw error
  }
}

function assertSeason(year: number): void {
  if (!Number.isInteger(year) || year < 1) throw new Error('Season id must be a positive integer')
}

function assertDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 38) throw new Error('Serie A day must be between 1 and 38')
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
