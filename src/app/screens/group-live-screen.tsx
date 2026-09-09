import React, { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Trophy, Zap } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  Behaviour,
  GameResultHelper,
  LiveGroupHelper,
  RankHelper,
  RealCalendarHelper,
  VoteHelper,
  buildRealRank,
  formatSeasonFromYear,
  type LiveGroup,
  type RealRank,
  type Vote,
  type VotedRealPlayer,
} from '@fantazone/domain'
import { AppScreen, PageIntro, StatusPill, Surface } from '../components/design-system'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

const LIVE_REFRESH_MS = 30_000

type Props = {
  runtime: GroupSessionRuntime
  selection: GroupNavigationSelection
  onOpenGame?: (gameId: string) => void
}

export function GroupLiveScreen({ runtime, selection, onOpenGame }: Props) {
  const [liveGroup, setLiveGroup] = useState<LiveGroup | null>(null)
  const [serieARank, setSerieARank] = useState<RealRank | null>(null)
  const [events, setEvents] = useState<VotedRealPlayer[]>([])
  const [isDuringSerieADay, setIsDuringSerieADay] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const inFlight = useRef(false)
  const leagueName = runtime.group.leagues.find(item => item.id === selection.leagueId)?.name ?? 'Lega'

  async function loadLive(silent = false) {
    if (selection.year == null || inFlight.current) return
    inFlight.current = true
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [group, realCalendar] = await Promise.all([
        runtime.liveComposer.getLiveGroup(selection.year, { refresh: true }),
        runtime.realCalendarRepository.getCalendar(selection.year, { refresh: true }),
      ])
      const now = new Date()
      const context = realCalendar ? RealCalendarHelper.context(realCalendar, now) : null
      const liveDay = context?.liveDay?.serieADay ?? null
      const cachedLiveVotes = liveDay != null
        ? await runtime.liveVoteRepository.getVotes(selection.year, liveDay)
        : null

      setLiveGroup(group)
      setSerieARank(realCalendar ? buildRealRank(realCalendar, now) : null)
      setEvents(sortLiveEvents((cachedLiveVotes?.players ?? []).filter(player => player.vote && VoteHelper.hasDoneSomething(player.vote))))
      setIsDuringSerieADay(context?.isDuringSerieADay ?? false)
      setLastUpdated(new Date())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossibile aggiornare il live.')
    } finally {
      inFlight.current = false
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    setLiveGroup(null)
    setSerieARank(null)
    setEvents([])
    setLastUpdated(null)
    void loadLive()
  }, [runtime, selection.year])

  useEffect(() => {
    if (!isDuringSerieADay || selection.year == null) return
    const timer = setInterval(() => { void loadLive(true) }, LIVE_REFRESH_MS)
    return () => clearInterval(timer)
  }, [isDuringSerieADay, runtime, selection.year])

  const league = useMemo(() => {
    if (!liveGroup || !selection.leagueId) return null
    return LiveGroupHelper.getLeagueById(liveGroup, selection.leagueId)
  }, [liveGroup, selection.leagueId])
  const roundKeys = league ? Object.keys(league.rounds).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : []

  return (
    <AppScreen maxWidth={1180}>
      <PageIntro
        eyebrow={leagueName}
        title="Live"
        description={`${selection.year != null ? `${formatSeasonFromYear(selection.year)} · ` : ''}${isDuringSerieADay ? 'la giornata è in corso e si aggiorna automaticamente.' : 'risultati, voti ed eventi della giornata.'}`}
        action={(
          <YStack alignItems="flex-end" gap="$1">
            <Button
              variant="outlined"
              borderRadius="$4"
              disabled={loading}
              icon={loading ? undefined : RefreshCw}
              onPress={() => { void loadLive() }}
            >
              {loading ? <Spinner /> : 'Aggiorna'}
            </Button>
            {lastUpdated ? (
              <Text color="$color8" fontSize="$1">Aggiornato {lastUpdated.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text>
            ) : null}
          </YStack>
        )}
      />

      <Surface accent={isDuringSerieADay ? 'red' : 'neutral'} padding="$4">
        <XStack alignItems="center" justifyContent="space-between" gap="$4" flexWrap="wrap">
          <XStack alignItems="center" gap="$3">
            <YStack
              width={46}
              height={46}
              borderRadius="$10"
              alignItems="center"
              justifyContent="center"
              backgroundColor={isDuringSerieADay ? '$red4' : '$color4'}
            >
              <Zap size="$1.2" color={isDuringSerieADay ? '$red10' : '$color9'} />
            </YStack>
            <YStack gap="$1">
              <Text color="$color12" fontSize="$5" fontWeight="900">
                {isDuringSerieADay ? 'Aggiornamento automatico attivo' : 'Nessuna giornata Serie A in corso'}
              </Text>
              <Text color="$color9" fontSize="$2">
                {isDuringSerieADay ? `Refresh ogni ${LIVE_REFRESH_MS / 1000} secondi` : 'Puoi comunque consultare l’ultimo stato disponibile.'}
              </Text>
            </YStack>
          </XStack>
          <StatusPill tone={isDuringSerieADay ? 'red' : 'neutral'}>{isDuringSerieADay ? 'LIVE' : 'Stand-by'}</StatusPill>
        </XStack>
      </Surface>

      {error ? (
        <Surface accent="red" padding="$3">
          <Paragraph color="$red11">{error}</Paragraph>
        </Surface>
      ) : null}

      {!error && loading && !liveGroup ? (
        <YStack minHeight={220} justifyContent="center" alignItems="center" gap="$3">
          <Spinner size="large" />
          <Text color="$color9">Preparazione del live…</Text>
        </YStack>
      ) : null}

      {!error && !loading && !liveGroup ? (
        <Surface padding="$4"><Paragraph color="$color10">Il live non è disponibile per questa stagione.</Paragraph></Surface>
      ) : null}
      {!error && liveGroup && !league ? (
        <Surface padding="$4"><Paragraph color="$color10">La lega selezionata non ha dati live per questa giornata.</Paragraph></Surface>
      ) : null}

      {events.length > 0 ? (
        <YStack gap="$3">
          <XStack alignItems="center" gap="$2">
            <StatusPill tone="red">Eventi Serie A</StatusPill>
            <Text color="$color9" fontSize="$2">{events.length} aggiornamenti rilevanti</Text>
          </XStack>
          <XStack gap="$3" flexWrap="wrap">
            {events.map((player, index) => (
              <YStack
                key={`${player.name}-${index}`}
                flexGrow={1}
                flexBasis={245}
                minWidth={220}
                backgroundColor="$red2"
                borderWidth={1}
                borderColor="$red5"
                borderRadius="$4"
                padding="$3"
                gap="$1.5"
              >
                <Text color="$color12" fontWeight="900">{player.name}</Text>
                <Text color="$color9" fontSize="$2">{player.team.name}</Text>
                <Text color="$red11" fontSize="$3" fontWeight="700">{player.vote ? liveEventLabel(player.vote) : ''}</Text>
              </YStack>
            ))}
          </XStack>
        </YStack>
      ) : null}

      {serieARank && serieARank.teams.length > 0 ? (
        <Surface accent="green" padding="$4">
          <YStack gap="$3">
            <XStack alignItems="center" justifyContent="space-between" gap="$3" flexWrap="wrap">
              <XStack alignItems="center" gap="$2">
                <Trophy size="$1" color="$green10" />
                <Text color="$color12" fontSize="$6" fontWeight="900">Classifica Serie A</Text>
              </XStack>
              <StatusPill tone={isDuringSerieADay ? 'red' : 'green'}>
                {isDuringSerieADay ? 'Proiezione live' : 'Da calendario canonico'}
              </StatusPill>
            </XStack>
            <Paragraph color="$color9" fontSize="$2">
              Derivata direttamente dai risultati del calendario condiviso. Durante le partite include i punteggi live già pubblicati dal provider.
            </Paragraph>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <YStack minWidth={760} gap="$1">
                <XStack paddingHorizontal="$2" paddingVertical="$1" alignItems="center">
                  <RankCell width={36} value="#" header />
                  <RankCell flex={1} minWidth={180} value="Squadra" header align="left" />
                  <RankCell value="G" header />
                  <RankCell value="V" header />
                  <RankCell value="N" header />
                  <RankCell value="P" header />
                  <RankCell value="GF" header />
                  <RankCell value="GS" header />
                  <RankCell value="DR" header />
                  <RankCell value="Pt" header strong />
                </XStack>
                {serieARank.teams.map((team, index) => (
                  <XStack
                    key={team.name}
                    paddingHorizontal="$2"
                    paddingVertical="$2"
                    borderRadius="$3"
                    alignItems="center"
                    backgroundColor={index < 4 ? '$green2' : index % 2 === 0 ? '$color2' : 'transparent'}
                  >
                    <RankCell width={36} value={String(index + 1)} strong={index < 4} />
                    <RankCell flex={1} minWidth={180} value={team.name} align="left" strong />
                    <RankCell value={String(team.played)} />
                    <RankCell value={String(team.victories)} />
                    <RankCell value={String(team.draws)} />
                    <RankCell value={String(team.defeats)} />
                    <RankCell value={String(team.goalsFor)} />
                    <RankCell value={String(team.goalsAgainst)} />
                    <RankCell value={team.goalDifference > 0 ? `+${team.goalDifference}` : String(team.goalDifference)} />
                    <RankCell value={String(team.points)} strong />
                  </XStack>
                ))}
              </YStack>
            </ScrollView>
          </YStack>
        </Surface>
      ) : null}

      {league ? (
        <YStack gap="$4">
          {roundKeys.map(roundKey => {
            const day = league.rounds[roundKey]
            return (
              <Surface key={roundKey} padding="$4">
                <YStack gap="$4">
                  <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
                    <YStack gap="$1">
                      <StatusPill tone={isDuringSerieADay ? 'red' : 'blue'}>Serie A {day.serieADay}ª</StatusPill>
                      <Text color="$color12" fontSize="$7" fontWeight="900">{roundKey}</Text>
                    </YStack>
                    <Text color="$color9" fontSize="$2">Fanta giornata {day.number}</Text>
                  </XStack>

                  <XStack gap="$3" flexWrap="wrap">
                    {day.games.map(game => {
                      const hasPoints = GameResultHelper.hasValue(game.result)
                      return (
                        <YStack
                          key={game.id}
                          flexGrow={1}
                          flexBasis={330}
                          minWidth={270}
                          backgroundColor="$color3"
                          borderWidth={1}
                          borderColor="$color5"
                          borderRadius="$4"
                          padding="$3.5"
                          gap="$3"
                        >
                          <XStack alignItems="center" justifyContent="space-between" gap="$2">
                            <Text flex={1} textAlign="left" color="$color12" fontWeight="900" numberOfLines={1}>{game.home}</Text>
                            <YStack minWidth={72} height={40} borderRadius="$3" backgroundColor="$color4" alignItems="center" justifyContent="center">
                              <Text color="$color12" fontWeight="900" fontSize="$5">
                                {game.result ? `${game.result.homeGoals}–${game.result.awayGoals}` : 'VS'}
                              </Text>
                            </YStack>
                            <Text flex={1} textAlign="right" color="$color12" fontWeight="900" numberOfLines={1}>{game.away}</Text>
                          </XStack>
                          <Text textAlign="center" color="$color9" fontSize="$2">
                            {game.result
                              ? `${game.result.home.value.toFixed(1)} · ${game.result.away.value.toFixed(1)} punti${hasPoints ? '' : ' · in attesa voti'}`
                              : 'Formazioni o voti non ancora disponibili'}
                          </Text>
                          {onOpenGame ? (
                            <Button size="$2.5" variant="outlined" alignSelf="center" onPress={() => onOpenGame(game.id)}>
                              Dettaglio partita
                            </Button>
                          ) : null}
                        </YStack>
                      )
                    })}
                  </XStack>
                </YStack>
              </Surface>
            )
          })}

          {league.rank && roundKeys.length > 0 ? (
            <Surface accent="blue" padding="$4">
              <YStack gap="$3">
                <XStack justifyContent="space-between" alignItems="center">
                  <Text color="$color12" fontSize="$6" fontWeight="900">Classifica live</Text>
                  <StatusPill tone="blue">Proiezione</StatusPill>
                </XStack>
                {RankHelper.getTeamsSortedByPoints(league.rank, roundKeys[0]).map((team, index) => (
                  <XStack
                    key={team.owner}
                    gap="$3"
                    alignItems="center"
                    padding="$3"
                    borderRadius="$4"
                    backgroundColor={index < 3 ? '$blue3' : '$color2'}
                    borderWidth={1}
                    borderColor={index < 3 ? '$blue5' : '$color4'}
                  >
                    <YStack width={34} height={34} borderRadius="$10" alignItems="center" justifyContent="center" backgroundColor="$color4">
                      <Text fontWeight="900">{index + 1}</Text>
                    </YStack>
                    <YStack flex={1} minWidth={0}>
                      <Text color="$color12" fontWeight="900" numberOfLines={1}>{team.name}</Text>
                      <Text color="$color9" fontSize="$2">{team.owner}</Text>
                    </YStack>
                    <Text color="$color12" fontWeight="900">{team.point} pt</Text>
                    <Text color="$color9" minWidth={70} textAlign="right">{team.valuePoint.toFixed(1)}</Text>
                  </XStack>
                ))}
              </YStack>
            </Surface>
          ) : null}
        </YStack>
      ) : null}
    </AppScreen>
  )
}

