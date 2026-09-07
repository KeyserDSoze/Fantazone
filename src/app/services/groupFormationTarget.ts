import {
  CalendarHelper,
  GameResultHelper,
  GroupHelper,
  RealCalendarHelper,
  type Calendar,
  type CalendarDay,
  type CalendarGame,
  type Group,
  type RealCalendar,
} from '@fantazone/domain'

export type FormationTarget = {
  basketId: string
  owner: string
  teamName: string
  gameId: string
  fantasyDay: number
  serieADay: number
}

export function resolveFormationTarget(input: {
  group: Group
  leagueId: string
  season: number
  identityEmail: string
  calendar: Calendar
  realCalendar: RealCalendar | null
  now?: Date
}): FormationTarget | null {
  const annualTeam = findOwnedAnnualTeam(input.group, input.leagueId, input.season, input.identityEmail)
  if (!annualTeam) return null

  const allDays = CalendarHelper.getAllDays(input.calendar)
  const ownedGames = allDays.flatMap(day => day.games
    .filter(game => isOwnerGame(game, annualTeam.owner))
    .map(game => ({ day, game })))
  if (ownedGames.length === 0) return null

  const now = input.now ?? new Date()
  const context = input.realCalendar ? RealCalendarHelper.context(input.realCalendar, now) : null
  const targetSerieADay = context?.liveDay?.serieADay
    ?? context?.nextDay?.serieADay
    ?? context?.lastDay?.serieADay
    ?? null

  const exact = targetSerieADay == null
    ? null
    : ownedGames.find(entry => entry.day.serieADay === targetSerieADay) ?? null

  const target = exact
    ?? chooseFallbackGame(ownedGames, targetSerieADay)
  if (!target) return null

  return {
    basketId: annualTeam.basketId,
    owner: annualTeam.owner,
    teamName: annualTeam.teamName,
    gameId: target.game.id,
    fantasyDay: target.day.number,
    serieADay: target.day.serieADay,
  }
}

function findOwnedAnnualTeam(group: Group, leagueId: string, season: number, identityEmail: string) {
  const league = group.leagues.find(item => item.id === leagueId) ?? null
  const allowedBasketIds = new Set(league?.basketsId ?? [])
  const restrictToLeague = allowedBasketIds.size > 0

  for (const basket of group.baskets) {
    if (restrictToLeague && !allowedBasketIds.has(basket.id)) continue
    const yearly = basket.years.find(item => item.year === season)
    if (!yearly) continue
    const team = yearly.teams.find(item => GroupHelper.isOwner(item, identityEmail))
    if (team) return { basketId: basket.id, owner: team.owner, teamName: team.name }
  }
  return null
}

function chooseFallbackGame(
  entries: Array<{ day: CalendarDay; game: CalendarGame }>,
  targetSerieADay: number | null,
) {
  const ordered = [...entries].sort((a, b) =>
    a.day.serieADay - b.day.serieADay || a.day.number - b.day.number || a.game.number - b.game.number)

  const pending = ordered.filter(entry => !GameResultHelper.hasValue(entry.game.result))
  if (targetSerieADay != null) {
    const future = pending.find(entry => entry.day.serieADay >= targetSerieADay)
    if (future) return future
  }
  return pending[0] ?? ordered[ordered.length - 1] ?? null
}

function isOwnerGame(game: CalendarGame, owner: string): boolean {
  const target = normalizeEmail(owner)
  return normalizeEmail(game.homeOwner) === target || normalizeEmail(game.awayOwner) === target
}

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}
