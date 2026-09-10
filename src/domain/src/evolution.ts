import { type Point } from './calendar'
import {
  createDefaultFantazoneEvolutionSettings,
  type EvolutionCardDefinition,
  type EvolutionCardSelection,
  type EvolutionCondition,
  type EvolutionConditionGroup,
  type EvolutionEffect,
  type EvolutionFootballEventType,
  type EvolutionMetric,
  type EvolutionPlayerMatchState,
  type EvolutionPlayerSeasonState,
  type EvolutionPlayerSelector,
  type EvolutionPlayerSkillAssignment,
  type EvolutionPlayerUsage,
  type EvolutionRole,
  type EvolutionRuleDefinition,
  type EvolutionSkillDefinition,
  type EvolutionSeasonSkillDocument,
  type FantazoneEvolutionSettings,
} from './evolutionModel'
import { getBuiltinEvolutionCards, getBuiltinEvolutionSkills } from './evolutionCatalog'
import { DefaultVoteLeagueSetting, Role, type LeagueSetting, type VoteLeagueSetting } from './group'
import { getPlayerKey, type RealPlayer } from './realPlayer'
import type { RealDay, RealGame } from './realCalendar'
import { FantaSoccerRole, type Player } from './team'
import type { EnrichedTeamPlayer, TeamPointCalculation } from './teamCalculation'
import { Behaviour, type Vote } from './vote'

export type EvolutionSide = 'home' | 'away'

export interface EvolutionRuleTrace {
  id: string
  ruleId: string
  source: EvolutionRuleDefinition['source']
  name: string
  description: string
  side: EvolutionSide
  targetSide: EvolutionSide
  playerKey: string | null
  amount: number
  effect: EvolutionEffect['type']
  message: string
}

export interface EvolutionResolvedTeam {
  point: Point
  playerValues: Record<string, number>
  formation: string
}

export interface EvolutionMatchResolution {
  home: EvolutionResolvedTeam
  away: EvolutionResolvedTeam
  trace: EvolutionRuleTrace[]
}

export interface EvolutionMatchCalculationInput {
  home: TeamPointCalculation
  away: TeamPointCalculation
  settings: LeagueSetting
  homeSkillAssignments?: EvolutionPlayerSkillAssignment[]
  awaySkillAssignments?: EvolutionPlayerSkillAssignment[]
  homeCards?: EvolutionCardSelection | null
  awayCards?: EvolutionCardSelection | null
  homePlayerState?: Record<string, EvolutionPlayerMatchState | undefined>
  awayPlayerState?: Record<string, EvolutionPlayerMatchState | undefined>
  seed?: string
}

type RuntimeEvent = {
  id: string
  type: EvolutionFootballEventType
  baseValue: number
  multiplier: number
  cancelled: boolean
  player: RuntimePlayer
}

type RuntimePlayer = {
  player: Player
  key: string
  actualPosition: FantaSoccerRole
  roleSlot: number
  vote: Vote | null
  baseFantasyValue: number
  effectiveValue: number
  morale: number
  previousPositiveBonus: boolean
  events: RuntimeEvent[]
}

type RuntimeSide = {
  side: EvolutionSide
  basePoint: Point
  players: RuntimePlayer[]
  scoreDelta: number
  formation: string
}

type RuleContext = {
  owner: RuntimeSide
  opponent: RuntimeSide
  origin: RuntimePlayer | null
  settings: LeagueSetting
  random: () => number
  trace: EvolutionRuleTrace[]
}

export function resolveFantazoneEvolutionSettings(settings: LeagueSetting): FantazoneEvolutionSettings {
  const defaults = createDefaultFantazoneEvolutionSettings()
  const source = settings.evolution
  if (!source) return defaults
  return {
    ...defaults,
    ...source,
    playerSkills: {
      ...defaults.playerSkills,
      ...source.playerSkills,
      rarityWeights: { ...defaults.playerSkills.rarityWeights, ...(source.playerSkills?.rarityWeights ?? {}) },
      catalog: {
        ...defaults.playerSkills.catalog,
        ...(source.playerSkills?.catalog ?? {}),
        disabledSkillIds: [...(source.playerSkills?.catalog?.disabledSkillIds ?? defaults.playerSkills.catalog.disabledSkillIds)],
        customSkills: [...(source.playerSkills?.catalog?.customSkills ?? defaults.playerSkills.catalog.customSkills)],
      },
    },
    coachCards: {
      ...defaults.coachCards,
      ...source.coachCards,
      catalog: {
        ...defaults.coachCards.catalog,
        ...(source.coachCards?.catalog ?? {}),
        disabledCardIds: [...(source.coachCards?.catalog?.disabledCardIds ?? defaults.coachCards.catalog.disabledCardIds)],
        customCards: [...(source.coachCards?.catalog?.customCards ?? defaults.coachCards.catalog.customCards)],
      },
    },
    families: {
      ...defaults.families,
      ...source.families,
      thresholds: [...(source.families?.thresholds ?? defaults.families.thresholds)].map(item => ({ ...item })),
      customRules: [...(source.families?.customRules ?? defaults.families.customRules)],
    },
    morale: { ...defaults.morale, ...source.morale },
    momentum: {
      ...defaults.momentum,
      ...source.momentum,
      positiveEvents: [...(source.momentum?.positiveEvents ?? defaults.momentum.positiveEvents)],
    },
    progressiveLineupLock: { ...defaults.progressiveLineupLock, ...source.progressiveLineupLock },
    ruleEngine: { ...defaults.ruleEngine, ...source.ruleEngine },
    customLeagueRules: [...(source.customLeagueRules ?? defaults.customLeagueRules)],
  }
}

