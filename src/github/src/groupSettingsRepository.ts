import type { Group } from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export const GROUP_SETTINGS_PATH = 'settings.json'
export const GROUP_SETTINGS_VERSION = 1

export type GroupDisplaySettings = {
  name: string
  description?: string
}

export type LeagueDisplaySettings = {
  name: string
}

export type GroupRepositorySettings = {
  version: 1
  group: GroupDisplaySettings
  leagues: Record<string, LeagueDisplaySettings>
}

export class GitHubGroupSettingsRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
  ) {}

  async getSettings(options: RepositoryJsonReadOptions = {}): Promise<GroupRepositorySettings | null> {
    const snapshot = await this.store.tryReadJson<unknown>(this.location(), options)
    return snapshot ? decodeGroupRepositorySettings(snapshot.value) : null
  }

  async writeSettings(
    settings: GroupRepositorySettings,
    message = 'chore: update group display settings',
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    const normalized = decodeGroupRepositorySettings(settings)
    return (await this.store.writeJson(this.location(), normalized, message, options)).sha
  }

  private location() {
    return { ...this.repository, path: GROUP_SETTINGS_PATH }
  }
}

export function createGroupRepositorySettings(group: Group): GroupRepositorySettings {
  return {
    version: GROUP_SETTINGS_VERSION,
    group: { name: requiredName(group.name, 'Group name') },
    leagues: Object.fromEntries(group.leagues.map(league => [
      league.id,
      { name: requiredName(league.name || league.id, `League ${league.id} name`) },
    ])),
  }
}

export function applyGroupRepositorySettings(group: Group, settings: GroupRepositorySettings | null): Group {
  if (!settings) return group
  return {
    ...group,
    name: settings.group.name,
    leagues: group.leagues.map(league => ({
      ...league,
      name: settings.leagues[league.id]?.name || league.name,
    })),
  }
}

export function decodeGroupRepositorySettings(value: unknown): GroupRepositorySettings {
  if (!value || typeof value !== 'object') throw new Error('settings.json must contain an object')
  const candidate = value as Partial<GroupRepositorySettings>
  if (candidate.version !== GROUP_SETTINGS_VERSION) {
    throw new Error(`Unsupported settings.json version ${String(candidate.version)}`)
  }
  if (!candidate.group || typeof candidate.group !== 'object') throw new Error('settings.json group is required')
  const group = candidate.group as Partial<GroupDisplaySettings>
  const leaguesValue = candidate.leagues
  if (!leaguesValue || typeof leaguesValue !== 'object' || Array.isArray(leaguesValue)) {
    throw new Error('settings.json leagues must be an object')
  }

  const leagues: Record<string, LeagueDisplaySettings> = {}
  for (const [id, raw] of Object.entries(leaguesValue)) {
    if (!id.trim()) throw new Error('settings.json contains an empty league id')
    if (!raw || typeof raw !== 'object') throw new Error(`settings.json league ${id} is invalid`)
    const name = requiredName((raw as Partial<LeagueDisplaySettings>).name, `League ${id} name`)
    leagues[id] = { name }
  }

  const description = typeof group.description === 'string' && group.description.trim()
    ? group.description.trim()
    : undefined

  return {
    version: GROUP_SETTINGS_VERSION,
    group: {
      name: requiredName(group.name, 'Group name'),
      ...(description ? { description } : {}),
    },
    leagues,
  }
}

function requiredName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}
