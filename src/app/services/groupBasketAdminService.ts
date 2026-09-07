import {
  GroupHelper,
  IdentityRole,
  type AnnualTeam,
  type Basket,
  type Calendar,
  type Group,
  type UserOfAGroup,
} from '@fantazone/domain'

export type GroupBasketAdminRuntime = {
  refreshGroup(): Promise<Group>
  groupRepository: {
    writeGroup(group: Group, message?: string): Promise<string>
  }
  teamRepository: {
    getTeam(basketId: string, season: number, email: string, options?: { refresh?: boolean }): Promise<unknown | null>
  }
  calendarRepository: {
    getCalendar(leagueId: string, season: number, options?: { refresh?: boolean }): Promise<Calendar | null>
  }
}

export type CopyPreviousTeamsResult = {
  group: Group
  copied: number
  skipped: string[]
}

export async function createGroupBasket(
  runtime: GroupBasketAdminRuntime,
  actor: UserOfAGroup,
  name: string,
  year: number,
): Promise<{ group: Group; basket: Basket }> {
  assertYear(year)
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const normalizedName = name.trim()
  if (!normalizedName) throw new Error('Il nome del basket non può essere vuoto.')
  if (group.baskets.some(basket => normalize(basket.name) === normalize(normalizedName))) {
    throw new Error(`Esiste già un basket chiamato “${normalizedName}”.`)
  }
  const basket: Basket = { id: newBasketId(), name: normalizedName, years: [{ year, teams: [] }] }
  const updated = { ...group, baskets: [...group.baskets, basket] }
  return { group: await save(runtime, updated, `chore: create basket ${basket.id}`), basket }
}

export async function deleteGroupBasket(
  runtime: GroupBasketAdminRuntime,
  actor: UserOfAGroup,
  basketId: string,
): Promise<Group> {
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const basket = requireBasket(group, basketId)
  const linkedLeagues = group.leagues.filter(league => league.basketsId.includes(basket.id))
  if (linkedLeagues.length > 0) {
    throw new Error(`Il basket è usato da ${linkedLeagues.map(league => league.name).join(', ')}. Rimuovilo prima dalle leghe.`)
  }
  const teamCount = basket.years.reduce((total, yearly) => total + yearly.teams.length, 0)
  if (teamCount > 0) throw new Error('Il basket contiene ancora squadre e non può essere eliminato.')
  const updated = { ...group, baskets: group.baskets.filter(item => item.id !== basket.id) }
  return save(runtime, updated, `chore: delete basket ${basket.id}`)
}

export async function addAnnualTeam(
  runtime: GroupBasketAdminRuntime,
  actor: UserOfAGroup,
  input: { basketId: string; year: number; name: string; owner: string },
): Promise<Group> {
  assertYear(input.year)
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const basket = requireBasket(group, input.basketId)
  const owner = requireActiveMember(group, input.owner).email
  const teamName = input.name.trim()
  if (!teamName) throw new Error('Il nome della squadra non può essere vuoto.')
  const assignment = findAssignment(group, owner, input.year)
  if (assignment) {
    throw new Error(`${owner} è già assegnato a ${assignment.team.name} nel basket ${assignment.basket.name} per questa stagione.`)
  }
  const team: AnnualTeam = { name: teamName, owner, additionalOwners: [] }
  const updatedBasket = upsertYear(basket, input.year, teams => [...teams, team])
  return save(runtime, replaceBasket(group, updatedBasket), `chore: add team ${owner} ${input.year}`)
}

export async function removeAnnualTeam(
  runtime: GroupBasketAdminRuntime,
  actor: UserOfAGroup,
  input: { basketId: string; year: number; owner: string },
): Promise<Group> {
  assertYear(input.year)
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const basket = requireBasket(group, input.basketId)
  const yearly = basket.years.find(item => item.year === input.year)
  const team = yearly?.teams.find(item => same(item.owner, input.owner))
  if (!yearly || !team) throw new Error('Squadra annuale non trovata.')
  await assertTeamCanBeRemoved(runtime, group, basket.id, input.year, team.owner)
  const updatedBasket = upsertYear(basket, input.year, teams => teams.filter(item => !same(item.owner, team.owner)))
  return save(runtime, replaceBasket(group, updatedBasket), `chore: remove team ${team.owner} ${input.year}`)
}

export async function toggleAnnualTeamCoOwner(
  runtime: GroupBasketAdminRuntime,
  actor: UserOfAGroup,
  input: { basketId: string; year: number; owner: string; coOwner: string },
): Promise<Group> {
  assertYear(input.year)
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const basket = requireBasket(group, input.basketId)
  const yearly = basket.years.find(item => item.year === input.year)
  const team = yearly?.teams.find(item => same(item.owner, input.owner))
  if (!yearly || !team) throw new Error('Squadra annuale non trovata.')
  const member = requireActiveMember(group, input.coOwner)
  if (same(member.email, team.owner)) throw new Error('L’owner principale non può essere aggiunto anche come co-owner.')
  const alreadyAssigned = team.additionalOwners.some(email => same(email, member.email))
  if (!alreadyAssigned) {
    const assignment = findAssignment(group, member.email, input.year, { basketId: basket.id, owner: team.owner })
    if (assignment) {
      throw new Error(`${member.email} è già assegnato a ${assignment.team.name} nel basket ${assignment.basket.name}.`)
    }
  }
  const updatedBasket = upsertYear(basket, input.year, teams => teams.map(item => {
    if (!same(item.owner, team.owner)) return item
    return {
      ...item,
      additionalOwners: alreadyAssigned
        ? item.additionalOwners.filter(email => !same(email, member.email))
        : [...item.additionalOwners, member.email],
    }
  }))
  return save(runtime, replaceBasket(group, updatedBasket), `chore: update co-owner ${team.owner} ${input.year}`)
}

