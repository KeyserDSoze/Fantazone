import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Behaviour,
  DefaultLeagueSetting,
  FantaSoccerRole,
  PlayerInTeamStatus,
  Role,
  advanceEvolutionPlayerSeasonState,
  assignEvolutionSkills,
  calculateEvolutionMatch,
  createEvolutionPlayerSeasonState,
  getEvolutionCardCatalog,
  getEvolutionLockedPlayerKeys,
  getEvolutionPlayerMatchState,
  getEvolutionSkillCatalog,
  isEvolutionCardSelectionLocked,
  resolveFantazoneEvolutionSettings,
  shouldRevealEvolutionCards,
  type EnrichedTeamPlayer,
  type LeagueSetting,
  type Player,
  type RealDay,
  type TeamPointCalculation,
  type Vote,
} from '../../src/domain/src/index'

function settings(): LeagueSetting {
  const value = structuredClone(DefaultLeagueSetting)
  value.evolution.enabled = true
  return value
}

function player(name: string, role: Role, realTeam = 'Roma', position = rolePosition(role)): Player {
  return {
    name,
    team: { name: realTeam, abbreviation: realTeam.slice(0, 3).toUpperCase() },
    role,
    isActive: true,
    visible: true,
    price: 1,
    revenue: 0,
    status: PlayerInTeamStatus.Active,
    position,
  }
}

function vote(role: Role, value = 6, patch: Partial<Vote> = {}): Vote {
  return {
    role,
    value,
    isFinal: true,
    goal: 0,
    penalty: 0,
    assist: 0,
    stoppedPenalty: 0,
    sufferedGoal: 0,
    wrongedPenalty: 0,
    ownGoal: 0,
    status: Behaviour.Nothing,
    manOfTheMatch: false,
    hasVote: true,
    isOut: false,
    isIn: true,
    injured: false,
    ...patch,
  }
}

function enriched(current: Player, currentVote: Vote | null, finalValue?: number): EnrichedTeamPlayer {
  return {
    current,
    currentPosition: current.position,
    vote: currentVote,
    finalValue: currentVote ? { value: finalValue ?? currentVote.value, special: false } : null,
  }
}

function calculation(formation: EnrichedTeamPlayer[], value?: number): TeamPointCalculation {
  return {
    point: {
      value: value ?? formation.reduce((sum, item) => sum + (item.currentPosition <= FantaSoccerRole.Forward && item.vote?.hasVote ? item.finalValue?.value ?? 0 : 0), 0),
      defensiveBonus: false,
      goodPeople: false,
      ownGoal: false,
    },
    formation,
  }
}

function rolePosition(role: Role): FantaSoccerRole {
  if (role === Role.GoalKeeper) return FantaSoccerRole.GoalKeeper
  if (role === Role.Defensor) return FantaSoccerRole.Defensor
  if (role === Role.Midfielder) return FantaSoccerRole.Midfielder
  return FantaSoccerRole.Forward
}

function emptyCalculation(): TeamPointCalculation {
  return calculation([], 0)
}

test('Evolution is opt-in and legacy settings resolve to a disabled complete profile', () => {
  const legacy = structuredClone(DefaultLeagueSetting) as LeagueSetting
  delete (legacy as unknown as { evolution?: unknown }).evolution
  const resolved = resolveFantazoneEvolutionSettings(legacy)
  assert.equal(resolved.enabled, false)
  assert.equal(resolved.playerSkills.enabled, true)
  assert.equal(resolved.families.thresholds.find(item => item.minPlayers === 4)?.bonusPerPlayer, 1)
})

test('built-in catalog is broad, role-aware and contains coach cards', () => {
  const value = settings()
  const skills = getEvolutionSkillCatalog(value)
  const cards = getEvolutionCardCatalog(value)
  assert.ok(skills.length >= 60)
  assert.ok(skills.some(skill => skill.id === 'mf-virtual-vote-6' && skill.roles.includes('midfielder')))
  assert.ok(skills.some(skill => skill.id === 'df-wall-goal-7'))
  assert.ok(cards.length >= 10)
  assert.ok(cards.some(card => card.id === 'card-counter-433'))
})

