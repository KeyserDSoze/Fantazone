import React, { useEffect, useState } from 'react'
import { Crown, Medal, RefreshCw, Trophy } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import { HallOfFameHelper, type HallOfFame } from '@fantazone/domain'
import { AppScreen, PageIntro, StatusPill, Surface } from '../components/design-system'
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
    <AppScreen maxWidth={1160}>
      <PageIntro
        eyebrow="Storia della lega"
        title="Hall of Fame"
        description={`${league?.name ?? 'Lega'} · campioni, record e classifica di tutti i tempi.`}
        action={(
          <Button
            variant="outlined"
            borderRadius="$4"
            disabled={loading}
            icon={loading ? undefined : RefreshCw}
            onPress={() => { void loadHall() }}
          >
            {loading ? <Spinner /> : 'Aggiorna'}
          </Button>
        )}
      />

      {error ? (
        <Surface accent="red" padding="$3">
          <Paragraph color="$red11">{error}</Paragraph>
        </Surface>
      ) : null}

      {!error && loading && !hall ? (
        <YStack minHeight={220} alignItems="center" justifyContent="center" gap="$3">
          <Spinner size="large" />
          <Text color="$color9">Ricostruisco la storia della lega…</Text>
        </YStack>
      ) : null}

      {!error && !loading && !hall ? (
        <Surface padding="$5">
          <YStack minHeight={160} alignItems="center" justifyContent="center" gap="$3">
            <Trophy size="$2" color="$color8" />
            <Paragraph color="$color10" textAlign="center">Hall of Fame non ancora materializzata per questa lega.</Paragraph>
          </YStack>
        </Surface>
      ) : null}

      {hall?.recordGame ? (
        <Surface accent="yellow" padding="$5">
          <XStack gap="$4" justifyContent="space-between" alignItems="center" flexWrap="wrap">
            <XStack gap="$3" alignItems="center" flex={1} minWidth={260}>
              <YStack width={50} height={50} borderRadius="$5" backgroundColor="$yellow4" alignItems="center" justifyContent="center">
                <Crown size="$1.3" color="$yellow10" />
              </YStack>
              <YStack gap="$1" flex={1}>
                <Text color="$yellow10" fontSize="$1" fontWeight="900" textTransform="uppercase">Record partita</Text>
                <Text color="$color12" fontSize="$6" fontWeight="900">{hall.recordGame.game.home} vs {hall.recordGame.game.away}</Text>
                <Text color="$color9">Stagione {hall.recordGame.year}</Text>
              </YStack>
            </XStack>
            <Text color="$color12" fontSize="$8" fontWeight="900">
              {hall.recordGame.game.result?.home.value.toFixed(1)} - {hall.recordGame.game.result?.away.value.toFixed(1)}
            </Text>
          </XStack>
        </Surface>
      ) : null}

      <XStack gap="$3" flexWrap="wrap" alignItems="flex-start">
        {winningTeams.length > 0 ? (
          <YStack flexGrow={1} flexBasis={500} minWidth={280}>
            <RankingPanel title="Squadre più vincenti" icon={<Trophy size="$1.2" color="$blue10" />}>
              {winningTeams.map((team, index) => (
                <HallRow
                  key={team.owner}
                  rank={index + 1}
                  title={team.teamName}
                  description={winsLabel(team.wins)}
                  value={`${HallOfFameHelper.totalWins(team)} titoli`}
                />
              ))}
            </RankingPanel>
          </YStack>
        ) : null}

        {rankings.length > 0 ? (
          <YStack flexGrow={1} flexBasis={500} minWidth={280}>
            <RankingPanel title="Classifica all-time" icon={<Medal size="$1.2" color="$purple10" />}>
              {rankings.map((team, index) => (
                <HallRow
                  key={`${team.owner}-${index}`}
                  rank={index + 1}
                  title={team.name}
                  description={`${team.owner} · ${team.victories} vittorie`}
                  value={`${team.point} pt`}
                />
              ))}
            </RankingPanel>
          </YStack>
        ) : null}
      </XStack>

      {winningPlayers.length > 0 ? (
        <RankingPanel title="Giocatori più vincenti" icon={<Crown size="$1.2" color="$yellow10" />}>
          <XStack gap="$2" flexWrap="wrap" alignItems="stretch">
            {winningPlayers.slice(0, 30).map((entry, index) => (
              <YStack
                key={`${entry.player.name}-${index}`}
                flexGrow={1}
                flexBasis={300}
                minWidth={260}
                padding="$3"
                borderRadius="$4"
                backgroundColor="$color3"
                borderWidth={1}
                borderColor="$color4"
                gap="$2"
              >
                <XStack justifyContent="space-between" alignItems="center" gap="$2">
                  <StatusPill tone={index < 3 ? 'yellow' : 'neutral'}>#{index + 1}</StatusPill>
                  <Text color="$color12" fontWeight="900" fontSize="$5">{HallOfFameHelper.totalWins(entry)}</Text>
                </XStack>
                <Text color="$color12" fontWeight="900" fontSize="$4" numberOfLines={1}>{entry.player.name}</Text>
                <Text color="$color9" fontSize="$2" numberOfLines={2}>{entry.player.team.name} · {winsLabel(entry.wins)}</Text>
              </YStack>
            ))}
          </XStack>
        </RankingPanel>
      ) : null}
    </AppScreen>
  )
}

function RankingPanel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Surface padding="$4">
      <YStack gap="$4">
        <XStack gap="$2" alignItems="center">
          {icon}
          <Text color="$color12" fontSize="$6" fontWeight="900">{title}</Text>
        </XStack>
        <YStack gap="$1">{children}</YStack>
      </YStack>
    </Surface>
  )
}

function HallRow({ rank, title, description, value }: { rank: number; title: string; description: string; value: string }) {
  return (
    <XStack gap="$3" alignItems="center" paddingVertical="$2.5" borderBottomWidth={1} borderBottomColor="$color4">
      <YStack width={34} height={34} borderRadius="$10" backgroundColor={rank <= 3 ? '$yellow3' : '$color3'} alignItems="center" justifyContent="center">
        <Text color={rank <= 3 ? '$yellow10' : '$color9'} fontWeight="900">{rank}</Text>
      </YStack>
      <YStack flex={1} minWidth={0}>
        <Text color="$color12" fontWeight="900" numberOfLines={1}>{title}</Text>
        <Text color="$color9" fontSize="$2" numberOfLines={1}>{description}</Text>
      </YStack>
      <Text color="$color12" fontWeight="900" textAlign="right">{value}</Text>
    </XStack>
  )
}

function winsLabel(wins: Record<string, number[]>): string {
  return Object.entries(wins).flatMap(([round, years]) => years.map(year => `${round} ${year}`)).join(' · ')
}
