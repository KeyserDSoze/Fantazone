import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, RefreshCw } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
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
import { AppScreen, PageIntro, StatusPill, Surface } from '../components/design-system'
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
    <AppScreen maxWidth={1120}>
      <PageIntro
        eyebrow={league?.name ?? 'Mercato'}
        title="Scambi"
        description={`${selection.year != null ? `${formatSeasonFromYear(selection.year)} · ` : ''}proposte attive, votazioni e storico del mercato.`}
        action={(
          <Button
            variant="outlined"
            borderRadius="$4"
            disabled={loading}
            icon={loading ? undefined : RefreshCw}
            onPress={() => { void loadMarkets() }}
          >
            {loading ? <Spinner /> : 'Aggiorna stato'}
          </Button>
        )}
      />

      <XStack gap="$2" flexWrap="wrap">
        <FilterButton label="Tutti" active={filter === 'all'} onPress={() => setFilter('all')} />
        <FilterButton label="In attesa" active={filter === 'pending'} onPress={() => setFilter('pending')} />
        <FilterButton label="Conclusi" active={filter === 'completed'} onPress={() => setFilter('completed')} />
      </XStack>

      {!isCurrentSeason ? (
        <Surface accent="yellow" padding="$3">
          <Paragraph color="$yellow11">Lo storico è consultabile, ma i comandi mercato sono validi solo per la stagione corrente.</Paragraph>
        </Surface>
      ) : null}
      {error ? <Surface accent="red" padding="$3"><Paragraph color="$red11">{error}</Paragraph></Surface> : null}
      {status ? <Surface accent="green" padding="$3"><Paragraph color="$green11">{status}</Paragraph></Surface> : null}

      {!error && loading && markets.length === 0 ? (
        <YStack minHeight={200} alignItems="center" justifyContent="center" gap="$3">
          <Spinner size="large" />
          <Text color="$color9">Aggiornamento mercato…</Text>
        </YStack>
      ) : null}

      {!error && !loading && visible.length === 0 ? (
        <Surface padding="$4">
          <YStack minHeight={150} alignItems="center" justifyContent="center" gap="$3">
            <ArrowRightLeft size="$2" color="$color8" />
            <Paragraph color="$color10">Nessuno scambio in questa vista.</Paragraph>
          </YStack>
        </Surface>
      ) : null}

      <YStack gap="$4">
        {visible.map(market => {
          const pending = MarketStatusHelper.isPending(market.status)
          const involved = MarketHelper.isUserInvolved(market, session.member.email)
          const vote = MarketHelper.getUserVote(market, session.member.email)
          const canCastVote = pending && canVote && !involved && vote == null
          const canCancel = pending && isCurrentSeason && involved
          return (
            <Surface key={market.id} accent={pending ? 'blue' : 'neutral'} padding="$4">
              <YStack gap="$4">
                <XStack justifyContent="space-between" gap="$3" alignItems="flex-start" flexWrap="wrap">
                  <YStack flex={1} minWidth={240} gap="$1.5">
                    <XStack alignItems="center" gap="$2">
                      <ArrowRightLeft size="$1.1" color="$color9" />
                      <Text color="$color12" fontSize="$6" fontWeight="900">
                        {teamName(teamNames, market.buyer)} ⇄ {teamName(teamNames, market.seller)}
                      </Text>
                    </XStack>
                    <Text color="$color8" fontSize="$2">{formatDate(market.creationTime)}</Text>
                  </YStack>
                  <StatusPill tone={statusTone(market.status)}>{MarketStatusHelper.asLabel(market.status)}</StatusPill>
                </XStack>

                <XStack gap="$3" flexWrap="wrap">
                  <TradeSide title={`${teamName(teamNames, market.buyer)} cede`} players={market.buyerPlayers.map(player => player.name)} money={market.moneyFromBuyer} />
                  <TradeSide title={`${teamName(teamNames, market.seller)} cede`} players={market.sellerPlayers.map(player => player.name)} money={market.moneyFromSeller} />
                </XStack>

                {pending ? (
                  <YStack gap="$3" paddingTop="$1">
                    <XStack justifyContent="space-between" gap="$3" alignItems="center" flexWrap="wrap">
                      <Text color="$color10">
                        Favorevoli {market.approvers.length} · Contrari {market.deniers.length} · Quorum {quorum}/{leagueSize}
                      </Text>
                      {vote ? <StatusPill tone={vote === 'approve' ? 'green' : 'red'}>{vote === 'approve' ? 'Hai approvato' : 'Hai rifiutato'}</StatusPill> : null}
                    </XStack>
                    <XStack gap="$2" flexWrap="wrap">
                      {canCastVote ? (
                        <>
                          <Button
                            backgroundColor="$green9"
                            borderColor="$green9"
                            color="white"
                            fontWeight="800"
                            disabled={actingId === market.id}
                            onPress={() => { void submitAction(market, 'approve') }}
                          >
                            Approva
                          </Button>
                          <Button variant="outlined" borderColor="$red7" color="$red11" disabled={actingId === market.id} onPress={() => { void submitAction(market, 'deny') }}>
                            Rifiuta
                          </Button>
                        </>
                      ) : null}
                      {canCancel ? (
                        <Button variant="outlined" disabled={actingId === market.id} onPress={() => { void submitAction(market, 'cancel') }}>
                          Annulla proposta
                        </Button>
                      ) : null}
                    </XStack>
                  </YStack>
                ) : null}
              </YStack>
            </Surface>
          )
        })}
      </YStack>
    </AppScreen>
  )
}

function TradeSide({ title, players, money }: { title: string; players: string[]; money: number }) {
  return (
    <YStack
      backgroundColor="$color3"
      borderWidth={1}
      borderColor="$color5"
      borderRadius="$4"
      padding="$3"
      flexGrow={1}
      flexBasis={300}
      minWidth={260}
      gap="$2"
    >
      <Text color="$color12" fontWeight="900">{title}</Text>
      {players.map(name => <Text key={name} color="$color10">{name}</Text>)}
      {money > 0 ? <Text color="$green10" fontWeight="900">+ {money}</Text> : null}
    </YStack>
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
function statusTone(status: MarketStatus): 'green' | 'red' | 'blue' | 'neutral' { return status === MarketStatus.Approved ? 'green' : status === MarketStatus.Denied ? 'red' : status === MarketStatus.Pending ? 'blue' : 'neutral' }