export function getEvolutionSkillCatalog(settings: LeagueSetting): EvolutionSkillDefinition[] {
  const evolution = resolveFantazoneEvolutionSettings(settings)
  const disabled = new Set(evolution.playerSkills.catalog.disabledSkillIds)
  const builtin = getBuiltinEvolutionSkills(evolution.playerSkills.catalog.builtinVersion)
    .filter(item => item.enabled !== false && !disabled.has(item.id))
  const custom = evolution.playerSkills.catalog.customSkills.filter(item => item.enabled !== false)
  return [...builtin, ...custom]
}

export function getEvolutionCardCatalog(settings: LeagueSetting): EvolutionCardDefinition[] {
  const evolution = resolveFantazoneEvolutionSettings(settings)
  const disabled = new Set(evolution.coachCards.catalog.disabledCardIds)
  const builtin = getBuiltinEvolutionCards(evolution.coachCards.catalog.builtinVersion)
    .filter(item => item.enabled !== false && !disabled.has(item.id))
  const custom = evolution.coachCards.catalog.customCards.filter(item => item.enabled !== false)
  return [...builtin, ...custom]
}

export function assignEvolutionSkills(
  players: Array<Pick<RealPlayer, 'name' | 'role'>>,
  settings: LeagueSetting,
  year: number,
  generatedAt = new Date().toISOString(),
  seedOverride?: string,
): EvolutionSeasonSkillDocument {
  const evolution = resolveFantazoneEvolutionSettings(settings)
  const configuredSeed = evolution.playerSkills.deterministicSeed.trim()
  const seed = seedOverride ?? configuredSeed || `${year}:${evolution.ruleEngine.deterministicRandomSeed}`
  const catalog = getEvolutionSkillCatalog(settings)
    .filter(item => item.power >= evolution.playerSkills.minPower && item.power <= evolution.playerSkills.maxPower)
  const assignments: EvolutionPlayerSkillAssignment[] = []

  for (const player of [...players].sort((a, b) => getPlayerKey(a.name).localeCompare(getPlayerKey(b.name)))) {
    const key = getPlayerKey(player.name)
    if (!key) continue
    if (!evolution.enabled || !evolution.playerSkills.enabled || evolution.playerSkills.skillsPerPlayer <= 0) {
      assignments.push({ playerKey: key, skillIds: [] })
      continue
    }
    const role = roleToEvolutionRole(player.role)
    const eligible = catalog.filter(item => item.roles.includes('any') || item.roles.includes(role))
    const random = createSeededRandom(`${seed}:${key}`)
    const skillIds: string[] = []
    const available = [...eligible]
    for (let index = 0; index < evolution.playerSkills.skillsPerPlayer && available.length > 0; index += 1) {
      const selected = weightedSkillPick(available, evolution, random)
      if (!selected) break
      skillIds.push(selected.id)
      if (evolution.playerSkills.uniqueSkillPerPlayer) {
        const at = available.findIndex(item => item.id === selected.id)
        if (at >= 0) available.splice(at, 1)
      }
    }
    assignments.push({ playerKey: key, skillIds })
  }

  return { version: 1, year, seed, generatedAt, assignments }
}

export function calculateEvolutionMatch(input: EvolutionMatchCalculationInput): EvolutionMatchResolution {
  const evolution = resolveFantazoneEvolutionSettings(input.settings)
  const home = buildRuntimeSide('home', input.home, input.settings, input.homePlayerState)
  const away = buildRuntimeSide('away', input.away, input.settings, input.awayPlayerState)
  const trace: EvolutionRuleTrace[] = []

  if (!evolution.enabled) return finalResolution(home, away, trace)

  if (evolution.families.enabled) {
    applyFamilySynergy(home, evolution, trace)
    applyFamilySynergy(away, evolution, trace)
  }
  if (evolution.morale.enabled || evolution.momentum.enabled) {
    applyMoraleAndMomentum(home, evolution, trace)
    applyMoraleAndMomentum(away, evolution, trace)
  }

  const random = createSeededRandom(input.seed ?? evolution.ruleEngine.deterministicRandomSeed)
  const skills = new Map(getEvolutionSkillCatalog(input.settings).map(item => [item.id, item] as const))
  if (evolution.playerSkills.enabled) {
    applyAssignedSkills(home, away, input.homeSkillAssignments ?? [], skills, input.settings, random, trace)
    applyAssignedSkills(away, home, input.awaySkillAssignments ?? [], skills, input.settings, random, trace)
  }

  if (evolution.coachCards.enabled) {
    const cards = new Map(getEvolutionCardCatalog(input.settings).map(item => [item.id, item] as const))
    applyCards(home, away, input.homeCards, cards, input.settings, random, trace)
    applyCards(away, home, input.awayCards, cards, input.settings, random, trace)
  }

  applyRuleSet(evolution.families.customRules, { owner: home, opponent: away, origin: null, settings: input.settings, random, trace })
  applyRuleSet(evolution.families.customRules, { owner: away, opponent: home, origin: null, settings: input.settings, random, trace })
  applyRuleSet(evolution.customLeagueRules, { owner: home, opponent: away, origin: null, settings: input.settings, random, trace })
  applyRuleSet(evolution.customLeagueRules, { owner: away, opponent: home, origin: null, settings: input.settings, random, trace })

  capModifiers(home, evolution.ruleEngine.maxAbsoluteTeamModifier, evolution.ruleEngine.maxAbsolutePlayerModifier)
  capModifiers(away, evolution.ruleEngine.maxAbsoluteTeamModifier, evolution.ruleEngine.maxAbsolutePlayerModifier)
  return finalResolution(home, away, trace)
}

