import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, H1, H2, H3, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  PlayerInTeamStatus,
  Role,
  formatSeasonFromYear,
  type EnhancedTeam,
  type Player,
} from '@fantazone/domain'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  selection: GroupNavigationSelection
}

type LoadedTeam = {
  basketId: string
  team: EnhancedTeam
}

export function GroupTeamsScreen({ runtime, selection }: Props) {
  const [teams, setTeams] = useState<LoadedTeam[]>([])
  const [expandedOwner, setExpandedOwner] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null
  const annualLeague = selection.year != null ? league?.years.find(item => item.year === selection.year) ?? null : null

  async function loadTeams() {
    if (!league || selection.year == null) {
      setTeams([])
      setError('Seleziona una lega e una stagione per visualizzare le squadre.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const requests: Array<Promise<LoadedTeam | null>> = []
      for (const basketId of league.basketsId) {
        const basket = runtime.group.baskets.find(item => item.id === basketId)
        const yearly = basket?.years.find(item => item.year === selection.year)
        for (const annualTeam of yearly?.teams ?? []) {
          requests.push(runtime.teamRepository.getEnhancedTeam(basketId, selection.year, annualTeam.owner, {
            leagueId: league.id,
            leagueSettings: annualLeague?.settings,
          }).then(team => team ? { basketId, team } : null))
        }
      }
      const loaded = (await Promise.all(requests)).filter((item): item is LoadedTeam => item !== null)
      loaded.sort((a, b) => a.team.name.localeCompare(b.team.name, 'it-IT', { sensitivity: 'base' }))
      setTeams(loaded)
      setExpandedOwner(current => current && loaded.some(item => item.team.owner === current) ? current : null)
    } catch (caught) {
      setTeams([])
      setError(caught instanceof Error ? caught.message : 'Impossibile caricare le squadre.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTeams()
  }, [runtime, selection.leagueId, selection.year])

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1120} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1">
            <H1>Le squadre</H1>
            <Paragraph color="$color10">
              {league?.name ?? 'Lega'}{selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}
            </Paragraph>
          </YStack>
          <Button variant="outlined" disabled={loading} onPress={() => { void loadTeams() }}>{loading ? <Spinner /> : 'Aggiorna'}</Button>
        </XStack>

        {error ? <Card borderWidth={1} borderColor="$red8" padding="$4"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {!error && loading && teams.length === 0 ? <Spinner size="large" /> : null}
        {!error && !loading && teams.length === 0 ? (
          <Card borderWidth={1} borderColor="$borderColor" padding="$4"><Paragraph color="$color10">Nessuna squadra disponibile per questa lega e stagione.</Paragraph></Card>
        ) : null}

        {teams.map(({ basketId, team }) => {
          const expanded = expandedOwner === team.owner
          return (
            <Card key={`${basketId}-${team.owner}`} borderWidth={1} borderColor={expanded ? '$blue8' : '$borderColor'} padding="$4">
              <YStack gap="$3">
                <XStack gap="$4" alignItems="center" justifyContent="space-between" flexWrap="wrap">
                  <YStack flex={1} minWidth={220} gap="$1">
                    <H2 size="$6">{team.name}</H2>
                    <Text color="$color10">{team.owner}</Text>
                    {team.additionalOwners.length > 0 ? <Text color="$color9" fontSize="$2">Co-owner: {team.additionalOwners.join(', ')}</Text> : null}
                  </YStack>
                  <XStack gap="$4" flexWrap="wrap">
                    <TeamMetric label="Giocatori" value={`${team.activePlayers.length}/${team.players.length}`} />
                    <TeamMetric label="Valore rosa" value={money(team.totalCost)} />
                    <TeamMetric label="Costo netto" value={money(team.netCost)} />
                    <TeamMetric label="Premi" value={money(team.moneyFromRank)} />
                  </XStack>
                  <Button size="$3" variant="outlined" onPress={() => setExpandedOwner(expanded ? null : team.owner)}>
                    {expanded ? 'Chiudi rosa' : 'Apri rosa'}
                  </Button>
                </XStack>

                {expanded ? (
                  <YStack gap="$4" paddingTop="$2">
                    {ROLE_ORDER.map(role => {
                      const players = team.players
                        .filter(player => player.role === role)
                        .sort((a, b) => Number(a.status !== PlayerInTeamStatus.Active) - Number(b.status !== PlayerInTeamStatus.Active) || b.price - a.price)
                      if (players.length === 0) return null
                      return (
                        <YStack key={role} gap="$2">
                          <H3>{roleLabel(role)}</H3>
                          {players.map(player => <TeamPlayerRow key={`${player.name}-${player.status}`} player={player} />)}
                        </YStack>
                      )
                    })}
                  </YStack>
                ) : null}
              </YStack>
            </Card>
          )
        })}
      </YStack>
    </ScrollView>
  )
}

function TeamMetric({ label, value }: { label: string; value: string }) {
  return <YStack minWidth={90}><Text color="$color9" fontSize="$2">{label}</Text><Text fontWeight="900">{value}</Text></YStack>
}

function TeamPlayerRow({ player }: { player: Player }) {
  const active = player.status === PlayerInTeamStatus.Active
  return (
    <XStack gap="$3" alignItems="center" padding="$3" borderRadius="$3" backgroundColor="$color2" opacity={active ? 1 : 0.55}>
      <YStack flex={1} minWidth={0}>
        <Text fontWeight="800" numberOfLines={1}>{player.name}</Text>
        <Text color="$color9" fontSize="$2" numberOfLines={1}>{player.team.name} · {statusLabel(player.status)}</Text>
      </YStack>
      <Text color="$color10">{money(player.price)}</Text>
    </XStack>
  )
}

const ROLE_ORDER = [Role.GoalKeeper, Role.Defensor, Role.Midfielder, Role.Forward] as const

function roleLabel(role: Role): string {
  switch (role) {
    case Role.GoalKeeper: return 'Portieri'
    case Role.Defensor: return 'Difensori'
    case Role.Midfielder: return 'Centrocampisti'
    case Role.Forward: return 'Attaccanti'
    default: return 'Altro'
  }
}

function statusLabel(status: PlayerInTeamStatus): string {
  switch (status) {
    case PlayerInTeamStatus.Active: return 'In squadra'
    case PlayerInTeamStatus.SoldForOneHalf: return 'Venduto metà prezzo'
    case PlayerInTeamStatus.SoldWithNoReturnedPrice: return 'Venduto senza rimborso'
    case PlayerInTeamStatus.Sold: return 'Venduto'
    case PlayerInTeamStatus.Removed: return 'Rimosso'
    default: return 'Stato sconosciuto'
  }
}

function money(value: number): string {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(value)
}
