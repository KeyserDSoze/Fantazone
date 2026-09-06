import { RealCalendarHelper, type RealCalendar } from './realCalendar'

export type FormationPropagationWindow = {
  sourceSerieADay: number
  targetSerieADay: number
  source: 'live' | 'last-completed'
}

/**
 * Pure port of the day-selection part of legacy SetFormationJob.
 * Live day wins over last completed day; missing calendar is handled by callers.
 */
export function getFormationPropagationWindow(
  calendar: RealCalendar,
  now = new Date(),
): FormationPropagationWindow | null {
  const liveDay = RealCalendarHelper.getLiveDay(calendar, now)
  const sourceDay = liveDay ?? RealCalendarHelper.getLastDay(calendar, now)
  if (!sourceDay || sourceDay.serieADay >= 38) return null
  return {
    sourceSerieADay: sourceDay.serieADay,
    targetSerieADay: sourceDay.serieADay + 1,
    source: liveDay ? 'live' : 'last-completed',
  }
}

/**
 * Resolves the immutable TeamDay that a season-Team save is allowed to update.
 * The authoritative instant is the GitHub commit time, never the client clock or
 * the time at which the Action runner happens to start.
 *
 * A save strictly before the first non-delayed match of a Serie A day belongs to
 * that day. At the exact kickoff instant (or later) it rolls to the next day.
 * No snapshot is ever produced beyond Serie A day 38.
 */
export function getFormationSnapshotTargetSerieADay(
  calendar: RealCalendar,
  committedAt: Date,
): number | null {
  const committedAtMs = committedAt.getTime()
  if (!Number.isFinite(committedAtMs)) throw new Error('Formation commit time is invalid')

  const days = [...calendar.days]
    .filter(day => Number.isInteger(day.serieADay) && day.serieADay >= 1 && day.serieADay <= 38)
    .sort((a, b) => a.serieADay - b.serieADay)

  for (const day of days) {
    const kickoff = day.games
      .filter(game => !game.delayed && game.date)
      .map(game => Date.parse(game.date!))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0]

    if (kickoff != null && committedAtMs < kickoff) return day.serieADay
  }

  return null
}
