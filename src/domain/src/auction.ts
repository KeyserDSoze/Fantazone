import { GroupHelper, IdentityRole, Role, type Group, type LeagueSetting } from './group'
import { getPlayerKey } from './realPlayer'
import type { StatPlayer } from './statPlayer'
import {
  FantaSoccerRole,
  PlayerInTeamStatus,
  TeamHelper,
  type Player,
  type Team,
} from './team'

export enum AuctionType {
  Normal = 0,
  RandomByLetter = 1,
  RandomList = 2,
}

export enum AuctionKind {
  Starting = 0,
  Repairing = 1,
}

export enum AuctionStatus {
  NotStarted = 0,
  Paused = 1,
  InProgress = 2,
  Finished = 3,
}

export type AuctionLeagueKey = {
  group: string
  league: string
  year: number
}

export type AuctionQueuePlayer = {
  playerKey: string
  isShown: boolean
}

export type AuctionParticipant = {
  owner: string
  teamName: string
}

export type AuctionWin = {
  playerKey: string
  owner: string | null
  price: number
}

export type AuctionCurrentLot = {
  player: StatPlayer
  shownAt: string
  owner: string | null
  substitutedPlayerKey: string | null
  price: number
  /** Mirrors legacy ActualAuction.StartingTime: null until the first accepted bid. */
  biddingStartedAt: string | null
}

export type AuctionRecentCommand = {
  commandId: string
  status: 'accepted' | 'rejected'
  sequence: number | null
  message: string | null
}

/**
 * Durable V1 host checkpoint. Realtime WebRTC traffic is deliberately not persisted
 * bid-by-bid; this is just enough state to reconnect peers/host and continue safely.
 */
export type AuctionCheckpoint = {
  version: 1
  id: string
  leagueKey: AuctionLeagueKey
  creator: string
  createdAt: string
  type: AuctionType
  kind: AuctionKind
  status: AuctionStatus
  current: AuctionCurrentLot | null
  winnings: AuctionWin[]
  playerQueues: Partial<Record<Role, AuctionQueuePlayer[]>>
  participants: AuctionParticipant[]
  lastShownPlayer: Partial<Record<Role, string | null>>
  secondsPerAuction: number
  currentRole: Role
  /** Monotonic sequence assigned only to accepted host events. */
  sequence: number
  recentCommands: AuctionRecentCommand[]
  updatedAt: string
}

export type AuctionTeamEntry = {
  basketId: string
  team: Team
}

export type AuctionTeams = ReadonlyMap<string, AuctionTeamEntry>

export type CreateAuctionCheckpointInput = {
  id: string
  group: Group
  leagueId: string
  season: number
  creator: string
  type: AuctionType
  kind: AuctionKind
  playerQueues: Partial<Record<Role, string[]>>
  createdAt: Date
  secondsPerAuction?: number
  currentRole?: Role
}

type AuctionCommandBase = {
  version: 1
  commandId: string
  auctionId: string
  actor: string
  clientTime: number
}

export type AuctionCommand =
  | (AuctionCommandBase & { type: 'SET_ROLE'; role: Role })
  | (AuctionCommandBase & { type: 'SET_TIMER'; seconds: number })
  | (AuctionCommandBase & { type: 'SHOW_PLAYER'; role: Role; forcedPlayerKey?: string | null })
  | (AuctionCommandBase & { type: 'PLACE_BID'; amount: number; bidderEmail?: string | null; substitutedPlayerKey?: string | null })
  | (AuctionCommandBase & { type: 'ASSIGN_CURRENT' })
  | (AuctionCommandBase & { type: 'CLOSE_CURRENT' })
  | (AuctionCommandBase & { type: 'PAUSE' })
  | (AuctionCommandBase & { type: 'RESUME' })
  | (AuctionCommandBase & { type: 'FINISH' })
  | (AuctionCommandBase & { type: 'REOPEN' })

export type AuctionEvent = {
  version: 1
  auctionId: string
  sequence: number
  commandId: string
  hostTime: string
  type:
    | 'ROLE_CHANGED'
    | 'TIMER_CHANGED'
    | 'PLAYER_SHOWN'
    | 'BID_ACCEPTED'
    | 'PLAYER_ASSIGNED'
    | 'CURRENT_CLOSED'
    | 'STATUS_CHANGED'
  data: Record<string, unknown>
}

