import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  FantaSoccerRole,
  GroupHelper,
  LeagueType,
  PlayerInTeamStatus,
  advanceEvolutionPlayerSeasonState,
  assignEvolutionCoachDecks,
  calculateDefinitiveDay,
  calculateRankFromCalendar,
  calculateTeamPoint,
  createEvolutionPlayerSeasonState,
  getCurrentSeasonYear,
  getEvolutionPlayerMatchState,
  getPlayerKey,
  progressLeagueCalendar,
  resolveFantazoneEvolutionSettings,
  type Calendar,
  type DefinitiveDayEvolutionGameContext,
  type EvolutionCardSelection,
  type EvolutionPlayerSeasonState,
  type EvolutionRuleTrace,
  type EvolutionSeasonCoachDeckDocument,
  type EvolutionSeasonSkillDocument,
  type Group,
  type LeagueSetting,
  type Rank,
  type RealCalendar,
  type RealDay,
  type Team,
  type VotedRealPlayers,
} from '@fantazone/domain'
import {
  GROUP_DOCUMENT_PATH,
  calendarDocumentPath,
  dailyRankDocumentPath,
  dayTeamDocumentPath,
  decodeRealCalendar,
  decodeVotedRealPlayers,
  evolutionCardsPath,
  evolutionPlayerStatePath,
  evolutionSkillsPath,
  evolutionTracePath,
  isGroupDocument,
  realCalendarDocumentPath,
  seasonRankDocumentPath,
  serieAVoteDocumentPath,
  type EvolutionCardsDocument,
  type EvolutionPlayerStateDocument,
  type EvolutionTraceDocument,
} from '@fantazone/github'
import { getAuthoritativeEvolutionCardIds } from './evolutionCardAuthority'

export type GroupRecalculationOptions = {
  groupRepoRoot: string
  platformRepoRoot: string
  season?: number
  day?: number
  now?: Date
}

export type GroupLeagueRecalculationResult = {
  leagueId: string
  calculatedSerieADays: number[]
  progressionChanged: boolean
  calendarPath: string
  rankPath: string
  dailyRankPaths: string[]
}

export type GroupRecalculationResult = {
  season: number
  leagues: GroupLeagueRecalculationResult[]
}

export async function recalculateGroupDay(options: GroupRecalculationOptions): Promise<GroupRecalculationResult> {
  if (!options.day || !Number.isInteger(options.day) || options.day < 1 || options.day > 38) {
    throw new Error('recalculate-day requires a Serie A day between 1 and 38')
  }
  return recalculateGroup({ ...options, requiredDay: options.day })
}

export async function recalculateGroupAll(options: GroupRecalculationOptions): Promise<GroupRecalculationResult> {
  return recalculateGroup({ ...options, requiredDay: null })
}

