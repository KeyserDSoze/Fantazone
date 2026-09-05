import { ingestMasterData } from './masterDataIngestion'
import { ingestSerieACalendar } from './serieAIngestion'

type JobName =
  | 'ingest-serie-a'
  | 'ingest-master-data'
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
