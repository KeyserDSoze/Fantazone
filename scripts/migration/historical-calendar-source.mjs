import { normalizeLegacyRealCalendarRecord } from './real-calendar-source.mjs'

const OPENFOOTBALL_BASE = 'https://raw.githubusercontent.com/openfootball/football.json/master'

const TEAM_ALIASES = new Map(Object.entries({
  'Atalanta BC': 'Atalanta',
  'Bologna FC 1909': 'Bologna',
  'Cagliari Calcio': 'Cagliari',
  'Empoli FC': 'Empoli',
  'Frosinone Calcio': 'Frosinone',
  'Genoa CFC': 'Genoa',
  'Hellas Verona FC': 'Verona',
  'ACF Fiorentina': 'Fiorentina',
  'FC Internazionale Milano': 'Inter',
  'Juventus FC': 'Juventus',
  'SS Lazio': 'Lazio',
  'US Lecce': 'Lecce',
  'AC Milan': 'Milan',
  'AC Monza': 'Monza',
  'SSC Napoli': 'Napoli',
  'AS Roma': 'Roma',
  'US Salernitana 1919': 'Salernitana',
  'US Sassuolo Calcio': 'Sassuolo',
  'Torino FC': 'Torino',
  'Udinese Calcio': 'Udinese',
  'Como 1907': 'Como',
  'US Cremonese': 'Cremonese',
  'Parma Calcio 1913': 'Parma',
  'AC Pisa 1909': 'Pisa',
}))

function positiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

export function historicalSeasonSlug(season) {
  const id = positiveInteger(season)
  if (!id) throw new Error(`Invalid Fantazone season '${season}'`)
  const start = 2011 + id
  return `${start}-${String(start + 1).slice(-2)}`
}

export function historicalCalendarUrl(season) {
  return `${OPENFOOTBALL_BASE}/${historicalSeasonSlug(season)}/it.1.json`
}

function teamName(value) {
  const raw = String(value ?? '').trim()
  const mapped = TEAM_ALIASES.get(raw)
  if (!mapped) throw new Error(`Unsupported OpenFootball Serie A team '${raw}'`)
  return mapped
}

function matchday(value) {
  const match = String(value ?? '').match(/(?:Matchday|Regular Season\s*-?)\s*(\d+)/i)
  const number = match ? Number(match[1]) : NaN
  if (!Number.isInteger(number) || number < 1 || number > 38) {
    throw new Error(`Unsupported Serie A round '${String(value ?? '')}'`)
  }
  return number
}

function finalScore(score) {
  const pair = Array.isArray(score) ? score : score?.ft
  if (!Array.isArray(pair) || pair.length < 2 || !Number.isFinite(Number(pair[0])) || !Number.isFinite(Number(pair[1]))) {
    throw new Error('Historical Serie A match has no final score')
  }
  return [Number(pair[0]), Number(pair[1])]
}

function matchDate(match) {
  const date = String(match?.date ?? '').trim()
  const time = String(match?.time ?? '00:00').trim() || '00:00'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error(`Invalid historical Serie A date/time '${date} ${time}'`)
  }
  // OpenFootball times are local fixture times. Keep them offset-less, like older Fantasoccer calendars,
  // instead of pretending they are UTC and shifting the historical kickoff.
  return `${date}T${time}:00`
}

/** Convert OpenFootball's public-domain Serie A JSON into the compact legacy shape already consumed by Fantazone. */
export function mapHistoricalSerieACalendar(document, expectedSeason) {
  const season = positiveInteger(expectedSeason)
  if (!season) throw new Error(`Invalid historical Serie A season '${expectedSeason}'`)
  if (!document || typeof document !== 'object' || !Array.isArray(document.matches)) {
    throw new Error('Historical Serie A document has no matches array')
  }

  const days = new Map()
  let gameCount = 0
  for (const match of document.matches) {
    const dayNumber = matchday(match?.round)
    const [homeGoals, awayGoals] = finalScore(match?.score)
    const game = {
      h: { n: teamName(match?.team1), a: '' },
      a: { n: teamName(match?.team2), a: '' },
      d: matchDate(match),
      g: homeGoals,
      y: awayGoals,
      e: false,
    }
    if (!days.has(dayNumber)) days.set(dayNumber, [])
    days.get(dayNumber).push(game)
    gameCount += 1
  }

  if (gameCount !== 380 || days.size !== 38) {
    throw new Error(`Historical Serie A ${historicalSeasonSlug(season)} is incomplete: expected 380 games / 38 matchdays, found ${gameCount} / ${days.size}`)
  }
  for (let day = 1; day <= 38; day++) {
    const games = days.get(day) ?? []
    if (games.length !== 10) throw new Error(`Historical Serie A matchday ${day} has ${games.length} games instead of 10`)
  }

  const record = {
    container: 'realcalendar',
    blobName: String(season),
    key: season,
    migrationRepair: true,
    value: {
      y: season,
      d: Array.from({ length: 38 }, (_, index) => ({ y: season, a: index + 1, g: days.get(index + 1) })),
    },
  }
  const normalized = normalizeLegacyRealCalendarRecord(record)
  if (!normalized.ok) throw new Error(normalized.issue?.detail ?? 'Historical Serie A calendar failed Fantazone validation')
  return normalized.record
}

export async function recoverHistoricalSerieACalendar(expectedSeason, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const url = historicalCalendarUrl(expectedSeason)
  if (typeof fetchImpl !== 'function') return { record: null, url, error: 'fetch is not available in this Node runtime' }

  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
    if (!response?.ok) return { record: null, url, error: `HTTP ${response?.status ?? 'unknown'}` }
    const document = await response.json()
    const record = mapHistoricalSerieACalendar(document, expectedSeason)
    return {
      record: {
        ...record,
        migrationRepair: true,
        sourceHistoricalProvider: 'openfootball/football.json',
        sourceHistoricalUrl: url,
      },
      url,
      error: null,
    }
  } catch (error) {
    return { record: null, url, error: error?.message ?? String(error) }
  }
}
