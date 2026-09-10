import {
  GroupHelper,
  IdentityRole,
  RealCalendarHelper,
  applyFormationPositions,
  validateFormation,
  validateLiveFormationChange,
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
  /**
   * Internal replay flag for a formation that was accepted into the local outbox
   * before kickoff but could only reach GitHub later. Replays never mutate the live
   * TeamDay: they update the mutable season Team and let the group Action apply the
   * Git commit timestamp to the next eligible giornata.
   */
  offlineReplay?: boolean
}

export type SavedFormation = {
  team: Team
  sha: string
  source: 'season' | 'day'
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
 * Before kickoff only the mutable season Team is changed and the GitHub Action freezes TeamDay.
 * During an enabled live window the already-frozen TeamDay is the canonical write target, so the
 * current match changes without leaking the live formation into the following giornata.
 *
 * An offline replay is different from a live edit: the intent was queued while ordinary pre-kickoff
 * editing was active, but GitHub did not receive it at that time. If the original fixture has since
 * locked (including an enabled live-change window), replay writes only the season Team. The group
 * Action then uses the real Git commit timestamp to roll that formation to the next eligible day.
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

    const wrapper = await this.games.getGame({ leagueId: input.leagueId, season: input.season, gameId: input.gameId })
    if (!wrapper) throw new FormationTeamNotFoundError()

    const requestedOwner = normalizeEmail(input.owner)
    const gameTeam = wrapper.teams.find(team => normalizeEmail(team.owner) === requestedOwner)
    if (!gameTeam) throw new FormationAuthorizationError('La squadra non appartiene alla partita selezionata.')

    const annual = findAnnualTeam(group, requestedOwner, input.season)
    if (!annual) throw new FormationTeamNotFoundError()
    const canonicalOwner = annual.team.owner
    const isOwner = GroupHelper.isOwner(annual.team, actor.email)
    const adminOverride = input.asAdmin === true && GroupHelper.hasRole(actor, IdentityRole.SuperAdmin)
    if (!isOwner && !adminOverride) throw new FormationAuthorizationError('Non sei l’owner o co-owner della squadra.')

    const league = group.leagues.find(item => item.id === input.leagueId)
    const annualLeague = league?.years.find(item => item.year === input.season)
    if (!annualLeague) throw new FormationLockedError()

    const offlineReplay = input.offlineReplay === true
    if (wrapper.isLiveFormationWindow && !offlineReplay) {
      const daySnapshot = await this.teams.getTeamDaySnapshot(
        annual.basketId, input.season, wrapper.serieADay, canonicalOwner, { refresh: true },
      )
      const fallbackSnapshot = daySnapshot ? null : await this.teams.getTeamSnapshot(
        annual.basketId, input.season, canonicalOwner, { refresh: true },
      )
      const base = daySnapshot?.value ?? fallbackSnapshot?.value
      if (!base) throw new FormationTeamNotFoundError()

      const canonical: Team = {
        ...base,
        owner: canonicalOwner,
        additionalOwners: [...(annual.team.additionalOwners ?? [])],
        formationChanges: base.formationChanges ?? 0,
      }
      const positioned = applyFormationPositions(canonical, input.positions)
      const liveValidation = validateLiveFormationChange(canonical, positioned, annualLeague.settings)
      if (!liveValidation.valid) throw new FormationValidationError([liveValidation.error])
      const validation = validateFormation(positioned)
      if (!validation.valid) throw new FormationValidationError(validation.errors)
      const updated: Team = {
        ...positioned,
        formationChanges: liveValidation.nextFormationChanges,
        lastUpdate: operationNow.toISOString(),
      }
      const sha = await this.teams.writeTeamDay(
        annual.basketId,
        input.season,
        wrapper.serieADay,
        canonicalOwner,
        updated,
        `feat: live formation ${canonicalOwner} day ${wrapper.serieADay}`,
        daySnapshot ? { expectedSha: daySnapshot.sha } : { createOnly: true },
      )
      return { team: updated, sha, source: 'day', serieADay: wrapper.serieADay }
    }

    if (!wrapper.canEdit && !offlineReplay) {
      const realCalendar = await this.realCalendars.getCalendar(input.season, { refresh: true })
      const liveSerieADay = realCalendar ? RealCalendarHelper.getLiveSerieADay(realCalendar, operationNow) : 0
      const isCurrentLiveDay = liveSerieADay === wrapper.serieADay
      if (!adminOverride || !isCurrentLiveDay) throw new FormationLockedError()
    }

    const seasonSnapshot = await this.teams.getTeamSnapshot(annual.basketId, input.season, canonicalOwner, { refresh: true })
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
      offlineReplay
        ? `feat: replay offline formation ${canonicalOwner}`
        : `feat: save current formation ${canonicalOwner}`,
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
