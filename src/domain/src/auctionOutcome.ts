import {
  AuctionKind,
  isAuctioneer,
  validatePlayerAssignment,
  type AuctionCheckpoint,
  type AuctionCommand,
  type AuctionCommandResult,
} from './auction'
import { GroupHelper, type Group } from './group'
import { getPlayerKey, type RealPlayer } from './realPlayer'
import {
  FantaSoccerRole,
  PlayerInTeamStatus,
  TeamHelper,
  type Player,
  type Team,
} from './team'

export type AuctionAssignmentOutcomeStatus = 'pending' | 'applied' | 'rejected'

/**
 * Durable business outcome emitted only when the realtime host accepts ASSIGN_CURRENT.
 * Bid traffic stays ephemeral; the group Action revalidates this document against
 * canonical Group/Team/Serie A data before mutating the roster.
 */
export type AuctionAssignmentOutcome = {
  version: 1
  auctionId: string
  sequence: number
  leagueId: string
  season: number
  kind: AuctionKind
  actor: string
  owner: string
  playerKey: string
  price: number
  substitutedPlayerKey: string | null
  assignedAt: string
  status: AuctionAssignmentOutcomeStatus
  result?: {
    processedAt: string
    message?: string
  }
}

export type ApplyAuctionAssignmentOutcomeInput = {
  group: Group
  outcome: AuctionAssignmentOutcome
  team: Team
  player: RealPlayer
  processedAt: Date
}

export type ApplyAuctionAssignmentOutcomeResult = {
  outcome: AuctionAssignmentOutcome
  team: Team
  changed: boolean
}

type AssignCommand = Extract<AuctionCommand, { type: 'ASSIGN_CURRENT' }>

export function createAuctionAssignmentOutcome(input: {
  checkpointBefore: AuctionCheckpoint
  command: AssignCommand
  result: AuctionCommandResult
}): AuctionAssignmentOutcome {
  const { checkpointBefore, command, result } = input
  const current = checkpointBefore.current
  if (!current) throw new Error('Cannot create assignment outcome without a current auction lot')
  if (command.auctionId !== checkpointBefore.id) throw new Error('Assignment command does not match auction checkpoint')
  if (result.status !== 'accepted' || result.event?.type !== 'PLAYER_ASSIGNED') {
    throw new Error('Assignment outcome requires an accepted PLAYER_ASSIGNED event')
  }
  if (result.event.commandId !== command.commandId || result.event.auctionId !== checkpointBefore.id) {
    throw new Error('Assignment event does not match command or auction')
  }
  if (result.event.sequence !== result.checkpoint.sequence || result.event.sequence !== checkpointBefore.sequence + 1) {
    throw new Error('Assignment event sequence does not follow checkpoint sequence')
  }

  const owner = normalize(current.owner)
  const actor = normalize(command.actor)
  const playerKey = getPlayerKey(current.player.name)
  if (!owner || !actor || !playerKey) throw new Error('Assignment outcome requires actor, owner and player key')
  if (!Number.isInteger(current.price) || current.price < 1) throw new Error('Assignment outcome requires a positive integer price')

  return {
    version: 1,
    auctionId: checkpointBefore.id,
    sequence: result.event.sequence,
    leagueId: checkpointBefore.leagueKey.league,
    season: checkpointBefore.leagueKey.year,
    kind: checkpointBefore.kind,
    actor,
    owner,
    playerKey,
    price: current.price,
    substitutedPlayerKey: current.substitutedPlayerKey ? normalizeKey(current.substitutedPlayerKey) : null,
    assignedAt: result.event.hostTime,
    status: 'pending',
  }
}

/**
 * Authoritative Action-side revalidation of one realtime assignment outcome.
 * Expected business failures are persisted as rejected outcomes instead of throwing,
 * making processing idempotent and inspectable in the group repository.
 */
