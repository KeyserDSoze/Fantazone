import { propagateNextFormations } from './formationPropagation'
import { snapshotSavedFormations } from './formationSnapshot'
import { recalculateGroupAll, recalculateGroupDay } from './groupRecalculation'
import { rebuildGroupHallOfFame } from './hallOfFameRebuild'
import { processGroupMarket } from './marketProcessing'
import { ingestFinalVotes } from './officialVoteIngestion'
import { ingestLiveVotes } from './liveVoteIngestion'
import { ingestMasterData } from './masterDataIngestion'
import { ingestPlayerImages } from './playerImagesIngestion'
import { ingestPlayerOdds } from './playerOddsIngestion'
import { rebuildPlayerStats } from './playerStatsRebuild'
import { bootstrapSerieAPlatformData } from './serieAPlatformBootstrap'
import { ingestSerieACalendar } from './serieAIngestion'

type JobName =
  | 'bootstrap-serie-a'
  | 'ingest-serie-a'
  | 'ingest-master-data'
  | 'rebuild-player-stats'
  | 'ingest-live-votes'
  | 'ingest-final-votes'
  | 'ingest-player-odds'
  | 'ingest-player-images'
  | 'snapshot-formations'
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
  'bootstrap-serie-a': async context => {
    const result = await bootstrapSerieAPlatformData({ season: context.season })
    console.log(
      `Bootstrap Serie A ${result.master.players.year}: ${result.calendar.calendar.days.length} giornate, ` +
      `${result.master.teams.teams.length} squadre, ${result.master.players.players.length} giocatori.`,
    )
    if (result.stats) {
      console.log(
        `Bootstrap statistiche: ${result.stats.stats.players.length} giocatori fino alla giornata ${result.stats.stats.untilSerieADay}.`,
      )
    } else {
      console.log('Bootstrap statistiche: nessuna rigenerazione necessaria perché il numero giocatori non è cambiato.')
    }
  },
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
  'ingest-player-odds': async context => {
    const result = await ingestPlayerOdds({ season: context.season })
    if (result.skipped) {
      console.log(`Player odds ${result.season}: skip=${result.reason ?? 'unknown'}.`)
      for (const source of result.sources.filter(source => !source.ok)) {
        console.warn(`${source.source}: ${source.error ?? 'provider error'}`)
      }
      return
    }
    console.log(
      `Player odds ${result.season}/${result.serieADay}: ${result.snapshot?.players.length ?? 0} giocatori salvati in ${result.path}.`,
    )
    for (const source of result.sources) {
      console.log(`${source.source}: ${source.ok ? `${source.observations} osservazioni` : `errore: ${source.error}`}`)
    }
  },
  'ingest-player-images': async context => {
    const result = await ingestPlayerImages({ season: context.season })
    if (result.skipped) {
      console.log(`Player images ${result.season}: skip=${result.reason ?? 'unknown'}.`)
      return
    }
    console.log(
      `Player images ${result.season}: ${result.written} nuove, ${result.existing} esistenti, ` +
      `${result.unmatched} senza match, ${result.failed} fallite in ${result.outputDirectory}.`,
    )
  },
  'snapshot-formations': async () => {
    const roots = groupJobRoots()
    const result = await snapshotSavedFormations({
      ...roots,
      fallbackBefore: process.env.FANTAZONE_SOURCE_BEFORE,
    })
    if (result.deferred) {
      console.log('Formazioni: manifest in aggiornamento, consolidamento rinviato al prossimo push stabile.')
      return
    }
    console.log(
      `Formazioni: ${result.inspectedCommits} commit ispezionate, ${result.changedTeamFiles} squadre salvate; ` +
      `${result.writtenSnapshots} snapshot aggiornati, ${result.staleSnapshots} obsoleti ignorati, ` +
      `${result.noTargetSnapshots} senza giornata futura.`,
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
  'rebuild-hall-of-fame': async () => {
    const roots = groupJobRoots()
    const result = await rebuildGroupHallOfFame({ groupRepoRoot: roots.groupRepoRoot })
    console.log(
      `Hall of Fame: ${result.leagues.length} leghe ricostruite; stagione corrente ${result.currentSeason}.`,
    )
  },
  'process-market': async context => {
    const roots = groupJobRoots()
    const result = await processGroupMarket({ groupRepoRoot: roots.groupRepoRoot, season: context.season })
    console.log(
      `Mercato ${result.season}: ${result.processedCommands} comandi; ` +
      `${result.appliedCommands} applicati, ${result.rejectedCommands} rifiutati, ` +
      `${result.expiredMarkets} scaduti, ${result.changedTeams} squadre aggiornate.`,
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