function weightedSkillPick(
  skills: EvolutionSkillDefinition[],
  evolution: FantazoneEvolutionSettings,
  random: () => number,
): EvolutionSkillDefinition | null {
  const weighted = skills.map(item => ({
    item,
    weight: Math.max(0, item.weight) * Math.max(0, evolution.playerSkills.rarityWeights[item.rarity] ?? 0),
  }))
  const total = weighted.reduce((sum, item) => sum + item.weight, 0)
  if (total <= 0) return skills[Math.floor(random() * skills.length)] ?? null
  let cursor = random() * total
  for (const entry of weighted) {
    cursor -= entry.weight
    if (cursor <= 0) return entry.item
  }
  return weighted[weighted.length - 1]?.item ?? null
}

function buildRuntimeSide(
  side: EvolutionSide,
  calculation: TeamPointCalculation,
  settings: LeagueSetting,
  states: Record<string, EvolutionPlayerMatchState | undefined> | undefined,
): RuntimeSide {
  const fieldByRole = new Map<Role, number>()
  const players = calculation.formation.map(enriched => {
    const key = getPlayerKey(enriched.current.name)
    const isField = isFieldPosition(enriched.currentPosition)
    const nextSlot = isField ? (fieldByRole.get(enriched.current.role) ?? 0) + 1 : 0
    if (isField) fieldByRole.set(enriched.current.role, nextSlot)
    const state = states?.[key]
    const runtime: RuntimePlayer = {
      player: enriched.current,
      key,
      actualPosition: enriched.currentPosition,
      roleSlot: nextSlot,
      vote: enriched.vote,
      baseFantasyValue: isField && enriched.vote?.hasVote ? (enriched.finalValue?.value ?? 0) : 0,
      effectiveValue: isField && enriched.vote?.hasVote ? (enriched.finalValue?.value ?? 0) : 0,
      morale: state?.morale ?? 0,
      previousPositiveBonus: state?.previousPositiveBonus ?? false,
      events: [],
    }
    runtime.events = buildRuntimeEvents(runtime, settings)
    return runtime
  })
  return {
    side,
    basePoint: { ...calculation.point },
    players,
    scoreDelta: 0,
    formation: formationOf(players),
  }
}

function buildRuntimeEvents(player: RuntimePlayer, settings: LeagueSetting): RuntimeEvent[] {
  const vote = player.vote
  if (!vote) return []
  const voteSettings = resolveVoteSettings(settings, player.player.role)
  const definitions: Array<[EvolutionFootballEventType, number, number]> = [
    ['goal', vote.goal, voteSettings.goal],
    ['penalty-goal', vote.penalty, voteSettings.penalty],
    ['assist', vote.assist, voteSettings.assist],
    ['suffered-goal', vote.sufferedGoal, voteSettings.sufferedGoal],
    ['saved-penalty', vote.stoppedPenalty, voteSettings.stoppedPenalty],
    ['missed-penalty', vote.wrongedPenalty, voteSettings.wrongedPenalty],
    ['own-goal', vote.ownGoal, voteSettings.ownGoal],
  ]
  if (vote.status === Behaviour.YellowCard) definitions.push(['yellow-card', 1, voteSettings.yellowCard])
  if (vote.status === Behaviour.RedCard) definitions.push(['red-card', 1, voteSettings.redCard])
  if (vote.injured) definitions.push(['injury', 1, voteSettings.injury])
  if (vote.manOfTheMatch) definitions.push(['man-of-the-match', 1, voteSettings.manOfTheMatch])
  if (vote.hasVote && player.player.role === Role.GoalKeeper && vote.sufferedGoal === 0 && settings.pointForCleanSheet > 0) {
    definitions.push(['clean-sheet', 1, settings.pointForCleanSheet])
  }

  const result: RuntimeEvent[] = []
  for (const [type, count, value] of definitions) {
    for (let index = 0; index < Math.max(0, count); index += 1) {
      result.push({ id: `${player.key}:${type}:${index + 1}`, type, baseValue: value, multiplier: 1, cancelled: false, player })
    }
  }
  return result
}

function applyFamilySynergy(side: RuntimeSide, evolution: FantazoneEvolutionSettings, trace: EvolutionRuleTrace[]): void {
  const eligible = evolution.families.scope === 'starting-eleven'
    ? side.players.filter(player => isFieldPosition(player.actualPosition))
    : side.players.filter(player => player.vote?.hasVote === true && isFieldPosition(player.actualPosition))
  const byFamily = new Map<string, RuntimePlayer[]>()
  for (const player of eligible) {
    const family = normalize(player.player.team.name)
    if (!family) continue
    const group = byFamily.get(family) ?? []
    group.push(player)
    byFamily.set(family, group)
  }
  const thresholds = [...evolution.families.thresholds].sort((a, b) => a.minPlayers - b.minPlayers)
  for (const [family, players] of byFamily) {
    const threshold = thresholds.filter(item => players.length >= item.minPlayers).at(-1)
    if (!threshold || threshold.bonusPerPlayer === 0) continue
    for (const player of players) {
      addPlayerDelta(side, player, threshold.bonusPerPlayer)
      trace.push({
        id: `family:${side.side}:${family}:${player.key}`,
        ruleId: `family-${threshold.minPlayers}`,
        source: 'synergy',
        name: `Famiglia ${player.player.team.name}`,
        description: `${players.length} titolari della stessa squadra reale.`,
        side: side.side,
        targetSide: side.side,
        playerKey: player.key,
        amount: threshold.bonusPerPlayer,
        effect: 'add-score',
        message: `${player.player.name}: famiglia ${player.player.team.name} ×${players.length}, ${signed(threshold.bonusPerPlayer)}.`,
      })
    }
  }
}