export function applyAuctionAssignmentOutcome(
  input: ApplyAuctionAssignmentOutcomeInput,
): ApplyAuctionAssignmentOutcomeResult {
  const outcome = cloneOutcome(input.outcome)
  const team = cloneTeam(input.team)
  if (outcome.status !== 'pending') return { outcome, team, changed: false }

  const processedAt = input.processedAt.toISOString()
  const fail = (message: string): ApplyAuctionAssignmentOutcomeResult => ({
    outcome: { ...outcome, status: 'rejected', result: { processedAt, message } },
    team,
    changed: false,
  })

  if (outcome.version !== 1) return fail('Unsupported auction assignment outcome version')
  if (!Number.isInteger(outcome.sequence) || outcome.sequence < 1) return fail('Invalid auction assignment sequence')
  if (!Number.isInteger(outcome.season) || outcome.season < 1) return fail('Invalid auction season')
  if (!Number.isInteger(outcome.price) || outcome.price < 1) return fail('Invalid auction price')
  if (!isAuctioneer(input.group, outcome.actor)) return fail('Only Admin or SuperAdmin can persist an auction assignment')

  const league = input.group.leagues.find(item => item.id === outcome.leagueId)
  const annual = GroupHelper.getAnnualLeague(input.group, outcome.leagueId, outcome.season)
  if (!league || !annual) return fail('Auction league/year not found in group')

  const owner = normalize(outcome.owner)
  const basketId = GroupHelper.getBasketId(input.group, owner, outcome.season)
  if (!owner || !basketId || !league.basketsId.includes(basketId)) {
    return fail('Auction owner does not belong to this league and season')
  }
  if (normalize(team.owner) !== owner) return fail('Canonical team owner does not match auction outcome')

  const authoritativePlayerKey = getPlayerKey(input.player.name)
  if (!authoritativePlayerKey || authoritativePlayerKey !== normalizeKey(outcome.playerKey)) {
    return fail('Auction player does not match authoritative Serie A data')
  }
  if (TeamHelper.getActivePlayers(team).some(player => getPlayerKey(player.name) === authoritativePlayerKey)) {
    return fail('Player is already active in the canonical team')
  }

  if (outcome.kind === AuctionKind.Starting && outcome.substitutedPlayerKey) {
    return fail('Starting auctions cannot replace an existing player')
  }

  const substitutionKey = outcome.substitutedPlayerKey ? normalizeKey(outcome.substitutedPlayerKey) : null
  const substituted = substitutionKey
    ? TeamHelper.getActivePlayers(team).find(player => getPlayerKey(player.name) === substitutionKey) ?? null
    : null
  if (substitutionKey && !substituted) return fail('Substituted player is not active in the canonical team')
  if (substituted && substituted.role !== input.player.role) return fail('Substituted player must have the same role')

  try {
    validatePlayerAssignment(annual.settings, input.player, team, outcome.price, substituted)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Auction assignment is not valid')
  }

  if (outcome.kind === AuctionKind.Repairing && substituted) {
    const target = team.players.find(player => player.status === PlayerInTeamStatus.Active && getPlayerKey(player.name) === substitutionKey)
    if (!target) return fail('Substituted player is no longer active')
    target.status = PlayerInTeamStatus.SoldWithNoReturnedPrice
    target.revenue = 0
  }

  const assigned: Player = {
    name: input.player.name,
    team: { ...input.player.team },
    role: input.player.role,
    isActive: input.player.isActive,
    visible: input.player.visible,
    price: outcome.price,
    revenue: 0,
    status: PlayerInTeamStatus.Active,
    position: FantaSoccerRole.Tribune,
  }
  team.players.push(assigned)

  return {
    outcome: { ...outcome, status: 'applied', result: { processedAt } },
    team,
    changed: true,
  }
}

function cloneOutcome(outcome: AuctionAssignmentOutcome): AuctionAssignmentOutcome {
  return {
    ...outcome,
    result: outcome.result ? { ...outcome.result } : undefined,
  }
}

function cloneTeam(team: Team): Team {
  return {
    ...team,
    additionalOwners: [...team.additionalOwners],
    players: team.players.map(player => ({ ...player, team: { ...player.team } })),
  }
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}