export type AuctionHostContext = {
  group: Group
  leagueId: string
  season: number
  players: readonly StatPlayer[]
  teams: AuctionTeams
  now: Date
}

export type AuctionCommandResult = {
  status: 'accepted' | 'rejected' | 'duplicate'
  message: string | null
  checkpoint: AuctionCheckpoint
  teams: AuctionTeams
  event: AuctionEvent | null
  changedTeamOwners: string[]
}

export type AuctionEventCursorResult =
  | { status: 'applied'; nextSequence: number }
  | { status: 'duplicate'; nextSequence: number }
  | { status: 'gap'; expectedSequence: number; receivedSequence: number }

const RECENT_COMMAND_LIMIT = 256
const MAX_TEAM_PLAYERS = 25
const BID_GRACE_SECONDS = 2
const ROLE_LIMITS: Readonly<Record<Role.GoalKeeper | Role.Defensor | Role.Midfielder | Role.Forward, number>> = {
  [Role.GoalKeeper]: 3,
  [Role.Defensor]: 8,
  [Role.Midfielder]: 8,
  [Role.Forward]: 6,
}

export function createAuctionCheckpoint(input: CreateAuctionCheckpointInput): AuctionCheckpoint {
  const id = input.id.trim()
  if (!id) throw new Error('Auction id is required')
  if (!Number.isInteger(input.season) || input.season < 1) throw new Error('Auction season must be a positive integer')
  const league = input.group.leagues.find(item => item.id === input.leagueId)
  const annual = GroupHelper.getAnnualLeague(input.group, input.leagueId, input.season)
  if (!league || !annual) throw new Error('Auction league/year not found in group')
  if (!isAuctioneer(input.group, input.creator)) throw new Error('Only Admin or SuperAdmin can create an auction')

  const seconds = input.secondsPerAuction ?? 10
  assertTimer(seconds)
  const participants = league.basketsId.flatMap(basketId => {
    const basket = input.group.baskets.find(item => item.id === basketId)
    return basket?.years.find(year => year.year === input.season)?.teams ?? []
  }).filter((team, index, all) =>
    Boolean(normalize(team.owner)) && all.findIndex(candidate => normalize(candidate.owner) === normalize(team.owner)) === index,
  ).map(team => ({ owner: team.owner, teamName: team.name }))

  const playerQueues: Partial<Record<Role, AuctionQueuePlayer[]>> = {}
  const lastShownPlayer: Partial<Record<Role, string | null>> = {}
  for (const role of auctionRoles()) {
    playerQueues[role] = uniqueKeys(input.playerQueues[role] ?? []).map(playerKey => ({ playerKey, isShown: false }))
    lastShownPlayer[role] = null
  }

  const createdAt = input.createdAt.toISOString()
  return {
    version: 1,
    id,
    leagueKey: { group: input.group.id, league: input.leagueId, year: input.season },
    creator: normalize(input.creator),
    createdAt,
    type: input.type,
    kind: input.kind,
    status: AuctionStatus.NotStarted,
    current: null,
    winnings: [],
    playerQueues,
    participants,
    lastShownPlayer,
    secondsPerAuction: seconds,
    currentRole: input.currentRole ?? Role.GoalKeeper,
    sequence: 0,
    recentCommands: [],
    updatedAt: createdAt,
  }
}

/**
 * Authoritative host reducer for WebRTC Auction V1.
 * The host serializes calls to this reducer and broadcasts only accepted events.
 */
