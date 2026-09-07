import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, H1, H2, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  MarketHelper,
  MarketStatus,
  MarketStatusHelper,
  MarketType,
  getCurrentSeasonYear,
  formatSeasonFromYear,
  type AuthenticatedGroupSession,
  type Market,
} from '@fantazone/domain'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  selection: GroupNavigationSelection
}

type Filter = 'all' | 'pending' | 'completed'

export function GroupMarketTradesScreen({ runtime, session, selection }: Props) {
  const [markets, setMarkets] = useState<Market[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null
  const annual = selection.year != null ? league?.years.find(item => item.year === selection.year) ?? null : null
  const isCurrentSeason = selection.year != null && selection.year === getCurrentSeasonYear(new Date())
  const canVote = isCurrentSeason && annual?.settings.market === MarketType.WithVote
  const teamNames = useMemo(() => buildTeamNames(runtime, selection), [runtime, selection.leagueId, selection.year])
  const leagueSize = teamNames.size
  const quorum = MarketHelper.calculateQuorum(leagueSize)

  async function loadMarkets() {
    if (!selection.leagueId || selection.year == null) {
      setMarkets([])
      setError('Seleziona una lega e una stagione.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const wrapper = await runtime.marketRepository.getMarket(selection.leagueId, selection.year, { refresh: true })
      setMarkets(wrapper.markets)
    } catch (caught) {
      setMarkets([])
      setError(caught instanceof Error ? caught.message : 'Impossibile caricare gli scambi.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setStatus(null)
    void loadMarkets()
  }, [runtime, selection.leagueId, selection.year])

  const visible = useMemo(() => {
    const source = filter === 'pending' ? MarketHelper.getActiveMarkets(markets)
      : filter === 'completed' ? MarketHelper.getCompletedMarkets(markets)
      : markets
    const pending = MarketHelper.sortByNewest(MarketHelper.getActiveMarkets(source))
    const completed = MarketHelper.sortByNewest(MarketHelper.getCompletedMarkets(source))
    return [...pending, ...completed]
  }, [markets, filter])

  async function submitAction(market: Market, kind: 'approve' | 'deny' | 'cancel') {
    if (!selection.leagueId || selection.year == null) return
    setActingId(market.id)
    setError(null)
    setStatus(null)
    try {
      const input = { session, leagueId: selection.leagueId, season: selection.year, marketId: market.id }
      const submitted = kind === 'approve'
        ? await runtime.marketService.approve(input)
        : kind === 'deny'
          ? await runtime.marketService.deny(input)
          : await runtime.marketService.cancel(input)
      setStatus(`Comando ${kind} inviato (${submitted.command.id}). Lo stato cambierà dopo la validazione della GitHub Action.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossibile inviare il comando mercato.')
    } finally {
      setActingId(null)
    }
  }

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1080} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1"><H1>Scambi</H1><Paragraph color="$color10">{league?.name ?? 'Lega'}{selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}</Paragraph></YStack>
          <Button variant="outlined" disabled={loading} onPress={() => { void loadMarkets() }}>{loading ? <Spinner /> : 'Aggiorna stato'}</Button>
        </XStack>

        <XStack gap="$2" flexWrap="wrap">
          <FilterButton label="Tutti" active={filter === 'all'} onPress={() => setFilter('all')} />
          <FilterButton label="In attesa" active={filter === 'pending'} onPress={() => setFilter('pending')} />
          <FilterButton label="Conclusi" active={filter === 'completed'} onPress={() => setFilter('completed')} />
        </XStack>

        {!isCurrentSeason ? <Card borderWidth={1} borderColor="$yellow8" padding="$3"><Paragraph>Lo storico è consultabile, ma i comandi mercato sono validi solo per la stagione corrente.</Paragraph></Card> : null}
        {error ? <Card borderWidth={1} borderColor="$red8" padding="$4"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {status ? <Card borderWidth={1} borderColor="$green8" padding="$4"><Paragraph color="$green10">{status}</Paragraph></Card> : null}
        {!error && loading && markets.length === 0 ? <Spinner size="large" /> : null}
        {!error && !loading && visible.length === 0 ? <Card borderWidth={1} borderColor="$borderColor" padding="$4"><Paragraph color="$color10">Nessuno scambio in questa vista.</Paragraph></Card> : null}

        {visible.map(market => {
          const pending = MarketStatusHelper.isPending(market.status)
          const involved = MarketHelper.isUserInvolved(market, session.member.email)
          const vote = MarketHelper.getUserVote(market, session.member.email)
          const canCastVote = pending && canVote && !involved && vote == null
          const canCancel = pending && isCurrentSeason && involved
          return (
            <Card key={market.id} borderWidth={1} borderColor={pending ? '$blue8' : '$borderColor'} padding="$4">
              <YStack gap="$3">
                <XStack justifyContent="space-between" gap="$3" alignItems="flex-start" flexWrap="wrap">
                  <YStack flex={1} minWidth={240}>
                    <H2 size="$6">{teamName(teamNames, market.buyer)} ⇄ {teamName(teamNames, market.seller)}</H2>
                    <Text color="$color9" fontSize="$2">{formatDate(market.creationTime)}</Text>
                  </YStack>
                  <Text fontWeight="900" color={statusColor(market.status)}>{MarketStatusHelper.asLabel(market.status)}</Text>
                </XStack>

                <XStack gap="$4" flexWrap="wrap">
                  <TradeSide title={`${teamName(teamNames, market.buyer)} cede`} players={market.buyerPlayers.map(player => player.name)} money={market.moneyFromBuyer} />
                  <TradeSide title={`${teamName(teamNames, market.seller)} cede`} players={market.sellerPlayers.map(player => player.name)} money={market.moneyFromSeller} />
                </XStack>

                {pending ? (
                  <YStack gap="$2">
                    <Text color="$color10">Favorevoli {market.approvers.length} · Contrari {market.deniers.length} · Quorum {quorum}/{leagueSize}</Text>
                    {vote ? <Text color="$color9">Hai già votato: {vote === 'approve' ? 'favorevole' : 'contrario'}.</Text> : null}
                    <XStack gap="$2" flexWrap="wrap">
                      {canCastVote ? <><Button disabled={actingId === market.id} onPress={() => { void submitAction(market, 'approve') }}>Approva</Button><Button variant="outlined" disabled={actingId === market.id} onPress={() => { void submitAction(market, 'deny') }}>Rifiuta</Button></> : null}
                      {canCancel ? <Button variant="outlined" disabled={actingId === market.id} onPress={() => { void submitAction(market, 'cancel') }}>Annulla proposta</Button> : null}
                    </XStack>
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

function TradeSide({ title, players, money }: { title: string; players: string[]; money: number }) {
  return <Card backgroundColor="$color2" padding="$3" flexGrow={1} flexBasis={300}><YStack gap="$1"><Text fontWeight="800">{title}</Text>{players.map(name => <Text key={name}>{name}</Text>)}{money > 0 ? <Text color="$green10">+ {money}</Text> : null}</YStack></Card>
}

function FilterButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Button size="$3" variant="outlined" backgroundColor={active ? '$color4' : 'transparent'} borderColor={active ? '$blue8' : '$borderColor'} onPress={onPress}>{label}</Button>
}

function buildTeamNames(runtime: GroupSessionRuntime, selection: GroupNavigationSelection): Map<string, string> {
  const result = new Map<string, string>()
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId)
  if (!league || selection.year == null) return result
  for (const basket of runtime.group.baskets.filter(item => league.basketsId.includes(item.id))) {
    const yearly = basket.years.find(item => item.year === selection.year)
    for (const team of yearly?.teams ?? []) result.set(team.owner.trim().toLowerCase(), team.name)
  }
  return result
}

function teamName(names: Map<string, string>, owner: string): string { return names.get(owner.trim().toLowerCase()) ?? owner }
function formatDate(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : value }
function statusColor(status: MarketStatus): string { return status === MarketStatus.Approved ? '$green10' : status === MarketStatus.Denied ? '$red10' : status === MarketStatus.Pending ? '$blue10' : '$color10' }
