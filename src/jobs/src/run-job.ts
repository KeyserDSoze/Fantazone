import { propagateNextFormations } from './formationPropagation'
import { recalculateGroupAll, recalculateGroupDay } from './groupRecalculation'
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
  | 'ingest-final-votes'
  | 'ingest-player-odds'
  | 'ingest-player-images'
  | 'set-next-formations'
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
    console.log(`Serie A calendar ${result.calendar.year}: ${result.calendar.days.length} giornate salvate in ${result.path}`)
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
      console.log(`Player count changed: statistiche ${stats.stats.year} rigenerate fino alla giornata ${stats.stats.untilSerieADay}.`)
    }
  },
  'rebuild-player-stats': async context => {
    const result = await rebuildPlayerStats(context)
    console.log(`Statistiche giocatori ${result.stats.year}: ${result.stats.players.length} giocatori fino alla giornata ${result.stats.untilSerieADay} salvati in ${result.path}`)
  },
  'ingest-final-votes': async context => {
    const result = await ingestFinalVotes(context)
    console.log(
      `Voti ufficiali ${result.votes.year}/${result.votes.serieADay}: ${result.votes.players.length} giocatori, ` +
      `${result.parsedPlayedTeams}/${result.expectedPlayedTeams} squadre giocate, ` +
      `${result.syntheticDelayedPlayers} voti sintetici da rinvii; complete=${result.complete}.`,
    )
    if (result.complete) {
      const stats = await rebuildPlayerStats({ season: result.votes.year, day: result.votes.serieADay })
      console.log(`Voti completi: statistiche ${stats.stats.year} rigenerate fino alla giornata ${stats.stats.untilSerieADay}.`)
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
  'set-next-formations': async context => {
    const roots = groupJobRoots()
    const result = await propagateNextFormations({ ...roots, season: context.season })
    if (result.targetSerieADay == null) {
      console.log(`Formazioni ${result.season}: nessuna propagazione necessaria.`)
      return
    }
    console.log(
      `Formazioni ${result.season}: giorno ${result.sourceSerieADay} -> ${result.targetSerieADay}; ` +
      `${result.copiedOwners.length} copiate, ${result.existingOwners.length} già presenti, ` +
      `${result.missingSourceOwners.length} senza sorgente.`,
    )
  },
  'recalculate-day': async context => {
    const roots = groupJobRoots()
    const result = await recalculateGroupDay({ ...roots, season: context.season, day: context.day })
    console.log(`Ricalcolo gruppo ${result.season}: ${result.leagues.length} leghe aggiornate per la giornata ${context.day}.`)
  },
  'recalculate-all': async context => {
    const roots = groupJobRoots()
    const result = await recalculateGroupAll({ ...roots, season: context.season })
    console.log(`Ricalcolo completo gruppo ${result.season}: ${result.leagues.length} leghe aggiornate.`)
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

function groupJobRoots(): { groupRepoRoot: string; platformRepoRoot: string } {
  const groupRepoRoot = process.env.FANTAZONE_GROUP_REPO_ROOT?.trim()
  const platformRepoRoot = process.env.FANTAZONE_PLATFORM_REPO_ROOT?.trim()
  if (!groupRepoRoot || !platformRepoRoot) {
    throw new Error(
      'Group job requires FANTAZONE_GROUP_REPO_ROOT and FANTAZONE_PLATFORM_REPO_ROOT. ' +
      'Run it from the Fantazone group workflow, not the platform background workflow.',
    )
  }
  return { groupRepoRoot, platformRepoRoot }
}

function optionalPositiveInteger(value: string | undefined, label: string): number | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== normalized) {
    throw new Error(`${label} must be a positive integer`)
  }
  return parsed
}