function RankCell({
  value,
  width = 54,
  flex,
  minWidth,
  align = 'center',
  header = false,
  strong = false,
}: {
  value: string
  width?: number
  flex?: number
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  header?: boolean
  strong?: boolean
}) {
  return (
    <Text
      width={flex ? undefined : width}
      flex={flex}
      minWidth={minWidth}
      textAlign={align}
      color={header ? '$color8' : '$color12'}
      fontSize={header ? '$1' : '$2'}
      fontWeight={header || strong ? '900' : '600'}
      textTransform={header ? 'uppercase' : undefined}
      numberOfLines={1}
    >
      {value}
    </Text>
  )
}

function sortLiveEvents(players: VotedRealPlayer[]): VotedRealPlayer[] {
  return [...players].sort((a, b) => eventWeight(b.vote) - eventWeight(a.vote) || a.name.localeCompare(b.name))
}

function eventWeight(vote: Vote | null): number {
  if (!vote) return 0
  return vote.goal * 100 + vote.penalty * 90 + vote.assist * 70 + vote.stoppedPenalty * 65 +
    (vote.status === Behaviour.RedCard ? 50 : 0) + vote.wrongedPenalty * 45 + vote.ownGoal * 40 +
    vote.sufferedGoal * 20 + (vote.status === Behaviour.YellowCard ? 10 : 0) + (vote.manOfTheMatch ? 5 : 0)
}

function liveEventLabel(vote: Vote): string {
  const events: string[] = []
  if (vote.goal) events.push(`${vote.goal} gol`)
  if (vote.penalty) events.push(`${vote.penalty} rigore segnato`)
  if (vote.assist) events.push(`${vote.assist} assist`)
  if (vote.stoppedPenalty) events.push(`${vote.stoppedPenalty} rigore parato`)
  if (vote.wrongedPenalty) events.push(`${vote.wrongedPenalty} rigore sbagliato`)
  if (vote.ownGoal) events.push(`${vote.ownGoal} autogol`)
  if (vote.sufferedGoal) events.push(`${vote.sufferedGoal} gol subito`)
  if (vote.status === Behaviour.RedCard) events.push('rosso')
  else if (vote.status === Behaviour.YellowCard) events.push('giallo')
  if (vote.manOfTheMatch) events.push('MVP')
  if (vote.injured) events.push('infortunio')
  return events.join(' · ')
}
