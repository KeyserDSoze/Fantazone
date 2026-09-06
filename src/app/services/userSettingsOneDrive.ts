export type StoredGroup = {
  id: string
  name: string
  repository: string
  /** Shared GitHub credential for this group. Missing only on legacy v1 settings. */
  pat?: string
}

export type UserSettings = {
  version: 2
  groups: StoredGroup[]
}

const SETTINGS_URL = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/settings.json:/content'

export async function loadUserSettings(graphAccessToken: string): Promise<UserSettings> {
  const response = await graphRequest(graphAccessToken, SETTINGS_URL)
  if (response.status === 404) {
    const initial = emptyUserSettings()
    await saveUserSettings(graphAccessToken, initial)
    return initial
  }
  if (!response.ok) throw new Error(`Impossibile leggere settings.json da OneDrive (HTTP ${response.status}).`)
  return decodeUserSettings(await response.json())
}

export async function saveUserSettings(graphAccessToken: string, settings: UserSettings): Promise<void> {
  const response = await graphRequest(graphAccessToken, SETTINGS_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: `${JSON.stringify(decodeUserSettings(settings), null, 2)}\n`,
  })
  if (!response.ok) throw new Error(`Impossibile salvare settings.json su OneDrive (HTTP ${response.status}).`)
}

export function emptyUserSettings(): UserSettings {
  return { version: 2, groups: [] }
}

export function createStoredGroup(input: { name: string; repository: string; pat?: string }): StoredGroup {
  return normalizeStoredGroup({
    id: newId(),
    name: input.name,
    repository: input.repository,
    pat: input.pat,
  })
}

export function upsertStoredGroup(settings: UserSettings, group: StoredGroup): UserSettings {
  const current = decodeUserSettings(settings)
  const normalized = normalizeStoredGroup(group)
  const groups = current.groups.filter(existing =>
    existing.id !== normalized.id && existing.repository.toLowerCase() !== normalized.repository.toLowerCase())
  groups.push(normalized)
  groups.sort((a, b) => a.name.localeCompare(b.name, 'it-IT'))
  return { version: 2, groups }
}

export function removeStoredGroup(settings: UserSettings, groupId: string): UserSettings {
  const normalizedId = groupId.trim()
  const current = decodeUserSettings(settings)
  if (!normalizedId) return current
  return {
    version: 2,
    groups: current.groups.filter(group => group.id !== normalizedId),
  }
}

/**
 * Reads both the old catalog-only v1 format and the shared-credential v2 format.
 * v1 groups are retained with `pat` absent so the app can migrate an existing
 * local credential into OneDrive after one successful open/reconnect.
 */
export function decodeUserSettings(value: unknown): UserSettings {
  if (!value || typeof value !== 'object') return emptyUserSettings()
  const raw = value as { version?: unknown; groups?: unknown }
  if ((raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.groups)) return emptyUserSettings()
  return {
    version: 2,
    groups: raw.groups.flatMap(value => {
      try { return [normalizeStoredGroup(value as StoredGroup)] } catch { return [] }
    }),
  }
}

async function graphRequest(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}

function normalizeStoredGroup(group: StoredGroup): StoredGroup {
  const id = group.id?.trim()
  const name = group.name?.trim()
  const repository = group.repository?.trim()
  const pat = typeof group.pat === 'string' ? group.pat.trim() : ''
  if (!id || !name || !repository) throw new Error('Gruppo OneDrive non valido.')
  return { id, name, repository, ...(pat ? { pat } : {}) }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
