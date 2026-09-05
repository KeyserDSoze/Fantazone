import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  getCurrentSeasonYear,
  getFormationPropagationWindow,
  type Group,
  type RealCalendar,
} from '@fantazone/domain'
import {
  GROUP_DOCUMENT_PATH,
  dayTeamDocumentPath,
  isGroupDocument,
  realCalendarDocumentPath,
} from '@fantazone/github'

export type FormationPropagationOptions = {
  groupRepoRoot: string
  platformRepoRoot: string
  season?: number
  now?: Date
}

export type FormationPropagationResult = {
  season: number
  sourceSerieADay: number | null
  targetSerieADay: number | null
  source: 'live' | 'last-completed' | null
  copiedOwners: string[]
  existingOwners: string[]
  missingSourceOwners: string[]
}

/**
 * Group-owned filesystem port of legacy SetFormationJob.
 * It never overwrites an existing target TeamDay and copies source JSON byte-for-byte.
 */
export async function propagateNextFormations(
  options: FormationPropagationOptions,
): Promise<FormationPropagationResult> {
  const season = options.season ?? getCurrentSeasonYear(options.now ?? new Date())
  assertSeason(season)

  const group = await readGroup(options.groupRepoRoot)
  const calendar = await readOptionalJson<RealCalendar>(
    resolve(options.platformRepoRoot, realCalendarDocumentPath(season)),
  )
  const window = calendar ? getFormationPropagationWindow(calendar, options.now ?? new Date()) : null
  if (!window) return emptyResult(season)

  const copiedOwners: string[] = []
  const existingOwners: string[] = []
  const missingSourceOwners: string[] = []

  for (const basket of group.baskets ?? []) {
    if (!basket.id?.trim()) continue
    const yearly = basket.years?.find(item => item.year === season)
    const teams = Array.isArray(yearly?.teams) ? yearly.teams : []
    for (const annualTeam of teams) {
      const owner = annualTeam.owner?.trim()
      if (!owner) continue
      const targetPath = resolve(
        options.groupRepoRoot,
        dayTeamDocumentPath(basket.id, season, window.targetSerieADay, owner),
      )
      if (await readOptionalText(targetPath) != null) {
        existingOwners.push(owner)
        continue
      }

      const sourcePath = resolve(
        options.groupRepoRoot,
        dayTeamDocumentPath(basket.id, season, window.sourceSerieADay, owner),
      )
      const sourceText = await readOptionalText(sourcePath)
      if (sourceText == null) {
        missingSourceOwners.push(owner)
        continue
      }

      // Match repository-object semantics: malformed source state must fail rather than propagate corruption.
      JSON.parse(sourceText)
      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(targetPath, sourceText, 'utf8')
      copiedOwners.push(owner)
    }
  }

  return {
    season,
    sourceSerieADay: window.sourceSerieADay,
    targetSerieADay: window.targetSerieADay,
    source: window.source,
    copiedOwners,
    existingOwners,
    missingSourceOwners,
  }
}

async function readGroup(root: string): Promise<Group> {
  const path = resolve(root, GROUP_DOCUMENT_PATH)
  const value = await readRequiredJson<unknown>(path, 'Group')
  if (!isGroupDocument(value)) throw new Error(`Unsupported group JSON schema in ${path}`)
  return value
}

async function readRequiredJson<T>(path: string, label: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if (isFileNotFound(error)) throw new Error(`${label} non trovato in ${path}`)
    throw error
  }
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  const text = await readOptionalText(path)
  return text == null ? null : JSON.parse(text) as T
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isFileNotFound(error)) return null
    throw error
  }
}

function emptyResult(season: number): FormationPropagationResult {
  return {
    season,
    sourceSerieADay: null,
    targetSerieADay: null,
    source: null,
    copiedOwners: [],
    existingOwners: [],
    missingSourceOwners: [],
  }
}

function assertSeason(season: number): void {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
