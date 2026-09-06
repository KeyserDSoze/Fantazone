import { GroupHelper, MarketType, Role, type Group, type LeagueSetting } from './group'
import { MarketHelper, MarketStatus } from './marketRules'
import { getPlayerKey } from './realPlayer'
import { PlayerInTeamStatus, TeamHelper, type FantaSoccerRole, type Player, type Team } from './team'

export interface Market {
  id: string
  buyer: string
  seller: string
  sellerPlayers: Player[]
  buyerPlayers: Player[]
  moneyFromBuyer: number
  moneyFromSeller: number
  approvers: string[]
  deniers: string[]
  status: MarketStatus
  /** ISO-8601 instant. */
  creationTime: string
}

export interface MarketWrapper {
  markets: Market[]
}

export type MarketCommandStatus = 'pending' | 'applied' | 'rejected'
export type MarketCommandKind = 'create' | 'approve' | 'deny' | 'cancel'

export type MarketCreateRequest = {
  buyer: string
  seller: string
  buyerPlayerKeys: string[]
  sellerPlayerKeys: string[]
  moneyFromBuyer: number
  moneyFromSeller: number
}

export interface MarketCommand {
  version: 1
  id: string
  kind: MarketCommandKind
  leagueId: string
  season: number
  actor: string
  requestedAt: string
  status: MarketCommandStatus
  marketId?: string
  create?: MarketCreateRequest
  result?: {
    marketId?: string
    marketStatus?: MarketStatus
    message?: string
    processedAt: string
  }
}

export type MarketTeamEntry = { basketId: string; team: Team }
export type MarketTeams = Map<string, MarketTeamEntry>

export type ProcessMarketCommandInput = {
  group: Group
  leagueId: string
  season: number
  command: MarketCommand
  market: MarketWrapper
  teams: MarketTeams
  now: Date
  currentSeason: number
}

export type ProcessMarketCommandResult = {
  market: MarketWrapper
  teams: MarketTeams
  command: MarketCommand
  changedTeams: string[]
}

export function emptyMarketWrapper(): MarketWrapper {
  return { markets: [] }
}

/**
 * Pure port of the legacy MarketManager transaction rules. The Action calls this
 * against freshly loaded canonical Group/Market/Team documents, so local UI checks
 * are advisory while this reducer is authoritative for persisted group state.
 */
