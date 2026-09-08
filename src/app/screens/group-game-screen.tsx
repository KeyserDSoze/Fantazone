import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Image } from 'react-native'
import { ArrowLeft, Clock3, Radio, RefreshCw, ShieldCheck } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  Behaviour,
  DefaultLeagueSetting,
  FantaSoccerRole,
  GameResultHelper,
  GroupHelper,
  LeagueType,
  RealCalendarHelper,
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
import { AppScreen, PageIntro, StatusPill, Surface } from '../components/design-system'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'
import { getPlayerImageUrlFromName } from '../utils/playerImage'

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
    <AppScreen maxWidth={1220}>
      <PageIntro
        eyebrow={isLiveWindow ? 'Live match' : 'Dettaglio partita'}
        title="Partita"
        description={`${league?.name ?? 'Lega'}${selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}. Formazioni, voti e proiezione sono calcolati localmente dai documenti canonici disponibili.`}
        action={(
          <XStack gap="$2" flexWrap="wrap">
            <Button variant="outlined" borderRadius="$4" icon={ArrowLeft} onPress={onBack}>Indietro</Button>
            <Button
              variant="outlined"
              borderRadius="$4"
              disabled={loading}
              icon={loading ? undefined : RefreshCw}
              onPress={() => { void loadGame() }}
            >
              {loading ? <Spinner /> : 'Aggiorna'}
            </Button>
          </XStack>
        )}
      />

      {error ? (
        <Surface accent="red" padding="$3">
          <Paragraph color="$red11">{error}</Paragraph>
        </Surface>
      ) : null}

      {!error && loading && !wrapper ? (
        <YStack minHeight={240} alignItems="center" justifyContent="center" gap="$3">
          <Spinner size="large" />
          <Text color="$color9">Caricamento partita…</Text>
        </YStack>
      ) : null}

      {wrapper ? (
        <>
          <Surface accent={isLiveWindow ? 'red' : 'blue'} padding="$5">
            <YStack gap="$4">
              <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
                <XStack gap="$2" alignItems="center">
                  {isLiveWindow ? <Radio size="$1" color="$red10" /> : <Clock3 size="$1" color="$blue10" />}
                  <Text color={isLiveWindow ? '$red10' : '$blue10'} fontSize="$2" fontWeight="900" textTransform="uppercase">
                    Fanta {wrapper.fantasyDay} · Serie A {wrapper.serieADay}ª
                  </Text>
                </XStack>
                <XStack gap="$2" alignItems="center" flexWrap="wrap">
                  <StatusPill tone={isLiveWindow ? 'red' : wrapper.canEdit ? 'green' : 'neutral'}>
                    {isLiveWindow ? 'LIVE' : wrapper.canEdit ? 'Turno futuro' : 'Turno chiuso'}
                  </StatusPill>
                  {lastUpdated ? (
                    <Text color="$color8" fontSize="$2">Agg. {lastUpdated.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text>
                  ) : null}
                </XStack>
              </XStack>

              <XStack alignItems="center" justifyContent="center" gap="$3" paddingVertical="$4">
                <ScoreTeam name={wrapper.game.home} points={projection.result?.home.value ?? null} align="right" />
                <YStack alignItems="center" justifyContent="center" minWidth={110} gap="$1">
                  <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Risultato</Text>
                  <Text color="$color12" fontSize="$10" lineHeight="$10" fontWeight="900" textAlign="center">
                    {showScore && projection.result ? `${projection.result.homeGoals} - ${projection.result.awayGoals}` : 'vs'}
                  </Text>
                </YStack>
                <ScoreTeam name={wrapper.game.away} points={projection.result?.away.value ?? null} align="left" />
              </XStack>

              {isLiveWindow ? (
                <XStack gap="$2" alignItems="flex-start">
                  <Radio size="$0.9" color="$red10" />
                  <Paragraph size="$2" color="$red11" flex={1}>
                    Voti live aggiornati automaticamente ogni 30 secondi. I voti ufficiali hanno sempre precedenza quando disponibili.
                  </Paragraph>
                </XStack>
              ) : null}
              {wrapper.requiresScoreCalculation && !isLiveWindow ? (
                <Paragraph size="$2" color="$yellow11">
                  Il risultato definitivo non è ancora materializzato nel calendario; questa vista usa i documenti voto disponibili senza scrivere nulla.
                </Paragraph>
              ) : null}
            </YStack>
          </Surface>

          <XStack gap="$3" alignItems="flex-start" flexWrap="wrap">
            <YStack flexGrow={1} flexBasis={520} minWidth={280}>
              <TeamPanel title={wrapper.game.home} calculation={projection.home} point={projection.result?.home ?? null} />
            </YStack>
            <YStack flexGrow={1} flexBasis={520} minWidth={280}>
              <TeamPanel title={wrapper.game.away} calculation={projection.away} point={projection.result?.away ?? null} />
            </YStack>
          </XStack>
        </>
      ) : null}
    </AppScreen>
  )
}

