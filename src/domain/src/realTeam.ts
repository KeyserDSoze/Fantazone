export interface RealTeam {
  name: string
  abbreviation: string
}

/** Self-describing global Serie A team master-data document for one Fantasoccer season id. */
export interface RealTeams {
  year: number
  teams: RealTeam[]
}

export function getRealTeamAbbreviation(team: Pick<RealTeam, 'name' | 'abbreviation'>): string {
  const explicit = team.abbreviation?.trim().toLocaleLowerCase('it-IT') ?? ''
  if (explicit) return explicit
  const name = team.name?.trim().toLocaleLowerCase('it-IT') ?? ''
  return name.length < 3 ? name : name.slice(0, 3)
}

export function normalizeRealTeam(team: RealTeam): RealTeam {
  return {
    name: normalizeTeamName(team.name),
    abbreviation: getRealTeamAbbreviation(team),
  }
}

function normalizeTeamName(value: string): string {
  const normalized = value.trim().toLocaleLowerCase('it-IT')
  if (!normalized) return ''
  return normalized[0].toLocaleUpperCase('it-IT') + normalized.slice(1)
}