function applyMoraleAndMomentum(side: RuntimeSide, evolution: FantazoneEvolutionSettings, trace: EvolutionRuleTrace[]): void {
  for (const player of side.players.filter(item => isFieldPosition(item.actualPosition))) {
    if (evolution.morale.enabled && player.morale < 0) {
      const hasPositive = hasPositiveFootballBonus(player.vote, evolution.momentum.positiveEvents)
      const cancelled = evolution.morale.cancelMatchPenaltyOnPositiveFootballBonus && hasPositive
      if (!cancelled) addPlayerDelta(side, player, player.morale)
      trace.push({
        id: `morale:${side.side}:${player.key}`,
        ruleId: 'morale-current',
        source: 'morale',
        name: cancelled ? 'Reazione di morale' : 'Morale basso',
        description: cancelled ? 'Un bonus reale neutralizza il malus di morale.' : 'Il giocatore entra in campo con morale negativo.',
        side: side.side,
        targetSide: side.side,
        playerKey: player.key,
        amount: cancelled ? 0 : player.morale,
        effect: 'add-score',
        message: cancelled
          ? `${player.player.name}: morale ${player.morale}, ma il bonus reale neutralizza il malus.`
          : `${player.player.name}: morale ${player.morale}.`,
      })
    }
    if (evolution.momentum.enabled && player.previousPositiveBonus && evolution.momentum.nextMatchBonus !== 0) {
      addPlayerDelta(side, player, evolution.momentum.nextMatchBonus)
      trace.push({
        id: `momentum:${side.side}:${player.key}`,
        ruleId: 'momentum-previous-positive-bonus',
        source: 'momentum',
        name: 'Stato di forma',
        description: 'Bonus ottenuto perché il giocatore aveva prodotto un bonus reale nella partita precedente.',
        side: side.side,
        targetSide: side.side,
        playerKey: player.key,
        amount: evolution.momentum.nextMatchBonus,
        effect: 'add-score',
        message: `${player.player.name}: stato di forma ${signed(evolution.momentum.nextMatchBonus)}.`,
      })
    }
  }
}

function applyAssignedSkills(
  owner: RuntimeSide,
  opponent: RuntimeSide,
  assignments: EvolutionPlayerSkillAssignment[],
  catalog: Map<string, EvolutionSkillDefinition>,
  settings: LeagueSetting,
  random: () => number,
  trace: EvolutionRuleTrace[],
): void {
  const byPlayer = new Map(assignments.map(item => [item.playerKey, item.skillIds] as const))
  for (const player of owner.players.filter(item => isFieldPosition(item.actualPosition))) {
    const ids = byPlayer.get(player.key) ?? []
    for (const id of ids) {
      const definition = catalog.get(id)
      if (!definition || definition.enabled === false) continue
      applyRuleSet(definition.rules, { owner, opponent, origin: player, settings, random, trace })
    }
  }
}

function applyCards(
  owner: RuntimeSide,
  opponent: RuntimeSide,
  selection: EvolutionCardSelection | null | undefined,
  catalog: Map<string, EvolutionCardDefinition>,
  settings: LeagueSetting,
  random: () => number,
  trace: EvolutionRuleTrace[],
): void {
  if (!selection) return
  const evolution = resolveFantazoneEvolutionSettings(settings)
  for (const cardId of selection.cardIds.slice(0, Math.max(0, evolution.coachCards.cardsPerMatch))) {
    const card = catalog.get(cardId)
    if (!card || card.enabled === false) continue
    applyRuleSet(card.rules, { owner, opponent, origin: null, settings, random, trace })
  }
}

function applyRuleSet(rules: EvolutionRuleDefinition[], context: RuleContext): void {
  const applicable = rules
    .filter(rule => rule.enabled !== false && evaluateConditionGroup(rule.conditions, context))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  const selected = resolveStacking(applicable)
  for (const rule of selected) {
    for (const effect of rule.effects) applyEffect(rule, effect, context)
  }
}

function resolveStacking(rules: EvolutionRuleDefinition[]): EvolutionRuleDefinition[] {
  const output: EvolutionRuleDefinition[] = []
  const grouped = new Map<string, EvolutionRuleDefinition[]>()
  for (const rule of rules) {
    const group = rule.stacking.group
    if (!group || rule.stacking.mode === 'stack') {
      output.push(rule)
      continue
    }
    const items = grouped.get(group) ?? []
    items.push(rule)
    grouped.set(group, items)
  }
  for (const items of grouped.values()) {
    const mode = items[0]?.stacking.mode ?? 'stack'
    if (mode === 'last') output.push(items[items.length - 1])
    else if (mode === 'max') output.push([...items].sort((a, b) => effectMagnitude(b) - effectMagnitude(a))[0])
    else if (mode === 'min') output.push([...items].sort((a, b) => effectMagnitude(a) - effectMagnitude(b))[0])
    else output.push(items[0])
  }
  return output.filter(Boolean).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
}

function effectMagnitude(rule: EvolutionRuleDefinition): number {
  return rule.effects.reduce((sum, effect) => {
    if (effect.type === 'add-score' || effect.type === 'set-player-score') return sum + Math.abs(effect.value)
    if (effect.type === 'multiply-event') return sum + Math.abs(effect.factor - 1)
    return sum + effect.quantity
  }, 0)
}

function evaluateConditionGroup(group: EvolutionConditionGroup | undefined, context: RuleContext): boolean {
  if (!group) return true
  if (group.all && !group.all.every(item => isConditionGroup(item) ? evaluateConditionGroup(item, context) : evaluateCondition(item, context))) return false
  if (group.any && !group.any.some(item => isConditionGroup(item) ? evaluateConditionGroup(item, context) : evaluateCondition(item, context))) return false
  if (group.not) {
    const value = isConditionGroup(group.not) ? evaluateConditionGroup(group.not, context) : evaluateCondition(group.not, context)
    if (value) return false
  }
  return true
}