function ScoreTeam({ name, points, align }: { name: string; points: number | null; align: 'left' | 'right' }) {
  return (
    <YStack flex={1} minWidth={0} alignItems={align === 'right' ? 'flex-end' : 'flex-start'} gap="$1">
      <Text color="$color12" fontSize="$6" fontWeight="900" numberOfLines={2} textAlign={align}>{name}</Text>
      <Text color="$color9" fontSize="$3" fontWeight="800">{points != null ? `${points.toFixed(1)} pt` : '— pt'}</Text>
    </YStack>
  )
}

function TeamPanel({ title, calculation, point }: { title: string; calculation: TeamPointCalculation | null; point: Point | null }) {
  if (!calculation) {
    return (
      <Surface padding="$4">
        <Paragraph color="$color10">Formazione non disponibile per {title}.</Paragraph>
      </Surface>
    )
  }
  const players = [...calculation.formation].sort((a, b) => a.currentPosition - b.currentPosition || a.current.name.localeCompare(b.current.name))
  return (
    <Surface padding="$4">
      <YStack gap="$4">
        <XStack justifyContent="space-between" alignItems="center" gap="$3">
          <YStack gap="$1" flex={1} minWidth={0}>
            <Text color="$color12" fontSize="$6" fontWeight="900" numberOfLines={1}>{title}</Text>
            <Text color="$color8" fontSize="$2">{players.length} giocatori in formazione</Text>
          </YStack>
          <Text color="$color12" fontSize="$7" fontWeight="900">{point?.value.toFixed(1) ?? calculation.point.value.toFixed(1)}</Text>
        </XStack>

        {(point?.defensiveBonus || point?.goodPeople) ? (
          <XStack gap="$2" flexWrap="wrap">
            {point?.defensiveBonus ? <StatusPill tone="green">Bonus difesa</StatusPill> : null}
            {point?.goodPeople ? <StatusPill tone="green">Fair play</StatusPill> : null}
          </XStack>
        ) : null}

        <YStack gap="$2">
          {players.map((player, index) => <PlayerVoteRow key={`${player.current.name}-${index}`} player={player} />)}
        </YStack>
      </YStack>
    </Surface>
  )
}

function PlayerVoteRow({ player }: { player: EnrichedTeamPlayer }) {
  const changed = player.currentPosition !== player.current.position
  return (
    <XStack
      gap="$3"
      alignItems="center"
      padding="$3"
      borderRadius="$4"
      backgroundColor="$color3"
      borderWidth={1}
      borderColor={changed ? '$yellow6' : '$color4'}
    >
      <PlayerAvatar name={player.current.name} />
      <YStack flex={1} minWidth={0} gap="$1">
        <Text color="$color12" fontWeight="900" numberOfLines={1}>{player.current.name}</Text>
        <Text color="$color9" fontSize="$2" numberOfLines={1}>
          {player.current.team.name} · {formationLabel(player.currentPosition)}
        </Text>
        {changed ? <Text color="$yellow10" fontSize="$1" fontWeight="900">SOSTITUZIONE</Text> : null}
        {player.vote ? <Text color="$color9" fontSize="$2" numberOfLines={2}>{voteEvents(player.vote)}</Text> : null}
      </YStack>
      <YStack alignItems="flex-end" minWidth={66} gap="$1">
        <Text color="$color8" fontSize="$1" fontWeight="900">VOTO</Text>
        <Text color="$color12" fontWeight="900" fontSize="$5">{player.vote?.hasVote ? player.vote.value.toFixed(1) : 'SV'}</Text>
        <Text color="$blue10" fontWeight="900" fontSize="$3">{player.finalValue ? player.finalValue.value.toFixed(1) : '—'}</Text>
      </YStack>
    </XStack>
  )
}

function PlayerAvatar({ name }: { name: string }) {
  const urls = getPlayerImageUrlFromName(name)
  const [source, setSource] = useState(urls.src)

  useEffect(() => {
    setSource(urls.src)
  }, [urls.src])

  return (
    <YStack width={48} height={48} borderRadius="$10" overflow="hidden" backgroundColor="$color4" borderWidth={1} borderColor="$color5">
      <Image
        source={{ uri: source }}
        accessibilityLabel={name}
        onError={() => setSource(urls.fallback)}
        style={{ width: 48, height: 48 }}
      />
    </YStack>
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
