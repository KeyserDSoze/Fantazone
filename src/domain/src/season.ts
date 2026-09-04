const BASE_YEAR = 2012
const SEASON_START_MONTH = 8
const SEASON_START_DAY = 10

export function getCurrentSeasonYear(now = new Date()): number {
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1
  const currentDay = now.getUTCDate()

  const isNewSeason = currentMonth > SEASON_START_MONTH ||
    (currentMonth === SEASON_START_MONTH && currentDay >= SEASON_START_DAY)
  const seasonStartYear = isNewSeason ? currentYear : currentYear - 1
  return seasonStartYear - BASE_YEAR + 1
}

export function formatSeasonFromYear(yearNumber: number): string {
  const startYear = BASE_YEAR + yearNumber - 1
  const endYear = startYear + 1
  return `${startYear}/${String(endYear).slice(-2)}`
}

export function getBaseYear(): number {
  return BASE_YEAR
}

export function getAvailableSeasonYears(now = new Date()): number[] {
  const currentSeasonYear = getCurrentSeasonYear(now)
  return Array.from({ length: currentSeasonYear + 1 }, (_, index) => index + 1)
}

export function parseSeasonString(seasonString: string): number | null {
  const match = seasonString.match(/^(\d{4})\/\d{2}$/)
  if (!match) return null
  const startYear = Number.parseInt(match[1], 10)
  return startYear - BASE_YEAR + 1
}

export function getSeasonYearRange(yearNumber: number): { startYear: number; endYear: number } {
  const startYear = BASE_YEAR + yearNumber - 1
  return { startYear, endYear: startYear + 1 }
}
