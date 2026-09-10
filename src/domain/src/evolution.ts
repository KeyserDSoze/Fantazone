import type { Point } from './calendar'
import { getBuiltinEvolutionCards, getBuiltinEvolutionSkills } from './evolutionCatalog'
import {
  createDefaultFantazoneEvolutionSettings,
  type EvolutionCardDefinition,
  type EvolutionCardSelection,
  type EvolutionCondition,
  type EvolutionConditionGroup,
  type EvolutionEffect,
  type EvolutionFootballEventType,
  type EvolutionMetric,
  type EvolutionOperator,
  type EvolutionPlayerMatchState,
  type EvolutionPlayerSeasonState,
  type EvolutionPlayerSelector,
  type EvolutionPlayerSkillAssignment,
  type EvolutionPlayerUsage,
  type EvolutionRole,
  type EvolutionRuleDefinition,
  type EvolutionSeasonSkillDocument,
  type EvolutionSkillDefinition,
  type FantazoneEvolutionSettings,
} from './evolutionModel'
import { DefaultVoteLeagueSetting, Role, type LeagueSetting, type VoteLeagueSetting } from './group'
import type { RealDay, RealGame } from './realCalendar'
import { getPlayerKey, type RealPlayer } from './realPlayer'
import { FantaSoccerRole, type Player } from './team'
import type { TeamPointCalculation } from './teamCalculation'
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
  originalPosition: FantaSoccerRole
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
      ...(source.playerSkills ?? {}),
      rarityWeights: {
        ...defaults.playerSkills.rarityWeights,
        ...(source.playerSkills?.rarityWeights ?? {}),
      },
      catalog: {
        ...defaults.playerSkills.catalog,
        ...(source.playerSkills?.catalog ?? {}),
        disabledSkillIds: [...(source.playerSkills?.catalog?.disabledSkillIds ?? defaults.playerSkills.catalog.disabledSkillIds)],
        customSkills: [...(source.playerSkills?.catalog?.customSkills ?? defaults.playerSkills.catalog.customSkills)],
      },
    },
    coachCards: {
      ...defaults.coachCards,
      ...(source.coachCards ?? {}),
      catalog: {
        ...defaults.coachCards.catalog,
        ...(source.coachCards?.catalog ?? {}),
        disabledCardIds: [...(source.coachCards?.catalog?.disabledCardIds ?? defaults.coachCards.catalog.disabledCardIds)],
        customCards: [...(source.coachCards?.catalog?.customCards ?? defaults.coachCards.catalog.customCards)],
      },
    },
    families: {
      ...defaults.families,
      ...(source.families ?? {}),
      thresholds: [...(source.families?.thresholds ?? defaults.families.thresholds)].map(item => ({ ...item })),
      customRules: [...(source.families?.customRules ?? defaults.families.customRules)],
    },
    morale: { ...defaults.morale, ...(source.morale ?? {}) },
    momentum: {
      ...defaults.momentum,
      ...(source.momentum ?? {}),
      positiveEvents: [...(source.momentum?.positiveEvents ?? defaults.momentum.positiveEvents)],
    },
    progressiveLineupLock: { ...defaults.progressiveLineupLock, ...(source.progressiveLineupLock ?? {}) },
    ruleEngine: { ...defaults.ruleEngine, ...(source.ruleEngine ?? {}) },
    customLeagueRules: [...(source.customLeagueRules ?? defaults.customLeagueRules)],
  }
}

export function isFantazoneEvolutionEnabled(settings: LeagueSetting): boolean {
  return resolveFantazoneEvolutionSettings(settings).enabled
}

export function getEvolutionSkillCatalog(settings: LeagueSetting): EvolutionSkillDefinition[] {
  const evolution = resolveFantazoneEvolutionSettings(settings)
  const disabled = new Set(evolution.playerSkills.catalog.disabledSkillIds)
  return [
    ...getBuiltinEvolutionSkills(evolution.playerSkills.catalog.builtinVersion),
    ...evolution.playerSkills.catalog.customSkills,
  ].filter(skill => skill.enabled !== false && !disabled.has(skill.id))
}

