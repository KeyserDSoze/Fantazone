import {
  DefaultLeagueSetting,
  GroupHelper,
  IdentityRole,
  LeagueType,
  calculateRankFromCalendar,
  cloneLeagueSetting,
  copyAnnualLeagueToYear,
  createInitialLeagueCalendar,
  isLeagueSettingValid,
  upsertAnnualLeague,
  type AnnualTeam,
  type Group,
  type League,
  type LeagueSetting,
  type Rank,
  type UserOfAGroup,
} from '@fantazone/domain'
import {
  GROUP_RECALCULATION_WORKFLOW_PATH,
  GitHubClient,
  RepositoryWriteConflictError,
} from '@fantazone/github'

export type GroupLeagueAdminRuntime = {
  connection: { token: string; repository?: { default_branch: string } }
  target: { owner: string; repo: string; ref?: string }
  refreshGroup(): Promise<Group>
  groupRepository: { writeGroup(group: Group, message?: string): Promise<string> }
  calendarRepository: {
    getCalendar(leagueId: string, season: number, options?: { refresh?: boolean }): Promise<import('@fantazone/domain').Calendar | null>
    writeCalendar(leagueId: string, season: number, calendar: import('@fantazone/domain').Calendar, message?: string, options?: { createOnly?: boolean }): Promise<string>
  }
  rankRepository: {
    getRank(leagueId: string, season: number, options?: { refresh?: boolean }): Promise<Rank | null>
    writeRank(leagueId: string, season: number, rank: Rank, message?: string, options?: { createOnly?: boolean }): Promise<string>
  }
  hallOfFameRepository: {
    getHallOfFame(leagueId: string, options?: { refresh?: boolean }): Promise<unknown | null>
  }
}

export type LeagueInitializationResult = {
  group: Group
  leagueId: string
  season: number
  teamCount: number
  createdCalendar: boolean
  createdRank: boolean
}

export async function createGroupLeague(
  runtime: GroupLeagueAdminRuntime,
  actor: UserOfAGroup,
  input: { name: string; year: number; type?: LeagueType },
): Promise<{ group: Group; league: League }> {
  assertYear(input.year)
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const name = input.name.trim()
  if (!name) throw new Error('Il nome della lega non può essere vuoto.')
  if (group.leagues.some(league => normalize(league.name) === normalize(name))) throw new Error(`Esiste già una lega chiamata “${name}”.`)
  const type = input.type ?? LeagueType.League
  assertPlayableType(type)
  const league: League = {
    id: newLeagueId(),
    name,
    isMain: group.leagues.length === 0,
    type,
    years: [{ year: input.year, type, settings: cloneLeagueSetting(DefaultLeagueSetting) }],
    basketsId: [],
  }
  const updated = { ...group, leagues: [...group.leagues, league] }
  return { group: await save(runtime, updated, `chore: create league ${league.id}`), league }
}

export async function deleteGroupLeague(runtime: GroupLeagueAdminRuntime, actor: UserOfAGroup, leagueId: string): Promise<Group> {
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const league = requireLeague(group, leagueId)
  for (const annual of league.years) {
    const [calendar, rank] = await Promise.all([
      runtime.calendarRepository.getCalendar(league.id, annual.year, { refresh: true }),
      runtime.rankRepository.getRank(league.id, annual.year, { refresh: true }),
    ])
    if (calendar || rank) throw new Error(`La lega contiene dati canonici per ${annual.year} e non può essere eliminata.`)
  }
  if (await runtime.hallOfFameRepository.getHallOfFame(league.id, { refresh: true })) {
    throw new Error('La lega ha già uno storico Hall of Fame e non può essere eliminata automaticamente.')
  }
  const remaining = group.leagues.filter(item => item.id !== league.id)
  if (league.isMain && remaining.length > 0 && !remaining.some(item => item.isMain)) remaining[0] = { ...remaining[0], isMain: true }
  return save(runtime, { ...group, leagues: remaining }, `chore: delete league ${league.id}`)
}

export async function setMainGroupLeague(runtime: GroupLeagueAdminRuntime, actor: UserOfAGroup, leagueId: string): Promise<Group> {
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  requireLeague(group, leagueId)
  return save(runtime, {
    ...group,
    leagues: group.leagues.map(league => ({ ...league, isMain: league.id === leagueId })),
  }, `chore: set main league ${leagueId}`)
}

