import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, H1, H2, Input, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
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
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1160} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <YStack gap="$1" paddingTop="$2">
          <H1>Crea scambio</H1>
          <Paragraph color="$color10">{league?.name ?? 'Lega'}{selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}</Paragraph>
        </YStack>

        {!isCurrentSeason ? <Card borderWidth={1} borderColor="$yellow8" padding="$4"><Paragraph>Il mercato può modificare le rose solo nella stagione corrente.</Paragraph></Card> : null}
        {!marketEnabled ? <Card borderWidth={1} borderColor="$yellow8" padding="$4"><Paragraph>Il mercato è disabilitato nelle impostazioni di questa lega.</Paragraph></Card> : null}
        {error ? <Card borderWidth={1} borderColor="$red8" padding="$4"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {status ? <Card borderWidth={1} borderColor="$green8" padding="$4"><Paragraph color="$green10">{status}</Paragraph></Card> : null}
        {loading ? <Spinner size="large" /> : null}

        {!loading && isCurrentSeason && marketEnabled && !myEntry ? (
          <Card borderWidth={1} borderColor="$borderColor" padding="$4"><Paragraph color="$color10">Non risulti owner di una squadra in questa lega. I co-owner non possono creare scambi a nome dell’owner canonico.</Paragraph></Card>
        ) : null}

        {!loading && myEntry && isCurrentSeason && marketEnabled ? (
          <>
            <Card borderWidth={1} borderColor="$blue8" padding="$4">
              <YStack gap="$2">
                <H2 size="$6">La tua squadra · {myEntry.team.name}</H2>
                <Text color="$color10">Budget teorico disponibile: {money((annual?.settings.startingMoney ?? 0) - myEntry.team.cost)}</Text>
              </YStack>
            </Card>

            <Card borderWidth={1} borderColor="$borderColor" padding="$4">
              <YStack gap="$3">
                <H2 size="$6">1. Scegli la controparte</H2>
                <XStack gap="$2" flexWrap="wrap">
                  {availableTargets.map(item => (
                    <Button key={item.team.owner} variant="outlined" backgroundColor={same(targetOwner ?? '', item.team.owner) ? '$color4' : 'transparent'} borderColor={same(targetOwner ?? '', item.team.owner) ? '$blue8' : '$borderColor'} onPress={() => {
                      setTargetOwner(item.team.owner)
                      setTargetPlayers([])
                    }}>{item.team.name}</Button>
                  ))}
                </XStack>
              </YStack>
            </Card>

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

                <Card borderWidth={1} borderColor={roleBalanced ? '$green8' : '$yellow8'} padding="$4">
                  <YStack gap="$3">
                    <H2 size="$6">2. Conguaglio</H2>
                    <Paragraph color="$color10">Lo scambio deve contenere lo stesso numero di giocatori per ogni ruolo. La Action ricontrollerà anche disponibilità e budget.</Paragraph>
                    <XStack gap="$3" flexWrap="wrap">
                      <YStack flex={1} minWidth={220} gap="$1"><Text>{myEntry.team.name} aggiunge</Text><Input value={myMoney} onChangeText={setMyMoney} keyboardType="numeric" placeholder="0" /></YStack>
                      <YStack flex={1} minWidth={220} gap="$1"><Text>{targetEntry.team.name} aggiunge</Text><Input value={targetMoney} onChangeText={setTargetMoney} keyboardType="numeric" placeholder="0" /></YStack>
                    </XStack>
                    <Text color={roleBalanced ? '$green10' : '$yellow10'} fontWeight="800">{roleBalanced ? 'Ruoli bilanciati' : 'Ruoli non bilanciati'}</Text>
                    <Button theme="accent" disabled={!canSubmit || submitting} onPress={() => { void submitTrade() }}>{submitting ? <Spinner /> : 'Invia proposta'}</Button>
                  </YStack>
                </Card>
              </>
            ) : null}
          </>
        ) : null}
      </YStack>
    </ScrollView>
  )
}

function PlayerSelector({ title, players, selected, onToggle }: { title: string; players: Player[]; selected: string[]; onToggle: (key: string) => void }) {
  const active = players.filter(player => player.status === PlayerInTeamStatus.Active).sort((a, b) => a.role - b.role || b.price - a.price)
  return (
    <Card borderWidth={1} borderColor="$borderColor" padding="$4">
      <YStack gap="$3">
        <H2 size="$6">{title}</H2>
        {active.map(player => {
          const key = getPlayerKey(player.name)
          const checked = selected.includes(key)
          return (
            <Button key={key} variant="outlined" backgroundColor={checked ? '$color4' : 'transparent'} borderColor={checked ? '$blue8' : '$borderColor'} justifyContent="space-between" onPress={() => onToggle(key)}>
              <Text flex={1} textAlign="left" numberOfLines={1}>{roleShort(player.role)} · {player.name}</Text>
              <Text>{money(player.price)}</Text>
            </Button>
          )
        })}
      </YStack>
    </Card>
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