export function getEvolutionCardCatalog(settings: LeagueSetting): EvolutionCardDefinition[] {
  const evolution = resolveFantazoneEvolutionSettings(settings)
  const disabled = new Set(evolution.coachCards.catalog.disabledCardIds)
  return [
    ...getBuiltinEvolutionCards(evolution.coachCards.catalog.builtinVersion),
    ...evolution.coachCards.catalog.customCards,
  ].filter(card => card.enabled !== false && !disabled.has(card.id))
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
  const seed = seedOverride ?? (configuredSeed || `${year}:${evolution.ruleEngine.deterministicRandomSeed}`)
  const catalog = getEvolutionSkillCatalog(settings).filter(skill =>
    skill.power >= evolution.playerSkills.minPower && skill.power <= evolution.playerSkills.maxPower,
  )
  const assignments: EvolutionPlayerSkillAssignment[] = []

  for (const player of [...players].sort((a, b) => getPlayerKey(a.name).localeCompare(getPlayerKey(b.name)))) {
    const playerKey = getPlayerKey(player.name)
    if (!playerKey) continue
    if (!evolution.enabled || !evolution.playerSkills.enabled || evolution.playerSkills.skillsPerPlayer <= 0) {
      assignments.push({ playerKey, skillIds: [] })
      continue
    }

    const role = roleToEvolutionRole(player.role)
    const available = catalog.filter(skill => skill.roles.includes('any') || skill.roles.includes(role))
    const random = createSeededRandom(`${seed}:${playerKey}`)
    const skillIds: string[] = []
    let pool = [...available]
    for (let index = 0; index < evolution.playerSkills.skillsPerPlayer && pool.length > 0; index += 1) {
      const selected = weightedSkillPick(pool, evolution, random)
      if (!selected) break
      skillIds.push(selected.id)
      if (evolution.playerSkills.uniqueSkillPerPlayer) pool = pool.filter(skill => skill.id !== selected.id)
    }
    assignments.push({ playerKey, skillIds })
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
  if (evolution.playerSkills.enabled) {
    const catalog = new Map(getEvolutionSkillCatalog(input.settings).map(skill => [skill.id, skill] as const))
    applyAssignedSkills(home, away, input.homeSkillAssignments ?? [], catalog, input.settings, random, trace)
    applyAssignedSkills(away, home, input.awaySkillAssignments ?? [], catalog, input.settings, random, trace)
  }

  if (evolution.coachCards.enabled) {
    const catalog = new Map(getEvolutionCardCatalog(input.settings).map(card => [card.id, card] as const))
    applyCards(home, away, input.homeCards, catalog, input.settings, random, trace)
    applyCards(away, home, input.awayCards, catalog, input.settings, random, trace)
  }

  applyRuleSet(evolution.families.customRules, context(home, away, null, input.settings, random, trace))
  applyRuleSet(evolution.families.customRules, context(away, home, null, input.settings, random, trace))
  applyRuleSet(evolution.customLeagueRules, context(home, away, null, input.settings, random, trace))
  applyRuleSet(evolution.customLeagueRules, context(away, home, null, input.settings, random, trace))

  applyCaps(home, evolution.ruleEngine.maxAbsolutePlayerModifier, evolution.ruleEngine.maxAbsoluteTeamModifier)
  applyCaps(away, evolution.ruleEngine.maxAbsolutePlayerModifier, evolution.ruleEngine.maxAbsoluteTeamModifier)
  return finalResolution(home, away, trace)
}

function context(
  owner: RuntimeSide,
  opponent: RuntimeSide,
  origin: RuntimePlayer | null,
  settings: LeagueSetting,
  random: () => number,
  trace: EvolutionRuleTrace[],
): RuleContext {
  return { owner, opponent, origin, settings, random, trace }
}

function weightedSkillPick(
  skills: EvolutionSkillDefinition[],
  evolution: FantazoneEvolutionSettings,
  random: () => number,
): EvolutionSkillDefinition | null {
  const entries = skills.map(skill => ({
    skill,
    weight: Math.max(0, skill.weight) * Math.max(0, evolution.playerSkills.rarityWeights[skill.rarity] ?? 0),
  }))
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
  if (total <= 0) return skills[Math.floor(random() * skills.length)] ?? null
  let cursor = random() * total
  for (const entry of entries) {
    cursor -= entry.weight
    if (cursor <= 0) return entry.skill
  }
  return entries[entries.length - 1]?.skill ?? null
}

function buildRuntimeSide(
  side: EvolutionSide,
  calculation: TeamPointCalculation,
  settings: LeagueSetting,
  states?: Record<string, EvolutionPlayerMatchState | undefined>,
): RuntimeSide {
  const roleSlots = new Map<Role, number>()
  const players = calculation.formation.map(enriched => {
    const key = getPlayerKey(enriched.current.name)
    const actualInField = isFieldPosition(enriched.currentPosition)
    const slot = actualInField ? (roleSlots.get(enriched.current.role) ?? 0) + 1 : 0
    if (actualInField) roleSlots.set(enriched.current.role, slot)
    const state = states?.[key]
    const baseFantasyValue = actualInField && enriched.vote?.hasVote ? (enriched.finalValue?.value ?? 0) : 0
    const runtime: RuntimePlayer = {
      player: enriched.current,
      key,
      actualPosition: enriched.currentPosition,
      originalPosition: enriched.current.position,
      roleSlot: slot,
      vote: enriched.vote,
      baseFantasyValue,
      effectiveValue: baseFantasyValue,
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
  if (vote.hasVote && player.player.role === Role.GoalKeeper && vote.sufferedGoal === 0 && settings.pointForCleanSheet !== 0) {
    definitions.push(['clean-sheet', 1, settings.pointForCleanSheet])
  }

  const events: RuntimeEvent[] = []
  for (const [type, count, baseValue] of definitions) {
    for (let index = 0; index < Math.max(0, count); index += 1) {
      events.push({
        id: `${player.key}:${type}:${index + 1}`,
        type,
        baseValue,
        multiplier: 1,
        cancelled: false,
        player,
      })
    }
  }
  return events
}

function applyFamilySynergy(side: RuntimeSide, evolution: FantazoneEvolutionSettings, trace: EvolutionRuleTrace[]): void {
  const eligible = evolution.families.scope === 'starting-eleven'
    ? side.players.filter(player => isFieldPosition(player.originalPosition))
    : side.players.filter(player => isFieldPosition(player.actualPosition) && player.vote?.hasVote === true)
  const byFamily = new Map<string, RuntimePlayer[]>()
  for (const player of eligible) {
    const family = normalize(player.player.team.name)
    if (!family) continue
    const group = byFamily.get(family) ?? []
    group.push(player)
    byFamily.set(family, group)
  }
  const thresholds = [...evolution.families.thresholds].sort((a, b) => a.minPlayers - b.minPlayers)
  for (const players of byFamily.values()) {
    const matching = thresholds.filter(threshold => players.length >= threshold.minPlayers)
    const threshold = matching[matching.length - 1]
    if (!threshold || threshold.bonusPerPlayer === 0) continue
    for (const player of players) {
      addPlayerModifier(side, player, threshold.bonusPerPlayer, true)
      trace.push({
        id: `family:${side.side}:${normalize(player.player.team.name)}:${player.key}`,
        ruleId: `family-${threshold.minPlayers}`,
        source: 'synergy',
        name: `Famiglia ${player.player.team.name}`,
        description: `${players.length} giocatori schierati della stessa squadra reale.`,
        side: side.side,
        targetSide: side.side,
        playerKey: player.key,
        amount: threshold.bonusPerPlayer,
        effect: 'add-score',
        message: `${player.player.name}: Famiglia ${player.player.team.name} ×${players.length}, ${signed(threshold.bonusPerPlayer)}.`,
      })
    }
  }
}

function applyMoraleAndMomentum(side: RuntimeSide, evolution: FantazoneEvolutionSettings, trace: EvolutionRuleTrace[]): void {
  for (const player of side.players.filter(item => isFieldPosition(item.actualPosition))) {
    if (evolution.morale.enabled && player.morale < 0) {
      const positive = hasPositiveFootballBonus(player.vote, evolution.momentum.positiveEvents)
      const neutralized = evolution.morale.cancelMatchPenaltyOnPositiveFootballBonus && positive
      if (!neutralized) addPlayerModifier(side, player, player.morale)
      trace.push({
        id: `morale:${side.side}:${player.key}`,
        ruleId: neutralized ? 'morale-reaction' : 'morale-low',
        source: 'morale',
        name: neutralized ? 'Reazione di morale' : 'Morale basso',
        description: neutralized
          ? 'Il giocatore partiva con morale basso, ma un bonus reale neutralizza il malus.'
          : 'Il giocatore entra nella partita con morale negativo.',
        side: side.side,
        targetSide: side.side,
        playerKey: player.key,
        amount: neutralized ? 0 : player.morale,
        effect: 'add-score',
        message: neutralized
          ? `${player.player.name}: morale ${player.morale}, neutralizzato da un bonus reale.`
          : `${player.player.name}: morale ${player.morale}.`,
      })
    }
    if (evolution.momentum.enabled && player.previousPositiveBonus && evolution.momentum.nextMatchBonus !== 0) {
      addPlayerModifier(side, player, evolution.momentum.nextMatchBonus)
      trace.push({
        id: `momentum:${side.side}:${player.key}`,
        ruleId: 'momentum-previous-positive-bonus',
        source: 'momentum',
        name: 'Stato di forma',
        description: 'Bonus ottenuto per un bonus reale prodotto nella partita precedente.',
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
  const byPlayer = new Map(assignments.map(assignment => [assignment.playerKey, assignment.skillIds] as const))
  for (const player of owner.players.filter(item => isFieldPosition(item.actualPosition))) {
    for (const skillId of byPlayer.get(player.key) ?? []) {
      const skill = catalog.get(skillId)
      if (!skill) continue
      applyRuleSet(skill.rules, context(owner, opponent, player, settings, random, trace))
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
  const maxCards = resolveFantazoneEvolutionSettings(settings).coachCards.cardsPerMatch
  for (const cardId of selection.cardIds.slice(0, Math.max(0, maxCards))) {
    const card = catalog.get(cardId)
    if (!card) continue
    applyRuleSet(card.rules, context(owner, opponent, null, settings, random, trace))
  }
}

function applyRuleSet(rules: EvolutionRuleDefinition[], ctx: RuleContext): void {
  const matching = rules
    .filter(rule => rule.enabled !== false && evaluateGroup(rule.conditions, ctx))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  for (const rule of resolveStacking(matching)) {
    const max = rule.stacking.maxApplicationsPerMatch
    const effects = max == null ? rule.effects : rule.effects.slice(0, Math.max(0, max))
    for (const effect of effects) applyEffect(rule, effect, ctx)
  }
}

function resolveStacking(rules: EvolutionRuleDefinition[]): EvolutionRuleDefinition[] {
  const direct: EvolutionRuleDefinition[] = []
  const groups = new Map<string, EvolutionRuleDefinition[]>()
  for (const rule of rules) {
    const group = rule.stacking.group
    if (!group || rule.stacking.mode === 'stack') {
      direct.push(rule)
      continue
    }
    groups.set(group, [...(groups.get(group) ?? []), rule])
  }
  for (const items of groups.values()) {
    const mode = items[0]?.stacking.mode ?? 'first'
    if (mode === 'last') direct.push(items[items.length - 1])
    else if (mode === 'max') direct.push([...items].sort((a, b) => effectMagnitude(b) - effectMagnitude(a))[0])
    else if (mode === 'min') direct.push([...items].sort((a, b) => effectMagnitude(a) - effectMagnitude(b))[0])
    else direct.push(items[0])
  }
  return direct.filter((value): value is EvolutionRuleDefinition => Boolean(value))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
}

function effectMagnitude(rule: EvolutionRuleDefinition): number {
  return rule.effects.reduce((sum, effect) => {
    if (effect.type === 'add-score' || effect.type === 'set-player-score') return sum + Math.abs(effect.value)
    if (effect.type === 'multiply-event') return sum + Math.abs(effect.factor - 1)
    return sum + Math.abs(effect.quantity)
  }, 0)
}

function evaluateGroup(group: EvolutionConditionGroup | undefined, ctx: RuleContext): boolean {
  if (!group) return true
  if (group.all && !group.all.every(item => isGroup(item) ? evaluateGroup(item, ctx) : evaluateCondition(item, ctx))) return false
  if (group.any && !group.any.some(item => isGroup(item) ? evaluateGroup(item, ctx) : evaluateCondition(item, ctx))) return false
  if (group.not) {
    const result = isGroup(group.not) ? evaluateGroup(group.not, ctx) : evaluateCondition(group.not, ctx)
    if (result) return false
  }
  return true
}

function isGroup(value: EvolutionCondition | EvolutionConditionGroup): value is EvolutionConditionGroup {
  return !('metric' in value)
}

function evaluateCondition(condition: EvolutionCondition, ctx: RuleContext): boolean {
  const subject = condition.subject ?? 'self'
  if (condition.metric === 'matching-player-count') {
    const side = subject === 'opponent' ? ctx.opponent : ctx.owner
    return compare(selectPlayers(side, condition.selector, ctx).length, condition.operator, condition.value)
  }
  if (subject === 'match') return false
  if (subject === 'team' || subject === 'opponent') {
    const side = subject === 'opponent' ? ctx.opponent : ctx.owner
    return compare(readSideMetric(side, condition.metric), condition.operator, condition.value)
  }
  if (!ctx.origin) return false
  return compare(readPlayerMetric(ctx.origin, ctx.owner, condition.metric), condition.operator, condition.value)
}

function readSideMetric(side: RuntimeSide, metric: EvolutionMetric): number | string | boolean | null {
  const starters = side.players.filter(player => isFieldPosition(player.originalPosition))
  const active = side.players.filter(player => isFieldPosition(player.actualPosition))
  switch (metric) {
    case 'team-formation': return side.formation
    case 'starters-count': return starters.length
    case 'starters-played-count': return starters.filter(player => player.vote?.hasVote === true).length
    case 'goals': return active.reduce((sum, player) => sum + (player.vote?.goal ?? 0), 0)
    case 'penalty-goals': return active.reduce((sum, player) => sum + (player.vote?.penalty ?? 0), 0)
    case 'assists': return active.reduce((sum, player) => sum + (player.vote?.assist ?? 0), 0)
    case 'suffered-goals': return active.reduce((sum, player) => sum + (player.vote?.sufferedGoal ?? 0), 0)
    case 'saved-penalties': return active.reduce((sum, player) => sum + (player.vote?.stoppedPenalty ?? 0), 0)
    case 'missed-penalties': return active.reduce((sum, player) => sum + (player.vote?.wrongedPenalty ?? 0), 0)
    case 'own-goals': return active.reduce((sum, player) => sum + (player.vote?.ownGoal ?? 0), 0)
    case 'same-family-starters': {
      const counts = new Map<string, number>()
      for (const player of starters) {
        const family = normalize(player.player.team.name)
        counts.set(family, (counts.get(family) ?? 0) + 1)
      }
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
    case 'fantasy-position': return player.originalPosition
    case 'role-slot': return player.roleSlot
    case 'real-team': return player.player.team.name
    case 'team-formation': return side.formation
    case 'morale': return player.morale
    case 'previous-positive-bonus': return player.previousPositiveBonus
    case 'same-family-starters': return side.players.filter(item =>
      isFieldPosition(item.originalPosition) && normalize(item.player.team.name) === normalize(player.player.team.name),
    ).length
    default: return null
  }
}

function compare(
  actual: number | string | boolean | null,
  operator: EvolutionOperator,
  expected: number | string | boolean | Array<number | string | boolean>,
): boolean {
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

function applyEffect(rule: EvolutionRuleDefinition, effect: EvolutionEffect, ctx: RuleContext): void {
  if (effect.type === 'add-score') {
    if (effect.target === 'self') {
      if (ctx.origin) applyPlayerScore(rule, effect, ctx.owner, ctx.origin, effect.value, ctx)
      return
    }
    const side = effect.target === 'opponent' ? ctx.opponent : ctx.owner
    if (effect.selector) {
      for (const player of selectPlayers(side, effect.selector, ctx)) {
        applyPlayerScore(rule, effect, side, player, effect.value, ctx)
      }
    } else {
      side.scoreDelta += effect.value
      pushTrace(rule, effect, ctx, side, null, effect.value, `${rule.name}: ${side.side === ctx.owner.side ? 'squadra' : 'avversario'} ${signed(effect.value)}.`)
    }
    return
  }

  if (effect.type === 'set-player-score') {
    const side = effect.target === 'opponent' ? ctx.opponent : ctx.owner
    const targets = effect.target === 'self' && ctx.origin
      ? [ctx.origin]
      : selectPlayers(side, effect.selector, ctx)
    for (const player of targets) {
      const before = player.effectiveValue
      const next = effect.mode === 'at-least'
        ? Math.max(before, effect.value)
        : effect.mode === 'at-most'
          ? Math.min(before, effect.value)
          : effect.value
      applyPlayerScore(rule, effect, side, player, next - before, ctx)
    }
    return
  }

  if (effect.type === 'cancel-event' || effect.type === 'multiply-event') {
    const side = effect.target === 'opponent' ? ctx.opponent : ctx.owner
    const targets = effect.target === 'self' && ctx.origin
      ? [ctx.origin]
      : selectPlayers(side, effect.selector, ctx)
    const events = selectEvents(targets, effect.eventType, effect.selector, ctx.random)
    const quantity = effect.type === 'cancel-event' ? effect.quantity : (effect.quantity ?? events.length)
    for (const event of events.slice(0, Math.max(0, quantity))) {
      const before = eventValue(event)
      if (effect.type === 'cancel-event') event.cancelled = true
      else event.multiplier *= effect.factor
      const delta = eventValue(event) - before
      addPlayerModifier(side, event.player, delta)
      pushTrace(
        rule,
        effect,
        ctx,
        side,
        event.player,
        delta,
        `${rule.name}: ${event.player.player.name}, ${event.type} ${effect.type === 'cancel-event' ? 'annullato' : `×${effect.factor}`}, ${signed(delta)}.`,
      )
    }
    return
  }

  const side = effect.target === 'opponent' ? ctx.opponent : ctx.owner
  const targets = effect.target === 'self' && ctx.origin
    ? [ctx.origin]
    : selectPlayers(side, effect.selector, ctx)
  for (let index = 0; index < Math.max(0, effect.quantity); index += 1) {
    const player = targets[index % targets.length]
    if (!player) break
    const event: RuntimeEvent = {
      id: `${player.key}:virtual:${effect.eventType}:${player.events.length + 1}`,
      type: effect.eventType,
      baseValue: eventScore(effect.eventType, player.player.role, ctx.settings),
      multiplier: 1,
      cancelled: false,
      player,
    }
    player.events.push(event)
    const delta = eventValue(event)
    addPlayerModifier(side, player, delta)
    pushTrace(rule, effect, ctx, side, player, delta, `${rule.name}: ${effect.eventType} assegnato a ${player.player.name}, ${signed(delta)}.`)
  }
}

function applyPlayerScore(
  rule: EvolutionRuleDefinition,
  effect: EvolutionEffect,
  side: RuntimeSide,
  player: RuntimePlayer,
  delta: number,
  ctx: RuleContext,
): void {
  if (delta === 0) return
  addPlayerModifier(side, player, delta)
  pushTrace(rule, effect, ctx, side, player, delta, `${rule.name}: ${player.player.name} ${signed(delta)}.`)
}

function addPlayerModifier(side: RuntimeSide, player: RuntimePlayer, delta: number, countEvenIfNotActualField = false): void {
  player.effectiveValue += delta
  if (countEvenIfNotActualField || isFieldPosition(player.actualPosition)) side.scoreDelta += delta
}

function pushTrace(
  rule: EvolutionRuleDefinition,
  effect: EvolutionEffect,
  ctx: RuleContext,
  targetSide: RuntimeSide,
  player: RuntimePlayer | null,
  amount: number,
  message: string,
): void {
  ctx.trace.push({
    id: `${rule.id}:${ctx.trace.length + 1}`,
    ruleId: rule.id,
    source: rule.source,
    name: rule.name,
    description: rule.description,
    side: ctx.owner.side,
    targetSide: targetSide.side,
    playerKey: player?.key ?? null,
    amount,
    effect: effect.type,
    message,
  })
}

function selectPlayers(side: RuntimeSide, selector: EvolutionPlayerSelector | undefined, ctx: RuleContext): RuntimePlayer[] {
  let players = [...side.players]
  if (selector?.roles?.length) {
    players = players.filter(player => selector.roles!.includes(roleToEvolutionRole(player.player.role)))
  }
  if (selector?.fantasyPositions?.length) {
    players = players.filter(player => selector.fantasyPositions!.includes(player.originalPosition))
  }
  if (selector?.realTeams?.length) {
    const teams = selector.realTeams.map(normalize)
    players = players.filter(player => teams.includes(normalize(player.player.team.name)))
  }
  if (selector?.where) {
    players = players.filter(player => evaluateGroup(selector.where, {
      ...ctx,
      owner: side,
      opponent: side.side === ctx.owner.side ? ctx.opponent : ctx.owner,
      origin: player,
    }))
  }
  players = orderPlayers(players, selector?.strategy ?? 'first', ctx.random)
  return selector?.quantity == null ? players : players.slice(0, Math.max(0, selector.quantity))
}

function orderPlayers(players: RuntimePlayer[], strategy: NonNullable<EvolutionPlayerSelector['strategy']>, random: () => number): RuntimePlayer[] {
  if (strategy === 'random') {
    return players.map(player => ({ player, order: random() })).sort((a, b) => a.order - b.order).map(item => item.player)
  }
  return [...players].sort((a, b) => {
    if (strategy === 'last') return b.key.localeCompare(a.key)
    if (strategy === 'highest-raw-vote') return (b.vote?.value ?? -1000) - (a.vote?.value ?? -1000) || a.key.localeCompare(b.key)
    if (strategy === 'lowest-raw-vote') return (a.vote?.value ?? 1000) - (b.vote?.value ?? 1000) || a.key.localeCompare(b.key)
    if (strategy === 'highest-fantasy-value') return b.effectiveValue - a.effectiveValue || a.key.localeCompare(b.key)
    if (strategy === 'lowest-fantasy-value') return a.effectiveValue - b.effectiveValue || a.key.localeCompare(b.key)
    return a.key.localeCompare(b.key)
  })
}

function selectEvents(
  players: RuntimePlayer[],
  type: EvolutionFootballEventType,
  selector: EvolutionPlayerSelector | undefined,
  random: () => number,
): RuntimeEvent[] {
  let events = players.flatMap(player => player.events.filter(event => event.type === type && !event.cancelled))
  const strategy = selector?.strategy ?? 'first'
  if (strategy === 'random') {
    events = events.map(event => ({ event, order: random() })).sort((a, b) => a.order - b.order).map(item => item.event)
  } else {
    events.sort((a, b) => {
      if (strategy === 'last') return b.id.localeCompare(a.id)
      if (strategy === 'highest-raw-vote') return (b.player.vote?.value ?? -1000) - (a.player.vote?.value ?? -1000) || a.id.localeCompare(b.id)
      if (strategy === 'lowest-raw-vote') return (a.player.vote?.value ?? 1000) - (b.player.vote?.value ?? 1000) || a.id.localeCompare(b.id)
      if (strategy === 'highest-fantasy-value') return b.player.effectiveValue - a.player.effectiveValue || a.id.localeCompare(b.id)
      if (strategy === 'lowest-fantasy-value') return a.player.effectiveValue - b.player.effectiveValue || a.id.localeCompare(b.id)
      return a.id.localeCompare(b.id)
    })
  }
  return events
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

function applyCaps(side: RuntimeSide, playerCap: number | null, teamCap: number | null): void {
  if (playerCap != null && Number.isFinite(playerCap) && playerCap >= 0) {
    for (const player of side.players) {
      const delta = player.effectiveValue - player.baseFantasyValue
      const capped = Math.max(-playerCap, Math.min(playerCap, delta))
      const correction = capped - delta
      player.effectiveValue += correction
      if (isFieldPosition(player.actualPosition)) side.scoreDelta += correction
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
  if (!evolution.enabled || !evolution.coachCards.enabled || !evolution.coachCards.revealAtFirstKickoff || !day) return false
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

function firstKickoff(day: RealDay): number | null {
  const values = day.games.map(parseKickoff).filter((value): value is number => value != null)
  return values.length === 0 ? null : Math.min(...values)
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
  return [Role.Defensor, Role.Midfielder, Role.Forward]
    .map(role => field.filter(player => player.player.role === role).length)
    .join('-')
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