export function processMarketCommand(input: ProcessMarketCommandInput): ProcessMarketCommandResult {
  const command = cloneCommand(input.command)
  const market = cloneWrapper(input.market)
  const teams = cloneTeams(input.teams)
  const changedTeams: string[] = []

  if (command.status !== 'pending') return { market, teams, command, changedTeams }
  if (command.season !== input.season || command.leagueId !== input.leagueId) {
    return rejected('Comando mercato non coerente con lega o stagione.')
  }
  if (input.season !== input.currentSeason) return rejected('Il mercato è disponibile solo per la stagione corrente.')

  const context = getMarketContext(input.group, input.leagueId, input.season)
  if (!context) return rejected('Lega non valida.')

  expirePendingMarkets(market, input.now)

  switch (command.kind) {
    case 'create': {
      if (context.settings.market === MarketType.Denied) return rejected('Il mercato non è abilitato per questa lega.')
      const proposal = command.create
      if (!proposal) return rejected('Proposta mercato mancante.')
      if (!same(command.actor, proposal.buyer)) return rejected('Solo il compratore può creare la proposta.')
      if (same(proposal.buyer, proposal.seller) || !context.owners.has(normalize(proposal.buyer)) || !context.owners.has(normalize(proposal.seller))) {
        return rejected('Compratore o venditore non validi.')
      }
      if (!nonNegativeInteger(proposal.moneyFromBuyer) || !nonNegativeInteger(proposal.moneyFromSeller)) {
        return rejected('Gli importi non possono essere negativi.')
      }

      const buyerEntry = teams.get(normalize(proposal.buyer))
      const sellerEntry = teams.get(normalize(proposal.seller))
      if (!buyerEntry || !sellerEntry) return rejected('Squadra non trovata.')
      const buyerPlayers = findPlayers(buyerEntry.team, proposal.buyerPlayerKeys)
      const sellerPlayers = findPlayers(sellerEntry.team, proposal.sellerPlayerKeys)
      if (!buyerPlayers || !sellerPlayers || buyerPlayers.length === 0 || sellerPlayers.length === 0) {
        return rejected('Uno o più giocatori non sono disponibili.')
      }
      if (!haveSameRoles(buyerPlayers, sellerPlayers)) return rejected('Lo scambio deve avere lo stesso numero di giocatori per ruolo.')

      const created: Market = {
        id: command.id,
        buyer: canonicalOwner(context, proposal.buyer),
        seller: canonicalOwner(context, proposal.seller),
        buyerPlayers: buyerPlayers.map(clonePlayer),
        sellerPlayers: sellerPlayers.map(clonePlayer),
        moneyFromBuyer: proposal.moneyFromBuyer,
        moneyFromSeller: proposal.moneyFromSeller,
        approvers: [canonicalOwner(context, proposal.buyer), canonicalOwner(context, proposal.seller)],
        deniers: [],
        status: MarketStatus.Pending,
        creationTime: input.now.toISOString(),
      }
      market.markets.push(created)

      if (context.settings.market === MarketType.WithoutVote || MarketHelper.hasReachedApprovalQuorum(created, context.teamCount)) {
        executeMarket(created, context.settings, teams, changedTeams)
      }
      return applied(created)
    }

    case 'approve':
    case 'deny': {
      if (context.settings.market !== MarketType.WithVote) return rejected('La lega non prevede la votazione del mercato.')
      const target = market.markets.find(item => item.id === command.marketId)
      if (!target || target.status !== MarketStatus.Pending) return rejected('Proposta non modificabile.', target)
      const actor = normalize(command.actor)
      if (!context.owners.has(actor) || same(command.actor, target.buyer) || same(command.actor, target.seller)) {
        return rejected('Utente non abilitato alla votazione.', target)
      }
      target.approvers = target.approvers.filter(email => !same(email, command.actor))
      target.deniers = target.deniers.filter(email => !same(email, command.actor))
      ;(command.kind === 'approve' ? target.approvers : target.deniers).push(canonicalOwner(context, command.actor))
      if (MarketHelper.hasReachedDenialQuorum(target, context.teamCount)) {
        target.status = MarketStatus.Denied
      } else if (MarketHelper.hasReachedApprovalQuorum(target, context.teamCount)) {
        executeMarket(target, context.settings, teams, changedTeams)
      }
      return applied(target)
    }

    case 'cancel': {
      const target = market.markets.find(item => item.id === command.marketId)
      if (!target || target.status !== MarketStatus.Pending) return rejected('Proposta non modificabile.', target)
      if (!same(command.actor, target.buyer) && !same(command.actor, target.seller)) {
        return rejected('Solo le squadre coinvolte possono annullare la proposta.', target)
      }
      target.status = MarketStatus.Cancelled
      return applied(target)
    }
  }

  function rejected(message: string, target?: Market): ProcessMarketCommandResult {
    command.status = 'rejected'
    command.result = {
      ...(target ? { marketId: target.id, marketStatus: target.status } : {}),
      message,
      processedAt: input.now.toISOString(),
    }
    return { market, teams, command, changedTeams }
  }

  function applied(target: Market): ProcessMarketCommandResult {
    command.status = target.status === MarketStatus.NoMoney || target.status === MarketStatus.NoPlayers ? 'rejected' : 'applied'
    command.result = {
      marketId: target.id,
      marketStatus: target.status,
      ...(command.status === 'rejected' ? { message: 'Lo scambio non può essere eseguito.' } : {}),
      processedAt: input.now.toISOString(),
    }
    return { market, teams, command, changedTeams }
  }
}

export function expirePendingMarkets(wrapper: MarketWrapper, now: Date): boolean {
  const cutoff = now.getTime() - 14 * 24 * 60 * 60 * 1000
  let changed = false
  for (const market of wrapper.markets) {
    if (market.status !== MarketStatus.Pending) continue
    const createdAt = Date.parse(market.creationTime)
    if (Number.isFinite(createdAt) && createdAt < cutoff) {
      market.status = MarketStatus.Expired
      changed = true
    }
  }
  return changed
}

function executeMarket(market: Market, settings: LeagueSetting, teams: MarketTeams, changedTeams: string[]): void {
  const buyerKey = normalize(market.buyer)
  const sellerKey = normalize(market.seller)
  const buyerEntry = teams.get(buyerKey)
  const sellerEntry = teams.get(sellerKey)
  if (!buyerEntry || !sellerEntry) {
    market.status = MarketStatus.NoPlayers
    return
  }
  const buyerPlayers = findPlayers(buyerEntry.team, market.buyerPlayers.map(player => getPlayerKey(player.name)))
  const sellerPlayers = findPlayers(sellerEntry.team, market.sellerPlayers.map(player => getPlayerKey(player.name)))
  if (!buyerPlayers || !sellerPlayers) {
    market.status = MarketStatus.NoPlayers
    return
  }

  const buyerBudget = settings.startingMoney - TeamHelper.getCost(buyerEntry.team)
    + sumPrice(buyerPlayers) - sumPrice(sellerPlayers)
    - market.moneyFromBuyer + market.moneyFromSeller
  const sellerBudget = settings.startingMoney - TeamHelper.getCost(sellerEntry.team)
    + sumPrice(sellerPlayers) - sumPrice(buyerPlayers)
    - market.moneyFromSeller + market.moneyFromBuyer
  if (buyerBudget < 0 || sellerBudget < 0) {
    market.status = MarketStatus.NoMoney
    return
  }

  assignIncomingPositions(buyerPlayers, sellerPlayers)
  const buyerPlayerKeys = new Set(buyerPlayers.map(player => getPlayerKey(player.name)))
  const sellerPlayerKeys = new Set(sellerPlayers.map(player => getPlayerKey(player.name)))
  buyerEntry.team.players = buyerEntry.team.players.filter(player => !buyerPlayerKeys.has(getPlayerKey(player.name)))
  sellerEntry.team.players = sellerEntry.team.players.filter(player => !sellerPlayerKeys.has(getPlayerKey(player.name)))
  buyerEntry.team.players.push(...sellerPlayers.map(clonePlayer))
  sellerEntry.team.players.push(...buyerPlayers.map(clonePlayer))
  buyerEntry.team.moneyFromRank += market.moneyFromSeller - market.moneyFromBuyer
  sellerEntry.team.moneyFromRank += market.moneyFromBuyer - market.moneyFromSeller
  changedTeams.push(buyerKey, sellerKey)
  market.status = MarketStatus.Approved
}

