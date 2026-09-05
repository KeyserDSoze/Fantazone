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