test('seasonal skill assignment is deterministic for the same seed', () => {
  const value = settings()
  const players = [
    player('Portiere Uno', Role.GoalKeeper),
    player('Difensore Uno', Role.Defensor),
    player('Mediano Uno', Role.Midfielder),
    player('Punta Uno', Role.Forward),
  ]
  const first = assignEvolutionSkills(players, value, 16, '2026-09-10T00:00:00.000Z', 'same-seed')
  const second = assignEvolutionSkills(players, value, 16, '2026-09-11T00:00:00.000Z', 'same-seed')
  assert.deepEqual(first.assignments, second.assignments)
  assert.ok(first.assignments.every(item => item.skillIds.length === 1))
})

test('four starters of the same real-team family receive +1 each', () => {
  const value = settings()
  value.evolution.playerSkills.enabled = false
  value.evolution.coachCards.enabled = false
  value.evolution.morale.enabled = false
  value.evolution.momentum.enabled = false
  const home = calculation([
    enriched(player('Roma GK', Role.GoalKeeper, 'Roma'), vote(Role.GoalKeeper)),
    enriched(player('Roma D', Role.Defensor, 'Roma'), vote(Role.Defensor)),
    enriched(player('Roma M', Role.Midfielder, 'Roma'), vote(Role.Midfielder)),
    enriched(player('Roma F', Role.Forward, 'Roma'), vote(Role.Forward)),
  ], 24)
  const result = calculateEvolutionMatch({ home, away: emptyCalculation(), settings: value })
  assert.equal(result.home.point.value, 28)
  assert.equal(result.trace.filter(item => item.source === 'synergy').length, 4)
})

test('midfielder virtual-vote skill can guarantee 6 when he does not play', () => {
  const value = settings()
  value.evolution.families.enabled = false
  value.evolution.coachCards.enabled = false
  value.evolution.morale.enabled = false
  value.evolution.momentum.enabled = false
  const midfielder = player('Sempre Presente', Role.Midfielder)
  const home = calculation([enriched(midfielder, null)], 0)
  const result = calculateEvolutionMatch({
    home,
    away: emptyCalculation(),
    settings: value,
    homeSkillAssignments: [{ playerKey: 'semprepresente', skillIds: ['mf-virtual-vote-6'] }],
  })
  assert.equal(result.home.point.value, 6)
  assert.equal(result.home.playerValues.semprepresente, 6)
})

test('defender raw-vote skill cancels an opponent goal using league goal value', () => {
  const value = settings()
  value.evolution.families.enabled = false
  value.evolution.coachCards.enabled = false
  value.evolution.morale.enabled = false
  value.evolution.momentum.enabled = false
  const defender = player('Muro', Role.Defensor)
  const striker = player('Bomber', Role.Forward, 'Milan')
  const home = calculation([enriched(defender, vote(Role.Defensor, 7), 7)], 7)
  const away = calculation([enriched(striker, vote(Role.Forward, 7, { goal: 1 }), 10)], 10)
  const result = calculateEvolutionMatch({
    home,
    away,
    settings: value,
    homeSkillAssignments: [{ playerKey: 'muro', skillIds: ['df-wall-goal-7'] }],
  })
  assert.equal(result.away.point.value, 7)
  assert.ok(result.trace.some(item => item.effect === 'cancel-event' && item.amount === -3))
})

test('counter card penalizes exactly an opponent 4-3-3 by four points', () => {
  const value = settings()
  value.evolution.families.enabled = false
  value.evolution.playerSkills.enabled = false
  value.evolution.morale.enabled = false
  value.evolution.momentum.enabled = false
  const away = calculation([
    enriched(player('GK', Role.GoalKeeper, 'A'), vote(Role.GoalKeeper)),
    ...Array.from({ length: 4 }, (_, index) => enriched(player(`D${index}`, Role.Defensor, 'A'), vote(Role.Defensor))),
    ...Array.from({ length: 3 }, (_, index) => enriched(player(`M${index}`, Role.Midfielder, 'B'), vote(Role.Midfielder))),
    ...Array.from({ length: 3 }, (_, index) => enriched(player(`F${index}`, Role.Forward, 'C'), vote(Role.Forward))),
  ], 66)
  const result = calculateEvolutionMatch({
    home: emptyCalculation(),
    away,
    settings: value,
    homeCards: { cardIds: ['card-counter-433'], selectedAt: '2026-09-10T00:00:00Z', lockedAt: null, revealedAt: null },
  })
  assert.equal(result.away.formation, '4-3-3')
  assert.equal(result.away.point.value, 62)
})

