import type { ExternalIdentity } from '@fantazone/domain'
import { repositoryPersistentCache } from './repositoryPersistentCache'
import { decodeUserSettings, type UserSettings } from './userSettingsOneDrive'

const IDENTITY_KEY = '__local__/microsoft-identity.v1'
const SETTINGS_PREFIX = '__local__/user-settings.v1/'
const LOCAL_SHA = 'local-v1'

export async function saveCachedIdentity(identity: ExternalIdentity): Promise<void> {
  await repositoryPersistentCache.set(IDENTITY_KEY, { value: identity, sha: LOCAL_SHA })
}

export async function loadCachedIdentity(): Promise<ExternalIdentity | null> {
  const entry = await repositoryPersistentCache.get(IDENTITY_KEY)
  const value = entry?.value
  if (!value || typeof value !== 'object') return null
  const identity = value as Partial<ExternalIdentity>
  if (identity.provider !== 'microsoft' || typeof identity.subject !== 'string' || typeof identity.email !== 'string') return null
  return identity as ExternalIdentity
}

export async function clearCachedIdentity(): Promise<void> {
  await repositoryPersistentCache.delete(IDENTITY_KEY)
}

export async function saveCachedUserSettings(identity: ExternalIdentity, settings: UserSettings): Promise<void> {
  await repositoryPersistentCache.set(settingsKey(identity), { value: settings, sha: LOCAL_SHA })
}

export async function loadCachedUserSettings(identity: ExternalIdentity): Promise<UserSettings | null> {
  const entry = await repositoryPersistentCache.get(settingsKey(identity))
  const value = entry?.value
  if (!value || typeof value !== 'object') return null
  const candidate = value as { version?: unknown; groups?: unknown }
  if ((candidate.version !== 1 && candidate.version !== 2 && candidate.version !== 3) || !Array.isArray(candidate.groups)) return null
  return decodeUserSettings(value)
}

function settingsKey(identity: ExternalIdentity): string {
  return `${SETTINGS_PREFIX}${identity.provider}:${identity.subject.trim()}`
}
