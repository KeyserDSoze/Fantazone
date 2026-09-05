import { ingestFinalVotes } from './officialVoteIngestion'
import { ingestLiveVotes } from './liveVoteIngestion'
import { ingestMasterData } from './masterDataIngestion'
import { rebuildPlayerStats } from './playerStatsRebuild'
import { ingestSerieACalendar } from './serieAIngestion'

type JobName =
  | 'ingest-serie-a'
  | 'ingest-master-data'
  | 'rebuild-player-stats'
  | 'ingest-live-votes'
  | 'ingest-live'
  | 'ingest-final-votes'
  | 'ingest-player-odds'
  | 'ingest-player-images'
  | 'set-next-formations'
  | 'rebuild-groups'
  | 'rebuild-hall-of-fame'
  | 'process-market'
  | 'recalculate-day'
  | 'recalculate-all'

type JobContext = {
  day?: number
  season?: number
}

const migrated: Partial<Record<JobName, (context: JobContext) => Promise<void>>> = {
  'ingest-serie-a': async context => {
    const result = await ingestSerieACalendar(context)
    console.log(
      `Serie A calendar ${result.calendar.year}: ${result.calendar.days.length} giornate salvate in ${result.path}`,
    )
  },
  'ingest-master-data': async context => {
    const result = await ingestMasterData(context)
    console.log(
      `Serie A master data ${result.players.year}: ${result.teams.teams.length} squadre, ${result.players.players.length} giocatori; ` +
      `${result.reconciliation.addedKeys.length} nuovi, ${result.reconciliation.inactiveKeys.length} inattivi, ` +
      `${result.reconciliation.transferredKeys.length} trasferimenti.`,
    )
    if (result.reconciliation.playerCountChanged) {
      const stats = await rebuildPlayerStats({ season: result.players.year })
      console.log(
        `Player count changed: statistiche ${stats.stats.year} rigenerate fino alla giornata ${stats.stats.untilSerieADay}.`,
      )
    }
  },
  'rebuild-player-stats': async context => {
    const result = await rebuildPlayerStats(context)
    console.log(
      `Statistiche giocatori ${result.stats.year}: ${result.stats.players.length} giocatori fino alla giornata ${result.stats.untilSerieADay} salvati in ${result.path}`,
    )
  },
  'ingest-final-votes': async context => {
    const result = await ingestFinalVotes(context)
    console.log(
      `Voti ufficiali ${result.votes.year}/${result.votes.serieADay}: ${result.votes.players.length} giocatori, ` +
      `${result.parsedPlayedTeams}/${result.expectedPlayedTeams} squadre giocate, ` +
      `${result.syntheticDelayedPlayers} voti sintetici da rinvii; complete=${result.complete}.`,
    )
    if (result.complete) {
      const stats = await rebuildPlayerStats({
        season: result.votes.year,
        day: result.votes.serieADay,
      })
      console.log(
        `Voti completi: statistiche ${stats.stats.year} rigenerate fino alla giornata ${stats.stats.untilSerieADay}.`,
      )
    }
  },
  'ingest-live-votes': async context => {
    const result = await ingestLiveVotes(context)
    if (result.skipped) {
      console.log('Nessuna partita live: ingest-live-votes non esegue chiamate al provider.')
      return
    }
    console.log(
      `Voti live: ${result.incomingPlayers} giocatori ricevuti; ` +
      `${result.written ? `snapshot aggiornato in ${result.path}` : 'nessun aggiornamento persistito'}.`,
    )
  },
}

const name = process.argv[2] as JobName | undefined
if (!name) {
  console.error('Usage: npm run job -- <job-name> [day] [season]')
  process.exit(2)
}

const context: JobContext = {
  day: optionalPositiveInteger(process.argv[3] || process.env.FANTAZONE_DAY, 'day'),
  season: optionalPositiveInteger(process.argv[4] || process.env.FANTAZONE_SEASON, 'season'),
}
const handler = migrated[name]
if (!handler) {
  console.error(`Job ${name} is registered in the migration plan but is not implemented yet.`)
  process.exit(3)
}

await handler(context)

function optionalPositiveInteger(value: string | undefined, label: string): number | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== normalized) {
    throw new Error(`${label} must be a positive integer`)
  }
  return parsed
}
