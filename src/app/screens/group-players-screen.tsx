import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, H1, Input, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  Role,
  StatPlayerHelper,
  createEmptyStatPlayer,
  formatSeasonFromYear,
  getPlayerKey,
  type StatPlayer,
} from '@fantazone/domain'
import { GitHubStatPlayersRepository } from '@fantazone/github'
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
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1120} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1">
            <H1>Tutti i giocatori</H1>
            <Paragraph color="$color10">
              Serie A{selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}{untilDay ? ` · statistiche fino alla ${untilDay}ª` : ' · statistiche non ancora disponibili'}
            </Paragraph>
          </YStack>
          <Button variant="outlined" disabled={loading} onPress={() => { void loadPlayers() }}>{loading ? <Spinner /> : 'Aggiorna'}</Button>
        </XStack>

        <Card borderWidth={1} borderColor="$borderColor" padding="$4">
          <YStack gap="$3">
            <Input value={query} onChangeText={setQuery} placeholder="Cerca giocatore o squadra Serie A" autoCorrect={false} />
            <XStack gap="$2" flexWrap="wrap">
              <FilterButton label="Tutti i ruoli" active={role == null} onPress={() => setRole(null)} />
              <FilterButton label="P" active={role === Role.GoalKeeper} onPress={() => setRole(Role.GoalKeeper)} />
              <FilterButton label="D" active={role === Role.Defensor} onPress={() => setRole(Role.Defensor)} />
              <FilterButton label="C" active={role === Role.Midfielder} onPress={() => setRole(Role.Midfielder)} />
              <FilterButton label="A" active={role === Role.Forward} onPress={() => setRole(Role.Forward)} />
              <FilterButton label={activeOnly ? 'Solo attivi' : 'Anche inattivi'} active={activeOnly} onPress={() => setActiveOnly(value => !value)} />
            </XStack>
            <XStack gap="$2" flexWrap="wrap">
              <FilterButton label="Fantamedia" active={sortMode === 'fanta'} onPress={() => setSortMode('fanta')} />
              <FilterButton label="Media voto" active={sortMode === 'average'} onPress={() => setSortMode('average')} />
              <FilterButton label="Gol" active={sortMode === 'goals'} onPress={() => setSortMode('goals')} />
              <FilterButton label="Nome" active={sortMode === 'name'} onPress={() => setSortMode('name')} />
            </XStack>
          </YStack>
        </Card>

        {error ? <Card borderWidth={1} borderColor="$red8" padding="$4"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {!error && loading && players.length === 0 ? <Spinner size="large" /> : null}
        {!error && !loading ? <Text color="$color9">{visiblePlayers.length} giocatori</Text> : null}

        {!error ? visiblePlayers.map(player => (
          <Card key={getPlayerKey(player.name)} borderWidth={1} borderColor="$borderColor" padding="$3" opacity={player.isActive ? 1 : 0.55}>
            <XStack gap="$3" alignItems="center" flexWrap="wrap">
              <YStack flex={1} minWidth={220}>
                <Text fontWeight="900" fontSize="$5" numberOfLines={1}>{player.name}</Text>
                <Text color="$color10" numberOfLines={1}>{roleLabel(player.role)} · {player.team.name}{player.isActive ? '' : ' · inattivo'}</Text>
              </YStack>
              <PlayerMetric label="MV" value={StatPlayerHelper.average(player).toFixed(2)} />
              <PlayerMetric label="FM" value={StatPlayerHelper.fantaAverage(player).toFixed(2)} />
              <PlayerMetric label="Voti" value={String(player.withVote)} />
              <PlayerMetric label="Gol" value={String(player.goals + player.penalties)} />
              <PlayerMetric label="Assist" value={String(player.assists)} />
              {player.role === Role.GoalKeeper ? <PlayerMetric label="Gol subiti" value={String(player.sufferedGoals)} /> : null}
            </XStack>
          </Card>
        )) : null}
      </YStack>
    </ScrollView>
  )
}

function FilterButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Button size="$3" variant="outlined" backgroundColor={active ? '$color4' : 'transparent'} borderColor={active ? '$blue8' : '$borderColor'} onPress={onPress}>{label}</Button>
}

function PlayerMetric({ label, value }: { label: string; value: string }) {
  return <YStack minWidth={55} alignItems="flex-end"><Text color="$color9" fontSize="$2">{label}</Text><Text fontWeight="900">{value}</Text></YStack>
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
