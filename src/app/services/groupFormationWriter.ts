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
  source: 'day' | 'season-fallback'
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
    super('La formazione di questa giornata non è più modificabile.')
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
 * The caller sends only playerKey -> position changes. Every other Team field is
 * reloaded from GitHub before validation and cannot be overwritten by the UI.
 * Serie A timing is resolved from the shared RealCalendar, never trusted from the client.
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
      const isCurrentLiveDay = adminOverride && liveSerieADay === wrapper.serieADay
      if (!isCurrentLiveDay) throw new FormationLockedError()
    }

    const daySnapshot = await this.teams.getTeamDaySnapshot(
      annual.basketId,
      input.season,
      wrapper.serieADay,
      canonicalOwner,
      { refresh: true },
    )
    const seasonSnapshot = daySnapshot
      ? null
      : await this.teams.getTeamSnapshot(annual.basketId, input.season, canonicalOwner, { refresh: true })
    const source = daySnapshot ? 'day' as const : 'season-fallback' as const
    const current = daySnapshot?.value ?? seasonSnapshot?.value
    if (!current) throw new FormationTeamNotFoundError()

    const positioned = applyFormationPositions(current, input.positions)
    const validation = validateFormation(positioned)
    if (!validation.valid) throw new FormationValidationError(validation.errors)

    const updated: Team = { ...positioned, lastUpdate: operationNow.toISOString() }
    const sha = await this.teams.writeTeamDay(
      annual.basketId,
      input.season,
      wrapper.serieADay,
      canonicalOwner,
      updated,
      `feat: save formation ${canonicalOwner} day ${wrapper.serieADay}`,
      daySnapshot ? { expectedSha: daySnapshot.sha } : { createOnly: true },
    )

    return { team: updated, sha, source, serieADay: wrapper.serieADay }
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
