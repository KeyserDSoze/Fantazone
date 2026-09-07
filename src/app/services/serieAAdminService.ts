import {
  GroupHelper,
  IdentityRole,
  type Group,
  type RealCalendar,
  type UserOfAGroup,
} from '@fantazone/domain'
import { GitHubClient, type GitHubRepo } from '@fantazone/github'

export const PLATFORM_BACKGROUND_WORKFLOW_ID = 'background-jobs.yml'

export type SerieAPlatformJob =
  | 'ingest-serie-a'
  | 'ingest-master-data'
  | 'rebuild-player-stats'
  | 'ingest-final-votes'
  | 'ingest-player-odds'
  | 'ingest-player-images'

export type SerieADelayedChange = {
  serieADay: number
  home: string
  away: string
  delayed: boolean
}

export type SerieAAdminAccess = {
  canWrite: boolean
  repository: string
  branch: string | null
  reason: string | null
}

export type SerieAAdminRuntime = {
  connection: { token: string }
  platformTarget: { owner: string; repo: string; ref?: string }
  refreshGroup(): Promise<Group>
  realCalendarRepository: {
    getCalendarSnapshot(
      season: number,
      options?: { refresh?: boolean },
    ): Promise<{ value: RealCalendar; sha: string } | null>
    writeCalendar(
      calendar: RealCalendar,
      message?: string,
      options?: { expectedSha?: string; branch?: string },
    ): Promise<string>
  }
}

export type SerieAAdminGitHubClient = {
  getRepository(owner: string, repo: string): Promise<GitHubRepo>
  dispatchWorkflow(
    owner: string,
    repo: string,
    workflowId: string,
    ref: string,
    inputs?: Record<string, string>,
  ): Promise<void>
}

export async function getSerieAAdminAccess(
  runtime: SerieAAdminRuntime,
  actor: UserOfAGroup,
  client: SerieAAdminGitHubClient = new GitHubClient(runtime.connection.token),
): Promise<SerieAAdminAccess> {
  const group = await runtime.refreshGroup()
  const currentActor = GroupHelper.findUserByEmail(group, actor.email)
  const repository = `${runtime.platformTarget.owner}/${runtime.platformTarget.repo}`
  if (!currentActor || !GroupHelper.hasRole(currentActor, IdentityRole.SuperAdmin)) {
    return {
      canWrite: false,
      repository,
      branch: runtime.platformTarget.ref?.trim() || null,
      reason: 'Solo un SuperAdmin del gruppo può eseguire operazioni amministrative sulla piattaforma.',
    }
  }

  const repo = await client.getRepository(runtime.platformTarget.owner, runtime.platformTarget.repo)
  const branch = runtime.platformTarget.ref?.trim() || repo.default_branch?.trim() || null
  if (repo.permissions?.push !== true) {
    return {
      canWrite: false,
      repository,
      branch,
      reason: `Il PAT corrente non ha permesso push su ${repository}. La gestione Serie A resta in sola lettura.`,
    }
  }
  if (!branch) {
    return {
      canWrite: false,
      repository,
      branch: null,
      reason: `Branch del repository piattaforma ${repository} non disponibile.`,
    }
  }
  return { canWrite: true, repository, branch, reason: null }
}

export async function saveSerieADelayedChanges(
  runtime: SerieAAdminRuntime,
  actor: UserOfAGroup,
  season: number,
  changes: readonly SerieADelayedChange[],
  client: SerieAAdminGitHubClient = new GitHubClient(runtime.connection.token),
): Promise<{ calendar: RealCalendar; changedGames: number }> {
  assertSeason(season)
  if (changes.length === 0) throw new Error('Nessuna modifica Serie A da salvare.')
  const access = await requireSerieAAdminAccess(runtime, actor, client)
  const snapshot = await runtime.realCalendarRepository.getCalendarSnapshot(season, { refresh: true })
  if (!snapshot) throw new Error(`Calendario Serie A ${season} non trovato.`)

  const next = clone(snapshot.value)
  const seen = new Set<string>()
  let changedGames = 0
  for (const change of changes) {
    assertDay(change.serieADay)
    const fixtureKey = delayedChangeKey(change)
    if (seen.has(fixtureKey)) throw new Error(`Modifica duplicata per ${change.home} - ${change.away}, giornata ${change.serieADay}.`)
    seen.add(fixtureKey)

    const day = next.days.find(item => item.serieADay === change.serieADay)
    if (!day) throw new Error(`Giornata Serie A ${change.serieADay} non trovata nel calendario fresco.`)
    const matches = day.games.filter(game =>
      sameText(game.home.name, change.home) && sameText(game.away.name, change.away),
    )
    if (matches.length !== 1) {
      throw new Error(
        `La partita ${change.home} - ${change.away} della giornata ${change.serieADay} non è più identificabile in modo univoco. Ricarica il calendario.`,
      )
    }
    if (matches[0].delayed !== change.delayed) {
      matches[0].delayed = change.delayed
      changedGames += 1
    }
  }

  if (changedGames === 0) return { calendar: snapshot.value, changedGames: 0 }
  await runtime.realCalendarRepository.writeCalendar(
    next,
    `admin: update Serie A delayed games ${season}`,
    { expectedSha: snapshot.sha, branch: access.branch! },
  )
  return { calendar: next, changedGames }
}

export async function dispatchSerieAPlatformJob(
  runtime: SerieAAdminRuntime,
  actor: UserOfAGroup,
  input: { job: SerieAPlatformJob; season: number; day?: number },
  client: SerieAAdminGitHubClient = new GitHubClient(runtime.connection.token),
): Promise<void> {
  assertSeason(input.season)
  if (input.day != null) assertDay(input.day)
  if (input.job === 'ingest-final-votes' && input.day == null) {
    throw new Error('L’import dei voti finali richiede una giornata Serie A.')
  }
  const access = await requireSerieAAdminAccess(runtime, actor, client)
  const inputs: Record<string, string> = {
    job: input.job,
    season: String(input.season),
  }
  if (input.day != null) inputs.day = String(input.day)
  await client.dispatchWorkflow(
    runtime.platformTarget.owner,
    runtime.platformTarget.repo,
    PLATFORM_BACKGROUND_WORKFLOW_ID,
    access.branch!,
    inputs,
  )
}

export function delayedChangeKey(change: Pick<SerieADelayedChange, 'serieADay' | 'home' | 'away'>): string {
  return `${change.serieADay}|${normalize(change.home)}|${normalize(change.away)}`
}

async function requireSerieAAdminAccess(
  runtime: SerieAAdminRuntime,
  actor: UserOfAGroup,
  client: SerieAAdminGitHubClient,
): Promise<SerieAAdminAccess> {
  const access = await getSerieAAdminAccess(runtime, actor, client)
  if (!access.canWrite) throw new Error(access.reason ?? 'Accesso amministrativo Serie A non disponibile.')
  return access
}

function assertSeason(season: number): void {
  if (!Number.isInteger(season) || season < 1) throw new Error('La stagione deve essere un identificatore positivo.')
}

function assertDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 38) throw new Error('La giornata Serie A deve essere compresa tra 1 e 38.')
}

function sameText(left: string, right: string): boolean {
  return normalize(left) === normalize(right)
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('it-IT')
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