export function processAuctionCommand(
  checkpointInput: AuctionCheckpoint,
  command: AuctionCommand,
  context: AuctionHostContext,
): AuctionCommandResult {
  const checkpoint = cloneCheckpoint(checkpointInput)
  let teams = cloneTeams(context.teams)
  const actor = normalize(command.actor)
  const hostTime = context.now.toISOString()

  if (command.version !== 1 || command.auctionId !== checkpoint.id) {
    return rejected(checkpoint, teams, command.commandId, 'Auction command does not match this checkpoint', hostTime)
  }
  if (!command.commandId.trim() || !actor) {
    return rejected(checkpoint, teams, command.commandId, 'Auction command id and actor are required', hostTime)
  }
  if (checkpoint.leagueKey.group !== context.group.id || checkpoint.leagueKey.league !== context.leagueId || checkpoint.leagueKey.year !== context.season) {
    return rejected(checkpoint, teams, command.commandId, 'Auction host context does not match checkpoint league', hostTime)
  }

  const previous = checkpoint.recentCommands.find(item => item.commandId === command.commandId)
  if (previous) {
    return {
      status: 'duplicate',
      message: previous.message,
      checkpoint,
      teams,
      event: null,
      changedTeamOwners: [],
    }
  }

  const host = isAuctioneer(context.group, actor)
  const playersByKey = indexPlayers(context.players)

  try {
    switch (command.type) {
      case 'SET_ROLE': {
        requireHost(host)
        assertAuctionRole(command.role)
        checkpoint.currentRole = command.role
        return accepted(checkpoint, teams, command, hostTime, 'ROLE_CHANGED', { role: command.role })
      }
      case 'SET_TIMER': {
        requireHost(host)
        assertTimer(command.seconds)
        checkpoint.secondsPerAuction = command.seconds
        return accepted(checkpoint, teams, command, hostTime, 'TIMER_CHANGED', { seconds: command.seconds })
      }
      case 'SHOW_PLAYER': {
        requireHost(host)
        if (checkpoint.status === AuctionStatus.Finished) throw new AuctionCommandError('Auction is already finished')
        if (checkpoint.current?.owner) throw new AuctionCommandError('Auction for player not terminated')
        assertAuctionRole(command.role)

        const selected = selectPlayer(checkpoint, command.role, command.forcedPlayerKey ?? null, playersByKey)
        if (!selected) throw new AuctionCommandError(`No more players for role ${command.role}`)
        if (checkpoint.winnings.some(win => win.playerKey === selected.key)) {
          throw new AuctionCommandError('Player has already been assigned in this auction')
        }

        checkpoint.currentRole = command.role
        checkpoint.current = {
          player: cloneStatPlayer(selected.player),
          shownAt: hostTime,
          owner: null,
          substitutedPlayerKey: null,
          price: 0,
          biddingStartedAt: null,
        }
        checkpoint.lastShownPlayer[command.role] = selected.key
        checkpoint.status = AuctionStatus.InProgress
        return accepted(checkpoint, teams, command, hostTime, 'PLAYER_SHOWN', {
          playerKey: selected.key,
          playerName: selected.player.name,
          role: selected.player.role,
        })
      }
      case 'PLACE_BID': {
        if (checkpoint.status === AuctionStatus.Finished) throw new AuctionCommandError('Auction is already finished')
        if (checkpoint.status === AuctionStatus.Paused && !host) throw new AuctionCommandError('Auction is paused')
        const current = checkpoint.current
        if (!current) throw new AuctionCommandError('No player is currently being auctioned')
        if (current.biddingStartedAt && elapsedSeconds(current.biddingStartedAt, context.now) > checkpoint.secondsPerAuction + BID_GRACE_SECONDS) {
          throw new AuctionCommandError('Bidding time for this player has expired')
        }

        const bidder = host && command.bidderEmail ? normalize(command.bidderEmail) : actor
        if (!bidder) throw new AuctionCommandError('Bidder is required')
        if (normalize(current.owner) === bidder) throw new AuctionCommandError('Sei già il miglior offerente.')
        const teamEntry = teams.get(bidder)
        if (!teamEntry) throw new AuctionCommandError('Team not found')
        if (!Number.isInteger(command.amount) || command.amount <= current.price) {
          throw new AuctionCommandError(`Bid must be higher than current bid (${current.price})`)
        }

        const substitutionKey = command.substitutedPlayerKey ? normalizeKey(command.substitutedPlayerKey) : null
        const substitution = substitutionKey ? playersByKey.get(substitutionKey)?.player ?? null : null
        if (substitution && checkpoint.kind !== AuctionKind.Repairing) {
          throw new AuctionCommandError('You can only substitute a player in repairing auctions')
        }
        if (substitution && substitution.role !== current.player.role) {
          throw new AuctionCommandError('You can only substitute a player with another of the same role')
        }
        validatePlayerAssignment(
          annualSettings(context.group, context.leagueId, context.season),
          current.player,
          teamEntry.team,
          command.amount,
          substitution,
        )

        current.price = command.amount
        current.owner = bidder
        current.substitutedPlayerKey = substitutionKey
        current.biddingStartedAt = hostTime
        return accepted(checkpoint, teams, command, hostTime, 'BID_ACCEPTED', {
          amount: command.amount,
          bidderEmail: bidder,
          bidderName: teamEntry.team.name,
          playerName: current.player.name,
          substitutedPlayerKey: substitutionKey,
        })
      }
      case 'ASSIGN_CURRENT': {
        requireHost(host)
        const current = checkpoint.current
        if (!current) throw new AuctionCommandError('No player is currently being auctioned')
        const owner = normalize(current.owner)
        if (!owner) throw new AuctionCommandError('No winning bidder for current player')
        const entry = teams.get(owner)
        if (!entry) throw new AuctionCommandError('Team not found')

        const substitution = current.substitutedPlayerKey
          ? playersByKey.get(current.substitutedPlayerKey)?.player ?? null
          : null
        validatePlayerAssignment(
          annualSettings(context.group, context.leagueId, context.season),
          current.player,
          entry.team,
          current.price,
          substitution,
        )

        const updatedTeam = assignPlayer(entry.team, current.player, current.price, checkpoint.kind, current.substitutedPlayerKey)
        teams.set(owner, { basketId: entry.basketId, team: updatedTeam })
        const playerKey = getPlayerKey(current.player.name)
        checkpoint.winnings.push({ playerKey, owner, price: current.price })
        const assigned = {
          owner,
          teamName: updatedTeam.name,
          price: current.price,
          playerName: current.player.name,
          teamCost: TeamHelper.getCost(updatedTeam),
          teamPlayersCount: TeamHelper.getActivePlayers(updatedTeam).length,
          playerKey,
        }
        checkpoint.current = null
        return accepted(checkpoint, teams, command, hostTime, 'PLAYER_ASSIGNED', assigned, [owner])
      }
      case 'CLOSE_CURRENT': {
        requireHost(host)
        if (!checkpoint.current) throw new AuctionCommandError('No current auction to close')
        checkpoint.current = null
        checkpoint.status = AuctionStatus.Paused
        return accepted(checkpoint, teams, command, hostTime, 'CURRENT_CLOSED', {})
      }
      case 'PAUSE':
        requireHost(host)
        checkpoint.status = AuctionStatus.Paused
        return accepted(checkpoint, teams, command, hostTime, 'STATUS_CHANGED', { status: AuctionStatus.Paused })
      case 'RESUME':
        requireHost(host)
        checkpoint.status = AuctionStatus.InProgress
        return accepted(checkpoint, teams, command, hostTime, 'STATUS_CHANGED', { status: AuctionStatus.InProgress })
      case 'FINISH':
        requireHost(host)
        checkpoint.status = AuctionStatus.Finished
        return accepted(checkpoint, teams, command, hostTime, 'STATUS_CHANGED', { status: AuctionStatus.Finished })
      case 'REOPEN':
        requireHost(host)
        checkpoint.status = AuctionStatus.Paused
        return accepted(checkpoint, teams, command, hostTime, 'STATUS_CHANGED', { status: AuctionStatus.Paused })
    }
  } catch (error) {
    if (error instanceof AuctionCommandError) {
      return rejected(checkpoint, teams, command.commandId, error.message, hostTime)
    }
    throw error
  }
}

