import { GameResultHelper, type Calendar, type CalendarGame } from './calendar'
import { LeagueType, type Group } from './group'
import { CUP_FINALS_ROUND, EUROPA_LEAGUE_ROUND } from './leagueProgression'
import { RankHelper, type Rank, type RankedTeam } from './rank'
import { getPlayerKey } from './realPlayer'
import { TeamHelper, type Player, type Team } from './team'

export interface HallOfFameRecordGame {
  game: CalendarGame
  year: number
}

export interface HallOfFameRecordPlayer {
  player: Player
  points: number
}

export interface HallOfFamePlayerWithMostPointsInYear {
  player: Player
  year: number
  points: number
}

export interface HallOfFameWinningTeam {
  owner: string
  teamName: string
  wins: Record<string, number[]>
}

export interface HallOfFameWinningPlayer {
  player: Player
  wins: Record<string, number[]>
}

/** Readable schema-v2 replacement for legacy HallOfFame. */
export interface HallOfFame {
  recordGame: HallOfFameRecordGame | null
  /** Legacy HallOfFameJob left this calculation as TODO; keep it null rather than inventing behavior. */
  recordPlayer: HallOfFameRecordPlayer | null
  /** Legacy HallOfFameJob left this calculation as TODO; keep it null rather than inventing behavior. */
  playerWithMostPointsInYear: HallOfFamePlayerWithMostPointsInYear | null
  winningPlayers: HallOfFameWinningPlayer[]
  winningTeams: HallOfFameWinningTeam[]
  allTimeRankings: RankedTeam[]
}

export type HallOfFameSeasonInput = {
  year: number
  leagueType: LeagueType
  rank: Rank
  calendar: Calendar
  /** Canonical season Team documents keyed by normalized owner email. */
  teamsByOwner: ReadonlyMap<string, Team>
}

export type BuildHallOfFameInput = {
  group: Group
  leagueId: string
  currentSeason: number
  /** The legacy job iterated league years newest-first. */
  seasons: HallOfFameSeasonInput[]
}

export type LeagueWinner = {
  owner: string
  round: string
}

export function emptyHallOfFame(): HallOfFame {
  return {
    recordGame: null,
    recordPlayer: null,
    playerWithMostPointsInYear: null,
    winningPlayers: [],
    winningTeams: [],
    allTimeRankings: [],
  }
}

/**
 * Pure port of legacy HallOfFameJob for one league.
 *
 * The two player-record fields deliberately remain null because the old job also
 * left them unimplemented. Perfect knockout ties use Fantazone's deterministic
 * replacement for the old crypto-random fallback so rebuilds are reproducible.
 */
export function buildHallOfFame(input: BuildHallOfFameInput): HallOfFame {
  const league = input.group.leagues.find(item => item.id === input.leagueId)
  if (!league) throw new Error(`Lega Hall of Fame non trovata: ${input.leagueId}`)

  const hall = emptyHallOfFame()
  const rankingsByOwner = new Map<string, RankedTeam>()
  const winningTeamsByOwner = new Map<string, HallOfFameWinningTeam>()
  const winningPlayersByKey = new Map<string, HallOfFameWinningPlayer>()

  for (const season of [...input.seasons].sort((a, b) => b.year - a.year)) {
    if (season.calendar.year !== season.year) {
      throw new Error(`Calendar ${input.leagueId} year mismatch: expected ${season.year}, found ${season.calendar.year}`)
    }

    for (const ranked of Object.values(season.rank.rounds).flat()) {
      const ownerKey = normalize(ranked.owner)
      const existing = rankingsByOwner.get(ownerKey)
      rankingsByOwner.set(ownerKey, existing ? RankHelper.addRankedTeams(existing, ranked) : cloneRankedTeam(ranked))
    }

    for (const game of allGames(season.calendar)) {
      if (!GameResultHelper.hasValue(game.result)) continue
      if (!hall.recordGame || shouldReplaceLegacyRecordGame(hall.recordGame.game, game)) {
        hall.recordGame = { game: cloneGame(game), year: season.year }
      }
    }

    if (!isSeasonFinalForHallOfFame(season.calendar, season.year, input.currentSeason)) continue

    for (const winner of getYearlyLeagueWinners(season.leagueType, season.rank, season.calendar)) {
      const annualTeam = findAnnualTeam(input.group, winner.owner, season.year)
      if (!annualTeam) {
        throw new Error(`Squadra storica non trovata per ${winner.owner} nella stagione ${season.year}`)
      }

      const ownerKey = normalize(winner.owner)
      let winningTeam = winningTeamsByOwner.get(ownerKey)
      if (!winningTeam) {
        winningTeam = { owner: winner.owner, teamName: annualTeam.name, wins: {} }
        winningTeamsByOwner.set(ownerKey, winningTeam)
      }
      appendWin(winningTeam.wins, winner.round, season.year)

      const team = season.teamsByOwner.get(ownerKey)
      if (!team) {
        throw new Error(`Team canonico non trovato per ${winner.owner} nella stagione ${season.year}`)
      }
      for (const player of TeamHelper.getActivePlayers(team)) {
        const playerKey = getPlayerKey(player.name)
        if (!playerKey) continue
        let winningPlayer = winningPlayersByKey.get(playerKey)
        if (!winningPlayer) {
          winningPlayer = { player: clonePlayer(player), wins: {} }
          winningPlayersByKey.set(playerKey, winningPlayer)
        }
        appendWin(winningPlayer.wins, winner.round, season.year)
      }
    }
  }

  hall.allTimeRankings = [...rankingsByOwner.values()]
  hall.winningTeams = [...winningTeamsByOwner.values()]
  hall.winningPlayers = [...winningPlayersByKey.values()]
  return hall
}

