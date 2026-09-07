import { RealCalendarHelper, type RealCalendar } from './realCalendar'
import { normalizePushEmail } from './pushNotification'

export const DEPLOYMENT_REMINDER_WINDOW_MS = 8 * 60 * 60 * 1000
export const DEPLOYMENT_REMINDER_MARKER_VERSION = 1 as const

export type DeploymentReminderTarget = {
  year: number
  serieADay: number
  kickoffAt: string
}

export type DeploymentReminderMarker = {
  version: typeof DEPLOYMENT_REMINDER_MARKER_VERSION
  year: number
  serieADay: number
  sentEmails: string[]
  updatedAt: string
}

/**
 * Returns the upcoming Serie A day only during the eight-hour pre-kickoff window.
 * Delayed games are ignored and a reminder is never generated after kickoff.
 */
export function getDeploymentReminderTarget(
  calendar: RealCalendar,
  now = new Date(),
): DeploymentReminderTarget | null {
  const nextDay = RealCalendarHelper.getNextDay(calendar, now)
  if (!nextDay) return null
  const nowMs = now.getTime()
  const kickoff = nextDay.games
    .filter(game => !game.delayed && Boolean(game.date))
    .map(game => Date.parse(game.date!))
    .filter(value => Number.isFinite(value) && value > nowMs && value - nowMs < DEPLOYMENT_REMINDER_WINDOW_MS)
    .sort((a, b) => a - b)[0]
  if (kickoff == null) return null
  return {
    year: calendar.year,
    serieADay: nextDay.serieADay,
    kickoffAt: new Date(kickoff).toISOString(),
  }
}

export function emptyDeploymentReminderMarker(
  target: Pick<DeploymentReminderTarget, 'year' | 'serieADay'>,
  now = new Date(),
): DeploymentReminderMarker {
  return {
    version: DEPLOYMENT_REMINDER_MARKER_VERSION,
    year: target.year,
    serieADay: target.serieADay,
    sentEmails: [],
    updatedAt: now.toISOString(),
  }
}

export function hasDeploymentReminderBeenSent(marker: DeploymentReminderMarker, email: string): boolean {
  const normalized = normalizePushEmail(email)
  return marker.sentEmails.some(item => normalizePushEmail(item) === normalized)
}

export function markDeploymentReminderSent(
  marker: DeploymentReminderMarker,
  email: string,
  now = new Date(),
): DeploymentReminderMarker {
  validateMarker(marker)
  const normalized = normalizePushEmail(email)
  if (!normalized || !normalized.includes('@')) throw new Error('Deployment reminder email is invalid')
  if (hasDeploymentReminderBeenSent(marker, normalized)) return { ...marker, updatedAt: now.toISOString() }
  return {
    ...marker,
    sentEmails: [...marker.sentEmails, normalized],
    updatedAt: now.toISOString(),
  }
}

export function validateDeploymentReminderMarker(
  marker: DeploymentReminderMarker,
  expected?: { year: number; serieADay: number },
): DeploymentReminderMarker {
  validateMarker(marker)
  if (expected && (marker.year !== expected.year || marker.serieADay !== expected.serieADay)) {
    throw new Error(`Deployment reminder marker mismatch: expected ${expected.year}/${expected.serieADay}`)
  }
  const sentEmails = marker.sentEmails.map(normalizePushEmail)
  if (sentEmails.some(email => !email || !email.includes('@'))) throw new Error('Deployment reminder marker contains an invalid email')
  if (new Set(sentEmails).size !== sentEmails.length) throw new Error('Deployment reminder marker contains duplicate emails')
  return { ...marker, sentEmails }
}

function validateMarker(marker: DeploymentReminderMarker): void {
  if (!marker || typeof marker !== 'object') throw new Error('Invalid deployment reminder marker')
  if (marker.version !== DEPLOYMENT_REMINDER_MARKER_VERSION) throw new Error('Unsupported deployment reminder marker version')
  if (!Number.isInteger(marker.year) || marker.year < 1) throw new Error('Invalid deployment reminder season')
  if (!Number.isInteger(marker.serieADay) || marker.serieADay < 1 || marker.serieADay > 38) throw new Error('Invalid deployment reminder day')
  if (!Array.isArray(marker.sentEmails)) throw new Error('Invalid deployment reminder recipients')
  if (!marker.updatedAt || Number.isNaN(Date.parse(marker.updatedAt))) throw new Error('Invalid deployment reminder updatedAt')
}