/** Peer-side sequence check. A gap means "request a fresh checkpoint from host". */
export function consumeAuctionEventSequence(nextSequence: number, event: AuctionEvent): AuctionEventCursorResult {
  if (!Number.isInteger(nextSequence) || nextSequence < 1) throw new Error('nextSequence must be a positive integer')
  if (event.sequence < nextSequence) return { status: 'duplicate', nextSequence }
  if (event.sequence > nextSequence) {
    return { status: 'gap', expectedSequence: nextSequence, receivedSequence: event.sequence }
  }
  return { status: 'applied', nextSequence: nextSequence + 1 }
}

export function validatePlayerAssignment(
  settings: LeagueSetting,
  realPlayer: Pick<StatPlayer, 'role'>,
  team: Team,
  price: number,
  substitution: Pick<StatPlayer, 'role'> | null,
): void {
  if (!Number.isInteger(price) || price < 0) throw new AuctionCommandError('Auction price must be a non-negative integer')
  const role = realPlayer.role
  if (role === Role.Undefined) throw new AuctionCommandError('Player role is not valid for auction')
  const limit = ROLE_LIMITS[role]
  const active = TeamHelper.getActivePlayers(team)
  const sameRole = active.filter(player => player.role === role).length
  const substitutionAllowance = substitution?.role === role ? 1 : 0
  if (sameRole >= limit + substitutionAllowance) {
    throw new AuctionCommandError(roleLimitMessage(role))
  }

  const remainingRosterSlotsAfterPurchase = Math.max(0, MAX_TEAM_PLAYERS - 1 - active.length)
  const remainingMoney = settings.startingMoney - (
    TeamHelper.getCost(team) + price + remainingRosterSlotsAfterPurchase
  )
  if (remainingMoney < 0) throw new AuctionCommandError('Stai spendendo troppi soldi')
}

