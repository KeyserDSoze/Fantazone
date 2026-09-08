import React, { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, Users } from '@tamagui/lucide-icons-2'
import { Button, Input, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  Role,
  StatPlayerHelper,
  createEmptyStatPlayer,
  formatSeasonFromYear,
  getPlayerKey,
  type StatPlayer,
} from '@fantazone/domain'
import { GitHubStatPlayersRepository } from '@fantazone/github'
import { AppScreen, PageIntro, StatusPill, Surface } from '../components/design-system'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  selection: GroupNavigationSelection
}

type SortMode = 'fanta' | 'average' | 'goals' | 'name'

export function GroupPlayersScreen({ runtime, selection }: Props) {
  const [players, setPlayers] = useState<StatPlayer[]>([])
  const [untilDay, setUntilDay] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<Role | null>(null)
  const [activeOnly, setActiveOnly] = useState(true)
  const [sortMode, setSortMode] = useState<SortMode>('fanta')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const statsRepository = useMemo(() => new GitHubStatPlayersRepository(runtime.store, runtime.platformTarget), [runtime])

  async function loadPlayers() {
    if (selection.year == null) {
      setPlayers([])
      setUntilDay(null)
      setError('Seleziona una stagione per visualizzare i giocatori.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [master, stats] = await Promise.all([
        runtime.realPlayersRepository.getPlayers(selection.year, { refresh: true }),
        statsRepository.getStats(selection.year, { refresh: true }),
      ])
      if (!master) throw new Error('Il master giocatori Serie A non è ancora disponibile per questa stagione.')
      const byKey = new Map((stats?.players ?? []).map(player => [getPlayerKey(player.name), player] as const))
      const combined = master.players.map(player => byKey.get(getPlayerKey(player.name)) ?? createEmptyStatPlayer(player))
      setPlayers(combined)
      setUntilDay(stats?.untilSerieADay ?? null)
    } catch (caught) {
      setPlayers([])
      setUntilDay(null)
      setError(caught instanceof Error ? caught.message : 'Impossibile caricare i giocatori.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPlayers()
  }, [runtime, statsRepository, selection.year])

  const visiblePlayers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('it-IT')
    let values = players.filter(player =>
      (!activeOnly || player.isActive) &&
      (role == null || player.role === role) &&
      (!needle || player.name.toLocaleLowerCase('it-IT').includes(needle) || player.team.name.toLocaleLowerCase('it-IT').includes(needle)),
    )
    switch (sortMode) {
      case 'average': values = StatPlayerHelper.sortByAverage(values); break
      case 'goals': values = [...values].sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name, 'it-IT')); break
      case 'name': values = [...values].sort((a, b) => a.name.localeCompare(b.name, 'it-IT', { sensitivity: 'base' })); break
      case 'fanta':
      default: values = StatPlayerHelper.sortByFantaAverage(values); break
    }
    return values
  }, [players, query, role, activeOnly, sortMode])

  return (
    <AppScreen maxWidth={1180}>
      <PageIntro
        eyebrow="Serie A"
        title="Tutti i giocatori"
        description={`${selection.year != null ? `${formatSeasonFromYear(selection.year)} · ` : ''}${untilDay ? `statistiche aggiornate fino alla ${untilDay}ª giornata.` : 'esplora il master giocatori e le statistiche disponibili.'}`}
        action={(
          <Button
            variant="outlined"
            borderRadius="$4"
            disabled={loading}
            icon={loading ? undefined : RefreshCw}
            onPress={() => { void loadPlayers() }}
          >
            {loading ? <Spinner /> : 'Aggiorna'}
          </Button>
        )}
      />

      <Surface padding="$4">
        <YStack gap="$4">
          <XStack alignItems="center" gap="$2">
            <Search size="$1" color="$color9" />
            <Text color="$color12" fontWeight="900">Trova e confronta</Text>
          </XStack>
          <Input
            size="$4"
            borderRadius="$4"
            value={query}
            onChangeText={setQuery}
            placeholder="Cerca giocatore o squadra Serie A"
            autoCorrect={false}
          />

          <YStack gap="$2">
            <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Ruolo e stato</Text>
            <XStack gap="$2" flexWrap="wrap">
              <FilterButton label="Tutti" active={role == null} onPress={() => setRole(null)} />
              <FilterButton label="Portieri" active={role === Role.GoalKeeper} onPress={() => setRole(Role.GoalKeeper)} />
              <FilterButton label="Difensori" active={role === Role.Defensor} onPress={() => setRole(Role.Defensor)} />
              <FilterButton label="Centrocampisti" active={role === Role.Midfielder} onPress={() => setRole(Role.Midfielder)} />
              <FilterButton label="Attaccanti" active={role === Role.Forward} onPress={() => setRole(Role.Forward)} />
              <FilterButton label={activeOnly ? 'Solo attivi' : 'Anche inattivi'} active={activeOnly} onPress={() => setActiveOnly(value => !value)} />
            </XStack>
          </YStack>

          <YStack gap="$2">
            <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Ordina per</Text>
            <XStack gap="$2" flexWrap="wrap">
              <FilterButton label="Fantamedia" active={sortMode === 'fanta'} onPress={() => setSortMode('fanta')} />
              <FilterButton label="Media voto" active={sortMode === 'average'} onPress={() => setSortMode('average')} />
              <FilterButton label="Gol" active={sortMode === 'goals'} onPress={() => setSortMode('goals')} />
              <FilterButton label="Nome" active={sortMode === 'name'} onPress={() => setSortMode('name')} />
            </XStack>
          </YStack>
        </YStack>
      </Surface>

      {error ? (
        <Surface accent="red" padding="$3">
          <Paragraph color="$red11">{error}</Paragraph>
        </Surface>
      ) : null}

      {!error && loading && players.length === 0 ? (
        <YStack minHeight={220} alignItems="center" justifyContent="center" gap="$3">
          <Spinner size="large" />
          <Text color="$color9">Caricamento giocatori…</Text>
        </YStack>
      ) : null}

      {!error && !loading ? (
        <XStack justifyContent="space-between" alignItems="center" gap="$3">
          <StatusPill tone="blue">{visiblePlayers.length} giocatori</StatusPill>
          <Text color="$color8" fontSize="$2">{activeOnly ? 'Solo attivi' : 'Attivi e inattivi'}</Text>
        </XStack>
      ) : null}

      {!error && !loading && visiblePlayers.length === 0 ? (
        <Surface padding="$4">
          <YStack minHeight={140} alignItems="center" justifyContent="center" gap="$3">
            <Users size="$2" color="$color8" />
            <Paragraph color="$color10" textAlign="center">Nessun giocatore corrisponde ai filtri selezionati.</Paragraph>
          </YStack>
        </Surface>
      ) : null}

      {!error ? (
        <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
          {visiblePlayers.map(player => (
            <YStack
              key={getPlayerKey(player.name)}
              flexGrow={1}
              flexBasis={340}
              minWidth={290}
              maxWidth={560}
              padding="$4"
              borderWidth={1}
              borderColor="$color5"
              backgroundColor="$color2"
              borderRadius="$5"
              opacity={player.isActive ? 1 : 0.52}
              gap="$4"
            >
              <XStack justifyContent="space-between" alignItems="flex-start" gap="$3">
                <YStack flex={1} minWidth={0} gap="$1">
                  <Text color="$color12" fontWeight="900" fontSize="$5" numberOfLines={1}>{player.name}</Text>
                  <Text color="$color9" numberOfLines={1}>{roleLabel(player.role)} · {player.team.name}</Text>
                </YStack>
                <StatusPill tone={player.isActive ? 'green' : 'neutral'}>{player.isActive ? 'Attivo' : 'Inattivo'}</StatusPill>
              </XStack>

              <XStack gap="$2" flexWrap="wrap">
                <PlayerMetric label="MV" value={StatPlayerHelper.average(player).toFixed(2)} emphasized={false} />
                <PlayerMetric label="FM" value={StatPlayerHelper.fantaAverage(player).toFixed(2)} emphasized />
                <PlayerMetric label="Voti" value={String(player.withVote)} emphasized={false} />
                <PlayerMetric label="Gol" value={String(player.goals + player.penalties)} emphasized={false} />
                <PlayerMetric label="Assist" value={String(player.assists)} emphasized={false} />
                {player.role === Role.GoalKeeper ? <PlayerMetric label="Gol subiti" value={String(player.sufferedGoals)} emphasized={false} /> : null}
              </XStack>
            </YStack>
          ))}
        </XStack>
      ) : null}
    </AppScreen>
  )
}

function FilterButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Button
      size="$3"
      borderRadius="$10"
      backgroundColor={active ? '$blue4' : '$color3'}
      borderColor={active ? '$blue7' : '$color5'}
      onPress={onPress}
    >
      <Text color={active ? '$blue11' : '$color10'} fontWeight="800">{label}</Text>
    </Button>
  )
}

function PlayerMetric({ label, value, emphasized }: { label: string; value: string; emphasized: boolean }) {
  return (
    <YStack
      flexGrow={1}
      flexBasis={66}
      minWidth={62}
      padding="$2.5"
      borderRadius="$3"
      backgroundColor={emphasized ? '$blue3' : '$color3'}
      borderWidth={1}
      borderColor={emphasized ? '$blue5' : '$color4'}
      gap="$1"
    >
      <Text color={emphasized ? '$blue10' : '$color8'} fontSize="$1" fontWeight="900">{label}</Text>
      <Text color="$color12" fontSize="$4" fontWeight="900">{value}</Text>
    </YStack>
  )
}

function roleLabel(role: Role): string {
  switch (role) {
    case Role.GoalKeeper: return 'Portiere'
    case Role.Defensor: return 'Difensore'
    case Role.Midfielder: return 'Centrocampista'
    case Role.Forward: return 'Attaccante'
    default: return 'Ruolo non definito'
  }
}