test('event multipliers use league scoring instead of hard-coded own-goal values', () => {
  const value = settings()
  value.evolution.families.enabled = false
  value.evolution.playerSkills.enabled = false
  value.evolution.morale.enabled = false
  value.evolution.momentum.enabled = false
  value.votes[Role.Undefined] = { ...value.votes[Role.Undefined]!, ownGoal: -4 }
  const unlucky = player('Sfortunato', Role.Defensor, 'Milan')
  const away = calculation([enriched(unlucky, vote(Role.Defensor, 6, { ownGoal: 1 }), 2)], 2)
  const result = calculateEvolutionMatch({
    home: emptyCalculation(),
    away,
    settings: value,
    homeCards: { cardIds: ['card-double-own-goal'], selectedAt: '2026-09-10T00:00:00Z', lockedAt: null, revealedAt: null },
  })
  assert.equal(result.away.point.value, -2)
  assert.ok(result.trace.some(item => item.effect === 'multiply-event' && item.amount === -4))
})

test('morale drops after two tribune days and resets on play while momentum remembers real bonus', () => {
  const value = settings()
  let state = createEvolutionPlayerSeasonState('attaccante')
  state = advanceEvolutionPlayerSeasonState(state, 'tribune', null, value)
  assert.equal(state.morale, 0)
  state = advanceEvolutionPlayerSeasonState(state, 'tribune', null, value)
  assert.equal(state.morale, -1)

  state = advanceEvolutionPlayerSeasonState(state, 'starter', vote(Role.Forward, 7, { goal: 1 }), value)
  assert.equal(state.morale, 0)
  assert.equal(state.previousPositiveBonus, true)
  assert.deepEqual(getEvolutionPlayerMatchState(state), { morale: 0, previousPositiveBonus: true })
})

test('a real positive bonus neutralizes the return-match morale penalty but trace keeps the reaction', () => {
  const value = settings()
  value.evolution.families.enabled = false
  value.evolution.playerSkills.enabled = false
  value.evolution.coachCards.enabled = false
  value.evolution.momentum.enabled = false
  const striker = player('Rientro', Role.Forward)
  const home = calculation([enriched(striker, vote(Role.Forward, 6, { assist: 1 }), 7)], 7)
  const result = calculateEvolutionMatch({
    home,
    away: emptyCalculation(),
    settings: value,
    homePlayerState: { rientro: { morale: -1, previousPositiveBonus: false } },
  })
  assert.equal(result.home.point.value, 7)
  assert.ok(result.trace.some(item => item.source === 'morale' && /neutralizza/i.test(item.description)))
})

test('cards lock before kickoff and reveal exactly at kickoff', () => {
  const value = settings()
  value.evolution.coachCards.lockMinutesBeforeFirstKickoff = 30
  const day: RealDay = {
    year: 16,
    serieADay: 1,
    games: [{
      home: { name: 'Roma', abbreviation: 'ROM' },
      away: { name: 'Milan', abbreviation: 'MIL' },
      date: '2026-09-12T16:00:00.000Z',
      homeGoals: null,
      awayGoals: null,
      delayed: false,
    }],
  }
  assert.equal(isEvolutionCardSelectionLocked(day, value, new Date('2026-09-12T15:29:59.000Z')), false)
  assert.equal(isEvolutionCardSelectionLocked(day, value, new Date('2026-09-12T15:30:00.000Z')), true)
  assert.equal(shouldRevealEvolutionCards(day, value, new Date('2026-09-12T15:59:59.000Z')), false)
  assert.equal(shouldRevealEvolutionCards(day, value, new Date('2026-09-12T16:00:00.000Z')), true)
})

test('progressive lock freezes only players whose real match has started', () => {
  const value = settings()
  value.evolution.progressiveLineupLock.enabled = true
  const day: RealDay = {
    year: 16,
    serieADay: 1,
    games: [
      { home: { name: 'Inter', abbreviation: 'INT' }, away: { name: 'Juventus', abbreviation: 'JUV' }, date: '2026-09-12T16:00:00.000Z', homeGoals: null, awayGoals: null, delayed: false },
      { home: { name: 'Roma', abbreviation: 'ROM' }, away: { name: 'Milan', abbreviation: 'MIL' }, date: '2026-09-12T18:45:00.000Z', homeGoals: null, awayGoals: null, delayed: false },
    ],
  }
  const locked = getEvolutionLockedPlayerKeys([
    player('Interista', Role.Defensor, 'Inter'),
    player('Romanista', Role.Forward, 'Roma'),
  ], day, value, new Date('2026-09-12T17:00:00.000Z'))
  assert.equal(locked.has('interista'), true)
  assert.equal(locked.has('romanista'), false)
})
