import {
  DefaultOpeningCompetitionSettings,
  GroupHelper,
  TeamHelper,
  applyFormationPositions,
  calculateOpeningCompetitionPrizes,
  calculateTeamPoint,
  validateFormation,
  type AuthenticatedGroupSession,
  type FormationPositionUpdate,
  type Group,
  type OpeningCompetitionSettings,
  type OpeningCompetitionStandings,
  type Team,
} from '@fantazone/domain'
import type { GroupSessionRuntime } from './groupSessionRuntime'

export type OpeningCompetitionTeamResult = {
  team: Team
  owner: string
  basketId: string
  day: number
}

export async function prepareOpeningCompetition(
  runtime: GroupSessionRuntime,
  leagueId: string,
  year: number,
): Promise<OpeningCompetitionStandings> {
  const group = await runtime.refreshGroup()
  const { league, annual, settings } = requireOpeningCompetition(group, leagueId, year)
  const previousYear = year - 1
  const members = previousMembers(group, league.id, previousYear)

  for (const member of members) {
    const openingSnapshot = await runtime.openingCompetitionRepository.getTeamSnapshot(
      league.id, year, member.basketId, member.team.owner, { refresh: true },
    )
    if (openingSnapshot) continue
    const source = await runtime.teamRepository.getTeam(member.basketId, previousYear, member.team.owner, { refresh: true })
    if (!source) continue
    const snapshot: Team = {
      ...source,
      additionalOwners: [...(member.team.additionalOwners ?? [])],
      openingCompetitionPrize: 0,
      formationChanges: 0,
    }
    await runtime.openingCompetitionRepository.writeTeam(
      league.id, year, member.basketId, member.team.owner, snapshot,
      `opening: snapshot ${member.team.owner} from ${previousYear}`,
      { createOnly: true },
    )
  }

  const scores = new Map<string, number>(members.map(member => [normalize(member.team.owner), 0]))
  const leagueType = GroupHelper.getAnnualType(league, year)
  for (let day = 1; day <= settings.serieADays; day += 1) {
    const officialVotes = await runtime.officialVoteRepository.getVotes(year, day, { refresh: true })
    for (const member of members) {
      const dayTeam = await runtime.openingCompetitionRepository.getTeamDay(
        league.id, year, member.basketId, day, member.team.owner, { refresh: true },
      )
      const base = dayTeam ?? await runtime.openingCompetitionRepository.getTeam(
        league.id, year, member.basketId, member.team.owner, { refresh: true },
      )
      if (!base) continue
      const point = calculateTeamPoint({
        players: TeamHelper.getActivePlayers(base),
        officialVotes,
        leagueType,
        settings: annual.settings,
      }).point.value
      scores.set(normalize(member.team.owner), (scores.get(normalize(member.team.owner)) ?? 0) + point)
    }
  }

  const raw = members.map(member => ({
    owner: member.team.owner,
    name: member.team.name || null,
    score: scores.get(normalize(member.team.owner)) ?? 0,
  }))
  const prizes = calculateOpeningCompetitionPrizes(settings.prizes, raw)
  const result: OpeningCompetitionStandings = {
    group: group.id,
    league: league.id,
    year,
    serieADays: settings.serieADays,
    teams: raw
      .map(team => ({ ...team, prize: prizes[normalize(team.owner)] ?? 0 }))
      .sort((a, b) => b.score - a.score || a.name?.localeCompare(b.name ?? '', 'it-IT') || 0),
  }

  const existing = await runtime.openingCompetitionRepository.getStandingsSnapshot(league.id, year, { refresh: true })
  if (!existing || JSON.stringify(existing.value) !== JSON.stringify(result)) {
    await runtime.openingCompetitionRepository.writeStandings(
      league.id,
      year,
      result,
      `opening: update standings ${league.id} ${year}`,
      existing ? { expectedSha: existing.sha } : { createOnly: true },
    )
  }
  return result
}

export async function getOpeningCompetitionTeam(
  runtime: GroupSessionRuntime,
  session: AuthenticatedGroupSession,
  leagueId: string,
  year: number,
  day: number,
): Promise<OpeningCompetitionTeamResult> {
  const group = await runtime.refreshGroup()
  const { league, settings } = requireOpeningCompetition(group, leagueId, year)
  assertOpeningDay(day, settings)
  const member = findPreviousMemberForIdentity(group, league.id, year - 1, session.identity.email)
  if (!member) throw new Error('Non hai una squadra nel campionato iniziale.')

  let snapshot = await runtime.openingCompetitionRepository.getTeam(
    league.id, year, member.basketId, member.team.owner, { refresh: true },
  )
  if (!snapshot) {
    await prepareOpeningCompetition(runtime, leagueId, year)
    snapshot = await runtime.openingCompetitionRepository.getTeam(
      league.id, year, member.basketId, member.team.owner, { refresh: true },
    )
  }
  if (!snapshot) throw new Error('Rosa iniziale non disponibile dalla stagione precedente.')
  const dayTeam = await runtime.openingCompetitionRepository.getTeamDay(
    league.id, year, member.basketId, day, member.team.owner, { refresh: true },
  )
  return { team: normalizeOpeningTeam(dayTeam ?? snapshot, member.team), owner: member.team.owner, basketId: member.basketId, day }
}

