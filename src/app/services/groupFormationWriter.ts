import {
  GroupHelper,
  IdentityRole,
  RealCalendarHelper,
  applyFormationPositions,
  validateFormation,
  type AuthenticatedGroupSession,
  type FormationPositionUpdate,
  type Group,
  type Team,
} from '@fantazone/domain'
import type { GitHubRealCalendarRepository, GitHubTeamRepository } from '@fantazone/github'
import type { GroupGameComposer } from './groupGameComposer'

export type SaveGameFormationInput = {
  session: AuthenticatedGroupSession
  leagueId: string
  season: number
  gameId: string
  owner: string
  positions: readonly FormationPositionUpdate[]
  asAdmin?: boolean
}

export type SavedFormation = {
  team: Team
  sha: string
  source: 'season'
  serieADay: number
}

export class FormationAuthorizationError extends Error {
  constructor(message = 'Non sei autorizzato a modificare questa formazione.') {
    super(message)
    this.name = 'FormationAuthorizationError'
  }
}

export class FormationLockedError extends Error {
  constructor() {
    super('Questa giornata è storica e non può essere usata per modificare la squadra corrente.')
    this.name = 'FormationLockedError'
  }
}

export class FormationTeamNotFoundError extends Error {
  constructor() {
    super('Squadra non trovata per la formazione richiesta.')
    this.name = 'FormationTeamNotFoundError'
  }
}

export class FormationValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors[0] ?? 'Formazione non valida.')
    this.name = 'FormationValidationError'
  }
}

/**
 * Write-side replacement for Game/SaveTeam.
 *
 * The client only ever mutates the season Team. Immutable TeamDay snapshots are
 * produced by the group GitHub Action from the resulting Git commit, using the
 * commit timestamp as the authoritative Serie A cutoff clock. This means a client
 * can never rewrite an already frozen historical TeamDay directly.
 */
export class GroupFormationWriter {
  constructor(
    private readonly refreshGroup: () => Promise<Group>,
    private readonly games: GroupGameComposer,
    private readonly teams: GitHubTeamRepository,
    private readonly realCalendars: GitHubRealCalendarRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async saveGameFormation(input: SaveGameFormationInput): Promise<SavedFormation> {
    const operationNow = this.now()
    const group = await this.refreshGroup()
    const actor = GroupHelper.findUserByEmail(group, input.session.identity.email)
    if (!actor || actor.role === IdentityRole.None) {
      throw new FormationAuthorizationError('Utente non valido nel gruppo selezionato.')
    }

    const wrapper = await this.games.getGame({
      leagueId: input.leagueId,
      season: input.season,
      gameId: input.gameId,
    })
    if (!wrapper) throw new FormationTeamNotFoundError()

    const requestedOwner = normalizeEmail(input.owner)
    const gameTeam = wrapper.teams.find(team => normalizeEmail(team.owner) === requestedOwner)
    if (!gameTeam) throw new FormationAuthorizationError('La squadra non appartiene alla partita selezionata.')

    const annual = findAnnualTeam(group, requestedOwner, input.season)
    if (!annual) throw new FormationTeamNotFoundError()
    const canonicalOwner = annual.team.owner
    const isOwner = [annual.team.owner, ...(annual.team.additionalOwners ?? [])]
      .some(email => normalizeEmail(email) === normalizeEmail(actor.email))
    const adminOverride = input.asAdmin === true && GroupHelper.hasRole(actor, IdentityRole.SuperAdmin)
    if (!isOwner && !adminOverride) throw new FormationAuthorizationError('Non sei l’owner della squadra.')

    if (!wrapper.canEdit) {
      const realCalendar = await this.realCalendars.getCalendar(input.season, { refresh: true })
      const liveSerieADay = realCalendar ? RealCalendarHelper.getLiveSerieADay(realCalendar, operationNow) : 0
      const isCurrentLiveDay = liveSerieADay === wrapper.serieADay
      if (!isCurrentLiveDay) throw new FormationLockedError()
    }

    const seasonSnapshot = await this.teams.getTeamSnapshot(
      annual.basketId,
      input.season,
      canonicalOwner,
      { refresh: true },
    )
    if (!seasonSnapshot) throw new FormationTeamNotFoundError()

    const positioned = applyFormationPositions(seasonSnapshot.value, input.positions)
    const validation = validateFormation(positioned)
    if (!validation.valid) throw new FormationValidationError(validation.errors)

    const updated: Team = { ...positioned, lastUpdate: operationNow.toISOString() }
    const sha = await this.teams.writeTeam(
      annual.basketId,
      input.season,
      canonicalOwner,
      updated,
      `feat: save current formation ${canonicalOwner}`,
      { expectedSha: seasonSnapshot.sha },
    )

    return { team: updated, sha, source: 'season', serieADay: wrapper.serieADay }
  }
}

function findAnnualTeam(group: Group, owner: string, season: number) {
  for (const basket of group.baskets) {
    const yearly = basket.years.find(item => item.year === season)
    const team = yearly?.teams.find(item => normalizeEmail(item.owner) === owner)
    if (team) return { basketId: basket.id, team }
  }
  return null
}

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}
