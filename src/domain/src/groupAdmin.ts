import type {
  AnnualLeague,
  AnnualTeam,
  League,
  LeagueSetting,
} from './group'

export const cloneLeagueSetting = (setting: LeagueSetting): LeagueSetting =>
  JSON.parse(JSON.stringify(setting)) as LeagueSetting

export const getAnnualLeagueForYear = (
  league: League,
  year: number,
  defaultSettings: LeagueSetting,
): AnnualLeague =>
  league.years.find(annualLeague => annualLeague.year === year) || {
    year,
    type: league.type,
    settings: cloneLeagueSetting(defaultSettings),
  }

export const upsertAnnualLeague = (
  years: AnnualLeague[],
  annualLeague: AnnualLeague,
): AnnualLeague[] =>
  years.some(year => year.year === annualLeague.year)
    ? years.map(year => year.year === annualLeague.year ? annualLeague : year)
    : [...years, annualLeague]

export const copyAnnualLeagueToYear = (
  source: AnnualLeague,
  targetYear: number,
  fallbackType: League['type'],
): AnnualLeague => ({
  year: targetYear,
  type: source.type || fallbackType,
  settings: cloneLeagueSetting(source.settings),
})

export const copyMissingTeams = (
  sourceTeams: AnnualTeam[],
  existingTeams: AnnualTeam[],
): AnnualTeam[] =>
  sourceTeams
    .filter(sourceTeam => !existingTeams.some(team => team.owner === sourceTeam.owner))
    .map(team => ({
      ...team,
      additionalOwners: [...(team.additionalOwners || [])],
    }))

export const isLeagueSettingValid = (setting: LeagueSetting): boolean => {
  const integerValues = [
    setting.startingMoney,
    setting.delayedDay,
    setting.cancelledDay,
    setting.pointForFirstGoal,
    setting.pointForNextGoal,
    setting.pointForOwnGoal,
    setting.differencePointForOwnGoal,
    setting.pointInHome,
    setting.pointForVictory,
    setting.pointForDefeat,
    setting.pointForDraw,
    setting.pointForStrongDefense,
    setting.pointForStrongDefense4,
    setting.pointForStrongDefense5,
    setting.pointForGoodPeople,
    setting.pointForCleanSheet,
    setting.moneyForGoal,
    setting.moneyForSufferedGoal,
  ]

  if (!integerValues.every(Number.isInteger)) return false
  if (setting.startingMoney < 25) return false
  if (setting.delayedDay < 0 || setting.delayedDay > 37) return false
  if (setting.cancelledDay < 0 || setting.cancelledDay > 38) return false
  if (setting.pointForFirstGoal < 1 || setting.pointForNextGoal < 1) return false
  if (setting.pointForOwnGoal < 0 || setting.differencePointForOwnGoal < 0) return false
  if (setting.pointForCleanSheet < 0) return false

  const fallbackVotes = setting.votes[-1]
  if (!fallbackVotes) return false

  return Object.values(setting.votes).every(votes => votes &&
    Object.values(votes).every(Number.isFinite) &&
    Number.isInteger(votes.injury) &&
    Number.isInteger(votes.manOfTheMatch))
}