function isConditionGroup(value: EvolutionCondition | EvolutionConditionGroup): value is EvolutionConditionGroup {
  return !('metric' in value)
}

function evaluateCondition(condition: EvolutionCondition, context: RuleContext): boolean {
  const subject = condition.subject ?? 'self'
  if (condition.metric === 'matching-player-count') {
    const side = subject === 'opponent' ? context.opponent : context.owner
    const count = selectPlayers(side, condition.selector, context, null).length
    return compare(count, condition.operator, condition.value)
  }
  if (subject === 'match') return false
  if (subject === 'team' || subject === 'opponent') {
    const side = subject === 'opponent' ? context.opponent : context.owner
    return compare(readSideMetric(side, condition.metric), condition.operator, condition.value)
  }
  if (!context.origin) return false
  return compare(readPlayerMetric(context.origin, context.owner, condition.metric), condition.operator, condition.value)
}

function readSideMetric(side: RuntimeSide, metric: EvolutionMetric): number | string | boolean | null {
  const field = side.players.filter(player => isFieldPosition(player.actualPosition))
  switch (metric) {
    case 'team-formation': return side.formation
    case 'starters-count': return field.length
    case 'starters-played-count': return field.filter(player => player.vote?.hasVote === true).length
    case 'goals': return field.reduce((sum, player) => sum + (player.vote?.goal ?? 0), 0)
    case 'penalty-goals': return field.reduce((sum, player) => sum + (player.vote?.penalty ?? 0), 0)
    case 'assists': return field.reduce((sum, player) => sum + (player.vote?.assist ?? 0), 0)
    case 'suffered-goals': return field.reduce((sum, player) => sum + (player.vote?.sufferedGoal ?? 0), 0)
    case 'saved-penalties': return field.reduce((sum, player) => sum + (player.vote?.stoppedPenalty ?? 0), 0)
    case 'missed-penalties': return field.reduce((sum, player) => sum + (player.vote?.wrongedPenalty ?? 0), 0)
    case 'own-goals': return field.reduce((sum, player) => sum + (player.vote?.ownGoal ?? 0), 0)
    case 'same-family-starters': {
      const counts = new Map<string, number>()
      for (const player of field) counts.set(normalize(player.player.team.name), (counts.get(normalize(player.player.team.name)) ?? 0) + 1)
      return Math.max(0, ...counts.values())
    }
    default: return null
  }
}

function readPlayerMetric(player: RuntimePlayer, side: RuntimeSide, metric: EvolutionMetric): number | string | boolean | null {
  const vote = player.vote
  switch (metric) {
    case 'raw-vote': return vote?.value ?? 0
    case 'fantasy-value': return player.baseFantasyValue
    case 'final-value': return player.effectiveValue
    case 'has-vote': return vote?.hasVote === true
    case 'played': return vote?.hasVote === true
    case 'goals': return vote?.goal ?? 0
    case 'penalty-goals': return vote?.penalty ?? 0
    case 'assists': return vote?.assist ?? 0
    case 'suffered-goals': return vote?.sufferedGoal ?? 0
    case 'saved-penalties': return vote?.stoppedPenalty ?? 0
    case 'missed-penalties': return vote?.wrongedPenalty ?? 0
    case 'own-goals': return vote?.ownGoal ?? 0
    case 'yellow-card': return vote?.status === Behaviour.YellowCard
    case 'red-card': return vote?.status === Behaviour.RedCard
    case 'injured': return vote?.injured === true
    case 'role': return roleToEvolutionRole(player.player.role)
    case 'fantasy-position': return player.player.position
    case 'role-slot': return player.roleSlot
    case 'real-team': return player.player.team.name
    case 'team-formation': return side.formation
    case 'morale': return player.morale
    case 'previous-positive-bonus': return player.previousPositiveBonus
    case 'same-family-starters': return side.players.filter(item => isFieldPosition(item.actualPosition) && normalize(item.player.team.name) === normalize(player.player.team.name)).length
    default: return null
  }
}

function compare(actual: number | string | boolean | null, operator: EvolutionCondition['operator'], expected: EvolutionCondition['value']): boolean {
  if (operator === 'in' || operator === 'not-in') {
    const values = Array.isArray(expected) ? expected : [expected]
    const included = values.some(value => value === actual)
    return operator === 'in' ? included : !included
  }
  if (operator === 'eq') return actual === expected
  if (operator === 'neq') return actual !== expected
  if (typeof actual !== 'number' || typeof expected !== 'number') return false
  if (operator === 'gt') return actual > expected
  if (operator === 'gte') return actual >= expected
  if (operator === 'lt') return actual < expected
  if (operator === 'lte') return actual <= expected
  return false
}

