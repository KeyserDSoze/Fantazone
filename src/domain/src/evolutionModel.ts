export const FANTAZONE_EVOLUTION_NAME = 'Fantazone Evolution'
export const FANTAZONE_EVOLUTION_SCHEMA_VERSION = 1

export type EvolutionRole = 'goalkeeper' | 'defender' | 'midfielder' | 'forward' | 'any'
export type EvolutionRarity = 'common' | 'rare' | 'epic' | 'legendary'
export type EvolutionRuleSource = 'player-skill' | 'coach-card' | 'synergy' | 'morale' | 'momentum' | 'league'
export type EvolutionRuleTrigger = 'match-start' | 'player-finalized' | 'team-finalized' | 'match-finalized'
export type EvolutionSubject = 'self' | 'team' | 'opponent' | 'match'
export type EvolutionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not-in'
export type EvolutionSelectorStrategy =
  | 'first'
  | 'last'
  | 'highest-raw-vote'
  | 'lowest-raw-vote'
  | 'highest-fantasy-value'
  | 'lowest-fantasy-value'
  | 'random'

export type EvolutionFootballEventType =
  | 'goal'
  | 'penalty-goal'
  | 'assist'
  | 'suffered-goal'
  | 'saved-penalty'
  | 'missed-penalty'
  | 'own-goal'
  | 'yellow-card'
  | 'red-card'
  | 'injury'
  | 'man-of-the-match'
  | 'clean-sheet'

export type EvolutionMetric =
  | 'raw-vote'
  | 'fantasy-value'
  | 'final-value'
  | 'has-vote'
  | 'played'
  | 'goals'
  | 'penalty-goals'
  | 'assists'
  | 'suffered-goals'
  | 'saved-penalties'
  | 'missed-penalties'
  | 'own-goals'
  | 'yellow-card'
  | 'red-card'
  | 'injured'
  | 'role'
  | 'fantasy-position'
  | 'role-slot'
  | 'real-team'
  | 'team-formation'
  | 'starters-count'
  | 'starters-played-count'
  | 'same-family-starters'
  | 'matching-player-count'
  | 'morale'
  | 'previous-positive-bonus'

export interface EvolutionPlayerSelector {
  roles?: EvolutionRole[]
  fantasyPositions?: number[]
  realTeams?: string[]
  where?: EvolutionConditionGroup
  strategy?: EvolutionSelectorStrategy
  quantity?: number
}

export interface EvolutionCondition {
  subject?: EvolutionSubject
  metric: EvolutionMetric
  operator: EvolutionOperator
  value: number | string | boolean | Array<number | string | boolean>
  selector?: EvolutionPlayerSelector
}

export interface EvolutionConditionGroup {
  all?: Array<EvolutionCondition | EvolutionConditionGroup>
  any?: Array<EvolutionCondition | EvolutionConditionGroup>
  not?: EvolutionCondition | EvolutionConditionGroup
}

export interface EvolutionStackingRule {
  mode: 'stack' | 'max' | 'min' | 'first' | 'last' | 'exclusive'
  group?: string
  maxApplicationsPerMatch?: number | null
  maxApplicationsPerPlayer?: number | null
}

export type EvolutionEffect =
  | {
      type: 'add-score'
      target: 'self' | 'team' | 'opponent'
      value: number
      selector?: EvolutionPlayerSelector
    }
  | {
      type: 'set-player-score'
      target: 'self' | 'team' | 'opponent'
      value: number
      mode?: 'exact' | 'at-least' | 'at-most'
      selector?: EvolutionPlayerSelector
    }
  | {
      type: 'cancel-event'
      target: 'self' | 'team' | 'opponent'
      eventType: EvolutionFootballEventType
      quantity: number
      selector?: EvolutionPlayerSelector
    }
  | {
      type: 'add-event'
      target: 'self' | 'team' | 'opponent'
      eventType: EvolutionFootballEventType
      quantity: number
      selector?: EvolutionPlayerSelector
    }
  | {
      type: 'multiply-event'
      target: 'self' | 'team' | 'opponent'
      eventType: EvolutionFootballEventType
      factor: number
      quantity?: number
      selector?: EvolutionPlayerSelector
    }

export interface EvolutionRuleDefinition {
  id: string
  name: string
  description: string
  source: EvolutionRuleSource
  trigger: EvolutionRuleTrigger
  conditions?: EvolutionConditionGroup
  effects: EvolutionEffect[]
  priority: number
  stacking: EvolutionStackingRule
  enabled?: boolean
}

export interface EvolutionSkillDefinition {
  id: string
  name: string
  description: string
  flavorText?: string
  roles: EvolutionRole[]
  rarity: EvolutionRarity
  power: number
  weight: number
  rules: EvolutionRuleDefinition[]
  enabled?: boolean
}

export type EvolutionCardCategory = 'formation' | 'tactic' | 'counter' | 'team' | 'wildcard'

export interface EvolutionCardDefinition {
  id: string
  name: string
  description: string
  flavorText?: string
  category: EvolutionCardCategory
  rarity: EvolutionRarity
  power: number
  weight: number
  rules: EvolutionRuleDefinition[]
  enabled?: boolean
}

export interface EvolutionSkillCatalogSettings {
  builtinVersion: number
  disabledSkillIds: string[]
  customSkills: EvolutionSkillDefinition[]
}

export interface EvolutionCardCatalogSettings {
  builtinVersion: number
  disabledCardIds: string[]
  customCards: EvolutionCardDefinition[]
}