export function isAuctioneer(group: Group, email: string): boolean {
  const user = GroupHelper.findUserByEmail(group, email)
  return Boolean(user) && (
    GroupHelper.hasRole(user!, IdentityRole.Admin) || GroupHelper.hasRole(user!, IdentityRole.SuperAdmin)
  )
}

class AuctionCommandError extends Error {}

function accepted(
  checkpoint: AuctionCheckpoint,
  teams: AuctionTeams,
  command: AuctionCommand,
  hostTime: string,
  type: AuctionEvent['type'],
  data: Record<string, unknown>,
  changedTeamOwners: string[] = [],
): AuctionCommandResult {
  checkpoint.sequence += 1
  checkpoint.updatedAt = hostTime
  const event: AuctionEvent = {
    version: 1,
    auctionId: checkpoint.id,
    sequence: checkpoint.sequence,
    commandId: command.commandId,
    hostTime,
    type,
    data,
  }
  rememberCommand(checkpoint, {
    commandId: command.commandId,
    status: 'accepted',
    sequence: event.sequence,
    message: null,
  })
  return { status: 'accepted', message: null, checkpoint, teams, event, changedTeamOwners }
}

function rejected(
  checkpoint: AuctionCheckpoint,
  teams: AuctionTeams,
  commandId: string,
  message: string,
  hostTime: string,
): AuctionCommandResult {
  checkpoint.updatedAt = hostTime
  if (commandId.trim()) {
    rememberCommand(checkpoint, { commandId, status: 'rejected', sequence: null, message })
  }
  return { status: 'rejected', message, checkpoint, teams, event: null, changedTeamOwners: [] }
}

function rememberCommand(checkpoint: AuctionCheckpoint, command: AuctionRecentCommand): void {
  checkpoint.recentCommands.push(command)
  if (checkpoint.recentCommands.length > RECENT_COMMAND_LIMIT) {
    checkpoint.recentCommands.splice(0, checkpoint.recentCommands.length - RECENT_COMMAND_LIMIT)
  }
}

function selectPlayer(
  checkpoint: AuctionCheckpoint,
  role: Role,
  forcedPlayerKey: string | null,
  playersByKey: Map<string, { key: string; player: StatPlayer }>,
): { key: string; player: StatPlayer } | null {
  if (forcedPlayerKey) {
    const selected = playersByKey.get(normalizeKey(forcedPlayerKey)) ?? null
    if (!selected || selected.player.role !== role) return null
    const queue = checkpoint.playerQueues[role] ?? []
    const queued = queue.find(item => item.playerKey === selected.key)
    if (queued) queued.isShown = true
    return selected
  }

  for (const queued of checkpoint.playerQueues[role] ?? []) {
    if (queued.isShown) continue
    queued.isShown = true
    const selected = playersByKey.get(queued.playerKey)
    if (selected) return selected
  }
  return null
}