async function recalculateGroup(
  options: GroupRecalculationOptions & { requiredDay: number | null },
): Promise<GroupRecalculationResult> {
  const season = options.season ?? getCurrentSeasonYear(options.now ?? new Date())
  assertSeason(season)
  const group = await readGroup(options.groupRepoRoot)
  const results: GroupLeagueRecalculationResult[] = []

  for (const league of group.leagues) {
    if (!league.years.some(year => year.year === season)) continue
    const calendarPath = resolve(options.groupRepoRoot, calendarDocumentPath(league.id, season))
    const calendar = await readOptionalJson<Calendar>(calendarPath)
    if (!calendar) continue
    if (calendar.year !== season) {
      throw new Error(`Calendar ${league.id} year mismatch: expected ${season}, found ${calendar.year}`)
    }

    const annual = GroupHelper.getAnnualLeague(group, league.id, season)
    if (!annual) continue
    const settings = annual.settings
    const leagueType = GroupHelper.getAnnualType(league, season)
    const evolution = resolveFantazoneEvolutionSettings(settings)
    const skillDocument = evolution.enabled && evolution.playerSkills.enabled
      ? await readOptionalJson<EvolutionSeasonSkillDocument>(resolve(options.groupRepoRoot, evolutionSkillsPath(league.id, season)))
      : null
    const realCalendar = evolution.enabled && evolution.coachCards.enabled
      ? await readRealCalendar(options.platformRepoRoot, season)
      : null
    const coachDeck = evolution.enabled && evolution.coachCards.enabled && evolution.coachCards.cardsInSeasonDeck > 0
      ? assignEvolutionCoachDecks(
          league.id,
          leagueOwners(group, league.id, season),
          settings,
          season,
          '1970-01-01T00:00:00.000Z',
        )
      : null
    const candidateDays = uniqueSerieADays(calendar)
      .filter(day => options.requiredDay == null || day === options.requiredDay)
    if (options.requiredDay != null && !candidateDays.includes(options.requiredDay)) continue

    const calculatedSerieADays: number[] = []
    for (const serieADay of candidateDays) {
      const officialVotes = await readOfficialVotes(options.platformRepoRoot, season, serieADay)
      if (!officialVotes) {
        if (options.requiredDay != null) {
          throw new Error(
            `Official votes ${season}/${serieADay} non trovati. Esegui prima ingest-final-votes; nessun risultato fantasy è stato scritto.`,
          )
        }
        continue
      }

      const cards = evolution.enabled && evolution.coachCards.enabled
        ? await readOptionalJson<EvolutionCardsDocument>(resolve(options.groupRepoRoot, evolutionCardsPath(league.id, season, serieADay)))
        : null
      const consumedCardsBefore = evolution.enabled && evolution.coachCards.enabled
        ? await rebuildEvolutionConsumedCards(
            options.groupRepoRoot,
            league.id,
            season,
            serieADay - 1,
            settings,
            coachDeck,
            realCalendar,
          )
        : new Map<string, string[]>()
      const realDay = realCalendar?.days.find(day => day.serieADay === serieADay) ?? null
      const cardSelections = evolution.enabled && evolution.coachCards.enabled && cards
        ? await buildAuthoritativeCardSelectionsForDay(
            options.groupRepoRoot,
            league.id,
            season,
            serieADay,
            settings,
            cards,
            coachDeck,
            consumedCardsBefore,
            realDay,
          )
        : new Map<string, EvolutionCardSelection>()
      const stateBefore = evolution.enabled
        ? await rebuildEvolutionStatesForLeague(
            options.groupRepoRoot,
            options.platformRepoRoot,
            group,
            league.id,
            season,
            serieADay - 1,
            settings,
            leagueType,
          )
        : new Map<string, EvolutionPlayerStateDocument>()
      const traces = new Map<string, EvolutionRuleTrace[]>()
      let changed = false

      for (const [roundKey, days] of Object.entries(calendar.rounds)) {
        for (let index = 0; index < days.length; index += 1) {
          const day = days[index]
          if (day.serieADay !== serieADay) continue
          const teamsByOwner = await loadTeamsForDay(options.groupRepoRoot, group, season, day)
          const evolutionByGameId = evolution.enabled
            ? buildEvolutionGameContexts(day, league.id, season, skillDocument, cardSelections, stateBefore)
            : undefined
          days[index] = calculateDefinitiveDay({
            day,
            teamsByOwner,
            officialVotes,
            leagueType,
            settings,
            mode: 'force',
            evolutionByGameId,
            onEvolutionTrace: (gameId, trace) => traces.set(gameId, trace),
          })
          changed = true
        }
        calendar.rounds[roundKey] = days
      }

      if (changed) {
        calculatedSerieADays.push(serieADay)
        if (evolution.enabled) {
          await writeEvolutionTraces(options.groupRepoRoot, league.id, season, serieADay, traces, options.now ?? new Date())
          const stateAfter = await rebuildEvolutionStatesForLeague(
            options.groupRepoRoot,
            options.platformRepoRoot,
            group,
            league.id,
            season,
            serieADay,
            settings,
            leagueType,
          )
          for (const document of stateAfter.values()) {
            await writeJson(
              resolve(options.groupRepoRoot, evolutionPlayerStatePath(league.id, season, document.owner)),
              document,
            )
          }
        }
      }
    }

    const excludedRounds = excludedRankRounds(leagueType)
    const rank = calculateRankFromCalendar(calendar, settings, excludedRounds)
    const progression = progressLeagueCalendar({ calendar, rank, leagueType })
    if (calculatedSerieADays.length === 0 && !progression.changed && options.requiredDay == null) continue

    await writeJson(calendarPath, progression.calendar)
    const rankPath = resolve(options.groupRepoRoot, seasonRankDocumentPath(league.id, season))
    await writeJson(rankPath, rank)
    const dailyRankPaths = await rebuildDailyRanks(
      options.groupRepoRoot,
      league.id,
      season,
      progression.calendar,
      settings,
      leagueType,
      rank,
    )

    results.push({
      leagueId: league.id,
      calculatedSerieADays,
      progressionChanged: progression.changed,
      calendarPath,
      rankPath,
      dailyRankPaths,
    })
  }

  return { season, leagues: results }
}

