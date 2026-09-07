export const PUSH_NOTIFICATION_SETTINGS_VERSION = 1 as const

export type PushSubscription = {
  endpoint: string
  p256dh: string
  auth: string
  createdAt: string
}

export type PushNotificationSettings = {
  version: typeof PUSH_NOTIFICATION_SETTINGS_VERSION
  email: string
  matchEvents: boolean
  opponentMatchEvents: boolean
  deploymentReminder: boolean
  endDay: boolean
  marketEvents: boolean
  subscriptions: PushSubscription[]
}

export type PushNotificationPreferences = Pick<
  PushNotificationSettings,
  'matchEvents' | 'opponentMatchEvents' | 'deploymentReminder' | 'endDay' | 'marketEvents'
>

export function emptyPushNotificationSettings(email: string): PushNotificationSettings {
  const normalizedEmail = normalizePushEmail(email)
  if (!normalizedEmail) throw new Error('Push notification email is required')
  return {
    version: PUSH_NOTIFICATION_SETTINGS_VERSION,
    email: normalizedEmail,
    matchEvents: false,
    opponentMatchEvents: false,
    deploymentReminder: false,
    endDay: false,
    marketEvents: false,
    subscriptions: [],
  }
}

export function normalizePushEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}

export function withPushPreferences(
  settings: PushNotificationSettings,
  preferences: PushNotificationPreferences,
): PushNotificationSettings {
  return {
    ...settings,
    matchEvents: Boolean(preferences.matchEvents),
    opponentMatchEvents: Boolean(preferences.opponentMatchEvents),
    deploymentReminder: Boolean(preferences.deploymentReminder),
    endDay: Boolean(preferences.endDay),
    marketEvents: Boolean(preferences.marketEvents),
  }
}

export function addPushSubscription(
  settings: PushNotificationSettings,
  subscription: PushSubscription,
): PushNotificationSettings {
  validatePushSubscription(subscription)
  const next = settings.subscriptions.filter(item => item.endpoint !== subscription.endpoint)
  next.push({ ...subscription })
  return { ...settings, subscriptions: next }
}

export function removePushSubscription(
  settings: PushNotificationSettings,
  endpoint: string,
): PushNotificationSettings {
  return {
    ...settings,
    subscriptions: settings.subscriptions.filter(item => item.endpoint !== endpoint),
  }
}

export function validatePushNotificationSettings(value: PushNotificationSettings): PushNotificationSettings {
  const email = normalizePushEmail(value.email)
  if (!email || !email.includes('@')) throw new Error('Invalid push notification email')
  if (value.version !== PUSH_NOTIFICATION_SETTINGS_VERSION) throw new Error('Unsupported push notification settings version')
  const fields: Array<keyof PushNotificationPreferences> = [
    'matchEvents',
    'opponentMatchEvents',
    'deploymentReminder',
    'endDay',
    'marketEvents',
  ]
  for (const field of fields) {
    if (typeof value[field] !== 'boolean') throw new Error(`Invalid push notification preference ${field}`)
  }
  if (!Array.isArray(value.subscriptions)) throw new Error('Invalid push subscriptions')
  const subscriptions = value.subscriptions.map(subscription => {
    validatePushSubscription(subscription)
    return { ...subscription }
  })
  const unique = new Set(subscriptions.map(item => item.endpoint))
  if (unique.size !== subscriptions.length) throw new Error('Duplicate push subscription endpoint')
  return { ...value, email, subscriptions }
}

export function validatePushSubscription(value: PushSubscription): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid push subscription')
  if (!value.endpoint?.startsWith('https://')) throw new Error('Push subscription endpoint must use HTTPS')
  if (!value.p256dh?.trim() || !value.auth?.trim()) throw new Error('Push subscription keys are required')
  if (!value.createdAt || Number.isNaN(new Date(value.createdAt).getTime())) throw new Error('Push subscription createdAt is invalid')
}