function applyEffect(rule: EvolutionRuleDefinition, effect: EvolutionEffect, context: RuleContext): void {
  if (effect.type === 'add-score') {
    if (effect.target === 'self') {
      if (context.origin) applyPlayerScoreEffect(rule, effect, context.owner, context.origin, effect.value, context)
      return
    }
    if (effect.selector) {
      const side = effect.target === 'opponent' ? context.opponent : context.owner
      for (const player of selectPlayers(side, effect.selector, context, context.origin)) {
        applyPlayerScoreEffect(rule, effect, side, player, effect.value, context)
      }
      return
    }
    const side = effect.target === 'opponent' ? context.opponent : context.owner
    side.scoreDelta += effect.value
    pushTrace(rule, effect, context, side, null, effect.value, `${rule.name}: ${sideLabel(side, context)} ${signed(effect.value)}.`)
    return
  }

  if (effect.type === 'set-player-score') {
    const side = effect.target === 'opponent' ? context.opponent : context.owner
    const players = effect.target === 'self'
      ? (context.origin ? [context.origin] : [])
      : selectPlayers(side, effect.selector, context, context.origin)
    for (const player of players) {
      const before = player.effectiveValue
      const next = effect.mode === 'at-most'
        ? Math.min(before, effect.value)
        : effect.mode === 'at-least'
          ? Math.max(before, effect.value)
          : effect.value
      applyPlayerScoreEffect(rule, effect, side, player, next - before, context)
    }
    return
  }

  if (effect.type === 'cancel-event' || effect.type === 'multiply-event') {
    const side = effect.target === 'opponent' ? context.opponent : context.owner
    const players = effect.target === 'self'
      ? (context.origin ? [context.origin] : [])
      : selectPlayers(side, effect.selector, context, context.origin)
    const events = selectEvents(players, effect.eventType, effect.selector, context.random)
    const quantity = effect.type === 'cancel-event' ? effect.quantity : (effect.quantity ?? events.length)
    for (const event of events.slice(0, Math.max(0, quantity))) {
      const before = eventValue(event)
      if (effect.type === 'cancel-event') event.cancelled = true
      else event.multiplier *= effect.factor
      const delta = eventValue(event) - before
      if (isFieldPosition(event.player.actualPosition)) {
        event.player.effectiveValue += delta
        side.scoreDelta += delta
      }
      pushTrace(rule, effect, context, side, event.player, delta, `${rule.name}: ${event.player.player.name}, ${event.type} ${effect.type === 'cancel-event' ? 'annullato' : `×${effect.factor}`}, ${signed(delta)}.`)
    }
    return
  }

  if (effect.type === 'add-event') {
    const side = effect.target === 'opponent' ? context.opponent : context.owner
    const players = effect.target === 'self'
      ? (context.origin ? [context.origin] : [])
      : selectPlayers(side, effect.selector, context, context.origin)
    const targets = players.length > 0 ? players : (effect.target === 'self' ? [] : side.players.filter(player => isFieldPosition(player.actualPosition)))
    const quantity = Math.max(0, effect.quantity)
    for (let index = 0; index < quantity; index += 1) {
      const player = targets[index % targets.length]
      if (!player) break
      const event: RuntimeEvent = {
        id: `${player.key}:virtual:${effect.eventType}:${player.events.length + 1}`,
        type: effect.eventType,
        baseValue: eventScore(effect.eventType, player.player.role, context.settings),
        multiplier: 1,
        cancelled: false,
        player,
      }
      player.events.push(event)
      const delta = eventValue(event)
      if (isFieldPosition(player.actualPosition)) {
        player.effectiveValue += delta
        side.scoreDelta += delta
      }
      pushTrace(rule, effect, context, side, player, delta, `${rule.name}: ${effect.eventType} assegnato a ${player.player.name}, ${signed(delta)}.`)
    }
  }
}

function applyPlayerScoreEffect(
  rule: EvolutionRuleDefinition,
  effect: EvolutionEffect,
  side: RuntimeSide,
  player: RuntimePlayer,
  delta: number,
  context: RuleContext,
): void {
  if (delta === 0) return
  player.effectiveValue += delta
  if (isFieldPosition(player.actualPosition)) side.scoreDelta += delta
  pushTrace(rule, effect, context, side, player, delta, `${rule.name}: ${player.player.name} ${signed(delta)}.`)
}

function pushTrace(
  rule: EvolutionRuleDefinition,
  effect: EvolutionEffect,
  context: RuleContext,
  targetSide: RuntimeSide,
  player: RuntimePlayer | null,
  amount: number,
  message: string,
): void {
  context.trace.push({
    id: `${rule.id}:${context.trace.length + 1}`,
    ruleId: rule.id,
    source: rule.source,
    name: rule.name,
    description: rule.description,
    side: context.owner.side,
    targetSide: targetSide.side,
    playerKey: player?.key ?? null,
    amount,
    effect: effect.type,
    message,
  })
}

function selectPlayers(
  side: RuntimeSide,
  selector: EvolutionPlayerSelector | undefined,
  context: RuleContext,
  origin: RuntimePlayer | null,
): RuntimePlayer[] {
  let players = [...side.players]
  if (selector?.roles?.length) players = players.filter(player => selector.roles!.includes(roleToEvolutionRole(player.player.role)))
  if (selector?.fantasyPositions?.length) players = players.filter(player => selector.fantasyPositions!.includes(player.player.position))
  if (selector?.realTeams?.length) {
    const names = selector.realTeams.map(normalize)
    players = players.filter(player => names.includes(normalize(player.player.team.name)))
  }
  if (selector?.where) {
    players = players.filter(player => evaluateConditionGroup(selector.where, {
      ...context,
      owner: side,
      opponent: side.side === context.owner.side ? context.opponent : context.owner,
      origin: player,
    }))
  }
  const strategy = selector?.strategy ?? 'first'
  players.sort((a, b) => comparePlayers(a, b, strategy, context.random))
  const quantity = selector?.quantity
  if (quantity != null) players = players.slice(0, Math.max(0, quantity))
  if (!selector && origin && side.side === context.owner.side) return [origin]
  return players
}

