import type {
  AnnualLeague,
  AnnualTeam,
  League,
  LeagueSetting,
  LeagueSettingRaw,
  VoteLeagueSetting,
  VoteLeagueSettingRaw,
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

const roleNames: Record<string, string> = {
  '-1': 'Undefined',
  '0': 'GoalKeeper',
  '1': 'Defensor',
  '2': 'Midfielder',
  '3': 'Forward',
}

export const serializeVoteSettings = (
  votes: Partial<Record<number, VoteLeagueSetting>>,
): Record<string, VoteLeagueSettingRaw> => {
  const rawVotes: Record<string, VoteLeagueSettingRaw> = {}

  for (const [role, setting] of Object.entries(votes)) {
    if (!setting) continue
    rawVotes[roleNames[role] || role] = {
      g: setting.goal,
      p: setting.penalty,
      s: setting.sufferedGoal,
      d: setting.stoppedPenalty,
      w: setting.wrongedPenalty,
      o: setting.ownGoal,
      a: setting.assist,
      y: setting.yellowCard,
      r: setting.redCard,
      j: setting.injury,
      m: setting.manOfTheMatch,
    }
  }

  return rawVotes
}

export const preserveRawLeagueSetting = (
  setting: LeagueSetting,
  votes: Record<string, VoteLeagueSettingRaw>,
): LeagueSettingRaw => ({
  ...setting.raw,
  v: votes,
  frm: setting.formation,
  lt: setting.typeSettings,
  s: setting.startingMoney,
  d: setting.delayedDay,
  c: setting.cancelledDay,
  g: setting.pointForFirstGoal,
  t: setting.pointForNextGoal,
  o: setting.pointForOwnGoal,
  f: setting.differencePointForOwnGoal,
  p: setting.pointInHome,
  a: setting.pointForVictory,
  b: setting.pointForDefeat,
  h: setting.pointForDraw,
  '3': setting.pointForStrongDefense,
  '4': setting.pointForStrongDefense4,
  '5': setting.pointForStrongDefense5,
  gp: setting.pointForGoodPeople,
  l: setting.pointForCleanSheet,
  m: setting.moneyForGoal,
  n: setting.moneyForSufferedGoal,
  q: setting.randomAuction,
  vp: setting.rankWithValuePoints,
  mk: setting.market,
})