type MarketContext = {
  settings: LeagueSetting
  owners: Set<string>
  canonicalOwners: Map<string, string>
  teamCount: number
}

function getMarketContext(group: Group, leagueId: string, season: number): MarketContext | null {
  const league = group.leagues.find(item => item.id === leagueId)
  const annual = league?.years.find(item => item.year === season)
  if (!league || !annual) return null
  const basketIds = new Set(league.basketsId)
  const annualTeams = group.baskets
    .filter(basket => basketIds.has(basket.id))
    .flatMap(basket => basket.years
      .filter(year => year.year === season)
      .flatMap(year => year.teams.map(team => ({ team, basketId: basket.id }))))
    .filter(entry => Boolean(entry.team.owner?.trim()))
  const canonicalOwners = new Map<string, string>()
  for (const entry of annualTeams) {
    if (!canonicalOwners.has(normalize(entry.team.owner))) canonicalOwners.set(normalize(entry.team.owner), entry.team.owner)
  }
  return {
    settings: annual.settings,
    owners: new Set(canonicalOwners.keys()),
    canonicalOwners,
    teamCount: annualTeams.length,
  }
}

function canonicalOwner(context: MarketContext, email: string): string {
  return context.canonicalOwners.get(normalize(email)) ?? email.trim()
}

function findPlayers(team: Team, requestedKeys: readonly string[]): Player[] | null {
  const keys = requestedKeys.map(value => value.trim()).filter(Boolean)
  if (keys.length !== new Set(keys).size) return null
  const active = team.players.filter(player => player.status === PlayerInTeamStatus.Active)
  const byKey = new Map(active.map(player => [getPlayerKey(player.name), player]))
  const players = keys.map(key => byKey.get(key))
  return players.some(player => !player) ? null : players as Player[]
}

function haveSameRoles(first: readonly Player[], second: readonly Player[]): boolean {
  return roleCounts(first).every(([role, count]) => roleCounts(second).find(([other]) => other === role)?.[1] === count)
    && roleCounts(first).length === roleCounts(second).length
}

function roleCounts(players: readonly Player[]): Array<[Role, number]> {
  const counts = new Map<Role, number>()
  for (const player of players) counts.set(player.role, (counts.get(player.role) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => a[0] - b[0])
}

function assignIncomingPositions(buyerPlayers: Player[], sellerPlayers: Player[]): void {
  for (const role of [...new Set(buyerPlayers.map(player => player.role))]) {
    const buyerByRole = buyerPlayers.filter(player => player.role === role)
    const sellerByRole = sellerPlayers.filter(player => player.role === role)
    for (let index = 0; index < buyerByRole.length; index += 1) {
      const buyerPosition = buyerByRole[index].position
      buyerByRole[index].position = sellerByRole[index].position as FantaSoccerRole
      sellerByRole[index].position = buyerPosition
    }
  }
}

function clonePlayer(player: Player): Player {
  return { ...player, team: { ...player.team } }
}

function cloneWrapper(wrapper: MarketWrapper): MarketWrapper {
  return {
    markets: wrapper.markets.map(market => ({
      ...market,
      buyerPlayers: market.buyerPlayers.map(clonePlayer),
      sellerPlayers: market.sellerPlayers.map(clonePlayer),
      approvers: [...market.approvers],
      deniers: [...market.deniers],
    })),
  }
}

function cloneTeams(teams: MarketTeams): MarketTeams {
  return new Map([...teams.entries()].map(([owner, entry]) => [owner, {
    basketId: entry.basketId,
    team: { ...entry.team, players: entry.team.players.map(clonePlayer), additionalOwners: [...entry.team.additionalOwners] },
  }]))
}

function cloneCommand(command: MarketCommand): MarketCommand {
  return {
    ...command,
    ...(command.create ? { create: { ...command.create, buyerPlayerKeys: [...command.create.buyerPlayerKeys], sellerPlayerKeys: [...command.create.sellerPlayerKeys] } } : {}),
    ...(command.result ? { result: { ...command.result } } : {}),
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function same(first: string | null | undefined, second: string | null | undefined): boolean {
  return normalize(first ?? '') === normalize(second ?? '')
}

function sumPrice(players: readonly Player[]): number {
  return players.reduce((sum, player) => sum + player.price, 0)
}

function nonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}
