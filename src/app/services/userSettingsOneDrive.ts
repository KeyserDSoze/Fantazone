export type StoredGroup = {
  id: string
  name: string
  repository: string
  /** Shared GitHub credential for this group. Missing only on legacy v1 settings. */
  pat?: string
  /** Opens this group automatically when more than one group is configured. */
  isDefault?: boolean
}

export type UserSettings = {
  version: 3
  groups: StoredGroup[]
}

export type StoredGroupSnapshot = {
  /** Current display name resolved from the repository root settings.json. */
  name: string
  /** Canonical owner/repository returned by GitHub. Defaults to the stored locator. */
  repository?: string
  /** Current shared PAT. Omitted to preserve the stored credential. */
  pat?: string
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
  const raw = await response.json()
  const decoded = decodeUserSettings(raw)
  if (isLegacySettingsVersion(raw)) await saveUserSettings(graphAccessToken, decoded)
  return decoded
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
  return { version: 3, groups: [] }
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
  let groups = current.groups.filter(existing =>
    existing.id !== normalized.id && existing.repository.toLowerCase() !== normalized.repository.toLowerCase())

  if (normalized.isDefault) groups = groups.map(clearDefault)
  groups.push(normalized)
  groups.sort((a, b) => a.name.localeCompare(b.name, 'it-IT'))
  return normalizeDefaultGroup({ version: 3, groups })
}

/**
 * Reconciles one user's OneDrive catalog copy with the display metadata just read
 * from the selected group repository. The repository remains the source of truth;
 * this only dirties the personal catalog when something actually changed.
 */
export function reconcileStoredGroup(
  settings: UserSettings,
  storedGroup: StoredGroup,
  snapshot: StoredGroupSnapshot,
): { settings: UserSettings; changed: boolean } {
  const current = decodeUserSettings(settings)
  const existing = current.groups.find(group =>
    group.id === storedGroup.id || group.repository.toLowerCase() === storedGroup.repository.toLowerCase())
  const next = normalizeStoredGroup({
    ...storedGroup,
    name: snapshot.name,
    repository: snapshot.repository ?? storedGroup.repository,
    pat: snapshot.pat === undefined ? storedGroup.pat : snapshot.pat,
  })

  const changed = !existing ||
    existing.id !== next.id ||
    existing.name !== next.name ||
    existing.repository !== next.repository ||
    existing.pat !== next.pat ||
    Boolean(existing.isDefault) !== Boolean(next.isDefault)

  return {
    settings: changed ? upsertStoredGroup(current, next) : current,
    changed,
  }
}

export function removeStoredGroup(settings: UserSettings, groupId: string): UserSettings {
  const normalizedId = groupId.trim()
  const current = decodeUserSettings(settings)
  if (!normalizedId) return current
  return normalizeDefaultGroup({
    version: 3,
    groups: current.groups.filter(group => group.id !== normalizedId),
  })
}

/**
 * Reads the catalog-only v1 format, the shared-credential v2 format and v3 with
 * an optional default group. A single group is always considered the default.
 */
export function decodeUserSettings(value: unknown): UserSettings {
  if (!value || typeof value !== 'object') return emptyUserSettings()
  const raw = value as { version?: unknown; groups?: unknown }
  if ((raw.version !== 1 && raw.version !== 2 && raw.version !== 3) || !Array.isArray(raw.groups)) {
    return emptyUserSettings()
  }
  return normalizeDefaultGroup({
    version: 3,
    groups: raw.groups.flatMap(value => {
      try { return [normalizeStoredGroup(value as StoredGroup)] } catch { return [] }
    }),
  })
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
  return {
    id,
    name,
    repository,
    ...(pat ? { pat } : {}),
    ...(group.isDefault === true ? { isDefault: true } : {}),
  }
}

function normalizeDefaultGroup(settings: UserSettings): UserSettings {
  let foundDefault = false
  let groups = settings.groups.map(group => {
    if (!group.isDefault) return group
    if (!foundDefault) {
      foundDefault = true
      return group
    }
    return clearDefault(group)
  })

  if (groups.length === 1 && !groups[0].isDefault) groups = [{ ...groups[0], isDefault: true }]
  return { version: 3, groups }
}

function clearDefault(group: StoredGroup): StoredGroup {
  const { isDefault: _isDefault, ...rest } = group
  return rest
}

function isLegacySettingsVersion(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { version?: unknown }).version !== 3)
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