export function isSeasonFinalForHallOfFame(calendar: Calendar, year: number, currentSeason: number): boolean {
  if (year < currentSeason) return true
  const latestDay = Object.values(calendar.rounds)
    .flat()
    .slice()
    .sort((a, b) => b.number - a.number)[0]
  return Boolean(latestDay?.games.length) && latestDay.games.every(game => GameResultHelper.hasValue(game.result))
}

/** Mirrors ILeagueCalculator.GetTheYearlyWinners used by legacy HallOfFameJob. */
export function getYearlyLeagueWinners(leagueType: LeagueType, rank: Rank, calendar: Calendar): LeagueWinner[] {
  switch (leagueType) {
    case LeagueType.Cup:
      return knockoutRoundWinner(calendar, CUP_FINALS_ROUND)
    case LeagueType.NewCup:
      return [
        ...knockoutRoundWinner(calendar, CUP_FINALS_ROUND),
        ...knockoutRoundWinner(calendar, EUROPA_LEAGUE_ROUND),
      ]
    default: {
      const firstRound = Object.values(rank.rounds)[0]
      if (!firstRound?.length) return []
      const winner = [...firstRound].sort((a, b) =>
        b.point - a.point || b.valuePoint - a.valuePoint || b.goal - a.goal,
      )[0]
      return winner ? [{ owner: winner.owner, round: '@' }] : []
    }
  }
}

export const HallOfFameHelper = {
  totalWins(winner: { wins: Record<string, number[]> }): number {
    return Object.values(winner.wins).reduce((total, years) => total + years.length, 0)
  },
  sortRankingsByPoints(rankings: RankedTeam[]): RankedTeam[] {
    return [...rankings].sort((a, b) => b.point - a.point)
  },
  sortRankingsByValueAssets(rankings: RankedTeam[]): RankedTeam[] {
    return [...rankings].sort((a, b) => b.valueAssets - a.valueAssets)
  },
  sortWinningTeamsByWins(teams: HallOfFameWinningTeam[]): HallOfFameWinningTeam[] {
    return [...teams].sort((a, b) => this.totalWins(b) - this.totalWins(a))
  },
  sortWinningPlayersByWins(players: HallOfFameWinningPlayer[]): HallOfFameWinningPlayer[] {
    return [...players].sort((a, b) => this.totalWins(b) - this.totalWins(a))
  },
}

function knockoutRoundWinner(calendar: Calendar, round: string): LeagueWinner[] {
  const game = calendar.rounds[round]
    ?.filter(day => day.games.length === 1)
    .slice()
    .sort((a, b) => b.number - a.number)[0]
    ?.games[0]
  if (!game || !GameResultHelper.hasValue(game.result)) return []
  return [{ owner: resolveSingleGameWinner(game, `${calendar.year}|${round}|winner`), round }]
}

function resolveSingleGameWinner(game: CalendarGame, seed: string): string {
  const result = game.result
  if (!result) throw new Error(`Knockout game ${game.id} has no result`)
  if (result.homeGoals > result.awayGoals) return game.homeOwner
  if (result.awayGoals > result.homeGoals) return game.awayOwner
  if (result.home.value > result.away.value) return game.homeOwner
  if (result.away.value > result.home.value) return game.awayOwner
  return stableHash(`${seed}|${game.homeOwner}|${game.awayOwner}`) % 2 === 0 ? game.homeOwner : game.awayOwner
}

/** Preserves the exact comparison used by legacy HallOfFameJob, including its home-side baseline. */
function shouldReplaceLegacyRecordGame(current: CalendarGame, candidate: CalendarGame): boolean {
  if (!current.result || !candidate.result) return false
  return (
    candidate.result.home.value > current.result.home.value &&
    candidate.result.home.value > candidate.result.away.value
  ) || (
    candidate.result.away.value > current.result.home.value &&
    candidate.result.away.value > candidate.result.home.value
  )
}

function allGames(calendar: Calendar): CalendarGame[] {
  return Object.values(calendar.rounds).flatMap(days => days.flatMap(day => day.games))
}

function findAnnualTeam(group: Group, owner: string, year: number): { name: string } | null {
  for (const basket of group.baskets) {
    const annual = basket.years.find(item => item.year === year)
    const team = annual?.teams.find(item => normalize(item.owner) === normalize(owner))
    if (team) return team
  }
  return null
}

function appendWin(wins: Record<string, number[]>, round: string, year: number): void {
  const years = wins[round] ?? (wins[round] = [])
  if (!years.includes(year)) years.push(year)
}

function cloneRankedTeam(team: RankedTeam): RankedTeam {
  return { ...team }
}

function clonePlayer(player: Player): Player {
  return { ...player, team: { ...player.team } }
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

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}