function comparePlayers(a: RuntimePlayer, b: RuntimePlayer, strategy: NonNullable<EvolutionPlayerSelector['strategy']>, random: () => number): number {
  if (strategy === 'last') return b.key.localeCompare(a.key)
  if (strategy === 'highest-raw-vote') return (b.vote?.value ?? -1000) - (a.vote?.value ?? -1000) || a.key.localeCompare(b.key)
  if (strategy === 'lowest-raw-vote') return (a.vote?.value ?? 1000) - (b.vote?.value ?? 1000) || a.key.localeCompare(b.key)
  if (strategy === 'highest-fantasy-value') return b.effectiveValue - a.effectiveValue || a.key.localeCompare(b.key)
  if (strategy === 'lowest-fantasy-value') return a.effectiveValue - b.effectiveValue || a.key.localeCompare(b.key)
  if (strategy === 'random') return random() - 0.5
  return a.key.localeCompare(b.key)
}

function selectEvents(players: RuntimePlayer[], type: EvolutionFootballEventType, selector: EvolutionPlayerSelector | undefined, random: () => number): RuntimeEvent[] {
  const events = players.flatMap(player => player.events.filter(event => event.type === type && !event.cancelled))
  const strategy = selector?.strategy ?? 'first'
  if (strategy === 'highest-fantasy-value') return events.sort((a, b) => b.player.effectiveValue - a.player.effectiveValue || a.id.localeCompare(b.id))
  if (strategy === 'lowest-fantasy-value') return events.sort((a, b) => a.player.effectiveValue - b.player.effectiveValue || a.id.localeCompare(b.id))
  if (strategy === 'highest-raw-vote') return events.sort((a, b) => (b.player.vote?.value ?? -1000) - (a.player.vote?.value ?? -1000) || a.id.localeCompare(b.id))
  if (strategy === 'lowest-raw-vote') return events.sort((a, b) => (a.player.vote?.value ?? 1000) - (b.player.vote?.value ?? 1000) || a.id.localeCompare(b.id))
  if (strategy === 'last') return events.sort((a, b) => b.id.localeCompare(a.id))
  if (strategy === 'random') return events.sort(() => random() - 0.5)
  return events.sort((a, b) => a.id.localeCompare(b.id))
}

function finalResolution(home: RuntimeSide, away: RuntimeSide, trace: EvolutionRuleTrace[]): EvolutionMatchResolution {
  return {
    home: {
      point: { ...home.basePoint, value: home.basePoint.value + home.scoreDelta },
      playerValues: Object.fromEntries(home.players.map(player => [player.key, player.effectiveValue])),
      formation: home.formation,
    },
    away: {
      point: { ...away.basePoint, value: away.basePoint.value + away.scoreDelta },
      playerValues: Object.fromEntries(away.players.map(player => [player.key, player.effectiveValue])),
      formation: away.formation,
    },
    trace,
  }
}

function capModifiers(side: RuntimeSide, teamCap: number | null, playerCap: number | null): void {
  if (playerCap != null && Number.isFinite(playerCap) && playerCap >= 0) {
    for (const player of side.players) {
      const delta = player.effectiveValue - player.baseFantasyValue
      const capped = Math.max(-playerCap, Math.min(playerCap, delta))
      const adjustment = capped - delta
      player.effectiveValue += adjustment
      if (isFieldPosition(player.actualPosition)) side.scoreDelta += adjustment
    }
  }
  if (teamCap != null && Number.isFinite(teamCap) && teamCap >= 0) {
    side.scoreDelta = Math.max(-teamCap, Math.min(teamCap, side.scoreDelta))
  }
}

export function createEvolutionPlayerSeasonState(playerKey: string): EvolutionPlayerSeasonState {
  return {
    playerKey,
    morale: 0,
    consecutiveTribune: 0,
    consecutiveBenchUnused: 0,
    consecutiveUnusedMixed: 0,
    previousPositiveBonus: false,
  }
}

export function advanceEvolutionPlayerSeasonState(
  previous: EvolutionPlayerSeasonState,
  usage: EvolutionPlayerUsage,
  vote: Vote | null | undefined,
  settings: LeagueSetting,
): EvolutionPlayerSeasonState {
  const evolution = resolveFantazoneEvolutionSettings(settings)
  const played = usage === 'starter' || usage === 'subbed-in'
  const positive = hasPositiveFootballBonus(vote, evolution.momentum.positiveEvents)
  if (played) {
    return {
      ...previous,
      morale: evolution.morale.enabled && evolution.morale.resetAfterPlaying ? 0 : previous.morale,
      consecutiveTribune: 0,
      consecutiveBenchUnused: 0,
      consecutiveUnusedMixed: 0,
      previousPositiveBonus: evolution.momentum.enabled ? positive : false,
    }
  }

  let consecutiveTribune = usage === 'tribune' ? previous.consecutiveTribune + 1 : 0
  let consecutiveBenchUnused = usage === 'bench-unused' ? previous.consecutiveBenchUnused + 1 : 0
  let consecutiveUnusedMixed = previous.consecutiveUnusedMixed + 1
  let morale = previous.morale
  if (evolution.morale.enabled) {
    const tribuneHit = usage === 'tribune' && consecutiveTribune >= evolution.morale.tribuneConsecutiveDays
    const benchHit = usage === 'bench-unused' && consecutiveBenchUnused >= evolution.morale.benchUnusedConsecutiveDays
    const mixedHit = consecutiveUnusedMixed >= evolution.morale.mixedUnusedConsecutiveDays
    if (tribuneHit || benchHit || mixedHit) {
      morale = Math.max(evolution.morale.minimumMorale, morale + evolution.morale.penaltyPerDrop)
      consecutiveTribune = 0
      consecutiveBenchUnused = 0
      consecutiveUnusedMixed = 0
    }
  }
  return {
    ...previous,
    morale,
    consecutiveTribune,
    consecutiveBenchUnused,
    consecutiveUnusedMixed,
    previousPositiveBonus: false,
  }
}

