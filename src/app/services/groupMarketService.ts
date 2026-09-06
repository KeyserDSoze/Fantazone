import {
  GroupHelper,
  IdentityRole,
  MarketType,
  getPlayerKey,
  type AuthenticatedGroupSession,
  type Group,
  type MarketCommand,
  type MarketCreateRequest,
  type MarketWrapper,
} from '@fantazone/domain'
import type { GitHubMarketRepository, GitHubTeamRepository } from '@fantazone/github'

export type SubmitMarketCreateInput = {
  session: AuthenticatedGroupSession
  leagueId: string
  season: number
  seller: string
  buyerPlayerKeys: string[]
  sellerPlayerKeys: string[]
  moneyFromBuyer?: number
  moneyFromSeller?: number
}

export type SubmitMarketActionInput = {
  session: AuthenticatedGroupSession
  leagueId: string
  season: number
  marketId: string
}

export type SubmittedMarketCommand = {
  command: MarketCommand
  sha: string
}

/**
 * Client-side UX/authorization boundary for market commands.
 *
 * It never mutates canonical Team/Market state directly. Every accepted request is
 * persisted as an append-only command and revalidated by the group Action against
 * fresh repository state before any exchange is applied.
 */
export class GroupMarketService {
  constructor(
    private readonly getGroup: () => Group,
    private readonly markets: GitHubMarketRepository,
    private readonly teams: GitHubTeamRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getMarket(leagueId: string, season: number): Promise<MarketWrapper> {
    return this.markets.getMarket(leagueId, season)
  }

  async create(input: SubmitMarketCreateInput): Promise<SubmittedMarketCommand> {
    const actor = this.requireParticipant(input.session)
    const group = this.getGroup()
    const context = findLeagueContext(group, input.leagueId, input.season)
    if (!context) throw new Error('Lega non valida.')
    if (context.market === MarketType.Denied) throw new Error('Il mercato non è abilitato per questa lega.')

    const buyer = actor.email
    const seller = canonicalOwner(context.owners, input.seller)
    if (!seller || same(buyer, seller)) throw new Error('Venditore non valido.')
    const buyerTeam = context.owners.find(owner => same(owner.email, buyer))
    const sellerTeam = context.owners.find(owner => same(owner.email, seller))
    if (!buyerTeam || !sellerTeam) throw new Error('Compratore o venditore non validi.')

    const [buyerCurrent, sellerCurrent] = await Promise.all([
      this.teams.getTeam(buyerTeam.basketId, input.season, buyerTeam.email, { refresh: true }),
      this.teams.getTeam(sellerTeam.basketId, input.season, sellerTeam.email, { refresh: true }),
    ])
    if (!buyerCurrent || !sellerCurrent) throw new Error('Squadra non trovata.')

    const buyerKeys = normalizeKeys(input.buyerPlayerKeys)
    const sellerKeys = normalizeKeys(input.sellerPlayerKeys)
    if (buyerKeys.length === 0 || sellerKeys.length === 0) throw new Error('Lo scambio deve includere almeno un giocatore per squadra.')
    const buyerPlayers = selectActivePlayers(buyerCurrent, buyerKeys)
    const sellerPlayers = selectActivePlayers(sellerCurrent, sellerKeys)
    if (!buyerPlayers || !sellerPlayers) throw new Error('Uno o più giocatori non sono disponibili.')
    if (!sameRoles(buyerPlayers, sellerPlayers)) throw new Error('Lo scambio deve avere lo stesso numero di giocatori per ruolo.')

    const create: MarketCreateRequest = {
      buyer: buyerTeam.email,
      seller: sellerTeam.email,
      buyerPlayerKeys: buyerKeys,
      sellerPlayerKeys: sellerKeys,
      moneyFromBuyer: nonNegativeMoney(input.moneyFromBuyer),
      moneyFromSeller: nonNegativeMoney(input.moneyFromSeller),
    }
    return this.submit('create', input.leagueId, input.season, actor.email, { create })
  }

  approve(input: SubmitMarketActionInput): Promise<SubmittedMarketCommand> {
    return this.submitForMarket('approve', input)
  }

  deny(input: SubmitMarketActionInput): Promise<SubmittedMarketCommand> {
    return this.submitForMarket('deny', input)
  }

  cancel(input: SubmitMarketActionInput): Promise<SubmittedMarketCommand> {
    return this.submitForMarket('cancel', input)
  }

  private async submitForMarket(kind: 'approve' | 'deny' | 'cancel', input: SubmitMarketActionInput): Promise<SubmittedMarketCommand> {
    const actor = this.requireParticipant(input.session)
    const group = this.getGroup()
    if (!findLeagueContext(group, input.leagueId, input.season)) throw new Error('Lega non valida.')
    const marketId = input.marketId.trim()
    if (!marketId) throw new Error('Market id non valido.')
    return this.submit(kind, input.leagueId, input.season, actor.email, { marketId })
  }

  private async submit(
    kind: MarketCommand['kind'],
    leagueId: string,
    season: number,
    actor: string,
    extra: Pick<MarketCommand, 'marketId' | 'create'>,
  ): Promise<SubmittedMarketCommand> {
    const requestedAt = this.now().toISOString()
    const id = newCommandId()
    const command: MarketCommand = {
      version: 1,
      id,
      kind,
      leagueId: leagueId.trim(),
      season,
      actor,
      requestedAt,
      status: 'pending',
      ...(extra.marketId ? { marketId: extra.marketId } : {}),
      ...(extra.create ? { create: extra.create } : {}),
    }
    const sha = await this.markets.submitCommand(command)
    return { command, sha }
  }

  private requireParticipant(session: AuthenticatedGroupSession) {
    const member = GroupHelper.findUserByEmail(this.getGroup(), session.identity.email)
    if (!member || member.role === IdentityRole.None || !GroupHelper.hasRole(member, IdentityRole.Participant)) {
      throw new Error('Utente non abilitato al mercato del gruppo.')
    }
    return member
  }
}

type LeagueOwner = { email: string; basketId: string }
type LeagueContext = { market: MarketType; owners: LeagueOwner[] }

function findLeagueContext(group: Group, leagueId: string, season: number): LeagueContext | null {
  const league = group.leagues.find(item => item.id === leagueId)
  const annual = league?.years.find(item => item.year === season)
  if (!league || !annual) return null
  const basketIds = new Set(league.basketsId)
  const owners = group.baskets
    .filter(basket => basketIds.has(basket.id))
    .flatMap(basket => basket.years
      .filter(year => year.year === season)
      .flatMap(year => year.teams.map(team => ({ email: team.owner, basketId: basket.id }))))
    .filter(owner => Boolean(owner.email?.trim()))
  return { market: annual.settings.market, owners }
}

function canonicalOwner(owners: LeagueOwner[], email: string): string | null {
  return owners.find(owner => same(owner.email, email))?.email ?? null
}

function selectActivePlayers(team: { players: Array<{ name: string; role: number; status: number }> }, keys: string[]) {
  const active = team.players.filter(player => player.status === 0)
  const byKey = new Map(active.map(player => [getPlayerKey(player.name), player]))
  const selected = keys.map(key => byKey.get(key))
  return selected.some(player => !player) ? null : selected as Array<{ name: string; role: number; status: number }>
}

function sameRoles(first: Array<{ role: number }>, second: Array<{ role: number }>): boolean {
  const count = (players: Array<{ role: number }>) => {
    const result = new Map<number, number>()
    for (const player of players) result.set(player.role, (result.get(player.role) ?? 0) + 1)
    return [...result.entries()].sort((a, b) => a[0] - b[0])
  }
  return JSON.stringify(count(first)) === JSON.stringify(count(second))
}

function normalizeKeys(values: string[]): string[] {
  const keys = values.map(value => value.trim()).filter(Boolean)
  if (keys.length !== new Set(keys).size) throw new Error('Uno stesso giocatore non può comparire due volte nello scambio.')
  return keys
}

function nonNegativeMoney(value: number | undefined): number {
  const normalized = value ?? 0
  if (!Number.isInteger(normalized) || normalized < 0) throw new Error('Gli importi non possono essere negativi.')
  return normalized
}

function same(first: string, second: string): boolean {
  return first.trim().toLowerCase() === second.trim().toLowerCase()
}

function newCommandId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
