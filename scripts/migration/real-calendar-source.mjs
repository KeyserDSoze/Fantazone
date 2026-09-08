const SEASON_SWITCH_MONTH = 8
const SEASON_SWITCH_DAY = 10

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function positiveInteger(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function seasonLabel(season) {
  const startYear = 2011 + season
  return `${startYear}/${String(startYear + 1).slice(-2)}`
}

function seasonBounds(season) {
  const startYear = 2011 + season
  return {
    start: Date.UTC(startYear, SEASON_SWITCH_MONTH - 1, SEASON_SWITCH_DAY),
    end: Date.UTC(startYear + 1, SEASON_SWITCH_MONTH - 1, SEASON_SWITCH_DAY),
  }
}

function isoDateTimestamp(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null
  return timestamp
}

function issue(record, expectedSeason, detail) {
  return {
    ok: false,
    issue: {
      container: 'realcalendar',
      blobName: record.blobName,
      key: expectedSeason,
      reason: 'invalid-realcalendar-season',
      detail,
    },
  }
}

/**
 * Rystem stores the repository key separately from the compact RealCalendar payload. Historical
 * Fantasoccer jobs could overwrite the previous season immediately before the August 10 season
 * switch, and some payloads also contain y=0. The Azure/Rystem key is therefore the canonical
 * season id, but dates must independently prove that the payload really belongs to that season.
 */
export function normalizeLegacyRealCalendarRecord(record) {
  const expectedSeason = positiveInteger(record?.key)
  if (!expectedSeason) return issue(record ?? {}, null, 'RealCalendar requires a positive numeric Azure/Rystem key.')
  if (!isObject(record?.value)) return issue(record, expectedSeason, `Season ${expectedSeason} (${seasonLabel(expectedSeason)}) payload is not an object.`)

  const raw = record.value
  const rawYear = typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : 0
  if (rawYear !== 0 && rawYear !== expectedSeason) {
    return issue(record, expectedSeason, `Payload year ${rawYear} does not match Azure/Rystem key ${expectedSeason} (${seasonLabel(expectedSeason)}).`)
  }
  if (!Array.isArray(raw.d)) {
    return issue(record, expectedSeason, `Season ${expectedSeason} (${seasonLabel(expectedSeason)}) has no readable day array.`)
  }

  const bounds = seasonBounds(expectedSeason)
  const normalizedDays = []
  for (let dayIndex = 0; dayIndex < raw.d.length; dayIndex++) {
    const day = raw.d[dayIndex]
    if (!isObject(day)) return issue(record, expectedSeason, `Day at index ${dayIndex} is not an object.`)

    const dayYear = typeof day.y === 'number' && Number.isFinite(day.y) ? day.y : 0
    if (dayYear !== 0 && dayYear !== expectedSeason) {
      return issue(record, expectedSeason, `Day ${day.a ?? dayIndex + 1} declares season ${dayYear}, expected ${expectedSeason} (${seasonLabel(expectedSeason)}).`)
    }
    if (!Array.isArray(day.g)) return issue(record, expectedSeason, `Day ${day.a ?? dayIndex + 1} has no readable games array.`)

    for (let gameIndex = 0; gameIndex < day.g.length; gameIndex++) {
      const game = day.g[gameIndex]
      if (!isObject(game)) return issue(record, expectedSeason, `Game ${day.a ?? dayIndex + 1}/${gameIndex} is not an object.`)
      if (game.d == null) continue
      const timestamp = isoDateTimestamp(game.d)
      if (timestamp == null) {
        return issue(record, expectedSeason, `Game ${day.a ?? dayIndex + 1}/${gameIndex} has invalid date '${String(game.d)}'.`)
      }
      if (timestamp < bounds.start || timestamp >= bounds.end) {
        return issue(
          record,
          expectedSeason,
          `Game ${day.a ?? dayIndex + 1}/${gameIndex} is dated ${String(game.d).slice(0, 10)}, outside season ${expectedSeason} (${seasonLabel(expectedSeason)}).`,
        )
      }
    }

    normalizedDays.push({ ...day, y: expectedSeason })
  }

  return {
    ok: true,
    record: {
      ...record,
      key: expectedSeason,
      value: { ...raw, y: expectedSeason, d: normalizedDays },
    },
  }
}