export async function toggleLeagueBasket(
  runtime: GroupLeagueAdminRuntime,
  actor: UserOfAGroup,
  leagueId: string,
  basketId: string,
): Promise<Group> {
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const league = requireLeague(group, leagueId)
  if (!group.baskets.some(basket => basket.id === basketId)) throw new Error('Basket non trovato.')
  await assertLeagueStructureMutable(runtime, league)
  const linked = league.basketsId.includes(basketId)
  const next = { ...league, basketsId: linked ? league.basketsId.filter(id => id !== basketId) : [...league.basketsId, basketId] }
  return save(runtime, replaceLeague(group, next), `chore: ${linked ? 'unlink' : 'link'} basket ${basketId} ${league.id}`)
}

export async function initializeLeagueYearDefaults(
  runtime: GroupLeagueAdminRuntime,
  actor: UserOfAGroup,
  leagueId: string,
  year: number,
): Promise<Group> {
  assertYear(year)
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const league = requireLeague(group, leagueId)
  if (league.years.some(annual => annual.year === year)) throw new Error('La stagione è già configurata per questa lega.')
  const annual = { year, type: league.type, settings: cloneLeagueSetting(DefaultLeagueSetting) }
  return save(runtime, replaceLeague(group, { ...league, years: upsertAnnualLeague(league.years, annual) }), `chore: initialize league ${league.id} ${year}`)
}

export async function copyLeagueYearFromPrevious(
  runtime: GroupLeagueAdminRuntime,
  actor: UserOfAGroup,
  leagueId: string,
  year: number,
): Promise<Group> {
  assertYear(year)
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const league = requireLeague(group, leagueId)
  if (league.years.some(annual => annual.year === year)) throw new Error('La stagione è già configurata per questa lega.')
  const previous = league.years.filter(annual => annual.year < year).sort((a, b) => b.year - a.year)[0]
  if (!previous) throw new Error('Non esiste una stagione precedente da copiare.')
  const annual = copyAnnualLeagueToYear(previous, year, league.type)
  return save(runtime, replaceLeague(group, { ...league, years: upsertAnnualLeague(league.years, annual) }), `chore: copy league settings ${league.id} ${year}`)
}

export async function setAnnualLeagueType(
  runtime: GroupLeagueAdminRuntime,
  actor: UserOfAGroup,
  leagueId: string,
  year: number,
  type: LeagueType,
): Promise<Group> {
  assertYear(year)
  assertPlayableType(type)
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const league = requireLeague(group, leagueId)
  const annual = league.years.find(item => item.year === year)
  if (!annual) throw new Error('Configura prima questa stagione della lega.')
  await assertLeagueYearStructureMutable(runtime, league.id, year)
  const next = { ...annual, type }
  return save(runtime, replaceLeague(group, { ...league, years: upsertAnnualLeague(league.years, next) }), `chore: update league type ${league.id} ${year}`)
}

export async function saveAnnualLeagueSettings(
  runtime: GroupLeagueAdminRuntime,
  actor: UserOfAGroup,
  leagueId: string,
  year: number,
  settings: LeagueSetting,
): Promise<Group> {
  assertYear(year)
  if (!isLeagueSettingValid(settings)) throw new Error('Le impostazioni della lega non sono valide.')
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const league = requireLeague(group, leagueId)
  const annual = league.years.find(item => item.year === year)
  if (!annual) throw new Error('Configura prima questa stagione della lega.')
  const next = { ...annual, settings: cloneLeagueSetting(settings) }
  return save(runtime, replaceLeague(group, { ...league, years: upsertAnnualLeague(league.years, next) }), `chore: update league settings ${league.id} ${year}`)
}

