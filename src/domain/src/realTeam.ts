export interface RealTeamRaw {
  n: string
  a: string
}

export interface RealTeam {
  name: string
  abbreviation: string
}

export const mapRawRealTeamToRealTeam = (raw: RealTeamRaw): RealTeam => ({
  name: raw.n,
  abbreviation: raw.a,
})

export const mapRealTeamToRawRealTeam = (team: RealTeam): RealTeamRaw => ({
  n: team.name,
  a: team.abbreviation,
})