export async function saveOpeningCompetitionTeam(
  runtime: GroupSessionRuntime,
  session: AuthenticatedGroupSession,
  leagueId: string,
  year: number,
  day: number,
  positions: readonly FormationPositionUpdate[],
): Promise<Team> {
  const group = await runtime.refreshGroup()
  const { league, settings } = requireOpeningCompetition(group, leagueId, year)
  assertOpeningDay(day, settings)
  const member = findPreviousMemberForIdentity(group, league.id, year - 1, session.identity.email)
  if (!member || !GroupHelper.isOwner(member.team, session.identity.email)) throw new Error('Non sei il proprietario o co-owner della squadra.')

  const current = await getOpeningCompetitionTeam(runtime, session, leagueId, year, day)
  const positioned = applyFormationPositions(current.team, positions)
  const validation = validateFormation(positioned)
  if (!validation.valid) throw new Error(validation.errors[0] ?? 'Formazione iniziale non valida.')
  const updated: Team = {
    ...positioned,
    owner: current.owner,
    additionalOwners: [...member.team.additionalOwners],
    formationChanges: 0,
    lastUpdate: new Date().toISOString(),
  }
  const existing = await runtime.openingCompetitionRepository.getTeamDaySnapshot(
    league.id, year, current.basketId, day, current.owner, { refresh: true },
  )
  await runtime.openingCompetitionRepository.writeTeamDay(
    league.id,
    year,
    current.basketId,
    day,
    current.owner,
    updated,
    `opening: save ${current.owner} day ${day}`,
    existing ? { expectedSha: existing.sha } : { createOnly: true },
  )
  await prepareOpeningCompetition(runtime, leagueId, year)
  return updated
}

function requireOpeningCompetition(group: Group, leagueId: string, year: number) {
  const league = group.leagues.find(item => item.id === leagueId)
  const annual = league?.years.find(item => item.year === year)
  const settings = normalizeOpeningSettings(annual?.settings.openingCompetition)
  if (!league || !annual || !league.isMain || !settings.enabled) throw new Error('Campionato iniziale non abilitato per questa lega/stagione.')
  return { league, annual, settings }
}

function normalizeOpeningSettings(value: OpeningCompetitionSettings | null | undefined): OpeningCompetitionSettings {
  return value ? {
    enabled: value.enabled === true,
    serieADays: value.serieADays ?? DefaultOpeningCompetitionSettings.serieADays,
    prizes: Array.isArray(value.prizes) ? value.prizes.map(prize => ({ ...prize })) : DefaultOpeningCompetitionSettings.prizes.map(prize => ({ ...prize })),
  } : {
    ...DefaultOpeningCompetitionSettings,
    prizes: DefaultOpeningCompetitionSettings.prizes.map(prize => ({ ...prize })),
  }
}

function previousMembers(group: Group, leagueId: string, previousYear: number) {
  const league = group.leagues.find(item => item.id === leagueId)
  if (!league) return []
  const unique = new Map<string, { basketId: string; team: import('@fantazone/domain').AnnualTeam }>()
  for (const basketId of league.basketsId) {
    const basket = group.baskets.find(item => item.id === basketId)
    const yearly = basket?.years.find(item => item.year === previousYear)
    for (const team of yearly?.teams ?? []) {
      const key = normalize(team.owner)
      if (key && !unique.has(key)) unique.set(key, { basketId, team })
    }
  }
  return [...unique.values()]
}

function findPreviousMemberForIdentity(group: Group, leagueId: string, previousYear: number, email: string) {
  return previousMembers(group, leagueId, previousYear).find(member => GroupHelper.isOwner(member.team, email)) ?? null
}

function normalizeOpeningTeam(team: Team, member: import('@fantazone/domain').AnnualTeam): Team {
  return {
    ...team,
    owner: member.owner,
    additionalOwners: [...(member.additionalOwners ?? [])],
    openingCompetitionPrize: 0,
    formationChanges: 0,
    players: team.players.map(player => ({ ...player, team: { ...player.team } })),
  }
}

function assertOpeningDay(day: number, settings: OpeningCompetitionSettings): void {
  if (!Number.isInteger(day) || day < 1 || day > settings.serieADays) throw new Error(`La giornata iniziale deve essere compresa tra 1 e ${settings.serieADays}.`)
}

function normalize(value: string): string { return value.trim().toLowerCase() }