function assignPlayer(
  source: Team,
  realPlayer: StatPlayer,
  price: number,
  kind: AuctionKind,
  substitutedPlayerKey: string | null,
): Team {
  const team = cloneTeam(source)
  if (kind === AuctionKind.Repairing && substitutedPlayerKey) {
    const toRemove = TeamHelper.getActivePlayers(team).find(player => getPlayerKey(player.name) === substitutedPlayerKey)
    if (toRemove) {
      toRemove.status = PlayerInTeamStatus.SoldWithNoReturnedPrice
      toRemove.revenue = 0
    }
  }
  const assigned: Player = {
    name: realPlayer.name,
    team: { ...realPlayer.team },
    role: realPlayer.role,
    isActive: realPlayer.isActive,
    visible: realPlayer.visible,
    price,
    revenue: 0,
    status: PlayerInTeamStatus.Active,
    position: FantaSoccerRole.Tribune,
  }
  team.players.push(assigned)
  return team
}

function annualSettings(group: Group, leagueId: string, season: number): LeagueSetting {
  const annual = GroupHelper.getAnnualLeague(group, leagueId, season)
  if (!annual) throw new AuctionCommandError('Auction league/year not found')
  return annual.settings
}

function indexPlayers(players: readonly StatPlayer[]): Map<string, { key: string; player: StatPlayer }> {
  const result = new Map<string, { key: string; player: StatPlayer }>()
  for (const player of players) {
    const key = getPlayerKey(player.name)
    if (!key) continue
    if (result.has(key)) throw new Error(`Duplicate auction player key '${key}'`)
    result.set(key, { key, player })
  }
  return result
}

function uniqueKeys(keys: readonly string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of keys) {
    const key = normalizeKey(raw)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(key)
  }
  return result
}

function requireHost(host: boolean): void {
  if (!host) throw new AuctionCommandError('Only auctioneer can perform this operation')
}

function assertTimer(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) {
    throw new AuctionCommandError('Auction timer must be between 1 and 300 seconds')
  }
}

function assertAuctionRole(role: Role): asserts role is Role.GoalKeeper | Role.Defensor | Role.Midfielder | Role.Forward {
  if (!auctionRoles().includes(role as Role.GoalKeeper | Role.Defensor | Role.Midfielder | Role.Forward)) {
    throw new AuctionCommandError('Auction role must be goalkeeper, defender, midfielder or forward')
  }
}

function roleLimitMessage(role: Role): string {
  switch (role) {
    case Role.GoalKeeper: return 'Troppi portieri'
    case Role.Defensor: return 'Troppi difensori'
    case Role.Midfielder: return 'Troppi centrocampisti'
    case Role.Forward: return 'Troppi attaccanti'
    default: return 'Troppi giocatori per ruolo'
  }
}

function auctionRoles(): Array<Role.GoalKeeper | Role.Defensor | Role.Midfielder | Role.Forward> {
  return [Role.GoalKeeper, Role.Defensor, Role.Midfielder, Role.Forward]
}

function elapsedSeconds(iso: string, now: Date): number {
  const started = new Date(iso).getTime()
  if (!Number.isFinite(started)) return Number.POSITIVE_INFINITY
  return (now.getTime() - started) / 1000
}

function cloneCheckpoint(value: AuctionCheckpoint): AuctionCheckpoint {
  return {
    ...value,
    leagueKey: { ...value.leagueKey },
    current: value.current ? {
      ...value.current,
      player: cloneStatPlayer(value.current.player),
    } : null,
    winnings: value.winnings.map(item => ({ ...item })),
    playerQueues: Object.fromEntries(Object.entries(value.playerQueues).map(([role, queue]) => [
      role,
      queue?.map(item => ({ ...item })) ?? [],
    ])) as Partial<Record<Role, AuctionQueuePlayer[]>>,
    participants: value.participants.map(item => ({ ...item })),
    lastShownPlayer: { ...value.lastShownPlayer },
    recentCommands: value.recentCommands.map(item => ({ ...item })),
  }
}

function cloneTeams(source: AuctionTeams): Map<string, AuctionTeamEntry> {
  return new Map([...source.entries()].map(([owner, entry]) => [normalize(owner), {
    basketId: entry.basketId,
    team: cloneTeam(entry.team),
  }]))
}

function cloneTeam(team: Team): Team {
  return {
    ...team,
    additionalOwners: [...team.additionalOwners],
    players: team.players.map(player => ({ ...player, team: { ...player.team } })),
  }
}

function cloneStatPlayer(player: StatPlayer): StatPlayer {
  return {
    ...player,
    team: { ...player.team },
    games: player.games.map(game => ({ ...game })),
  }
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}