export async function copyAnnualTeamsFromPreviousYear(
  runtime: GroupBasketAdminRuntime,
  actor: UserOfAGroup,
  input: { basketId: string; year: number },
): Promise<CopyPreviousTeamsResult> {
  assertYear(input.year)
  const group = await runtime.refreshGroup()
  requireSuperAdmin(group, actor.email)
  const basket = requireBasket(group, input.basketId)
  const previous = basket.years.find(item => item.year === input.year - 1)
  if (!previous || previous.teams.length === 0) throw new Error('Nessuna squadra disponibile nella stagione precedente.')
  const current = basket.years.find(item => item.year === input.year)?.teams ?? []
  const copied: AnnualTeam[] = []
  const skipped: string[] = []
  for (const team of previous.teams) {
    const identities = [team.owner, ...team.additionalOwners]
    const conflict = identities.find(email => findAssignment(group, email, input.year))
    if (conflict || current.some(existing => same(existing.owner, team.owner))) {
      skipped.push(team.name)
      continue
    }
    copied.push({ ...team, additionalOwners: [...team.additionalOwners] })
  }
  if (copied.length === 0) return { group, copied: 0, skipped }
  const updatedBasket = upsertYear(basket, input.year, teams => [...teams, ...copied])
  return {
    group: await save(runtime, replaceBasket(group, updatedBasket), `chore: copy teams ${input.year - 1} to ${input.year}`),
    copied: copied.length,
    skipped,
  }
}

async function assertTeamCanBeRemoved(
  runtime: GroupBasketAdminRuntime,
  group: Group,
  basketId: string,
  year: number,
  owner: string,
): Promise<void> {
  const current = await runtime.teamRepository.getTeam(basketId, year, owner, { refresh: true })
  if (current) {
    throw new Error('Esiste già il Team canonico della stagione. La squadra non può essere rimossa dall’anagrafica senza una migrazione esplicita dei dati.')
  }
  const linkedLeagues = group.leagues.filter(league => league.basketsId.includes(basketId))
  for (const league of linkedLeagues) {
    const calendar = await runtime.calendarRepository.getCalendar(league.id, year, { refresh: true })
    if (!calendar) continue
    const used = Object.values(calendar.rounds).flatMap(days => days.flatMap(day => day.games))
      .some(game => same(game.homeOwner, owner) || same(game.awayOwner, owner))
    if (used) throw new Error(`La squadra è già presente nel calendario di ${league.name} e non può essere rimossa.`)
  }
}

function findAssignment(
  group: Group,
  email: string,
  year: number,
  exclude?: { basketId: string; owner: string },
): { basket: Basket; team: AnnualTeam } | null {
  for (const basket of group.baskets) {
    const yearly = basket.years.find(item => item.year === year)
    if (!yearly) continue
    for (const team of yearly.teams) {
      if (exclude && basket.id === exclude.basketId && same(team.owner, exclude.owner)) continue
      if (GroupHelper.isOwner(team, email)) return { basket, team }
    }
  }
  return null
}

function requireSuperAdmin(group: Group, email: string): UserOfAGroup {
  const member = GroupHelper.findUserByEmail(group, email)
  if (!member || !GroupHelper.hasRole(member, IdentityRole.SuperAdmin)) {
    throw new Error('Solo un SuperAdmin può modificare basket e squadre del gruppo.')
  }
  return member
}

function requireActiveMember(group: Group, email: string): UserOfAGroup {
  const member = GroupHelper.findUserByEmail(group, email)
  if (!member || member.role === IdentityRole.None) throw new Error(`${email.trim()} non è un utente attivo del gruppo.`)
  return member
}

function requireBasket(group: Group, basketId: string): Basket {
  const basket = group.baskets.find(item => item.id === basketId)
  if (!basket) throw new Error('Basket non trovato.')
  return basket
}

function upsertYear(basket: Basket, year: number, mutate: (teams: AnnualTeam[]) => AnnualTeam[]): Basket {
  const existing = basket.years.find(item => item.year === year)
  return {
    ...basket,
    years: existing
      ? basket.years.map(item => item.year === year ? { ...item, teams: mutate(item.teams) } : item)
      : [...basket.years, { year, teams: mutate([]) }].sort((a, b) => a.year - b.year),
  }
}

function replaceBasket(group: Group, basket: Basket): Group {
  return { ...group, baskets: group.baskets.map(item => item.id === basket.id ? basket : item) }
}

async function save(runtime: GroupBasketAdminRuntime, group: Group, message: string): Promise<Group> {
  await runtime.groupRepository.writeGroup(group, message)
  return runtime.refreshGroup()
}

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 1) throw new Error('Stagione non valida.')
}

function newBasketId(): string {
  return `basket-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function same(first: string, second: string): boolean { return normalize(first) === normalize(second) }
function normalize(value: string): string { return value.trim().toLowerCase() }
