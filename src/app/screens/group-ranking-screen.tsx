import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, H1, H2, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  LuckCalculator,
  RankHelper,
  formatSeasonFromYear,
  type Calendar,
  type Rank,
  type TeamLuck,
} from '@fantazone/domain'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  selection: GroupNavigationSelection
}

export function GroupRankingScreen({ runtime, selection }: Props) {
  const [rank, setRank] = useState<Rank | null>(null)
  const [calendar, setCalendar] = useState<Calendar | null>(null)
  const [roundKey, setRoundKey] = useState<string | null>(null)
  const [selectedLuckOwner, setSelectedLuckOwner] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null

  async function loadRank() {
    if (!selection.leagueId || selection.year == null) {
      setRank(null)
      setCalendar(null)
      setRoundKey(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [rankValue, calendarValue] = await Promise.all([
        runtime.rankRepository.getRank(selection.leagueId, selection.year, { refresh: true }),
        runtime.calendarRepository.getCalendar(selection.leagueId, selection.year, { refresh: true }),
      ])
      setRank(rankValue)
      setCalendar(calendarValue)
      if (!rankValue) {
        setRoundKey(null)
        return
      }
      const keys = RankHelper.getAvailableRounds(rankValue)
      setRoundKey(current => current && keys.includes(current) ? current : (keys[0] ?? null))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossibile caricare la classifica.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setSelectedLuckOwner(null)
    void loadRank()
  }, [runtime, selection.leagueId, selection.year])

  const roundKeys = rank ? RankHelper.getAvailableRounds(rank) : []
  const teams = rank && roundKey ? RankHelper.getTeamsSortedByPoints(rank, roundKey) : []
  const luckByOwner = useMemo(() => calendar && roundKey ? LuckCalculator.calculateTeamLuck(calendar, roundKey) : new Map<string, TeamLuck>(), [calendar, roundKey])
  const selectedLuck = selectedLuckOwner ? luckByOwner.get(normalize(selectedLuckOwner)) ?? null : null

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={980} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1">
            <H1>Classifica</H1>
            <Paragraph color="$color10">
              {league?.name ?? 'Lega'}{selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}
              {rank ? ` · Serie A ${rank.serieADay}ª` : ''}
            </Paragraph>
          </YStack>
          <Button variant="outlined" disabled={loading} onPress={() => { void loadRank() }}>
            {loading ? <Spinner /> : 'Aggiorna'}
          </Button>
        </XStack>

        {roundKeys.length > 1 ? (
          <XStack gap="$2" flexWrap="wrap">
            {roundKeys.map(key => (
              <Button
                key={key}
                size="$3"
                variant="outlined"
                backgroundColor={key === roundKey ? '$color3' : 'transparent'}
                borderColor={key === roundKey ? '$blue8' : '$borderColor'}
                onPress={() => { setRoundKey(key); setSelectedLuckOwner(null) }}
              >
                {key}
              </Button>
            ))}
          </XStack>
        ) : null}

        {error ? <Card borderWidth={1} borderColor="$red8" padding="$4"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {!error && loading && !rank ? <Spinner size="large" /> : null}
        {!error && !loading && !rank ? (
          <Card borderWidth={1} borderColor="$borderColor" padding="$4">
            <Paragraph color="$color10">La classifica non è ancora disponibile per questa lega e stagione.</Paragraph>
          </Card>
        ) : null}

        {teams.length > 0 ? (
          <YStack gap="$2">
            <XStack paddingHorizontal="$3" gap="$2" alignItems="center">
              <Text width={34} color="$color10" fontWeight="700">#</Text>
              <Text flex={1} color="$color10" fontWeight="700">Squadra</Text>
              <Text width={44} textAlign="center" color="$color10" fontWeight="700">Pt</Text>
              <Text width={44} textAlign="center" color="$color10" fontWeight="700">G</Text>
              <Text width={54} textAlign="center" color="$color10" fontWeight="700">GF:GS</Text>
              {calendar ? <Text width={70} textAlign="center" color="$color10" fontWeight="700">🍀</Text> : null}
            </XStack>
            {teams.map((team, index) => {
              const games = RankHelper.getTotalGamesPlayed(team)
              const luck = luckByOwner.get(normalize(team.owner)) ?? null
              return (
                <Card key={`${team.owner}-${index}`} borderWidth={1} borderColor={selectedLuckOwner === team.owner ? '$blue8' : '$borderColor'} padding="$3">
                  <XStack gap="$2" alignItems="center">
                    <Text width={34} fontWeight="800">{index + 1}</Text>
                    <YStack flex={1} minWidth={0}>
                      <Text fontWeight="800" numberOfLines={1}>{team.name}</Text>
                      <Text color="$color10" fontSize="$2" numberOfLines={1}>{team.owner}</Text>
                    </YStack>
                    <Text width={44} textAlign="center" fontWeight="800">{team.point}</Text>
                    <Text width={44} textAlign="center">{games}</Text>
                    <Text width={54} textAlign="center">{team.goal}:{team.sufferedGoal}</Text>
                    {calendar ? (
                      <Button
                        size="$2"
                        width={70}
                        variant="outlined"
                        disabled={!luck}
                        onPress={() => setSelectedLuckOwner(current => current === team.owner ? null : team.owner)}
                      >
                        {luck ? LuckCalculator.formatLuck(luck.avgLuck) : '—'}
                      </Button>
                    ) : null}
                  </XStack>
                </Card>
              )
            })}
          </YStack>
        ) : null}

        {selectedLuck ? <LuckDetail luck={selectedLuck} onClose={() => setSelectedLuckOwner(null)} /> : null}
      </YStack>
    </ScrollView>
  )
}

function LuckDetail({ luck, onClose }: { luck: TeamLuck; onClose: () => void }) {
  const events = [...luck.events].sort((a, b) => b.gameDay - a.gameDay || Math.abs(b.points) - Math.abs(a.points))
  const positives = events.filter(event => event.points > 0).length
  const negatives = events.filter(event => event.points < 0).length
  return (
    <Card borderWidth={1} borderColor="$blue8" padding="$4">
      <YStack gap="$3">
        <XStack justifyContent="space-between" gap="$3" alignItems="flex-start">
          <YStack gap="$1">
            <H2 size="$6">Fortuna · {luck.name}</H2>
            <Text color="$color10">Totale {LuckCalculator.formatLuckPoints(luck.totalLuck)} · Media {LuckCalculator.formatLuck(luck.avgLuck)} · {luck.gamesPlayed} partite</Text>
            <Text color="$color9" fontSize="$2">{positives} eventi positivi · {negatives} negativi</Text>
          </YStack>
          <Button size="$2" variant="outlined" onPress={onClose}>Chiudi</Button>
        </XStack>
        {events.length === 0 ? <Paragraph color="$color10">Nessun evento fortuna rilevato nelle partite giocate.</Paragraph> : null}
        {events.map((event, index) => (
          <Card key={`${event.gameId}-${event.type}-${index}`} backgroundColor="$color2" padding="$3">
            <YStack gap="$1">
              <XStack justifyContent="space-between" gap="$3">
                <Text fontWeight="800">Giornata {event.gameDay} · vs {event.opponent}</Text>
                <Text fontWeight="900" color={event.points > 0 ? '$green10' : '$red10'}>{LuckCalculator.formatLuckPoints(event.points)}</Text>
              </XStack>
              <Text color="$color10" fontSize="$2">{event.myScore.toFixed(1)} - {event.opponentScore.toFixed(1)} · {event.detail}</Text>
            </YStack>
          </Card>
        ))}
      </YStack>
    </Card>
  )
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}