export async function initializeLeagueCalendarAndRank(
  runtime: GroupLeagueAdminRuntime,
  actor: UserOfAGroup,
  leagueId: string,
  year: number,
): Promise<LeagueInitializationResult> {
  assertYear(year)
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const league = requireLeague(group, leagueId)
  const annual = league.years.find(item => item.year === year)
  if (!annual) throw new Error('Configura prima questa stagione della lega.')
  const type = GroupHelper.getAnnualType(league, year)
  assertPlayableType(type)
  const allTeams = gatherLeagueTeams(group, league, year)
  if (allTeams.length < 2) throw new Error('Servono almeno due squadre nei basket collegati.')
  assertUniqueOwners(allTeams)
  const selectedTeams = type === LeagueType.Cup ? await selectClassicCupTeams(runtime, group, league, year, allTeams) : allTeams
  if (type === LeagueType.NewCup && selectedTeams.length < 16) throw new Error('La NewCup richiede almeno 16 squadre.')

  let calendar = await runtime.calendarRepository.getCalendar(league.id, year, { refresh: true })
  let createdCalendar = false
  if (calendar) {
    assertCalendarRosterCompatible(calendar, selectedTeams, type)
  } else {
    const candidate = createInitialLeagueCalendar({
      year,
      leagueType: type,
      settings: annual.settings,
      teams: selectedTeams,
      seed: `${group.id}|${league.id}|${year}`,
    })
    try {
      await runtime.calendarRepository.writeCalendar(league.id, year, candidate, `calendar: initialize ${league.id} ${year}`, { createOnly: true })
      calendar = candidate
      createdCalendar = true
    } catch (error) {
      if (!(error instanceof RepositoryWriteConflictError)) throw error
      const concurrent = await runtime.calendarRepository.getCalendar(league.id, year, { refresh: true })
      if (!concurrent) throw error
      assertCalendarRosterCompatible(concurrent, selectedTeams, type)
      calendar = concurrent
    }
  }

  let existingRank = await runtime.rankRepository.getRank(league.id, year, { refresh: true })
  let createdRank = false
  if (!existingRank) {
    const rank = calculateRankFromCalendar(calendar, annual.settings, excludedRankRounds(type))
    try {
      await runtime.rankRepository.writeRank(league.id, year, rank, `rank: initialize ${league.id} ${year}`, { createOnly: true })
      existingRank = rank
      createdRank = true
    } catch (error) {
      if (!(error instanceof RepositoryWriteConflictError)) throw error
      existingRank = await runtime.rankRepository.getRank(league.id, year, { refresh: true })
      if (!existingRank) throw error
    }
  }

  return { group: await runtime.refreshGroup(), leagueId: league.id, season: year, teamCount: selectedTeams.length, createdCalendar, createdRank }
}

export async function dispatchGroupRecalculation(
  runtime: GroupLeagueAdminRuntime,
  actor: UserOfAGroup,
  input: { season: number; day?: number },
): Promise<void> {
  assertYear(input.season)
  if (input.day != null && (!Number.isInteger(input.day) || input.day < 1 || input.day > 38)) throw new Error('La giornata deve essere compresa tra 1 e 38.')
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const workflow = GROUP_RECALCULATION_WORKFLOW_PATH.split('/').at(-1)
  if (!workflow) throw new Error('Workflow di manutenzione del gruppo non configurato.')
  const ref = runtime.target.ref?.trim() || runtime.connection.repository?.default_branch?.trim()
  if (!ref) throw new Error('Branch del repository di gruppo non disponibile.')
  const inputs: Record<string, string> = {
    job: input.day == null ? 'recalculate-all' : 'recalculate-day',
    season: String(input.season),
  }
  if (input.day != null) inputs.day = String(input.day)
  await new GitHubClient(runtime.connection.token).dispatchWorkflow(runtime.target.owner, runtime.target.repo, workflow, ref, inputs)
}

function gatherLeagueTeams(group: Group, league: League, year: number): AnnualTeam[] {
  const baskets = new Set(league.basketsId)
  return group.baskets
    .filter(basket => baskets.has(basket.id))
    .flatMap(basket => basket.years.find(item => item.year === year)?.teams ?? [])
    .map(team => ({ ...team, additionalOwners: [...team.additionalOwners] }))
}

async function selectClassicCupTeams(
  runtime: GroupLeagueAdminRuntime,
  group: Group,
  league: League,
  year: number,
  teams: AnnualTeam[],
): Promise<AnnualTeam[]> {
  if (teams.length < 16) throw new Error('La Coppa classica richiede almeno 16 squadre.')
  if (teams.length === 16) return teams
  const byOwner = new Map(teams.map(team => [normalize(team.owner), team]))
  const seeded: AnnualTeam[] = []
  for (const main of group.leagues.filter(item => item.isMain)) {
    const previous = main.years.filter(annual => annual.year < year).sort((a, b) => b.year - a.year)[0]
    if (!previous) continue
    const rank = await runtime.rankRepository.getRank(main.id, previous.year, { refresh: true })
    if (!rank) continue
    const ranked = Object.values(rank.rounds).flat().slice().sort((a, b) => b.point - a.point || b.valuePoint - a.valuePoint || b.goal - a.goal)
    for (const entry of ranked) {
      const team = byOwner.get(normalize(entry.owner))
      if (team && !seeded.some(item => same(item.owner, team.owner))) seeded.push(team)
      if (seeded.length >= 8) break
    }
    if (seeded.length >= 8) break
  }
  const remaining = teams
    .filter(team => !seeded.some(item => same(item.owner, team.owner)))
    .sort((a, b) => seededOrder(`${group.id}|${league.id}|${year}|${a.owner}`) - seededOrder(`${group.id}|${league.id}|${year}|${b.owner}`))
  return [...seeded, ...remaining].slice(0, 16)
}

