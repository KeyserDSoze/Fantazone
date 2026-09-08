import React, { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, RefreshCw, Users } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  PlayerInTeamStatus,
  Role,
  formatSeasonFromYear,
  type EnhancedTeam,
  type Player,
} from '@fantazone/domain'
import { AppScreen, PageIntro, StatusPill, Surface } from '../components/design-system'
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
    <AppScreen maxWidth={1180}>
      <PageIntro
        eyebrow={league?.name ?? 'Lega'}
        title="Le squadre"
        description={`${selection.year != null ? `${formatSeasonFromYear(selection.year)} · ` : ''}rose, valori e composizione delle squadre della tua lega.`}
        action={(
          <Button
            variant="outlined"
            borderRadius="$4"
            disabled={loading}
            icon={loading ? undefined : RefreshCw}
            onPress={() => { void loadTeams() }}
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

      {!error && loading && teams.length === 0 ? (
        <YStack minHeight={220} alignItems="center" justifyContent="center" gap="$3">
          <Spinner size="large" />
          <Text color="$color9">Caricamento squadre…</Text>
        </YStack>
      ) : null}

      {!error && !loading && teams.length === 0 ? (
        <Surface padding="$4">
          <YStack minHeight={150} alignItems="center" justifyContent="center" gap="$3">
            <Users size="$2" color="$color8" />
            <Paragraph color="$color10" textAlign="center">Nessuna squadra disponibile per questa lega e stagione.</Paragraph>
          </YStack>
        </Surface>
      ) : null}

      <XStack gap="$4" flexWrap="wrap" alignItems="flex-start">
        {teams.map(({ basketId, team }) => {
          const expanded = expandedOwner === team.owner
          return (
            <YStack key={`${basketId}-${team.owner}`} flexGrow={1} flexBasis={510} minWidth={300}>
              <Surface accent={expanded ? 'blue' : 'neutral'} padding="$4">
                <YStack gap="$4">
                  <XStack alignItems="flex-start" justifyContent="space-between" gap="$3">
                    <YStack flex={1} minWidth={0} gap="$1.5">
                      <Text color="$color12" fontSize="$6" fontWeight="900" numberOfLines={1}>{team.name}</Text>
                      <Text color="$color9" numberOfLines={1}>{team.owner}</Text>
                      {team.additionalOwners.length > 0 ? (
                        <Text color="$color8" fontSize="$2" numberOfLines={2}>Co-owner: {team.additionalOwners.join(', ')}</Text>
                      ) : null}
                    </YStack>
                    <StatusPill tone={expanded ? 'blue' : 'neutral'}>{team.activePlayers.length} attivi</StatusPill>
                  </XStack>

                  <XStack gap="$2" flexWrap="wrap">
                    <TeamMetric label="Giocatori" value={`${team.activePlayers.length}/${team.players.length}`} />
                    <TeamMetric label="Valore rosa" value={money(team.totalCost)} />
                    <TeamMetric label="Costo netto" value={money(team.netCost)} />
                    <TeamMetric label="Premi" value={money(team.moneyFromRank)} />
                  </XStack>

                  <Button
                    borderRadius="$4"
                    variant="outlined"
                    iconAfter={expanded ? ChevronUp : ChevronDown}
                    onPress={() => setExpandedOwner(expanded ? null : team.owner)}
                  >
                    {expanded ? 'Chiudi rosa' : 'Apri rosa'}
                  </Button>

                  {expanded ? (
                    <YStack gap="$5" paddingTop="$1">
                      {ROLE_ORDER.map(role => {
                        const players = team.players
                          .filter(player => player.role === role)
                          .sort((a, b) => Number(a.status !== PlayerInTeamStatus.Active) - Number(b.status !== PlayerInTeamStatus.Active) || b.price - a.price)
                        if (players.length === 0) return null
                        return (
                          <YStack key={role} gap="$2">
                            <XStack alignItems="center" justifyContent="space-between">
                              <Text color="$color12" fontSize="$5" fontWeight="900">{roleLabel(role)}</Text>
                              <Text color="$color8" fontSize="$2">{players.length}</Text>
                            </XStack>
                            {players.map(player => <TeamPlayerRow key={`${player.name}-${player.status}`} player={player} />)}
                          </YStack>
                        )
                      })}
                    </YStack>
                  ) : null}
                </YStack>
              </Surface>
            </YStack>
          )
        })}
      </XStack>
    </AppScreen>
  )
}

function TeamMetric({ label, value }: { label: string; value: string }) {
  return (
    <YStack
      flexGrow={1}
      flexBasis={105}
      minWidth={98}
      padding="$2.5"
      borderRadius="$3"
      backgroundColor="$color3"
      borderWidth={1}
      borderColor="$color4"
      gap="$1"
    >
      <Text color="$color8" fontSize="$1" fontWeight="800" textTransform="uppercase">{label}</Text>
      <Text color="$color12" fontSize="$4" fontWeight="900">{value}</Text>
    </YStack>
  )
}

function TeamPlayerRow({ player }: { player: Player }) {
  const active = player.status === PlayerInTeamStatus.Active
  return (
    <XStack
      gap="$3"
      alignItems="center"
      padding="$3"
      borderRadius="$3"
      backgroundColor="$color3"
      borderWidth={1}
      borderColor="$color4"
      opacity={active ? 1 : 0.5}
    >
      <YStack flex={1} minWidth={0}>
        <Text color="$color12" fontWeight="800" numberOfLines={1}>{player.name}</Text>
        <Text color="$color9" fontSize="$2" numberOfLines={1}>{player.team.name} · {statusLabel(player.status)}</Text>
      </YStack>
      <Text color="$color12" fontWeight="900">{money(player.price)}</Text>
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
