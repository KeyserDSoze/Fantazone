import React, { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Star, Trophy } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  LuckCalculator,
  RankHelper,
  formatSeasonFromYear,
  type Calendar,
  type Rank,
  type TeamLuck,
} from '@fantazone/domain'
import { AppScreen, PageIntro, StatusPill, Surface } from '../components/design-system'
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
  const luckByOwner = useMemo(
    () => calendar && roundKey ? LuckCalculator.calculateTeamLuck(calendar, roundKey) : new Map<string, TeamLuck>(),
    [calendar, roundKey],
  )
  const selectedLuck = selectedLuckOwner ? luckByOwner.get(normalize(selectedLuckOwner)) ?? null : null

  return (
    <AppScreen maxWidth={1120}>
      <PageIntro
        eyebrow={league?.name ?? 'Lega'}
        title="Classifica"
        description={`${selection.year != null ? `${formatSeasonFromYear(selection.year)} · ` : ''}${rank ? `aggiornata alla ${rank.serieADay}ª di Serie A.` : 'posizioni, punti e rendimento della tua lega.'}`}
        action={(
          <Button
            variant="outlined"
            borderRadius="$4"
            disabled={loading}
            icon={loading ? undefined : RefreshCw}
            onPress={() => { void loadRank() }}
          >
            {loading ? <Spinner /> : 'Aggiorna'}
          </Button>
        )}
      />

      {roundKeys.length > 1 ? (
        <YStack gap="$2">
          <Text color="$color9" fontSize="$2" fontWeight="800">FASE / GIRONE</Text>
          <XStack gap="$2" flexWrap="wrap">
            {roundKeys.map(key => {
              const active = key === roundKey
              return (
                <Button
                  key={key}
                  size="$3"
                  borderRadius="$10"
                  backgroundColor={active ? '$blue4' : '$color2'}
                  borderColor={active ? '$blue7' : '$color5'}
                  onPress={() => { setRoundKey(key); setSelectedLuckOwner(null) }}
                >
                  <Text color={active ? '$blue11' : '$color10'} fontWeight="800">{key}</Text>
                </Button>
              )
            })}
          </XStack>
        </YStack>
      ) : null}

      {error ? (
        <Surface accent="red" padding="$3">
          <Paragraph color="$red11">{error}</Paragraph>
        </Surface>
      ) : null}

      {!error && loading && !rank ? (
        <YStack minHeight={220} alignItems="center" justifyContent="center" gap="$3">
          <Spinner size="large" />
          <Text color="$color9">Aggiornamento classifica…</Text>
        </YStack>
      ) : null}

      {!error && !loading && !rank ? (
        <Surface padding="$4">
          <YStack minHeight={140} justifyContent="center" alignItems="center" gap="$3">
            <Trophy size="$2" color="$color8" />
            <Paragraph color="$color10" textAlign="center">
              La classifica non è ancora disponibile per questa lega e stagione.
            </Paragraph>
          </YStack>
        </Surface>
      ) : null}

      {teams.length > 0 ? (
        <Surface padding="$4">
          <YStack gap="$2">
            <XStack paddingHorizontal="$3" paddingBottom="$2" gap="$2" alignItems="center">
              <Text width={38} color="$color8" fontSize="$2" fontWeight="800">POS</Text>
              <Text flex={1} color="$color8" fontSize="$2" fontWeight="800">SQUADRA</Text>
              <Text width={48} textAlign="center" color="$color8" fontSize="$2" fontWeight="800">PT</Text>
              <Text width={48} textAlign="center" color="$color8" fontSize="$2" fontWeight="800">G</Text>
              <Text width={62} textAlign="center" color="$color8" fontSize="$2" fontWeight="800">GF:GS</Text>
              {calendar ? <Text width={74} textAlign="center" color="$color8" fontSize="$2" fontWeight="800">FORTUNA</Text> : null}
            </XStack>

            {teams.map((team, index) => {
              const games = RankHelper.getTotalGamesPlayed(team)
              const luck = luckByOwner.get(normalize(team.owner)) ?? null
              const selected = selectedLuckOwner === team.owner
              const podium = index < 3
              return (
                <YStack
                  key={`${team.owner}-${index}`}
                  padding="$3"
                  borderWidth={1}
                  borderColor={selected ? '$blue7' : '$color4'}
                  backgroundColor={selected ? '$blue2' : podium ? '$color3' : '$color2'}
                  borderRadius="$4"
                >
                  <XStack gap="$2" alignItems="center">
                    <YStack
                      width={38}
                      height={38}
                      borderRadius="$10"
                      alignItems="center"
                      justifyContent="center"
                      backgroundColor={index === 0 ? '$yellow4' : index === 1 ? '$gray4' : index === 2 ? '$orange4' : '$color3'}
                    >
                      <Text color="$color12" fontWeight="900">{index + 1}</Text>
                    </YStack>
                    <YStack flex={1} minWidth={0}>
                      <Text color="$color12" fontWeight="900" numberOfLines={1}>{team.name}</Text>
                      <Text color="$color9" fontSize="$2" numberOfLines={1}>{team.owner}</Text>
                    </YStack>
                    <Text width={48} textAlign="center" fontSize="$5" fontWeight="900" color="$color12">{team.point}</Text>
                    <Text width={48} textAlign="center" color="$color10">{games}</Text>
                    <Text width={62} textAlign="center" color="$color10">{team.goal}:{team.sufferedGoal}</Text>
                    {calendar ? (
                      <Button
                        size="$2.5"
                        width={74}
                        borderRadius="$10"
                        backgroundColor={selected ? '$blue4' : '$color3'}
                        borderColor={selected ? '$blue7' : '$color5'}
                        disabled={!luck}
                        onPress={() => setSelectedLuckOwner(current => current === team.owner ? null : team.owner)}
                      >
                        {luck ? LuckCalculator.formatLuck(luck.avgLuck) : '—'}
                      </Button>
                    ) : null}
                  </XStack>
                </YStack>
              )
            })}
          </YStack>
        </Surface>
      ) : null}

      {selectedLuck ? <LuckDetail luck={selectedLuck} onClose={() => setSelectedLuckOwner(null)} /> : null}
    </AppScreen>
  )
}

