import React, { useEffect, useState } from 'react'
import { Button, Card, H1, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import { RankHelper, formatSeasonFromYear, type Rank } from '@fantazone/domain'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  selection: GroupNavigationSelection
}

export function GroupRankingScreen({ runtime, selection }: Props) {
  const [rank, setRank] = useState<Rank | null>(null)
  const [roundKey, setRoundKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null

  async function loadRank() {
    if (!selection.leagueId || selection.year == null) {
      setRank(null)
      setRoundKey(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const value = await runtime.rankRepository.getRank(selection.leagueId, selection.year, { refresh: true })
      setRank(value)
      if (!value) {
        setRoundKey(null)
        return
      }
      const keys = RankHelper.getAvailableRounds(value)
      setRoundKey(current => current && keys.includes(current) ? current : (keys[0] ?? null))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossibile caricare la classifica.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRank()
  }, [runtime, selection.leagueId, selection.year])

  const roundKeys = rank ? RankHelper.getAvailableRounds(rank) : []
  const teams = rank && roundKey ? RankHelper.getTeamsSortedByPoints(rank, roundKey) : []

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
                onPress={() => setRoundKey(key)}
              >
                {key}
              </Button>
            ))}
          </XStack>
        ) : null}

        {error ? (
          <Card borderWidth={1} borderColor="$red8" padding="$4"><Paragraph color="$red10">{error}</Paragraph></Card>
        ) : null}
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
            </XStack>
            {teams.map((team, index) => {
              const games = RankHelper.getTotalGamesPlayed(team)
              return (
                <Card key={`${team.owner}-${index}`} borderWidth={1} borderColor="$borderColor" padding="$3">
                  <XStack gap="$2" alignItems="center">
                    <Text width={34} fontWeight="800">{index + 1}</Text>
                    <YStack flex={1} minWidth={0}>
                      <Text fontWeight="800" numberOfLines={1}>{team.name}</Text>
                      <Text color="$color10" fontSize="$2" numberOfLines={1}>{team.owner}</Text>
                    </YStack>
                    <Text width={44} textAlign="center" fontWeight="800">{team.point}</Text>
                    <Text width={44} textAlign="center">{games}</Text>
                    <Text width={54} textAlign="center">{team.goal}:{team.sufferedGoal}</Text>
                  </XStack>
                </Card>
              )
            })}
          </YStack>
        ) : null}
      </YStack>
    </ScrollView>
  )
}