function assertCalendarRosterCompatible(calendar: import('@fantazone/domain').Calendar, teams: AnnualTeam[], type: LeagueType): void {
  const owners = new Set(Object.values(calendar.rounds).flatMap(days => days.flatMap(day => day.games.flatMap(game => [normalize(game.homeOwner), normalize(game.awayOwner)]))))
  const expected = new Set(teams.map(team => normalize(team.owner)))
  if (type === LeagueType.Cup) {
    if (owners.size !== 16 || [...owners].some(owner => !expected.has(owner))) throw new Error('Il Calendar esistente non corrisponde più al roster disponibile della Coppa.')
    return
  }
  if (owners.size !== expected.size || [...owners].some(owner => !expected.has(owner))) {
    throw new Error('Il Calendar esistente non corrisponde più al roster configurato. Non viene sovrascritto automaticamente.')
  }
}

async function assertLeagueStructureMutable(runtime: GroupLeagueAdminRuntime, league: League): Promise<void> {
  for (const annual of league.years) await assertLeagueYearStructureMutable(runtime, league.id, annual.year)
}

async function assertLeagueYearStructureMutable(runtime: GroupLeagueAdminRuntime, leagueId: string, year: number): Promise<void> {
  const [calendar, rank] = await Promise.all([
    runtime.calendarRepository.getCalendar(leagueId, year, { refresh: true }),
    runtime.rankRepository.getRank(leagueId, year, { refresh: true }),
  ])
  if (calendar || rank) throw new Error(`La struttura della lega per ${year} è già materializzata. Calendar/Rank non vengono riscritti implicitamente.`)
}

function excludedRankRounds(type: LeagueType): string[] {
  if (type === LeagueType.Cup) return ['Finals']
  if (type === LeagueType.NewCup) return ['Finals', 'Europa League', 'Supercoppa']
  return []
}

function assertUniqueOwners(teams: AnnualTeam[]): void {
  const owners = new Set<string>()
  for (const team of teams) {
    const owner = normalize(team.owner)
    if (owners.has(owner)) throw new Error(`Owner duplicato nei basket collegati: ${team.owner}`)
    owners.add(owner)
  }
}

function requireSuperAdmin(group: Group, email: string): UserOfAGroup {
  const member = GroupHelper.findUserByEmail(group, email)
  if (!member || !GroupHelper.hasRole(member, IdentityRole.SuperAdmin)) throw new Error('Solo un SuperAdmin può modificare le leghe del gruppo.')
  return member
}

function requireLeague(group: Group, leagueId: string): League {
  const league = group.leagues.find(item => item.id === leagueId)
  if (!league) throw new Error('Lega non trovata.')
  return league
}

function assertPlayableType(type: LeagueType): void {
  if (![LeagueType.League, LeagueType.Cup, LeagueType.NewCup, LeagueType.SuperLeague, LeagueType.FutsalLeague].includes(type)) {
    throw new Error('Tipo di lega non valido.')
  }
}

function replaceLeague(group: Group, league: League): Group {
  return { ...group, leagues: group.leagues.map(item => item.id === league.id ? league : item) }
}

async function save(runtime: GroupLeagueAdminRuntime, group: Group, message: string): Promise<Group> {
  await runtime.groupRepository.writeGroup(group, message)
  return runtime.refreshGroup()
}

function assertYear(year: number): void { if (!Number.isInteger(year) || year < 1) throw new Error('Stagione non valida.') }
function newLeagueId(): string { return `league-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }
function normalize(value: string): string { return value.trim().toLowerCase() }
function same(a: string, b: string): boolean { return normalize(a) === normalize(b) }
function seededOrder(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return hash >>> 0
}