function LuckDetail({ luck, onClose }: { luck: TeamLuck; onClose: () => void }) {
  const events = [...luck.events].sort((a, b) => b.gameDay - a.gameDay || Math.abs(b.points) - Math.abs(a.points))
  const positives = events.filter(event => event.points > 0).length
  const negatives = events.filter(event => event.points < 0).length
  return (
    <Surface accent="blue" padding="$4">
      <YStack gap="$4">
        <XStack justifyContent="space-between" gap="$3" alignItems="flex-start" flexWrap="wrap">
          <YStack gap="$2" flex={1} minWidth={220}>
            <StatusPill tone="blue">Analisi fortuna</StatusPill>
            <XStack gap="$2" alignItems="center">
              <Star size="$1.2" color="$blue10" />
              <Text color="$color12" fontSize="$6" fontWeight="900">{luck.name}</Text>
            </XStack>
            <Text color="$color10">
              Totale {LuckCalculator.formatLuckPoints(luck.totalLuck)} · Media {LuckCalculator.formatLuck(luck.avgLuck)} · {luck.gamesPlayed} partite
            </Text>
            <Text color="$color9" fontSize="$2">{positives} eventi positivi · {negatives} negativi</Text>
          </YStack>
          <Button size="$2.5" variant="outlined" onPress={onClose}>Chiudi</Button>
        </XStack>

        {events.length === 0 ? <Paragraph color="$color10">Nessun evento fortuna rilevato nelle partite giocate.</Paragraph> : null}
        <XStack gap="$3" flexWrap="wrap">
          {events.map((event, index) => (
            <YStack
              key={`${event.gameId}-${event.type}-${index}`}
              flexGrow={1}
              flexBasis={300}
              minWidth={260}
              backgroundColor="$color2"
              borderWidth={1}
              borderColor="$color5"
              borderRadius="$4"
              padding="$3"
              gap="$1.5"
            >
              <XStack justifyContent="space-between" gap="$3">
                <Text color="$color12" fontWeight="800">Giornata {event.gameDay} · vs {event.opponent}</Text>
                <Text fontWeight="900" color={event.points > 0 ? '$green10' : '$red10'}>{LuckCalculator.formatLuckPoints(event.points)}</Text>
              </XStack>
              <Text color="$color10" fontSize="$2">{event.myScore.toFixed(1)} - {event.opponentScore.toFixed(1)} · {event.detail}</Text>
            </YStack>
          ))}
        </XStack>
      </YStack>
    </Surface>
  )
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}
