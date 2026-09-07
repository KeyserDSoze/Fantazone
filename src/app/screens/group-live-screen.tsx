import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, H1, H2, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  Behaviour,
  GameResultHelper,
  LiveGroupHelper,
  RankHelper,
  RealCalendarHelper,
  VoteHelper,
  formatSeasonFromYear,
  type LiveGroup,
  type Vote,
  type VotedRealPlayer,
} from '@fantazone/domain'
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
      const context = realCalendar ? RealCalendarHelper.context(realCalendar, new Date()) : null
      const liveDay = context?.liveDay?.serieADay ?? null
      const cachedLiveVotes = liveDay != null
        ? await runtime.liveVoteRepository.getVotes(selection.year, liveDay)
        : null

      setLiveGroup(group)
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
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1080} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1">
            <H1>Live</H1>
            <Paragraph color="$color10">{leagueName}{selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}</Paragraph>
            <Text color={isDuringSerieADay ? '$red10' : '$color9'} fontWeight="700">
              {isDuringSerieADay ? 'Aggiornamento automatico attivo' : 'Nessuna giornata Serie A in corso'}
            </Text>
          </YStack>
          <YStack gap="$1" alignItems="flex-end">
            <Button variant="outlined" disabled={loading} onPress={() => { void loadLive() }}>{loading ? <Spinner /> : 'Aggiorna'}</Button>
            {lastUpdated ? <Text color="$color9" fontSize="$2">{lastUpdated.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text> : null}
          </YStack>
        </XStack>

        {error ? <Card borderWidth={1} borderColor="$red8" padding="$4"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {!error && loading && !liveGroup ? <Spinner size="large" /> : null}
        {!error && !loading && !liveGroup ? <Card borderWidth={1} borderColor="$borderColor" padding="$4"><Paragraph color="$color10">Il live non è disponibile per questa stagione.</Paragraph></Card> : null}
        {!error && liveGroup && !league ? <Card borderWidth={1} borderColor="$borderColor" padding="$4"><Paragraph color="$color10">La lega selezionata non ha dati live per questa giornata.</Paragraph></Card> : null}

        {events.length > 0 ? (
          <Card borderWidth={1} borderColor="$red8" padding="$4">
            <YStack gap="$3">
              <H2 size="$6">Eventi Serie A</H2>
              <XStack gap="$2" flexWrap="wrap">
                {events.map((player, index) => (
                  <Card key={`${player.name}-${index}`} backgroundColor="$color2" padding="$3" flexGrow={1} flexBasis={240}>
                    <YStack gap="$1">
                      <Text fontWeight="900">{player.name}</Text>
                      <Text color="$color9" fontSize="$2">{player.team.name}</Text>
                      <Text color="$color11">{player.vote ? liveEventLabel(player.vote) : ''}</Text>
                    </YStack>
                  </Card>
                ))}
              </XStack>
            </YStack>
          </Card>
        ) : null}

        {league ? (
          <>
            {roundKeys.map(roundKey => {
              const day = league.rounds[roundKey]
              return (
                <Card key={roundKey} borderWidth={1} borderColor="$borderColor" padding="$4">
                  <YStack gap="$3">
                    <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
                      <H2 size="$6">{roundKey}</H2>
                      <Text color="$color10">Fanta {day.number} · Serie A {day.serieADay}ª</Text>
                    </XStack>
                    <YStack gap="$2">
                      {day.games.map(game => {
                        const hasPoints = GameResultHelper.hasValue(game.result)
                        return (
                          <Card key={game.id} backgroundColor="$color2" padding="$3">
                            <YStack gap="$2">
                              <XStack alignItems="center" justifyContent="space-between" gap="$2">
                                <Text flex={1} textAlign="right" fontWeight="800" numberOfLines={1}>{game.home}</Text>
                                <Text minWidth={72} textAlign="center" fontWeight="900" fontSize="$5">{game.result ? `${game.result.homeGoals} - ${game.result.awayGoals}` : 'vs'}</Text>
                                <Text flex={1} fontWeight="800" numberOfLines={1}>{game.away}</Text>
                              </XStack>
                              <Text textAlign="center" color="$color10" fontSize="$2">
                                {game.result ? `${game.result.home.value.toFixed(1)} · ${game.result.away.value.toFixed(1)} punti${hasPoints ? '' : ' · in attesa voti'}` : 'Formazioni o voti non ancora disponibili'}
                              </Text>
                              {onOpenGame ? <Button size="$2" variant="outlined" alignSelf="center" onPress={() => onOpenGame(game.id)}>Dettaglio partita</Button> : null}
                            </YStack>
                          </Card>
                        )
                      })}
                    </YStack>
                  </YStack>
                </Card>
              )
            })}

            {league.rank && roundKeys.length > 0 ? (
              <Card borderWidth={1} borderColor="$borderColor" padding="$4">
                <YStack gap="$3">
                  <H2 size="$6">Classifica live</H2>
                  {RankHelper.getTeamsSortedByPoints(league.rank, roundKeys[0]).map((team, index) => (
                    <XStack key={team.owner} gap="$3" alignItems="center" paddingVertical="$2">
                      <Text width={28} textAlign="center" fontWeight="800">{index + 1}</Text>
                      <YStack flex={1} minWidth={0}>
                        <Text fontWeight="800" numberOfLines={1}>{team.name}</Text>
                        <Text color="$color9" fontSize="$2">{team.owner}</Text>
                      </YStack>
                      <Text fontWeight="900">{team.point} pt</Text>
                      <Text color="$color10" minWidth={70} textAlign="right">{team.valuePoint.toFixed(1)}</Text>
                    </XStack>
                  ))}
                </YStack>
              </Card>
            ) : null}
          </>
        ) : null}
      </YStack>
    </ScrollView>
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
