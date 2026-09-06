import {
  AuctionKind,
  AuctionType,
  Role,
  createAuctionCheckpoint,
  createEmptyStatPlayer,
  getPlayerKey,
  type AuctionCheckpoint,
  type AuctionTeams,
  type Group,
  type RealPlayer,
  type StatPlayer,
  type Team,
} from '@fantazone/domain'
import {
  GitHubRealPlayersRepository,
  GitHubStatPlayersRepository,
} from '@fantazone/github'
import { GroupAuctionHostSession } from './groupAuctionHostSession'
import type { GroupSessionRuntime } from './groupSessionRuntime'

export type AuctionSetupContext = {
  checkpoint: AuctionCheckpoint
  players: StatPlayer[]
  teams: AuctionTeams
}

export type CreateGroupAuctionInput = {
  leagueId: string
  season: number
  creator: string
  type: AuctionType
  kind: AuctionKind
  secondsPerAuction?: number
}

/**
 * Legacy-compatible auction bootstrap using only canonical GitHub data.
 * It also creates missing season Team documents exactly like the old controller did.
 */
export class GroupAuctionSetupService {
  private readonly realPlayersRepository: GitHubRealPlayersRepository
  private readonly statPlayersRepository: GitHubStatPlayersRepository

  constructor(
    private readonly runtime: GroupSessionRuntime,
    private readonly now: () => Date = () => new Date(),
    private readonly random: () => number = Math.random,
  ) {
    this.realPlayersRepository = new GitHubRealPlayersRepository(runtime.store, runtime.platformTarget)
    this.statPlayersRepository = new GitHubStatPlayersRepository(runtime.store, runtime.platformTarget)
  }

  async createAuction(input: CreateGroupAuctionInput): Promise<{
    session: GroupAuctionHostSession
    context: AuctionSetupContext
  }> {
    const group = this.runtime.group
    const league = group.leagues.find(item => item.id === input.leagueId)
    const annual = league?.years.find(item => item.year === input.season)
    if (!league || !annual) throw new Error('Lega/stagione non disponibile per l’asta.')
    if (!league.isMain) throw new Error('Il legacy consente la creazione dell’asta solo sulla lega principale.')

    const teams = await this.loadLeagueTeams(group, input.leagueId, input.season, input.kind)
    const players = await this.loadAuctionPlayers(input.season)
    const queues = buildAuctionPlayerQueues(players, teams, input.type, this.random)
    const createdAt = this.now()
    const checkpoint = createAuctionCheckpoint({
      id: createAuctionId(group.id, input.leagueId, input.season, createdAt),
      group,
      leagueId: input.leagueId,
      season: input.season,
      creator: input.creator,
      type: input.type,
      kind: input.kind,
      playerQueues: queues,
      createdAt,
      secondsPerAuction: input.secondsPerAuction,
    })

    const session = await GroupAuctionHostSession.create(
      this.runtime.auctionRepository,
      checkpoint,
      { group, leagueId: input.leagueId, season: input.season, players, teams, now: this.now },
    )
    await this.runtime.auctionDiscovery.activateCheckpoint(session.checkpoint)
    return { session, context: { checkpoint: session.checkpoint, players, teams: session.currentTeams } }
  }

  async resumeAuction(checkpoint: AuctionCheckpoint): Promise<{
    session: GroupAuctionHostSession
    context: AuctionSetupContext
  }> {
    const players = await this.loadAuctionPlayers(checkpoint.leagueKey.year)
    const teams = await this.loadLeagueTeams(
      this.runtime.group,
      checkpoint.leagueKey.league,
      checkpoint.leagueKey.year,
      checkpoint.kind,
    )
    const snapshot = await this.runtime.auctionRepository.getCheckpoint(
      checkpoint.leagueKey.year,
      checkpoint.id,
      { refresh: true },
    )
    if (!snapshot) throw new Error(`Checkpoint asta '${checkpoint.id}' non disponibile.`)
    const session = GroupAuctionHostSession.resume(
      this.runtime.auctionRepository,
      snapshot,
      {
        group: this.runtime.group,
        leagueId: checkpoint.leagueKey.league,
        season: checkpoint.leagueKey.year,
        players,
        teams,
        now: this.now,
      },
    )
    return { session, context: { checkpoint: session.checkpoint, players, teams: session.currentTeams } }
  }

