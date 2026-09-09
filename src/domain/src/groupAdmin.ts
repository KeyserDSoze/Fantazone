import {
  DefaultOpeningCompetitionSettings,
  type AnnualLeague,
  type AnnualTeam,
  type League,
  type LeagueSetting,
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
  // Repositories created before 0.3.6 do not contain these fields yet. Treat their
  // absence exactly like the backend defaults so existing groups remain editable.
  const liveFormationChanges = setting.liveFormationChanges ?? 0
  const allowLiveModuleChange = setting.allowLiveModuleChange ?? false
  const opening = setting.openingCompetition ?? DefaultOpeningCompetitionSettings

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
    liveFormationChanges,
    opening.serieADays,
  ]

  if (!integerValues.every(Number.isInteger)) return false
  if (setting.startingMoney < 25) return false
  if (setting.delayedDay < 0 || setting.delayedDay > 37) return false
  if (setting.cancelledDay < 0 || setting.cancelledDay > 38) return false
  if (liveFormationChanges < 0 || liveFormationChanges > 11) return false
  if (setting.allowLiveModuleChange != null && typeof setting.allowLiveModuleChange !== 'boolean') return false
  if (typeof allowLiveModuleChange !== 'boolean') return false
  if (setting.pointForFirstGoal < 1 || setting.pointForNextGoal < 1) return false
  if (setting.pointForOwnGoal < 0 || setting.differencePointForOwnGoal < 0) return false
  if (setting.pointForCleanSheet < 0) return false

  if (typeof opening.enabled !== 'boolean') return false
  if (opening.serieADays < 1 || opening.serieADays > 38) return false
  if (!Array.isArray(opening.prizes)) return false
  const positions = new Set<number>()
  for (const prize of opening.prizes) {
    if (!Number.isInteger(prize.position) || prize.position < 1 || positions.has(prize.position)) return false
    if (!Number.isInteger(prize.credits) || prize.credits < 0) return false
    positions.add(prize.position)
  }

  const fallbackVotes = setting.votes[-1]
  if (!fallbackVotes) return false

  return Object.values(setting.votes).every(votes => votes &&
    Object.values(votes).every(Number.isFinite) &&
    Number.isInteger(votes.injury) &&
    Number.isInteger(votes.manOfTheMatch))
}