function buildEvolutionGameContexts(
  day: Calendar['rounds'][string][number],
  leagueId: string,
  season: number,
  skills: EvolutionSeasonSkillDocument | null,
  cardSelections: Map<string, EvolutionCardSelection>,
  stateByOwner: Map<string, EvolutionPlayerStateDocument>,
): Map<string, DefinitiveDayEvolutionGameContext> {
  const result = new Map<string, DefinitiveDayEvolutionGameContext>()
  for (const game of day.games) {
    const homeOwner = normalizeOwner(game.homeOwner)
    const awayOwner = normalizeOwner(game.awayOwner)
    result.set(game.id, {
      homeSkillAssignments: skills?.assignments ?? [],
      awaySkillAssignments: skills?.assignments ?? [],
      homeCards: cardSelections.get(homeOwner) ?? null,
      awayCards: cardSelections.get(awayOwner) ?? null,
      homePlayerState: playerMatchState(stateByOwner.get(homeOwner)),
      awayPlayerState: playerMatchState(stateByOwner.get(awayOwner)),
      seed: `${leagueId}:${season}:${day.serieADay}:${game.id}`,
    })
  }
  return result
}

async function buildAuthoritativeCardSelectionsForDay(
  groupRepoRoot: string,
  leagueId: string,
  year: number,
  serieADay: number,
  settings: LeagueSetting,
  cards: EvolutionCardsDocument,
  coachDeck: EvolutionSeasonCoachDeckDocument | null,
  consumedCardsByOwner: Map<string, string[]>,
  realDay: RealDay | null,
): Promise<Map<string, EvolutionCardSelection>> {
  const result = new Map<string, EvolutionCardSelection>()
  const relativePath = evolutionCardsPath(leagueId, year, serieADay)
  for (const [owner, sealed] of Object.entries(cards.commitments ?? {})) {
    const ownerKey = normalizeOwner(owner)
    const cardIds = await getAuthoritativeEvolutionCardIds({
      groupRepoRoot,
      relativePath,
      cards,
      owner,
      leagueId,
      year,
      serieADay,
      settings,
      deck: coachDeck,
      consumedCardIds: consumedCardsByOwner.get(ownerKey) ?? [],
      realDay,
    })
    if (!sealed.reveal || !cardIds) continue
    result.set(ownerKey, {
      cardIds,
      selectedAt: sealed.committedAt,
      lockedAt: sealed.lockedAt,
      revealedAt: sealed.reveal.revealedAt,
    })
  }
  return result
}

async function rebuildEvolutionConsumedCards(
  groupRepoRoot: string,
  leagueId: string,
  year: number,
  throughSerieADay: number,
  settings: LeagueSetting,
  coachDeck: EvolutionSeasonCoachDeckDocument | null,
  realCalendar: RealCalendar | null,
): Promise<Map<string, string[]>> {
  const consumedByOwner = new Map<string, string[]>()
  if (throughSerieADay <= 0) return consumedByOwner

  for (let serieADay = 1; serieADay <= Math.min(38, throughSerieADay); serieADay += 1) {
    const relativePath = evolutionCardsPath(leagueId, year, serieADay)
    const cards = await readOptionalJson<EvolutionCardsDocument>(resolve(groupRepoRoot, relativePath))
    if (!cards) continue
    const realDay = realCalendar?.days.find(day => day.serieADay === serieADay) ?? null
    for (const owner of Object.keys(cards.commitments ?? {})) {
      const ownerKey = normalizeOwner(owner)
      const consumed = consumedByOwner.get(ownerKey) ?? []
      const cardIds = await getAuthoritativeEvolutionCardIds({
        groupRepoRoot,
        relativePath,
        cards,
        owner,
        leagueId,
        year,
        serieADay,
        settings,
        deck: coachDeck,
        consumedCardIds: consumed,
        realDay,
      })
      if (cardIds) consumedByOwner.set(ownerKey, [...consumed, ...cardIds])
    }
  }
  return consumedByOwner
}

