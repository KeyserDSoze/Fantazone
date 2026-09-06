import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  getFormationSnapshotTargetSerieADay,
  type RealCalendar,
} from '@fantazone/domain'
import {
  dayTeamDocumentPath,
  realCalendarDocumentPath,
} from '@fantazone/github'

export const FORMATION_SNAPSHOT_CURSOR_PATH = 'data/groups/runtime/formation-snapshot-cursor.json'

export type FormationSnapshotCursor = {
  version: 1
  processedThroughCommit: string
  updatedAt: string
}

export type FormationSnapshotSource = {
  version: 1
  sourceCommit: string
  sourceCommittedAt: string
}

export type SnapshotSavedFormationsOptions = {
  groupRepoRoot: string
  platformRepoRoot: string
  /** GitHub push `before` SHA. Used only to seed a repository that has no cursor yet. */
  fallbackBefore?: string
  now?: Date
}

export type SnapshotSavedFormationsResult = {
  deferred: boolean
  processedThroughCommit: string | null
  inspectedCommits: number
  changedTeamFiles: number
  writtenSnapshots: number
  staleSnapshots: number
  noTargetSnapshots: number
}

type SeasonTeamPath = {
  path: string
  season: number
  basketId: string
  owner: string
}

/**
 * Consolidates every unprocessed season-Team commit into the correct immutable
 * TeamDay snapshot. The Git commit timestamp is the authoritative deadline clock.
 *
 * A persisted cursor makes this safe with GitHub Actions concurrency: even if an
 * intermediate pending workflow run is replaced, the next run scans every commit
 * after the cursor and therefore cannot lose a pre-kickoff save.
 */
export async function snapshotSavedFormations(
  options: SnapshotSavedFormationsOptions,
): Promise<SnapshotSavedFormationsResult> {
  const manifest = await readOptionalJson<Record<string, unknown>>(resolve(options.groupRepoRoot, 'manifest.json'))
  if (manifest?.updating === true) return emptyResult(true)

  const head = gitLine(options.groupRepoRoot, 'rev-parse', 'HEAD')
  const cursorPath = resolve(options.groupRepoRoot, FORMATION_SNAPSHOT_CURSOR_PATH)
  const cursor = decodeCursor(await readOptionalJson<unknown>(cursorPath))
  const baseline = resolveBaseline(options.groupRepoRoot, head, cursor, options.fallbackBefore)
  const commits = listCommits(options.groupRepoRoot, baseline, head)
  if (commits.length === 0) {
    return {
      ...emptyResult(false),
      processedThroughCommit: cursor?.processedThroughCommit ?? null,
    }
  }

  const calendars = new Map<number, RealCalendar | null>()
  let changedTeamFiles = 0
  let writtenSnapshots = 0
  let staleSnapshots = 0
  let noTargetSnapshots = 0

  for (const commit of commits) {
    const teamPaths = changedSeasonTeamPaths(options.groupRepoRoot, commit)
    if (teamPaths.length === 0) continue

    const committedAtText = gitLine(options.groupRepoRoot, 'show', '-s', '--format=%cI', commit)
    const committedAt = new Date(committedAtText)
    if (!Number.isFinite(committedAt.getTime())) throw new Error(`Commit ${commit} has an invalid committer date`)

    for (const teamPath of teamPaths) {
      const sourceText = gitFileAtCommit(options.groupRepoRoot, commit, teamPath.path)
      if (sourceText == null) continue
      const parsed: unknown = JSON.parse(sourceText)
      if (!parsed || typeof parsed !== 'object') throw new Error(`Invalid Team JSON in ${teamPath.path} at ${commit}`)
      changedTeamFiles += 1

      let calendar = calendars.get(teamPath.season)
      if (calendar === undefined) {
        calendar = await readOptionalJson<RealCalendar>(
          resolve(options.platformRepoRoot, realCalendarDocumentPath(teamPath.season)),
        )
        calendars.set(teamPath.season, calendar)
      }
      if (!calendar) {
        noTargetSnapshots += 1
        continue
      }

      const targetDay = getFormationSnapshotTargetSerieADay(calendar, committedAt)
      if (targetDay == null) {
        noTargetSnapshots += 1
        continue
      }

      const targetPath = resolve(
        options.groupRepoRoot,
        dayTeamDocumentPath(teamPath.basketId, teamPath.season, targetDay, teamPath.owner),
      )
      const sourcePath = resolve(
        options.groupRepoRoot,
        formationSnapshotSourceDocumentPath(teamPath.basketId, teamPath.season, targetDay, teamPath.owner),
      )
      const existingSource = decodeSource(await readOptionalJson<unknown>(sourcePath))
      if (existingSource && !isNewerSource(options.groupRepoRoot, existingSource, commit, committedAt)) {
        staleSnapshots += 1
        continue
      }

      await writeText(targetPath, sourceText)
      await writeJson(sourcePath, {
        version: 1,
        sourceCommit: commit,
        sourceCommittedAt: committedAt.toISOString(),
      } satisfies FormationSnapshotSource)
      writtenSnapshots += 1
    }
  }

  await writeJson(cursorPath, {
    version: 1,
    processedThroughCommit: head,
    updatedAt: (options.now ?? new Date()).toISOString(),
  } satisfies FormationSnapshotCursor)

  return {
    deferred: false,
    processedThroughCommit: head,
    inspectedCommits: commits.length,
    changedTeamFiles,
    writtenSnapshots,
    staleSnapshots,
    noTargetSnapshots,
  }
}