export interface EvolutionPlayerSkillSettings {
  enabled: boolean
  skillsPerPlayer: number
  deterministicSeed: string
  uniqueSkillPerPlayer: boolean
  minPower: number
  maxPower: number
  rarityWeights: Record<EvolutionRarity, number>
  catalog: EvolutionSkillCatalogSettings
}

export interface EvolutionCoachCardSettings {
  enabled: boolean
  cardsPerMatch: number
  cardsInSeasonDeck: number
  lockMinutesBeforeFirstKickoff: number
  revealAtFirstKickoff: boolean
  catalog: EvolutionCardCatalogSettings
}

export interface EvolutionFamilyThreshold {
  minPlayers: number
  bonusPerPlayer: number
}

export interface EvolutionFamilySettings {
  enabled: boolean
  scope: 'starting-eleven' | 'players-who-played'
  thresholds: EvolutionFamilyThreshold[]
  customRules: EvolutionRuleDefinition[]
}

export interface EvolutionMoraleSettings {
  enabled: boolean
  tribuneConsecutiveDays: number
  benchUnusedConsecutiveDays: number
  mixedUnusedConsecutiveDays: number
  penaltyPerDrop: number
  minimumMorale: number
  resetAfterPlaying: boolean
  cancelMatchPenaltyOnPositiveFootballBonus: boolean
}

export interface EvolutionMomentumSettings {
  enabled: boolean
  nextMatchBonus: number
  positiveEvents: EvolutionFootballEventType[]
}

export interface EvolutionProgressiveLineupLockSettings {
  enabled: boolean
  keepDelayedMatchesEditable: boolean
}

export interface EvolutionRuleEngineSettings {
  explainEveryEffect: boolean
  maxAbsolutePlayerModifier: number | null
  maxAbsoluteTeamModifier: number | null
  deterministicRandomSeed: string
}

export interface FantazoneEvolutionSettings {
  enabled: boolean
  name: string
  schemaVersion: number
  playerSkills: EvolutionPlayerSkillSettings
  coachCards: EvolutionCoachCardSettings
  families: EvolutionFamilySettings
  morale: EvolutionMoraleSettings
  momentum: EvolutionMomentumSettings
  progressiveLineupLock: EvolutionProgressiveLineupLockSettings
  ruleEngine: EvolutionRuleEngineSettings
  customLeagueRules: EvolutionRuleDefinition[]
}

export interface EvolutionPlayerSkillAssignment {
  playerKey: string
  skillIds: string[]
}

export interface EvolutionSeasonSkillDocument {
  version: 1
  year: number
  seed: string
  generatedAt: string
  assignments: EvolutionPlayerSkillAssignment[]
}

export interface EvolutionCardSelection {
  cardIds: string[]
  selectedAt: string
  lockedAt: string | null
  revealedAt: string | null
}

export type EvolutionPlayerUsage = 'starter' | 'subbed-in' | 'bench-unused' | 'tribune'

export interface EvolutionPlayerSeasonState {
  playerKey: string
  morale: number
  consecutiveTribune: number
  consecutiveBenchUnused: number
  consecutiveUnusedMixed: number
  previousPositiveBonus: boolean
}

export interface EvolutionPlayerMatchState {
  morale: number
  previousPositiveBonus: boolean
}

export const DefaultFantazoneEvolutionSettings: Readonly<FantazoneEvolutionSettings> = {
  enabled: false,
  name: FANTAZONE_EVOLUTION_NAME,
  schemaVersion: FANTAZONE_EVOLUTION_SCHEMA_VERSION,
  playerSkills: {
    enabled: true,
    skillsPerPlayer: 1,
    deterministicSeed: '',
    uniqueSkillPerPlayer: true,
    minPower: 1,
    maxPower: 100,
    rarityWeights: { common: 60, rare: 27, epic: 10, legendary: 3 },
    catalog: { builtinVersion: 1, disabledSkillIds: [], customSkills: [] },
  },
  coachCards: {
    enabled: true,
    cardsPerMatch: 1,
    cardsInSeasonDeck: 20,
    lockMinutesBeforeFirstKickoff: 0,
    revealAtFirstKickoff: true,
    catalog: { builtinVersion: 1, disabledCardIds: [], customCards: [] },
  },
  families: {
    enabled: true,
    scope: 'starting-eleven',
    thresholds: [
      { minPlayers: 3, bonusPerPlayer: 0.5 },
      { minPlayers: 4, bonusPerPlayer: 1 },
      { minPlayers: 5, bonusPerPlayer: 1.5 },
      { minPlayers: 6, bonusPerPlayer: 2 },
    ],
    customRules: [],
  },
  morale: {
    enabled: true,
    tribuneConsecutiveDays: 2,
    benchUnusedConsecutiveDays: 4,
    mixedUnusedConsecutiveDays: 3,
    penaltyPerDrop: -1,
    minimumMorale: -3,
    resetAfterPlaying: true,
    cancelMatchPenaltyOnPositiveFootballBonus: true,
  },
  momentum: {
    enabled: true,
    nextMatchBonus: 1,
    positiveEvents: ['goal', 'penalty-goal', 'assist', 'saved-penalty', 'man-of-the-match'],
  },
  progressiveLineupLock: {
    enabled: false,
    keepDelayedMatchesEditable: true,
  },
  ruleEngine: {
    explainEveryEffect: true,
    maxAbsolutePlayerModifier: null,
    maxAbsoluteTeamModifier: null,
    deterministicRandomSeed: 'fantazone-evolution',
  },
  customLeagueRules: [],
}

export function createDefaultFantazoneEvolutionSettings(): FantazoneEvolutionSettings {
  return JSON.parse(JSON.stringify(DefaultFantazoneEvolutionSettings)) as FantazoneEvolutionSettings
}
