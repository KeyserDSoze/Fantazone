import type { Calendar, CalendarGame } from './calendar'
import type { LuckEvent, TeamLuck } from './rank'

type DayScore = { owner: string; name: string; score: number }

/** Pure port of the legacy Fantasoccer "Parametro Fortuna" calculation. */
export class LuckCalculator {
  static calculateTeamLuck(calendar: Calendar, roundId: string): Map<string, TeamLuck> {
    const result = new Map<string, TeamLuck>()
    for (const day of calendar.rounds[roundId] ?? []) {
      const scores = this.getDayScores(day.games)
      for (const game of day.games) {
        if (!game.result || game.result.isCancelled) continue
        if (game.result.home.value === 0 && game.result.away.value === 0) continue

        const homeEvents = this.calculateGameLuck(
          game,
          day.number,
          game.homeOwner,
          game.home,
          game.result.home.value,
          game.result.homeGoals,
          game.awayOwner,
          game.away,
          game.result.away.value,
          game.result.awayGoals,
          scores,
        )
        const awayEvents = this.calculateGameLuck(
          game,
          day.number,
          game.awayOwner,
          game.away,
          game.result.away.value,
          game.result.awayGoals,
          game.homeOwner,
          game.home,
          game.result.home.value,
          game.result.homeGoals,
          scores,
        )
        this.addEvents(result, game.homeOwner, game.home, homeEvents)
        this.addEvents(result, game.awayOwner, game.away, awayEvents)
      }
    }

    for (const luck of result.values()) {
      luck.avgLuck = luck.gamesPlayed > 0 ? luck.totalLuck / luck.gamesPlayed : 0
    }
    return result
  }

  static formatLuck(luck: number): string {
    const percentage = Math.round(luck * 100)
    return `${percentage > 0 ? '+' : ''}${percentage}%`
  }

  static formatLuckPoints(luck: number): string {
    return `${luck > 0 ? '+' : ''}${luck.toFixed(2)}`
  }

  private static getDayScores(games: CalendarGame[]): DayScore[] {
    const scores: DayScore[] = []
    for (const game of games) {
      if (!game.result || game.result.isCancelled) continue
      scores.push({ owner: game.homeOwner, name: game.home, score: game.result.home.value })
      scores.push({ owner: game.awayOwner, name: game.away, score: game.result.away.value })
    }
    return scores.sort((a, b) => a.score - b.score)
  }

