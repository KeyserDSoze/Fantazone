import type { OpeningCompetitionPrize } from './group'

export interface OpeningCompetitionStanding {
  owner: string
  name: string | null
  score: number
  prize: number
}

export interface OpeningCompetitionStandings {
  group: string
  league: string
  year: number
  serieADays: number
  teams: OpeningCompetitionStanding[]
}

export function calculateOpeningCompetitionPrizes(
  rules: readonly OpeningCompetitionPrize[],
  standings: readonly { owner: string; score: number }[],
): Record<string, number> {
  const prizeByPosition = new Map(rules.map(rule => [rule.position, rule.credits] as const))
  const result: Record<string, number> = {}
  for (const standing of standings) {
    const position = standings.filter(candidate => candidate.score > standing.score).length + 1
    result[normalize(standing.owner)] = prizeByPosition.get(position) ?? 0
  }
  return result
}

export function getOpeningCompetitionPrize(
  rules: readonly OpeningCompetitionPrize[],
  score: number,
  standings: readonly { owner: string; score: number }[],
): number {
  const position = standings.filter(candidate => candidate.score > score).length + 1
  return rules.find(rule => rule.position === position)?.credits ?? 0
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}
