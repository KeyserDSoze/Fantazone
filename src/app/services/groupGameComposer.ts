import {
  CalendarHelper,
  GameResultHelper,
  GroupHelper,
  TeamHelper,
  type Calendar,
  type CalendarDay,
  type CalendarGame,
  type GameSide,
  type GameTeam,
  type GameWrapper,
  type Group,
  type Team,
} from '@fantazone/domain'
import type { GitHubCalendarRepository, GitHubTeamRepository } from '@fantazone/github'

export type ComposeGameInput = {
  leagueId: string
  season: number
  gameId: string
  /**
   * Next real Serie A day. Until RealCalendar is migrated callers may omit it;
   * 39 preserves the legacy controller fallback when the real calendar was unavailable.
   */
  nextSerieADay?: number
}

type LocatedGame = {
  day: CalendarDay
  game: CalendarGame
}

/**
 * Local replacement for GET /Game/Get. It joins canonical Group, Calendar and
 * Team/TeamDay documents without creating another persisted aggregate.
 */
export class GroupGameComposer {
  constructor(
    private readonly getGroup: () => Group,
    private readonly calendars: GitHubCalendarRepository,
    private readonly teams: GitHubTeamRepository,
  ) {}

  async getGame(input: ComposeGameInput): Promise<GameWrapper | null> {
    validateInput(input)
    const calendar = await this.calendars.getCalendar(input.leagueId, input.season)
    if (!calendar) return null

    const located = findGame(calendar, input.gameId)
    if (!located) return null

    const nextSerieADay = input.nextSerieADay ?? 39
    const canEdit = located.day.serieADay >= nextSerieADay
    const group = this.getGroup()

    const [home, away] = await Promise.all([
      this.composeTeam(group, input.season, located.day.serieADay, located.game, 'home', canEdit),
      this.composeTeam(group, input.season, located.day.serieADay, located.game, 'away', canEdit),
    ])

    return {
      leagueId: input.leagueId,
      season: input.season,
      fantasyDay: located.day.number,
      serieADay: located.day.serieADay,
      game: located.game,
      teams: [home, away],
      canEdit,
      nextSerieADay,
      editabilitySource: input.nextSerieADay == null ? 'legacy-fallback' : 'serie-a-context',
      requiresScoreCalculation: !canEdit && !GameResultHelper.hasValue(located.game.result),
    }
  }

  private async composeTeam(
    group: Group,
    season: number,
    serieADay: number,
    game: CalendarGame,
    side: GameSide,
    canEdit: boolean,
  ): Promise<GameTeam> {
    const owner = side === 'home' ? game.homeOwner : game.awayOwner
    const fallbackName = side === 'home' ? game.home : game.away
    const basketId = GroupHelper.getBasketId(group, owner, season)
    if (!basketId) return missingTeam(side, fallbackName, owner)

    const dayTeam = await this.teams.getTeamDay(basketId, season, serieADay, owner)
    if (dayTeam) return projectTeam(side, dayTeam, 'day')

    if (canEdit) {
      const seasonTeam = await this.teams.getTeam(basketId, season, owner)
      if (seasonTeam) return projectTeam(side, seasonTeam, 'season')
    }

    return missingTeam(side, fallbackName, owner)
  }
}

function findGame(calendar: Calendar, gameId: string): LocatedGame | null {
  for (const day of CalendarHelper.getAllDays(calendar)) {
    const game = day.games.find(item => item.id === gameId)
    if (game) return { day, game }
  }
  return null
}

function projectTeam(side: GameSide, team: Team, source: 'day' | 'season'): GameTeam {
  return {
    side,
    name: team.name,
    owner: team.owner,
    additionalOwners: [...(team.additionalOwners ?? [])],
    players: TeamHelper.getActivePlayers(team).map(player => ({
      current: player,
      currentPosition: player.position,
    })),
    lastUpdate: team.lastUpdate,
    source,
  }
}

function missingTeam(side: GameSide, name: string, owner: string): GameTeam {
  return {
    side,
    name,
    owner,
    additionalOwners: [],
    players: [],
    lastUpdate: null,
    source: 'missing',
  }
}

function validateInput(input: ComposeGameInput): void {
  if (!input.leagueId.trim()) throw new Error('League id is required')
  if (!input.gameId.trim()) throw new Error('Game id is required')
  if (!Number.isInteger(input.season) || input.season < 1) throw new Error('Season must be a positive integer')
  if (input.nextSerieADay != null && (!Number.isInteger(input.nextSerieADay) || input.nextSerieADay < 1)) {
    throw new Error('Next Serie A day must be a positive integer')
  }
}
