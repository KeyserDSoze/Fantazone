import {
  DefaultLeagueSetting,
  GameResultHelper,
  GroupHelper,
  RealCalendarHelper,
  TeamHelper,
  applyLiveRoundsToRank,
  calculateTeamPoint,
  canApplyLiveRoundsToRank,
  type CalendarDay,
  type CalendarGame,
  type GameResult,
  type Group,
  type LeagueSetting,
  type LiveGroup,
  type LiveLeague,
  type Point,
  type Rank,
  type Team,
  type VotedRealPlayers,
} from '@fantazone/domain'
import type {
  GitHubCalendarRepository,
  GitHubRankRepository,
  GitHubRealCalendarRepository,
  GitHubSerieAVoteRepository,
  GitHubTeamRepository,
} from '@fantazone/github'

/**
 * Local replacement for legacy LiveJob + persisted LiveGroup cache.
 * It reads canonical documents and composes the old LiveGroup read model without writes.
 */
export class GroupLiveComposer {
  constructor(
    private readonly getGroup: () => Group,
    private readonly calendars: GitHubCalendarRepository,
    private readonly ranks: GitHubRankRepository,
    private readonly teams: GitHubTeamRepository,
    private readonly realCalendars: GitHubRealCalendarRepository,
    private readonly liveVotes: GitHubSerieAVoteRepository,
    private readonly officialVotes: GitHubSerieAVoteRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getLiveGroup(season: number): Promise<LiveGroup | null> {
    assertSeason(season)
    const realCalendar = await this.realCalendars.getCalendar(season)
    if (!realCalendar) return null

    const context = RealCalendarHelper.context(realCalendar, this.now())
    const targetDay = context.liveDay ?? context.nextDay
    if (!targetDay) return null

    const serieADay = targetDay.serieADay
    const [officialVotes, liveVotes] = await Promise.all([
      this.officialVotes.getVotes(season, serieADay),
      context.liveSerieADay === serieADay ? this.liveVotes.getVotes(season, serieADay) : Promise.resolve(null),
    ])

    const group = this.getGroup()
    const leagues: LiveLeague[] = []
    for (const league of group.leagues) {
      if (!league.years.some(year => year.year === season)) continue
      const calendar = await this.calendars.getCalendar(league.id, season)
      if (!calendar) continue

      const annual = GroupHelper.getAnnualLeague(group, league.id, season)
      const settings = annual?.settings ?? DefaultLeagueSetting
      const leagueType = GroupHelper.getAnnualType(league, season)
      const rounds: Record<string, CalendarDay> = {}

      for (const [roundKey, days] of Object.entries(calendar.rounds)) {
        const day = days.find(item => item.serieADay === serieADay)
        if (!day) continue
        rounds[roundKey] = await this.projectDay({
          group,
          season,
          day,
          settings,
          leagueType,
          officialVotes,
          liveVotes,
        })
      }

      const canonicalRank = await this.ranks.getRank(league.id, season)
      const rank = canonicalRank
        ? (!Object.prototype.hasOwnProperty.call(rounds, 'Finals') && canApplyLiveRoundsToRank(canonicalRank, rounds)
            ? applyLiveRoundsToRank(canonicalRank, rounds, settings)
            : cloneRank(canonicalRank))
        : null

      leagues.push({
        id: league.id,
        name: league.name?.trim() || league.id,
        rounds,
        rank,
      })
    }

    return { name: group.name?.trim() || group.id, leagues }
  }

  private async projectDay(input: {
    group: Group
    season: number
    day: CalendarDay
    settings: LeagueSetting
    leagueType: ReturnType<typeof GroupHelper.getAnnualType>
    officialVotes: VotedRealPlayers | null
    liveVotes: VotedRealPlayers | null
  }): Promise<CalendarDay> {
    const games: CalendarGame[] = []
    for (const sourceGame of input.day.games) {
      const game = cloneGame(sourceGame)
      if (game.result?.isCancelled === true) {
        games.push(game)
        continue
      }
      if (!game.homeOwner?.trim() || !game.awayOwner?.trim()) {
        games.push(game)
        continue
      }

      const homeBasket = GroupHelper.getBasketId(input.group, game.homeOwner, input.season)
      const awayBasket = GroupHelper.getBasketId(input.group, game.awayOwner, input.season)
      if (!homeBasket || !awayBasket) {
        games.push(game)
        continue
      }

      const [homeTeam, awayTeam] = await Promise.all([
        this.teams.getTeamDay(homeBasket, input.season, input.day.serieADay, game.homeOwner),
        this.teams.getTeamDay(awayBasket, input.season, input.day.serieADay, game.awayOwner),
      ])
      const home = homeTeam?.players
        ? addHomeAdvantage(this.calculatePoint(homeTeam, input, input.settings), input.settings.pointInHome)
        : zeroPoint()
      const away = this.calculatePoint(awayTeam, input, input.settings)
      const result: GameResult = {
        home,
        away,
        isCancelled: false,
        homeGoals: 0,
        awayGoals: 0,
      }
      const goals = GameResultHelper.calculateGoals(result, input.settings)
      result.homeGoals = goals.home
      result.awayGoals = goals.away
      game.result = result
      games.push(game)
    }
    return { ...input.day, games }
  }

  private calculatePoint(
    team: Team | null,
    input: {
      leagueType: ReturnType<typeof GroupHelper.getAnnualType>
      officialVotes: VotedRealPlayers | null
      liveVotes: VotedRealPlayers | null
    },
    settings: LeagueSetting,
  ): Point {
    if (!team?.players) return zeroPoint()
    return calculateTeamPoint({
      players: TeamHelper.getActivePlayers(team),
      officialVotes: input.officialVotes,
      liveVotes: input.liveVotes,
      leagueType: input.leagueType,
      settings,
    }).point
  }
}

function addHomeAdvantage(point: Point, advantage: number): Point {
  return { ...point, value: point.value + advantage }
}

function zeroPoint(): Point {
  return { value: 0, defensiveBonus: false, goodPeople: false, ownGoal: false }
}

function cloneGame(game: CalendarGame): CalendarGame {
  return {
    ...game,
    result: game.result ? {
      ...game.result,
      home: { ...game.result.home },
      away: { ...game.result.away },
    } : null,
  }
}

function cloneRank(rank: Rank): Rank {
  return {
    serieADay: rank.serieADay,
    rounds: Object.fromEntries(
      Object.entries(rank.rounds).map(([key, teams]) => [key, teams.map(team => ({ ...team }))]),
    ),
  }
}

function assertSeason(season: number): void {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
}
