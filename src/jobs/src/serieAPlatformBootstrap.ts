import { getCurrentSeasonYear } from '@fantazone/domain'
import { ingestMasterData, type TextFetcher } from './masterDataIngestion'
import { rebuildPlayerStats } from './playerStatsRebuild'
import { ingestSerieACalendar, type JsonFetcher } from './serieAIngestion'

export type SerieAPlatformBootstrapOptions = {
  season?: number
  repoRoot?: string
  calendarBaseUrl?: string
  playersSourceUrl?: string
  fetchCalendarJson?: JsonFetcher
  fetchPlayersText?: TextFetcher
  now?: Date
}

/**
 * Initializes the canonical global Serie A foundation in dependency order.
 *
 * Calendar must exist before RealTeams/RealPlayers can be derived. Statistics are
 * rebuilt only when the master-data reconciliation reports a player-count change,
 * matching the legacy AllPlayersAndAllTeamsJob trigger.
 */
export async function bootstrapSerieAPlatformData(options: SerieAPlatformBootstrapOptions = {}) {
  const now = options.now ?? new Date()
  const season = options.season ?? getCurrentSeasonYear(now)

  const calendar = await ingestSerieACalendar({
    season,
    repoRoot: options.repoRoot,
    baseUrl: options.calendarBaseUrl,
    fetchJson: options.fetchCalendarJson,
    now,
  })

  const master = await ingestMasterData({
    season: calendar.calendar.year,
    repoRoot: options.repoRoot,
    sourceUrl: options.playersSourceUrl,
    fetchText: options.fetchPlayersText,
    now,
  })

  const stats = master.reconciliation.playerCountChanged
    ? await rebuildPlayerStats({ season: master.players.year, repoRoot: options.repoRoot, now })
    : null

  return { calendar, master, stats }
}
