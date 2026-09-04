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

const migrated: Partial<Record<JobName, () => Promise<void>>> = {}

const name = process.argv[2] as JobName | undefined
if (!name) {
  console.error('Usage: npm run job -- <job-name> [arguments]')
  process.exit(2)
}

const handler = migrated[name]
if (!handler) {
  console.error(`Job ${name} is registered in the migration plan but is not implemented yet.`)
  process.exit(3)
}

await handler()
