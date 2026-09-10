import { createDefaultFantazoneEvolutionSettings } from './evolutionModel'
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
  // Older repositories may not contain live/opening/Evolution fields yet. Missing
  // values are interpreted exactly as defaults so existing groups stay editable.
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

  if (!isEvolutionSettingValid(setting)) return false

  const fallbackVotes = setting.votes[-1]
  if (!fallbackVotes) return false

  return Object.values(setting.votes).every(votes => votes &&
    Object.values(votes).every(Number.isFinite) &&
    Number.isInteger(votes.injury) &&
    Number.isInteger(votes.manOfTheMatch))
}

function isEvolutionSettingValid(setting: LeagueSetting): boolean {
  const defaults = createDefaultFantazoneEvolutionSettings()
  const evolution = setting.evolution ?? defaults
  if (typeof evolution.enabled !== 'boolean' || !evolution.name?.trim()) return false
  if (!Number.isInteger(evolution.schemaVersion) || evolution.schemaVersion < 1) return false

  const modules = [
    evolution.playerSkills?.enabled,
    evolution.coachCards?.enabled,
    evolution.families?.enabled,
    evolution.morale?.enabled,
    evolution.momentum?.enabled,
    evolution.progressiveLineupLock?.enabled,
    evolution.ruleEngine?.explainEveryEffect,
  ]
  if (!modules.every(value => typeof value === 'boolean')) return false

  const skills = evolution.playerSkills
  if (!Number.isInteger(skills.skillsPerPlayer) || skills.skillsPerPlayer < 0 || skills.skillsPerPlayer > 5) return false
  if (!Number.isFinite(skills.minPower) || !Number.isFinite(skills.maxPower) || skills.minPower < 0 || skills.maxPower > 100 || skills.minPower > skills.maxPower) return false
  if (!Object.values(skills.rarityWeights).every(value => Number.isFinite(value) && value >= 0)) return false
  if (!Array.isArray(skills.catalog.disabledSkillIds) || !Array.isArray(skills.catalog.customSkills)) return false

  const cards = evolution.coachCards
  const revealGrace = cards.revealGraceSecondsAfterFirstKickoff ?? defaults.coachCards.revealGraceSecondsAfterFirstKickoff
  if (!Number.isInteger(cards.cardsPerMatch) || cards.cardsPerMatch < 0 || cards.cardsPerMatch > 5) return false
  if (!Number.isInteger(cards.cardsInSeasonDeck) || cards.cardsInSeasonDeck < 0 || cards.cardsInSeasonDeck > 200) return false
  if (!Number.isInteger(cards.lockMinutesBeforeFirstKickoff) || cards.lockMinutesBeforeFirstKickoff < 0 || cards.lockMinutesBeforeFirstKickoff > 7 * 24 * 60) return false
  if (!Number.isInteger(revealGrace) || revealGrace < 0 || revealGrace > 600) return false
  if (!Array.isArray(cards.catalog.disabledCardIds) || !Array.isArray(cards.catalog.customCards)) return false

  if (!Array.isArray(evolution.families.thresholds) || evolution.families.thresholds.length === 0) return false
  const familyThresholds = [...evolution.families.thresholds].sort((a, b) => a.minPlayers - b.minPlayers)
  if (!familyThresholds.every(item => Number.isInteger(item.minPlayers) && item.minPlayers >= 2 && item.minPlayers <= 11 && Number.isFinite(item.bonusPerPlayer))) return false
  if (familyThresholds.some((item, index) => index > 0 && item.minPlayers === familyThresholds[index - 1].minPlayers)) return false

  const morale = evolution.morale
  if (![morale.tribuneConsecutiveDays, morale.benchUnusedConsecutiveDays, morale.mixedUnusedConsecutiveDays].every(value => Number.isInteger(value) && value > 0 && value <= 38)) return false
  if (!Number.isFinite(morale.penaltyPerDrop) || morale.penaltyPerDrop > 0) return false
  if (!Number.isFinite(morale.minimumMorale) || morale.minimumMorale > 0) return false

  if (!Number.isFinite(evolution.momentum.nextMatchBonus)) return false
  if (!Array.isArray(evolution.momentum.positiveEvents)) return false
  if (!Array.isArray(evolution.customLeagueRules) || !Array.isArray(evolution.families.customRules)) return false

  for (const cap of [evolution.ruleEngine.maxAbsolutePlayerModifier, evolution.ruleEngine.maxAbsoluteTeamModifier]) {
    if (cap != null && (!Number.isFinite(cap) || cap < 0)) return false
  }
  return true
}
