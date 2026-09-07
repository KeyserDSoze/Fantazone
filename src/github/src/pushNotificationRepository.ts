import {
  emptyPushNotificationSettings,
  normalizePushEmail,
  validatePushNotificationSettings,
  type PushNotificationSettings,
} from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonSnapshot,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export const GROUP_PUSH_ROOT = 'data/push/users'

export function pushNotificationSettingsPath(email: string): string {
  const normalized = normalizePushEmail(email)
  if (!normalized || !normalized.includes('@')) throw new Error('Push notification email is invalid')
  return `${GROUP_PUSH_ROOT}/${hexUtf8(normalized)}.json`
}

export class GitHubPushNotificationRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
  ) {}

  async getSnapshot(
    email: string,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<PushNotificationSettings> | null> {
    const snapshot = await this.store.tryReadJson<unknown>(this.location(email), options)
    if (!snapshot) return null
    return { ...snapshot, value: decodePushNotificationSettings(snapshot.value, email) }
  }

  async get(email: string, options: RepositoryJsonReadOptions = {}): Promise<PushNotificationSettings> {
    return (await this.getSnapshot(email, options))?.value ?? emptyPushNotificationSettings(email)
  }

  async write(
    settings: PushNotificationSettings,
    message = `chore: update push settings ${normalizePushEmail(settings.email)}`,
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    const decoded = validatePushNotificationSettings(settings)
    return (await this.store.writeJson(this.location(decoded.email), decoded, message, options)).sha
  }

  private location(email: string) {
    return { ...this.repository, path: pushNotificationSettingsPath(email) }
  }
}

export function decodePushNotificationSettings(value: unknown, expectedEmail?: string): PushNotificationSettings {
  if (!value || typeof value !== 'object') throw new Error('Unsupported push notification settings JSON schema')
  const decoded = validatePushNotificationSettings(value as PushNotificationSettings)
  if (expectedEmail && normalizePushEmail(decoded.email) !== normalizePushEmail(expectedEmail)) {
    throw new Error(`Push notification email mismatch: expected ${normalizePushEmail(expectedEmail)}, found ${decoded.email}`)
  }
  return decoded
}

function hexUtf8(value: string): string {
  return Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('')
}
