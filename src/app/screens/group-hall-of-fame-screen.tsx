import React, { useEffect, useState } from 'react'
import { Button, Card, H1, H2, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import { HallOfFameHelper, type HallOfFame } from '@fantazone/domain'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = { runtime: GroupSessionRuntime; selection: GroupNavigationSelection }

export function GroupHallOfFameScreen({ runtime, selection }: Props) {
  const [hall, setHall] = useState<HallOfFame | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null

  async function loadHall() {
    if (!selection.leagueId) {
      setHall(null)
      setError('Seleziona una lega.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      setHall(await runtime.hallOfFameRepository.getHallOfFame(selection.leagueId, { refresh: true }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossibile caricare la Hall of Fame.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadHall() }, [runtime, selection.leagueId])

  const winningTeams = hall ? HallOfFameHelper.sortWinningTeamsByWins(hall.winningTeams) : []
  const winningPlayers = hall ? HallOfFameHelper.sortWinningPlayersByWins(hall.winningPlayers) : []
  const rankings = hall ? HallOfFameHelper.sortRankingsByPoints(hall.allTimeRankings) : []

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1080} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1"><H1>Hall of Fame</H1><Paragraph color="$color10">{league?.name ?? 'Lega'} · storia completa</Paragraph></YStack>
          <Button variant="outlined" disabled={loading} onPress={() => { void loadHall() }}>{loading ? <Spinner /> : 'Aggiorna'}</Button>
        </XStack>
        {error ? <Card borderWidth={1} borderColor="$red8" padding="$4"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {!error && loading && !hall ? <Spinner size="large" /> : null}
        {!error && !loading && !hall ? <Card borderWidth={1} borderColor="$borderColor" padding="$4"><Paragraph color="$color10">Hall of Fame non ancora materializzata per questa lega.</Paragraph></Card> : null}

        {hall?.recordGame ? (
          <Card borderWidth={1} borderColor="$yellow8" padding="$4">
            <YStack gap="$2"><H2 size="$6">Record partita</H2><Text fontWeight="900">{hall.recordGame.game.home} vs {hall.recordGame.game.away}</Text><Text color="$color10">Stagione {hall.recordGame.year} · {hall.recordGame.game.result?.home.value.toFixed(1)} - {hall.recordGame.game.result?.away.value.toFixed(1)} punti</Text></YStack>
          </Card>
        ) : null}

        {winningTeams.length > 0 ? (
          <Card borderWidth={1} borderColor="$borderColor" padding="$4">
            <YStack gap="$3"><H2 size="$6">Squadre più vincenti</H2>{winningTeams.map((team, index) => <XStack key={team.owner} gap="$3" alignItems="center"><Text width={28} fontWeight="900">{index + 1}</Text><YStack flex={1}><Text fontWeight="900">{team.teamName}</Text><Text color="$color9" fontSize="$2">{winsLabel(team.wins)}</Text></YStack><Text fontWeight="900">{HallOfFameHelper.totalWins(team)} titoli</Text></XStack>)}</YStack>
          </Card>
        ) : null}

        {rankings.length > 0 ? (
          <Card borderWidth={1} borderColor="$borderColor" padding="$4">
            <YStack gap="$3"><H2 size="$6">Classifica all-time</H2>{rankings.map((team, index) => <XStack key={`${team.owner}-${index}`} gap="$3" alignItems="center"><Text width={28} fontWeight="900">{index + 1}</Text><YStack flex={1}><Text fontWeight="800">{team.name}</Text><Text color="$color9" fontSize="$2">{team.owner}</Text></YStack><Text fontWeight="900">{team.point} pt</Text><Text color="$color10" minWidth={80} textAlign="right">{team.victories} V</Text></XStack>)}</YStack>
          </Card>
        ) : null}

        {winningPlayers.length > 0 ? (
          <Card borderWidth={1} borderColor="$borderColor" padding="$4">
            <YStack gap="$3"><H2 size="$6">Giocatori più vincenti</H2>{winningPlayers.slice(0, 30).map((entry, index) => <XStack key={`${entry.player.name}-${index}`} gap="$3" alignItems="center"><Text width={28} fontWeight="900">{index + 1}</Text><YStack flex={1}><Text fontWeight="800">{entry.player.name}</Text><Text color="$color9" fontSize="$2">{entry.player.team.name} · {winsLabel(entry.wins)}</Text></YStack><Text fontWeight="900">{HallOfFameHelper.totalWins(entry)}</Text></XStack>)}</YStack>
          </Card>
        ) : null}
      </YStack>
    </ScrollView>
  )
}

function winsLabel(wins: Record<string, number[]>): string {
  return Object.entries(wins).flatMap(([round, years]) => years.map(year => `${round} ${year}`)).join(' · ')
}
