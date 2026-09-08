import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, CheckCircle2, RefreshCw, WalletCards } from '@tamagui/lucide-icons-2'
import { Button, Input, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  MarketType,
  PlayerInTeamStatus,
  Role,
  getCurrentSeasonYear,
  getPlayerKey,
  formatSeasonFromYear,
  type AuthenticatedGroupSession,
  type EnhancedTeam,
  type Player,
} from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  selection: GroupNavigationSelection
}

type LoadedTeam = { basketId: string; team: EnhancedTeam }

export function GroupMarketCreateScreen({ runtime, session, selection }: Props) {
  const [teams, setTeams] = useState<LoadedTeam[]>([])
  const [targetOwner, setTargetOwner] = useState<string | null>(null)
  const [myPlayers, setMyPlayers] = useState<string[]>([])
  const [targetPlayers, setTargetPlayers] = useState<string[]>([])
  const [myMoney, setMyMoney] = useState('0')
  const [targetMoney, setTargetMoney] = useState('0')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null
  const annual = selection.year != null ? league?.years.find(item => item.year === selection.year) ?? null : null
  const isCurrentSeason = selection.year != null && selection.year === getCurrentSeasonYear(new Date())
  const marketEnabled = annual?.settings.market !== MarketType.Denied

  async function loadTeams() {
    if (!league || selection.year == null) {
      setTeams([])
      setError('Seleziona una lega e una stagione.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const requests: Array<Promise<LoadedTeam | null>> = []
      for (const basketId of league.basketsId) {
        const yearly = runtime.group.baskets.find(item => item.id === basketId)?.years.find(item => item.year === selection.year)
        for (const annualTeam of yearly?.teams ?? []) {
          requests.push(runtime.teamRepository.getEnhancedTeam(basketId, selection.year, annualTeam.owner, {
            leagueId: league.id,
            leagueSettings: annual?.settings,
          }).then(team => team ? { basketId, team } : null))
        }
      }
      const loaded = (await Promise.all(requests)).filter((item): item is LoadedTeam => item !== null)
      setTeams(loaded)
      setTargetOwner(current => current && loaded.some(item => same(item.team.owner, current)) ? current : null)
    } catch (caught) {
      setTeams([])
      setError(caught instanceof Error ? caught.message : 'Impossibile caricare le squadre per il mercato.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setTargetOwner(null)
    setMyPlayers([])
    setTargetPlayers([])
    setMyMoney('0')
    setTargetMoney('0')
    setStatus(null)
    void loadTeams()
  }, [runtime, selection.leagueId, selection.year])

  const myEntry = teams.find(item => same(item.team.owner, session.member.email)) ?? null
  const targetEntry = targetOwner ? teams.find(item => same(item.team.owner, targetOwner)) ?? null : null
  const availableTargets = teams.filter(item => !same(item.team.owner, session.member.email))
  const roleBalanced = useMemo(() => sameRoleCounts(
    activeSelected(myEntry?.team.players ?? [], myPlayers),
    activeSelected(targetEntry?.team.players ?? [], targetPlayers),
  ), [myEntry, targetEntry, myPlayers, targetPlayers])
  const canSubmit = isCurrentSeason && marketEnabled && myEntry != null && targetEntry != null && myPlayers.length > 0 && targetPlayers.length > 0 && roleBalanced

  async function submitTrade() {
    if (!league || selection.year == null || !targetEntry || !canSubmit) return
    setSubmitting(true)
    setError(null)
    setStatus(null)
    try {
      const submitted = await runtime.marketService.create({
        session,
        leagueId: league.id,
        season: selection.year,
        seller: targetEntry.team.owner,
        buyerPlayerKeys: myPlayers,
        sellerPlayerKeys: targetPlayers,
        moneyFromBuyer: parseMoney(myMoney),
        moneyFromSeller: parseMoney(targetMoney),
      })
      setStatus(`Proposta inviata (${submitted.command.id}). La GitHub Action la rivaliderà sullo stato corrente prima di applicarla.`)
      setTargetOwner(null)
      setMyPlayers([])
      setTargetPlayers([])
      setMyMoney('0')
      setTargetMoney('0')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossibile inviare la proposta.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppScreen maxWidth={1180}>
      <PageIntro
        eyebrow={league?.name ?? 'Mercato'}
        title="Crea uno scambio"
        description={`${selection.year != null ? `${formatSeasonFromYear(selection.year)} · ` : ''}costruisci una proposta bilanciata e inviala alla lega.`}
        action={(
          <Button
            variant="outlined"
            borderRadius="$4"
            disabled={loading}
            icon={loading ? undefined : RefreshCw}
            onPress={() => { void loadTeams() }}
          >
            {loading ? <Spinner /> : 'Aggiorna rose'}
          </Button>
        )}
      />

      {!isCurrentSeason ? (
        <Surface accent="yellow" padding="$3">
          <Paragraph color="$yellow11">Il mercato può modificare le rose solo nella stagione corrente.</Paragraph>
        </Surface>
      ) : null}
      {!marketEnabled ? (
        <Surface accent="yellow" padding="$3">
          <Paragraph color="$yellow11">Il mercato è disabilitato nelle impostazioni di questa lega.</Paragraph>
        </Surface>
      ) : null}
      {error ? (
        <Surface accent="red" padding="$3"><Paragraph color="$red11">{error}</Paragraph></Surface>
      ) : null}
      {status ? (
        <Surface accent="green" padding="$3"><Paragraph color="$green11">{status}</Paragraph></Surface>
      ) : null}

      {loading ? (
        <YStack minHeight={180} alignItems="center" justifyContent="center" gap="$3">
          <Spinner size="large" />
          <Text color="$color9">Caricamento rose…</Text>
        </YStack>
      ) : null}

      {!loading && isCurrentSeason && marketEnabled && !myEntry ? (
        <Surface padding="$4">
          <Paragraph color="$color10">Non risulti owner di una squadra in questa lega. I co-owner non possono creare scambi a nome dell’owner canonico.</Paragraph>
        </Surface>
      ) : null}

      {!loading && myEntry && isCurrentSeason && marketEnabled ? (
        <YStack gap="$4">
          <Surface accent="blue" padding="$4">
            <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
              <YStack gap="$1">
                <StatusPill tone="blue">La tua squadra</StatusPill>
                <Text color="$color12" fontSize="$6" fontWeight="900">{myEntry.team.name}</Text>
              </YStack>
              <XStack alignItems="center" gap="$2">
                <WalletCards size="$1.2" color="$blue10" />
                <YStack alignItems="flex-end">
                  <Text color="$color8" fontSize="$1" fontWeight="900">BUDGET TEORICO</Text>
                  <Text color="$color12" fontSize="$6" fontWeight="900">{money((annual?.settings.startingMoney ?? 0) - myEntry.team.cost)}</Text>
                </YStack>
              </XStack>
            </XStack>
          </Surface>

          <Surface padding="$4">
            <YStack gap="$3">
              <Text color="$color12" fontSize="$6" fontWeight="900">1. Scegli la controparte</Text>
              <Paragraph color="$color9">Seleziona la squadra con cui vuoi costruire la proposta.</Paragraph>
              <XStack gap="$2" flexWrap="wrap">
                {availableTargets.map(item => {
                  const active = same(targetOwner ?? '', item.team.owner)
                  return (
                    <Button
                      key={item.team.owner}
                      borderRadius="$10"
                      backgroundColor={active ? '$blue4' : '$color3'}
                      borderColor={active ? '$blue7' : '$color5'}
                      onPress={() => {
                        setTargetOwner(item.team.owner)
                        setTargetPlayers([])
                      }}
                    >
                      <Text color={active ? '$blue11' : '$color10'} fontWeight="800">{item.team.name}</Text>
                    </Button>
                  )
                })}
              </XStack>
            </YStack>
          </Surface>

          {targetEntry ? (
            <>
              <XStack gap="$4" flexWrap="wrap" alignItems="flex-start">
                <YStack flexGrow={1} flexBasis={500} minWidth={0}>
                  <PlayerSelector title={`${myEntry.team.name} cede`} players={myEntry.team.players} selected={myPlayers} onToggle={key => toggleKey(myPlayers, setMyPlayers, key)} />
                </YStack>
                <YStack flexGrow={1} flexBasis={500} minWidth={0}>
                  <PlayerSelector title={`${targetEntry.team.name} cede`} players={targetEntry.team.players} selected={targetPlayers} onToggle={key => toggleKey(targetPlayers, setTargetPlayers, key)} />
                </YStack>
              </XStack>

              <Surface accent={roleBalanced ? 'green' : 'yellow'} padding="$4">
                <YStack gap="$4">
                  <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
                    <YStack gap="$1">
                      <Text color="$color12" fontSize="$6" fontWeight="900">2. Conguaglio</Text>
                      <Paragraph color="$color10">Lo scambio deve avere lo stesso numero di giocatori per ogni ruolo.</Paragraph>
                    </YStack>
                    <StatusPill tone={roleBalanced ? 'green' : 'yellow'}>
                      {roleBalanced ? 'Ruoli bilanciati' : 'Da bilanciare'}
                    </StatusPill>
                  </XStack>

                  <XStack gap="$3" flexWrap="wrap">
                    <YStack flex={1} minWidth={220} gap="$2">
                      <Text color="$color12" fontWeight="800">{myEntry.team.name} aggiunge</Text>
                      <Input size="$4" borderRadius="$4" value={myMoney} onChangeText={setMyMoney} keyboardType="numeric" placeholder="0" />
                    </YStack>
                    <YStack flex={1} minWidth={220} gap="$2">
                      <Text color="$color12" fontWeight="800">{targetEntry.team.name} aggiunge</Text>
                      <Input size="$4" borderRadius="$4" value={targetMoney} onChangeText={setTargetMoney} keyboardType="numeric" placeholder="0" />
                    </YStack>
                  </XStack>

                  <PrimaryAction
                    disabled={!canSubmit || submitting}
                    onPress={() => { void submitTrade() }}
                    icon={submitting ? <Spinner color="white" /> : <ArrowRightLeft size="$1" color="white" />}
                  >
                    {submitting ? 'Invio proposta…' : 'Invia proposta'}
                  </PrimaryAction>
                </YStack>
              </Surface>
            </>
          ) : null}
        </YStack>
      ) : null}
    </AppScreen>
  )
}

function PlayerSelector({ title, players, selected, onToggle }: { title: string; players: Player[]; selected: string[]; onToggle: (key: string) => void }) {
  const active = players.filter(player => player.status === PlayerInTeamStatus.Active).sort((a, b) => a.role - b.role || b.price - a.price)
  return (
    <Surface padding="$4">
      <YStack gap="$3">
        <XStack justifyContent="space-between" alignItems="center">
          <Text color="$color12" fontSize="$6" fontWeight="900">{title}</Text>
          <StatusPill tone={selected.length > 0 ? 'blue' : 'neutral'}>{selected.length} scelti</StatusPill>
        </XStack>
        {active.map(player => {
          const key = getPlayerKey(player.name)
          const checked = selected.includes(key)
          return (
            <Button
              key={key}
              minHeight={52}
              borderRadius="$4"
              backgroundColor={checked ? '$blue3' : '$color3'}
              borderColor={checked ? '$blue7' : '$color5'}
              justifyContent="space-between"
              icon={checked ? CheckCircle2 : undefined}
              onPress={() => onToggle(key)}
            >
              <Text flex={1} textAlign="left" color={checked ? '$blue11' : '$color11'} fontWeight="800" numberOfLines={1}>
                {roleShort(player.role)} · {player.name}
              </Text>
              <Text color="$color9" fontWeight="800">{money(player.price)}</Text>
            </Button>
          )
        })}
      </YStack>
    </Surface>
  )
}

function activeSelected(players: Player[], keys: string[]): Player[] {
  const wanted = new Set(keys)
  return players.filter(player => player.status === PlayerInTeamStatus.Active && wanted.has(getPlayerKey(player.name)))
}

function sameRoleCounts(first: Player[], second: Player[]): boolean {
  if (first.length === 0 || second.length === 0 || first.length !== second.length) return false
  for (const role of [Role.GoalKeeper, Role.Defensor, Role.Midfielder, Role.Forward]) {
    if (first.filter(player => player.role === role).length !== second.filter(player => player.role === role).length) return false
  }
  return true
}

function toggleKey(current: string[], setCurrent: (value: string[]) => void, key: string) {
  setCurrent(current.includes(key) ? current.filter(value => value !== key) : [...current, key])
}

function parseMoney(value: string): number {
  const parsed = Number.parseInt(value.trim() || '0', 10)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error('Gli importi devono essere interi non negativi.')
  return parsed
}

function roleShort(role: Role): string {
  switch (role) {
    case Role.GoalKeeper: return 'P'
    case Role.Defensor: return 'D'
    case Role.Midfielder: return 'C'
    case Role.Forward: return 'A'
    default: return '?'
  }
}

function money(value: number): string {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(value)
}

function same(first: string, second: string): boolean {
  return first.trim().toLowerCase() === second.trim().toLowerCase()
}