function playerMatchState(document: EvolutionPlayerStateDocument | undefined) {
  if (!document) return undefined
  return Object.fromEntries(document.players.map(state => [state.playerKey, getEvolutionPlayerMatchState(state)]))
}

async function rebuildEvolutionStatesForLeague(
  groupRepoRoot: string,
  platformRepoRoot: string,
  group: Group,
  leagueId: string,
  season: number,
  throughSerieADay: number,
  settings: LeagueSetting,
  leagueType: LeagueType,
): Promise<Map<string, EvolutionPlayerStateDocument>> {
  const league = group.leagues.find(item => item.id === leagueId)
  const owners = new Map<string, { owner: string; basketId: string }>()
  for (const basketId of league?.basketsId ?? []) {
    const yearly = group.baskets.find(item => item.id === basketId)?.years.find(item => item.year === season)
    for (const team of yearly?.teams ?? []) owners.set(normalizeOwner(team.owner), { owner: team.owner, basketId })
  }

  const states = new Map<string, Map<string, EvolutionPlayerSeasonState>>()
  for (const owner of owners.keys()) states.set(owner, new Map())
  if (throughSerieADay <= 0) {
    return new Map([...owners].map(([key, value]) => [key, stateDocument(leagueId, season, value.owner, 0, states.get(key)!)]))
  }

  for (let day = 1; day <= Math.min(38, throughSerieADay); day += 1) {
    const votes = await readOfficialVotes(platformRepoRoot, season, day)
    if (!votes) continue
    for (const [ownerKey, owner] of owners) {
      const team = await readOptionalJson<Team>(resolve(groupRepoRoot, dayTeamDocumentPath(owner.basketId, season, day, owner.owner)))
      if (!team) continue
      const calculation = calculateTeamPoint({
        players: team.players.filter(player => player.status === PlayerInTeamStatus.Active),
        officialVotes: votes,
        liveVotes: null,
        leagueType,
        settings,
      })
      const resolvedByKey = new Map(calculation.formation.map(player => [getPlayerKey(player.current.name), player] as const))
      const ownerStates = states.get(ownerKey)!
      for (const player of team.players.filter(item => item.status === PlayerInTeamStatus.Active)) {
        const key = getPlayerKey(player.name)
        if (!key) continue
        const resolved = resolvedByKey.get(key)
        const played = Boolean(resolved?.vote?.hasVote && resolved.currentPosition >= FantaSoccerRole.GoalKeeper && resolved.currentPosition <= FantaSoccerRole.Forward)
        const originallyStarter = player.position >= FantaSoccerRole.GoalKeeper && player.position <= FantaSoccerRole.Forward
        const usage = played
          ? (originallyStarter ? 'starter' : 'subbed-in')
          : player.position === FantaSoccerRole.Tribune ? 'tribune' : 'bench-unused'
        const previous = ownerStates.get(key) ?? createEvolutionPlayerSeasonState(key)
        ownerStates.set(key, advanceEvolutionPlayerSeasonState(previous, usage, resolved?.vote, settings))
      }
    }
  }

  return new Map([...owners].map(([key, value]) => [
    key,
    stateDocument(leagueId, season, value.owner, Math.min(38, throughSerieADay), states.get(key)!),
  ]))
}

function stateDocument(
  leagueId: string,
  year: number,
  owner: string,
  updatedThroughDay: number,
  states: Map<string, EvolutionPlayerSeasonState>,
): EvolutionPlayerStateDocument {
  return {
    version: 1,
    leagueId,
    year,
    owner,
    updatedThroughDay,
    players: [...states.values()].sort((a, b) => a.playerKey.localeCompare(b.playerKey)),
  }
}

async function writeEvolutionTraces(
  groupRepoRoot: string,
  leagueId: string,
  year: number,
  serieADay: number,
  traces: Map<string, EvolutionRuleTrace[]>,
  calculatedAt: Date,
): Promise<void> {
  for (const [gameId, trace] of traces) {
    const document: EvolutionTraceDocument = {
      version: 1,
      leagueId,
      year,
      serieADay,
      gameId,
      calculatedAt: calculatedAt.toISOString(),
      trace,
    }
    await writeJson(resolve(groupRepoRoot, evolutionTracePath(leagueId, year, serieADay, gameId)), document)
  }
}

