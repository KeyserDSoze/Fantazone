import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, H1, H2, H3, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  Behaviour,
  DefaultLeagueSetting,
  FantaSoccerRole,
  GameResultHelper,
  GroupHelper,
  LeagueType,
  RealCalendarHelper,
  Role,
  calculateTeamPoint,
  formatSeasonFromYear,
  type EnrichedTeamPlayer,
  type GameResult,
  type GameWrapper,
  type Point,
  type TeamPointCalculation,
  type Vote,
  type VotedRealPlayers,
} from '@fantazone/domain'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

const GAME_REFRESH_MS = 30_000

type Props = {
  runtime: GroupSessionRuntime
  selection: GroupNavigationSelection
  gameId: string
  onBack: () => void
}

type GameProjection = {
  home: TeamPointCalculation | null
  away: TeamPointCalculation | null
  result: GameResult | null
  hasAnyVote: boolean
}

export function GroupGameScreen({ runtime, selection, gameId, onBack }: Props) {
  const [wrapper, setWrapper] = useState<GameWrapper | null>(null)
  const [officialVotes, setOfficialVotes] = useState<VotedRealPlayers | null>(null)
  const [liveVotes, setLiveVotes] = useState<VotedRealPlayers | null>(null)
  const [isLiveWindow, setIsLiveWindow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const inFlight = useRef(false)

  async function loadGame(silent = false) {
    if (!selection.leagueId || selection.year == null || inFlight.current) return
    inFlight.current = true
    if (!silent) setLoading(true)
    setError(null)
    try {
      const game = await runtime.gameComposer.getGame({
        leagueId: selection.leagueId,
        season: selection.year,
        gameId,
      })
      if (!game) throw new Error('Partita non trovata nel calendario selezionato.')

      const [realCalendar, official] = await Promise.all([
        runtime.realCalendarRepository.getCalendar(selection.year, { refresh: true }),
        runtime.officialVoteRepository.getVotes(selection.year, game.serieADay, { refresh: true }),
      ])
      const context = realCalendar ? RealCalendarHelper.context(realCalendar, new Date()) : null
      const liveWindow = context?.liveDay?.serieADay === game.serieADay
      const live = liveWindow
        ? await runtime.liveVoteRepository.getVotes(selection.year, game.serieADay, { refresh: true })
        : null

      setWrapper(game)
      setOfficialVotes(official)
      setLiveVotes(live)
      setIsLiveWindow(liveWindow)
      setLastUpdated(new Date())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossibile caricare la partita.')
    } finally {
      inFlight.current = false
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    setWrapper(null)
    setOfficialVotes(null)
    setLiveVotes(null)
    setLastUpdated(null)
    void loadGame()
  }, [runtime, selection.leagueId, selection.year, gameId])

  useEffect(() => {
    if (!isLiveWindow) return
    const timer = setInterval(() => { void loadGame(true) }, GAME_REFRESH_MS)
    return () => clearInterval(timer)
  }, [isLiveWindow, runtime, selection.leagueId, selection.year, gameId])

  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null
  const settings = selection.leagueId && selection.year != null
    ? GroupHelper.getAnnualLeague(runtime.group, selection.leagueId, selection.year)?.settings ?? DefaultLeagueSetting
    : DefaultLeagueSetting
  const leagueType = league && selection.year != null
    ? GroupHelper.getAnnualType(league, selection.year)
    : LeagueType.League

  const projection = useMemo<GameProjection>(() => {
    if (!wrapper) return { home: null, away: null, result: null, hasAnyVote: false }
    const homeTeam = wrapper.teams.find(team => team.side === 'home') ?? null
    const awayTeam = wrapper.teams.find(team => team.side === 'away') ?? null
    const home = homeTeam ? calculateTeamPoint({
      players: homeTeam.players.map(player => player.current),
      officialVotes,
      liveVotes,
      leagueType,
      settings,
    }) : null
    const away = awayTeam ? calculateTeamPoint({
      players: awayTeam.players.map(player => player.current),
      officialVotes,
      liveVotes,
      leagueType,
      settings,
    }) : null
    const hasAnyVote = [home, away].some(calculation => calculation?.formation.some(player => player.vote?.hasVote) === true)
    const projected = home && away
      ? resultFromPoints(addHomeAdvantage(home.point, settings.pointInHome), away.point, settings)
      : null
    const storedIsAuthoritative = GameResultHelper.hasValue(wrapper.game.result) && !isLiveWindow
    return {
      home,
      away,
      result: storedIsAuthoritative ? wrapper.game.result : projected,
      hasAnyVote,
    }
  }, [wrapper, officialVotes, liveVotes, leagueType, settings, isLiveWindow])

  const showScore = Boolean(wrapper?.game.result && GameResultHelper.hasValue(wrapper.game.result)) || projection.hasAnyVote

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1160} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1">
            <Button size="$3" variant="outlined" alignSelf="flex-start" onPress={onBack}>← Indietro</Button>
            <H1>Partita</H1>
            <Paragraph color="$color10">
              {league?.name ?? 'Lega'}{selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}
            </Paragraph>
          </YStack>
          <YStack gap="$1" alignItems="flex-end">
            <Button variant="outlined" disabled={loading} onPress={() => { void loadGame() }}>
              {loading ? <Spinner /> : 'Aggiorna'}
            </Button>
            {lastUpdated ? (
              <Text color="$color9" fontSize="$2">{lastUpdated.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text>
            ) : null}
          </YStack>
        </XStack>

        {error ? <Card borderWidth={1} borderColor="$red8" padding="$4"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {!error && loading && !wrapper ? <Spinner size="large" /> : null}

        {wrapper ? (
          <>
            <Card borderWidth={1} borderColor={isLiveWindow ? '$red8' : '$borderColor'} padding="$4">
              <YStack gap="$3">
                <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
                  <YStack gap="$1">
                    <H2 size="$6">{wrapper.game.home} vs {wrapper.game.away}</H2>
                    <Text color="$color10">Fanta {wrapper.fantasyDay} · Serie A {wrapper.serieADay}ª</Text>
                  </YStack>
                  <Text color={isLiveWindow ? '$red10' : wrapper.canEdit ? '$green10' : '$color10'} fontWeight="900">
                    {isLiveWindow ? 'LIVE' : wrapper.canEdit ? 'Turno futuro' : 'Turno chiuso'}
                  </Text>
                </XStack>

                <XStack justifyContent="center" alignItems="center" gap="$4" paddingVertical="$3">
                  <YStack flex={1} alignItems="flex-end" minWidth={0}>
                    <Text fontSize="$6" fontWeight="900" numberOfLines={1}>{wrapper.game.home}</Text>
                    <Text color="$color10">{projection.result?.home.value.toFixed(1) ?? '—'} pt</Text>
                  </YStack>
                  <Text fontSize="$8" fontWeight="900" minWidth={110} textAlign="center">
                    {showScore && projection.result ? `${projection.result.homeGoals} - ${projection.result.awayGoals}` : 'vs'}
                  </Text>
                  <YStack flex={1} minWidth={0}>
                    <Text fontSize="$6" fontWeight="900" numberOfLines={1}>{wrapper.game.away}</Text>
                    <Text color="$color10">{projection.result?.away.value.toFixed(1) ?? '—'} pt</Text>
                  </YStack>
                </XStack>

                {isLiveWindow ? (
                  <Paragraph size="$2" color="$red10">Voti live aggiornati automaticamente ogni 30 secondi. I voti ufficiali hanno sempre precedenza quando disponibili.</Paragraph>
                ) : null}
                {wrapper.requiresScoreCalculation && !isLiveWindow ? (
                  <Paragraph size="$2" color="$yellow10">Il risultato definitivo non è ancora stato materializzato nel calendario; questa vista usa i documenti voto disponibili senza scrivere nulla.</Paragraph>
                ) : null}
              </YStack>
            </Card>

            <XStack gap="$4" alignItems="flex-start" flexWrap="wrap">
              <YStack flexGrow={1} flexBasis={500} minWidth={0}>
                <TeamPanel title={wrapper.game.home} calculation={projection.home} point={projection.result?.home ?? null} />
              </YStack>
              <YStack flexGrow={1} flexBasis={500} minWidth={0}>
                <TeamPanel title={wrapper.game.away} calculation={projection.away} point={projection.result?.away ?? null} />
              </YStack>
            </XStack>
          </>
        ) : null}
      </YStack>
    </ScrollView>
  )
}

function TeamPanel({ title, calculation, point }: { title: string; calculation: TeamPointCalculation | null; point: Point | null }) {
  if (!calculation) {
    return <Card borderWidth={1} borderColor="$borderColor" padding="$4"><Paragraph color="$color10">Formazione non disponibile per {title}.</Paragraph></Card>
  }
  const players = [...calculation.formation].sort((a, b) => a.currentPosition - b.currentPosition || a.current.name.localeCompare(b.current.name))
  return (
    <Card borderWidth={1} borderColor="$borderColor" padding="$4">
      <YStack gap="$3">
        <XStack justifyContent="space-between" alignItems="center" gap="$3">
          <H2 size="$6">{title}</H2>
          <Text fontWeight="900">{point?.value.toFixed(1) ?? calculation.point.value.toFixed(1)} pt</Text>
        </XStack>
        {point?.defensiveBonus ? <Text color="$green10" fontSize="$2">Bonus difesa attivo</Text> : null}
        {point?.goodPeople ? <Text color="$green10" fontSize="$2">Bonus fair play attivo</Text> : null}
        <YStack gap="$2">
          {players.map((player, index) => <PlayerVoteRow key={`${player.current.name}-${index}`} player={player} />)}
        </YStack>
      </YStack>
    </Card>
  )
}

function PlayerVoteRow({ player }: { player: EnrichedTeamPlayer }) {
  const changed = player.currentPosition !== player.current.position
  return (
    <Card backgroundColor="$color2" padding="$3">
      <XStack gap="$3" alignItems="center">
        <YStack flex={1} minWidth={0}>
          <Text fontWeight="800" numberOfLines={1}>{player.current.name}</Text>
          <Text color="$color9" fontSize="$2" numberOfLines={1}>
            {player.current.team.name} · {formationLabel(player.currentPosition)}{changed ? ' · sostituzione' : ''}
          </Text>
          {player.vote ? <Text color="$color10" fontSize="$2">{voteEvents(player.vote)}</Text> : null}
        </YStack>
        <YStack alignItems="flex-end" minWidth={72}>
          <Text fontWeight="900">{player.vote?.hasVote ? player.vote.value.toFixed(1) : 'SV'}</Text>
          <Text color="$color10" fontSize="$2">{player.finalValue ? player.finalValue.value.toFixed(1) : '—'}</Text>
        </YStack>
      </XStack>
    </Card>
  )
}

function resultFromPoints(home: Point, away: Point, settings: typeof DefaultLeagueSetting): GameResult {
  const result: GameResult = { home, away, isCancelled: false, homeGoals: 0, awayGoals: 0 }
  const goals = GameResultHelper.calculateGoals(result, settings)
  return { ...result, homeGoals: goals.home, awayGoals: goals.away }
}

function addHomeAdvantage(point: Point, value: number): Point {
  return { ...point, value: point.value + value }
}

function formationLabel(position: FantaSoccerRole): string {
  switch (position) {
    case FantaSoccerRole.GoalKeeper: return 'Portiere titolare'
    case FantaSoccerRole.Defensor: return 'Difensore titolare'
    case FantaSoccerRole.Midfielder: return 'Centrocampista titolare'
    case FantaSoccerRole.Forward: return 'Attaccante titolare'
    case FantaSoccerRole.BackupGoalKeeper: return 'Portiere riserva'
    case FantaSoccerRole.FirstBackupDefensor: return 'Difensore riserva 1'
    case FantaSoccerRole.SecondBackupDefensor: return 'Difensore riserva 2'
    case FantaSoccerRole.FirstBackupMidfielder: return 'Centrocampista riserva 1'
    case FantaSoccerRole.SecondBackupMidfielder: return 'Centrocampista riserva 2'
    case FantaSoccerRole.FirstBackupForward: return 'Attaccante riserva 1'
    case FantaSoccerRole.SecondBackupForward: return 'Attaccante riserva 2'
    case FantaSoccerRole.Tribune: return 'Tribuna'
    default: return 'Fuori formazione'
  }
}

function voteEvents(vote: Vote): string {
  const events: string[] = []
  if (vote.goal) events.push(`${vote.goal} gol`)
  if (vote.penalty) events.push(`${vote.penalty} rigore`)
  if (vote.assist) events.push(`${vote.assist} assist`)
  if (vote.stoppedPenalty) events.push(`${vote.stoppedPenalty} rigore parato`)
  if (vote.sufferedGoal) events.push(`${vote.sufferedGoal} gol subito`)
  if (vote.wrongedPenalty) events.push(`${vote.wrongedPenalty} rigore sbagliato`)
  if (vote.ownGoal) events.push(`${vote.ownGoal} autogol`)
  if (vote.status === Behaviour.YellowCard) events.push('giallo')
  if (vote.status === Behaviour.RedCard) events.push('rosso')
  if (vote.injured) events.push('infortunio')
  if (vote.manOfTheMatch) events.push('MVP')
  return events.length > 0 ? events.join(' · ') : vote.hasVote ? 'Nessun bonus/malus' : 'Senza voto'
}
