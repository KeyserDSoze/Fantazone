import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MATCH_LIVE_WINDOW_MS = (2 * 60 + 15) * 60 * 1000

export async function findLiveSerieAGame(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd()
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now())
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid current time for live-vote schedule guard')

  const calendarsRoot = resolve(repoRoot, 'data/serie-a/calendars')
  let files
  try {
    files = (await readdir(calendarsRoot)).filter(name => name.endsWith('.json')).sort()
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }

  const nowMs = now.getTime()
  for (const file of files) {
    const value = JSON.parse(await readFile(join(calendarsRoot, file), 'utf8'))
    if (!value || typeof value !== 'object' || !Number.isInteger(value.year) || !Array.isArray(value.days)) {
      throw new Error(`Invalid RealCalendar document '${file}'`)
    }
    for (const day of value.days) {
      if (!day || typeof day !== 'object' || !Number.isInteger(day.serieADay) || !Array.isArray(day.games)) continue
      for (const game of day.games) {
        if (!game || typeof game !== 'object' || game.delayed === true || typeof game.date !== 'string') continue
        const kickoff = Date.parse(game.date)
        if (!Number.isFinite(kickoff)) continue
        if (nowMs >= kickoff && nowMs <= kickoff + MATCH_LIVE_WINDOW_MS) {
          return { season: value.year, serieADay: day.serieADay }
        }
      }
    }
  }
  return null
}

export async function hasLiveSerieAGame(options = {}) {
  return (await findLiveSerieAGame(options)) !== null
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const repoRoot = argument('--root') ?? process.cwd()
  const nowValue = argument('--now')
  const context = await findLiveSerieAGame({
    repoRoot,
    ...(nowValue ? { now: new Date(nowValue) } : {}),
  })

  if (process.argv.includes('--github-output')) {
    process.stdout.write(
      `run=${context ? 'true' : 'false'}\n` +
      `day=${context?.serieADay ?? ''}\n` +
      `season=${context?.season ?? ''}\n`,
    )
    return
  }

  process.stdout.write(context ? 'true' : 'false')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