async function loadTeamsForDay(
  groupRepoRoot: string,
  group: Group,
  season: number,
  day: Calendar['rounds'][string][number],
): Promise<Map<string, Team | null>> {
  const owners = new Set(day.games.flatMap(game => [game.homeOwner, game.awayOwner]).filter(Boolean))
  const result = new Map<string, Team | null>()
  for (const owner of owners) {
    const basketId = GroupHelper.getBasketId(group, owner, season)
    if (!basketId) {
      result.set(owner, null)
      continue
    }
    const path = resolve(groupRepoRoot, dayTeamDocumentPath(basketId, season, day.serieADay, owner))
    result.set(owner, await readOptionalJson<Team>(path))
  }
  return result
}

async function rebuildDailyRanks(
  groupRepoRoot: string,
  leagueId: string,
  season: number,
  calendar: Calendar,
  settings: LeagueSetting,
  leagueType: LeagueType,
  seasonRank: Rank,
): Promise<string[]> {
  const maxDay = seasonRank.serieADay
  if (maxDay < 1) return []
  const paths: string[] = []
  for (const serieADay of uniqueSerieADays(calendar).filter(day => day <= maxDay)) {
    const truncated = truncateCalendar(calendar, serieADay)
    const dailyRank = calculateRankFromCalendar(truncated, settings, excludedRankRounds(leagueType))
    if (dailyRank.serieADay !== serieADay) continue
    const path = resolve(groupRepoRoot, dailyRankDocumentPath(leagueId, season, serieADay))
    await writeJson(path, dailyRank)
    paths.push(path)
  }
  return paths
}

function truncateCalendar(calendar: Calendar, throughSerieADay: number): Calendar {
  return {
    year: calendar.year,
    rounds: Object.fromEntries(
      Object.entries(calendar.rounds).map(([roundKey, days]) => [
        roundKey,
        days
          .filter(day => day.serieADay <= throughSerieADay)
          .map(day => structuredClone(day)),
      ]),
    ),
  }
}

export function excludedRankRounds(leagueType: LeagueType): string[] {
  switch (leagueType) {
    case LeagueType.Cup:
      return ['Finals']
    case LeagueType.NewCup:
      return ['Finals', 'Europa League', 'Supercoppa']
    default:
      return []
  }
}

function leagueOwners(group: Group, leagueId: string, season: number): string[] {
  const league = group.leagues.find(item => item.id === leagueId)
  if (!league) return []
  return [...new Set(league.basketsId.flatMap(basketId =>
    group.baskets
      .find(item => item.id === basketId)
      ?.years.find(item => item.year === season)
      ?.teams.map(team => normalizeOwner(team.owner)) ?? [],
  ).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function uniqueSerieADays(calendar: Calendar): number[] {
  return [...new Set(
    Object.values(calendar.rounds).flatMap(days => days.map(day => day.serieADay)),
  )].sort((a, b) => a - b)
}

async function readGroup(root: string): Promise<Group> {
  const path = resolve(root, GROUP_DOCUMENT_PATH)
  const value = await readRequiredJson<unknown>(path, 'Group')
  if (!isGroupDocument(value)) throw new Error(`Unsupported group JSON schema in ${path}`)
  return value
}

async function readRealCalendar(root: string, season: number): Promise<RealCalendar | null> {
  const path = resolve(root, realCalendarDocumentPath(season))
  const value = await readOptionalJson<unknown>(path)
  return value == null ? null : decodeRealCalendar(value, season)
}

async function readOfficialVotes(root: string, season: number, day: number): Promise<VotedRealPlayers | null> {
  const path = resolve(root, serieAVoteDocumentPath('official', season, day))
  const value = await readOptionalJson<unknown>(path)
  return value == null ? null : decodeVotedRealPlayers(value, season, day)
}

async function readRequiredJson<T>(path: string, label: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if (isFileNotFound(error)) throw new Error(`${label} non trovato in ${path}`)
    throw error
  }
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if (isFileNotFound(error)) return null
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function assertSeason(season: number): void {
  if (!Number.isInteger(season) || season < 1) throw new Error('Season must be a positive integer')
}

function normalizeOwner(value: string): string {
  return value.trim().toLowerCase()
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
