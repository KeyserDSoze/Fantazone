import { mapLegacyCalendar } from './legacy-mappers.mjs'

const ZERO_POINT = Object.freeze({ v: 0, d: false, g: false, o: false })

function normalizeLegacyPoint(value, side) {
  if (value == null) return ZERO_POINT
  if (typeof value === 'object' && !Array.isArray(value)) return value
  const preview = JSON.stringify(value)
  throw new Error(`Unsupported legacy ${side} point shape: ${typeof value} ${preview?.slice(0, 120) ?? ''}`.trim())
}

/**
 * Some persisted Calendar GameResult documents contain a non-null result with one or both
 * Point references serialized as null. Legacy GameResult.HasValue explicitly tolerated
 * null Home/Away via null-conditional access, so null is semantically Point.Zero here.
 */
export function mapLegacyCalendarCompatible(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return mapLegacyCalendar(raw)
  const rounds = raw.r && typeof raw.r === 'object' && !Array.isArray(raw.r) ? raw.r : {}
  const normalizedRounds = {}

  for (const [round, days] of Object.entries(rounds)) {
    normalizedRounds[round] = Array.isArray(days) ? days.map(day => ({
      ...day,
      g: Array.isArray(day?.g) ? day.g.map(game => {
        if (!game?.r || typeof game.r !== 'object' || Array.isArray(game.r)) return game
        return {
          ...game,
          r: {
            ...game.r,
            h: normalizeLegacyPoint(game.r.h, 'home'),
            a: normalizeLegacyPoint(game.r.a, 'away'),
          },
        }
      }) : day?.g,
    })) : days
  }

  return mapLegacyCalendar({ ...raw, r: normalizedRounds })
}