export function getEvolutionPlayerMatchState(state: EvolutionPlayerSeasonState): EvolutionPlayerMatchState {
  return { morale: state.morale, previousPositiveBonus: state.previousPositiveBonus }
}

export function isEvolutionCardSelectionLocked(day: RealDay | null | undefined, settings: LeagueSetting, now = new Date()): boolean {
  const evolution = resolveFantazoneEvolutionSettings(settings)
  if (!evolution.enabled || !evolution.coachCards.enabled || !day) return false
  const first = firstKickoff(day)
  if (first == null) return false
  return now.getTime() >= first - Math.max(0, evolution.coachCards.lockMinutesBeforeFirstKickoff) * 60_000
}

export function shouldRevealEvolutionCards(day: RealDay | null | undefined, settings: LeagueSetting, now = new Date()): boolean {
  const evolution = resolveFantazoneEvolutionSettings(settings)
  if (!evolution.enabled || !evolution.coachCards.enabled || !day || !evolution.coachCards.revealAtFirstKickoff) return false
  const first = firstKickoff(day)
  return first != null && now.getTime() >= first
}

export function getEvolutionLockedPlayerKeys(
  players: Array<Pick<Player, 'name' | 'team'>>,
  day: RealDay | null | undefined,
  settings: LeagueSetting,
  now = new Date(),
): Set<string> {
  const evolution = resolveFantazoneEvolutionSettings(settings)
  const locked = new Set<string>()
  if (!evolution.enabled || !evolution.progressiveLineupLock.enabled || !day) return locked
  const lockedTeams = new Set<string>()
  for (const game of day.games) {
    if (game.delayed && evolution.progressiveLineupLock.keepDelayedMatchesEditable) continue
    const kickoff = parseKickoff(game)
    if (kickoff == null || now.getTime() < kickoff) continue
    lockedTeams.add(normalize(game.home.name))
    lockedTeams.add(normalize(game.away.name))
  }
  for (const player of players) {
    if (lockedTeams.has(normalize(player.team.name))) locked.add(getPlayerKey(player.name))
  }
  return locked
}

export function isFantazoneEvolutionEnabled(settings: LeagueSetting): boolean {
  return resolveFantazoneEvolutionSettings(settings).enabled
}

function firstKickoff(day: RealDay): number | null {
  const values = day.games.map(parseKickoff).filter((value): value is number => value != null)
  return values.length ? Math.min(...values) : null
}

function parseKickoff(game: RealGame): number | null {
  if (!game.date) return null
  const value = Date.parse(game.date)
  return Number.isFinite(value) ? value : null
}

function roleToEvolutionRole(role: Role): EvolutionRole {
  if (role === Role.GoalKeeper) return 'goalkeeper'
  if (role === Role.Defensor) return 'defender'
  if (role === Role.Midfielder) return 'midfielder'
  if (role === Role.Forward) return 'forward'
  return 'any'
}

function formationOf(players: RuntimePlayer[]): string {
  const field = players.filter(player => isFieldPosition(player.actualPosition))
  const defenders = field.filter(player => player.player.role === Role.Defensor).length
  const midfielders = field.filter(player => player.player.role === Role.Midfielder).length
  const forwards = field.filter(player => player.player.role === Role.Forward).length
  return `${defenders}-${midfielders}-${forwards}`
}

function isFieldPosition(position: FantaSoccerRole): boolean {
  return position >= FantaSoccerRole.GoalKeeper && position <= FantaSoccerRole.Forward
}

function eventValue(event: RuntimeEvent): number {
  return event.cancelled ? 0 : event.baseValue * event.multiplier
}

function eventScore(type: EvolutionFootballEventType, role: Role, settings: LeagueSetting): number {
  const votes = resolveVoteSettings(settings, role)
  switch (type) {
    case 'goal': return votes.goal
    case 'penalty-goal': return votes.penalty
    case 'assist': return votes.assist
    case 'suffered-goal': return votes.sufferedGoal
    case 'saved-penalty': return votes.stoppedPenalty
    case 'missed-penalty': return votes.wrongedPenalty
    case 'own-goal': return votes.ownGoal
    case 'yellow-card': return votes.yellowCard
    case 'red-card': return votes.redCard
    case 'injury': return votes.injury
    case 'man-of-the-match': return votes.manOfTheMatch
    case 'clean-sheet': return settings.pointForCleanSheet
  }
}

function resolveVoteSettings(settings: LeagueSetting, role: Role): VoteLeagueSetting {
  return settings.votes[role] ?? settings.votes[Role.Undefined] ?? DefaultVoteLeagueSetting
}

function hasPositiveFootballBonus(vote: Vote | null | undefined, configured: EvolutionFootballEventType[]): boolean {
  if (!vote) return false
  const events = new Set(configured)
  return (events.has('goal') && vote.goal > 0) ||
    (events.has('penalty-goal') && vote.penalty > 0) ||
    (events.has('assist') && vote.assist > 0) ||
    (events.has('saved-penalty') && vote.stoppedPenalty > 0) ||
    (events.has('man-of-the-match') && vote.manOfTheMatch) ||
    (events.has('clean-sheet') && vote.hasVote && vote.role === Role.GoalKeeper && vote.sufferedGoal === 0)
}

function createSeededRandom(seed: string): () => number {
  let value = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return () => {
    value += 0x6D2B79F5
    let current = value
    current = Math.imul(current ^ (current >>> 15), current | 1)
    current ^= current + Math.imul(current ^ (current >>> 7), current | 61)
    return ((current ^ (current >>> 14)) >>> 0) / 4294967296
  }
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('it-IT')
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${Number(value.toFixed(2))}`
}

function sideLabel(side: RuntimeSide, context: RuleContext): string {
  return side.side === context.owner.side ? 'squadra' : 'avversario'
}