  async loadAuctionPlayers(season: number): Promise<StatPlayer[]> {
    const stats = await this.statPlayersRepository.getStats(season, { refresh: true })
    if (stats?.players.length) return stats.players.filter(isAuctionPlayer)

    const master = await this.realPlayersRepository.getPlayers(season, { refresh: true })
    if (!master) throw new Error(`Master giocatori Serie A ${season} non disponibile.`)
    return master.players.filter(isAuctionPlayer).map(createEmptyStatPlayer)
  }

  private async loadLeagueTeams(
    group: Group,
    leagueId: string,
    season: number,
    kind: AuctionKind,
  ): Promise<Map<string, { basketId: string; team: Team }>> {
    const league = group.leagues.find(item => item.id === leagueId)
    if (!league || !league.years.some(item => item.year === season)) {
      throw new Error('Lega/stagione non disponibile per l’asta.')
    }

    const result = new Map<string, { basketId: string; team: Team }>()
    for (const basketId of league.basketsId) {
      const basket = group.baskets.find(item => item.id === basketId)
      const year = basket?.years.find(item => item.year === season)
      if (!basket || !year) continue
      for (const annualTeam of year.teams) {
        const owner = normalizeEmail(annualTeam.owner)
        if (!owner || result.has(owner)) continue
        let team = await this.runtime.teamRepository.getTeam(basketId, season, annualTeam.owner, { refresh: true })
        if (!team) {
          if (kind === AuctionKind.Repairing) {
            throw new Error(`La squadra ${annualTeam.name} non esiste ancora: impossibile avviare un’asta di riparazione.`)
          }
          team = {
            name: annualTeam.name,
            owner: annualTeam.owner,
            additionalOwners: [...(annualTeam.additionalOwners ?? [])],
            players: [],
            moneyFromRank: 0,
            lastUpdate: null,
          }
          await this.runtime.teamRepository.writeTeam(
            basketId,
            season,
            annualTeam.owner,
            team,
            `auction: initialize ${annualTeam.name}`,
            { createOnly: true },
          )
        }
        result.set(owner, { basketId, team })
      }
    }
    if (result.size === 0) throw new Error('La lega non contiene squadre per questa stagione.')
    return result
  }
}

export function buildAuctionPlayerQueues(
  players: readonly StatPlayer[],
  teams: AuctionTeams,
  type: AuctionType,
  random: () => number = Math.random,
): Partial<Record<Role, string[]>> {
  const taken = new Set(
    [...teams.values()].flatMap(entry => entry.team.players.map(player => getPlayerKey(player.name))),
  )
  const queues: Partial<Record<Role, string[]>> = {}

  for (const role of auctionRoles()) {
    let available = players
      .filter(player => player.role === role && !taken.has(getPlayerKey(player.name)))
      .map(player => ({ key: getPlayerKey(player.name), name: player.name }))
      .filter(player => Boolean(player.key))

    if (type === AuctionType.RandomByLetter) {
      available = [...available].sort((a, b) => a.name.localeCompare(b.name, 'it-IT', { sensitivity: 'base' }))
      const start = Math.floor(clampRandom(random()) * 26)
      available = [...available].sort((a, b) =>
        letterDistance(a.name, start) - letterDistance(b.name, start) ||
        a.name.localeCompare(b.name, 'it-IT', { sensitivity: 'base' }),
      )
    } else if (type === AuctionType.RandomList) {
      available = shuffle([...available], random)
    }
    queues[role] = available.map(item => item.key)
  }
  return queues
}

function createAuctionId(groupId: string, leagueId: string, season: number, date: Date): string {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `${safeSegment(groupId)}-${safeSegment(leagueId)}-${season}-${stamp}`
}

function isAuctionPlayer(player: RealPlayer): boolean {
  return player.role !== Role.Undefined && player.isActive && player.visible
}

function auctionRoles(): Array<Role.GoalKeeper | Role.Defensor | Role.Midfielder | Role.Forward> {
  return [Role.GoalKeeper, Role.Defensor, Role.Midfielder, Role.Forward]
}

function letterDistance(name: string, start: number): number {
  const first = name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().charCodeAt(0) - 65
  if (first < 0 || first > 25) return 26
  return (first - start + 26) % 26
}

function shuffle<T>(values: T[], random: () => number): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(clampRandom(random()) * (index + 1))
    ;[values[index], values[target]] = [values[target], values[index]]
  }
  return values
}

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(0.999999999999, value))
}

function safeSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'auction'
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}