  private static calculateGameLuck(
    game: CalendarGame,
    dayNumber: number,
    myOwner: string,
    _myName: string,
    myScore: number,
    myGoals: number,
    opponentOwner: string,
    opponentName: string,
    opponentScore: number,
    opponentGoals: number,
    dayScores: DayScore[],
  ): LuckEvent[] {
    const events: LuckEvent[] = []
    const result = this.result(myGoals, opponentGoals)
    const goalDiff = Math.abs(myGoals - opponentGoals)
    const scoreDiff = Math.abs(myScore - opponentScore)
    const myRank = dayScores.findIndex(score => normalize(score.owner) === normalize(myOwner)) + 1
    const opponentRank = dayScores.findIndex(score => normalize(score.owner) === normalize(opponentOwner)) + 1
    const totalTeams = dayScores.length
    const bestRank = totalTeams

    if (result === 'win' && goalDiff === 1 && myScore < 66) {
      events.push(event('win-vs-worst', 5, game, dayNumber, opponentName, myScore, opponentScore, result,
        `Vittoria fortunatissima con meno di 66 punti (${myScore.toFixed(1)}) e 1 solo goal di scarto`))
    } else if (result === 'win' && goalDiff === 1 && opponentRank <= 3 && myScore >= 66) {
      const points = opponentRank === 1 ? 3 : opponentRank === 2 ? 2 : 1
      const rankLabel = opponentRank === 1 ? 'peggiore' : opponentRank === 2 ? 'secondo peggiore' : 'terzo peggiore'
      events.push(event('win-vs-second-worst', points, game, dayNumber, opponentName, myScore, opponentScore, result,
        `Vittoria di 1 goal contro il ${rankLabel} punteggio del turno (${opponentScore.toFixed(1)} punti)`))
    }

    if (result === 'win' && goalDiff === 1 && scoreDiff < 6 && myScore >= 66 && opponentRank > 3) {
      let points = 6 - scoreDiff
      const distance = nextGoalThreshold(opponentGoals) - opponentScore
      if (distance <= 3) points += 2
      events.push(event('win-narrow', points, game, dayNumber, opponentName, myScore, opponentScore, result,
        `Vittoria di misura con solo ${scoreDiff.toFixed(1)} punti di scarto${distance <= 3 ? ` (avversario a ${distance.toFixed(1)} punti dal pareggio!)` : ''}`))
    }

    if (result === 'draw' && scoreDiff > 0) {
      const maxDrawGap = 5.5
      let points = myScore < opponentScore ? (scoreDiff / maxDrawGap) * 3 : -(scoreDiff / maxDrawGap) * 3
      const myDistance = nextGoalThreshold(myGoals) - myScore
      const opponentDistance = nextGoalThreshold(opponentGoals) - opponentScore
      if (opponentDistance <= 3) points += 2
      if (myDistance <= 3) points -= 2
      events.push(event('draw-wide-gap', points, game, dayNumber, opponentName, myScore, opponentScore, result,
        myScore < opponentScore
          ? `Pareggio fortunato con ${scoreDiff.toFixed(1)} punti in meno dell'avversario${opponentDistance <= 3 ? ` (avversario a ${opponentDistance.toFixed(1)} punti dal goal successivo!)` : ''}`
          : `Pareggio sfortunato con ${scoreDiff.toFixed(1)} punti in più dell'avversario${myDistance <= 3 ? ` (eri a ${myDistance.toFixed(1)} punti dal goal successivo!)` : ''}`))
    }

    if (result === 'loss' && goalDiff === 1 && scoreDiff < 6) {
      let points = -(6 - scoreDiff)
      const distance = nextGoalThreshold(myGoals) - myScore
      if (distance <= 3) points -= 2
      events.push(event('loss-narrow', points, game, dayNumber, opponentName, myScore, opponentScore, result,
        `Sconfitta di misura per soli ${scoreDiff.toFixed(1)} punti${distance <= 3 ? ` (eri a ${distance.toFixed(1)} punti dal pareggio!)` : ''}`))
    }

    if (result === 'loss' && myRank === bestRank) {
      events.push(event('loss-as-best', -8, game, dayNumber, opponentName, myScore, opponentScore, result,
        `Sconfitta pur avendo il miglior punteggio del turno (${myScore.toFixed(1)} punti)`))
    }

    if (result === 'loss' && myRank >= totalTeams - 2 && myRank !== bestRank) {
      events.push(event('loss-as-top3', -4, game, dayNumber, opponentName, myScore, opponentScore, result,
        `Sconfitta pur essendo tra i migliori 3 punteggi (${myScore.toFixed(1)} punti)`))
    }

    if (result === 'win' && myRank <= 3) {
      events.push(event('win-as-worst', 3, game, dayNumber, opponentName, myScore, opponentScore, result,
        `Vittoria pur avendo uno dei peggiori punteggi del turno (${myScore.toFixed(1)} punti)`))
    }

    const secondBestRank = totalTeams - 1
    if (opponentRank === secondBestRank || opponentRank === bestRank) {
      const label = opponentRank === bestRank ? 'miglior' : 'secondo miglior'
      const modifier = result === 'win' ? -1 : result === 'draw' ? -2 : result === 'loss' && goalDiff === 1 ? -3 : 0
      if (modifier !== 0) {
        const detail = result === 'win'
          ? `Vittoria sfortunata contro il ${label} punteggio del turno (${opponentScore.toFixed(1)} punti)`
          : result === 'draw'
            ? `Pareggio sfortunato contro il ${label} punteggio del turno (${opponentScore.toFixed(1)} punti)`
            : `Sconfitta sfortunata di 1 goal contro il ${label} punteggio del turno (${opponentScore.toFixed(1)} punti)`
        events.push(event('loss-as-top3', modifier, game, dayNumber, opponentName, myScore, opponentScore, result, detail))
      }
    }

    return events
  }

  private static result(myGoals: number, opponentGoals: number): 'win' | 'draw' | 'loss' {
    if (myGoals > opponentGoals) return 'win'
    if (myGoals < opponentGoals) return 'loss'
    return 'draw'
  }

  private static addEvents(map: Map<string, TeamLuck>, owner: string, name: string, events: LuckEvent[]): void {
    const key = normalize(owner)
    const current = map.get(key) ?? { owner, name, totalLuck: 0, gamesPlayed: 0, avgLuck: 0, events: [] }
    current.gamesPlayed += 1
    current.events.push(...events)
    current.totalLuck += events.reduce((total, item) => total + item.points, 0)
    map.set(key, current)
  }
}

function nextGoalThreshold(goals: number): number {
  return (goals + 1) * 66
}

function event(
  type: LuckEvent['type'],
  points: number,
  game: CalendarGame,
  gameDay: number,
  opponent: string,
  myScore: number,
  opponentScore: number,
  result: LuckEvent['result'],
  detail: string,
): LuckEvent {
  return { type, points, gameId: game.id, gameDay, opponent, myScore, opponentScore, result, detail }
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}
