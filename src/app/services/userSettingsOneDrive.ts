export type StoredGroup = {
  id: string
  name: string
  repository: string
}

export type UserSettings = {
  version: 1
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
  return { version: 1, groups: [] }
}

export function createStoredGroup(input: { name: string; repository: string }): StoredGroup {
  return { id: newId(), name: input.name.trim(), repository: input.repository.trim() }
}

export function upsertStoredGroup(settings: UserSettings, group: StoredGroup): UserSettings {
  const normalized = normalizeStoredGroup(group)
  const groups = settings.groups.filter(existing =>
    existing.id !== normalized.id && existing.repository.toLowerCase() !== normalized.repository.toLowerCase())
  groups.push(normalized)
  groups.sort((a, b) => a.name.localeCompare(b.name, 'it-IT'))
  return { version: 1, groups }
}

export function decodeUserSettings(value: unknown): UserSettings {
  if (!value || typeof value !== 'object') return emptyUserSettings()
  const raw = value as { version?: unknown; groups?: unknown }
  if (raw.version !== 1 || !Array.isArray(raw.groups)) return emptyUserSettings()
  return {
    version: 1,
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
  if (!id || !name || !repository) throw new Error('Gruppo OneDrive non valido.')
  return { id, name, repository }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