export function formationSnapshotSourceDocumentPath(
  basketId: string,
  season: number,
  day: number,
  owner: string,
): string {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
  if (!Number.isInteger(day) || day < 1 || day > 38) throw new Error('Serie A day must be between 1 and 38')
  if (!basketId.trim()) throw new Error('Basket id is required')
  if (!owner.trim()) throw new Error('Owner email is required')
  return `data/groups/seasons/${season}/days/${day}/formation-sources/${encodeURIComponent(basketId.trim())}/${encodeURIComponent(owner.trim())}.json`
}

function changedSeasonTeamPaths(root: string, commit: string): SeasonTeamPath[] {
  const raw = gitRaw(root, 'diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', commit)
  return raw
    .split('\0')
    .filter(Boolean)
    .map(parseSeasonTeamPath)
    .filter((value): value is SeasonTeamPath => value !== null)
}

function parseSeasonTeamPath(path: string): SeasonTeamPath | null {
  const match = /^data\/groups\/seasons\/(\d+)\/teams\/([^/]+)\/([^/]+)\.json$/.exec(path)
  if (!match) return null
  try {
    return {
      path,
      season: Number.parseInt(match[1], 10),
      basketId: decodeURIComponent(match[2]),
      owner: decodeURIComponent(match[3]),
    }
  } catch {
    return null
  }
}

function resolveBaseline(
  root: string,
  head: string,
  cursor: FormationSnapshotCursor | null,
  fallbackBefore: string | undefined,
): string | null {
  if (cursor?.processedThroughCommit && isAncestor(root, cursor.processedThroughCommit, head)) {
    return cursor.processedThroughCommit
  }

  const fallback = fallbackBefore?.trim()
  if (!fallback || /^0+$/.test(fallback) || !isAncestor(root, fallback, head)) return parentOf(root, head)

  // Include the `before` commit itself. On a normal RepositoryRevision write the
  // stable-manifest push has the Team commit as its `before` SHA.
  return parentOf(root, fallback)
}

function listCommits(root: string, baseline: string | null, head: string): string[] {
  const output = baseline
    ? gitLine(root, 'rev-list', '--reverse', `${baseline}..${head}`)
    : gitLine(root, 'rev-list', '--reverse', head)
  return output.split('\n').map(value => value.trim()).filter(Boolean)
}

function parentOf(root: string, commit: string): string | null {
  try {
    return gitLine(root, 'rev-parse', `${commit}^`)
  } catch {
    return null
  }
}

function isNewerSource(
  root: string,
  existing: FormationSnapshotSource,
  incomingCommit: string,
  incomingCommittedAt: Date,
): boolean {
  if (existing.sourceCommit === incomingCommit) return false
  const existingTime = Date.parse(existing.sourceCommittedAt)
  if (!Number.isFinite(existingTime)) return true
  if (incomingCommittedAt.getTime() > existingTime) return true
  if (incomingCommittedAt.getTime() < existingTime) return false
  return isAncestor(root, existing.sourceCommit, incomingCommit)
}

function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: root,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function gitFileAtCommit(root: string, commit: string, path: string): string | null {
  try {
    return gitRaw(root, 'show', `${commit}:${path}`)
  } catch {
    return null
  }
}

function gitLine(root: string, ...args: string[]): string {
  return gitRaw(root, ...args).trim()
}

function gitRaw(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

function decodeCursor(value: unknown): FormationSnapshotCursor | null {
  if (!value || typeof value !== 'object') return null
  const cursor = value as Partial<FormationSnapshotCursor>
  return cursor.version === 1 && typeof cursor.processedThroughCommit === 'string' && typeof cursor.updatedAt === 'string'
    ? cursor as FormationSnapshotCursor
    : null
}

function decodeSource(value: unknown): FormationSnapshotSource | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<FormationSnapshotSource>
  return source.version === 1 && typeof source.sourceCommit === 'string' && typeof source.sourceCommittedAt === 'string'
    ? source as FormationSnapshotSource
    : null
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
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value, 'utf8')
}

function emptyResult(deferred: boolean): SnapshotSavedFormationsResult {
  return {
    deferred,
    processedThroughCommit: null,
    inspectedCommits: 0,
    changedTeamFiles: 0,
    writtenSnapshots: 0,
    staleSnapshots: 0,
    noTargetSnapshots: 0,
  }
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
