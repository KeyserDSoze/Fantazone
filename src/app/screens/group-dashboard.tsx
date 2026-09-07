import React, { useEffect, useState } from 'react'
import { Button, Card, H1, H2, Paragraph, ScrollView, YStack } from 'tamagui'
import type { AuthenticatedGroupSession } from '@fantazone/domain'
import {
  findNavigationItem,
  getDefaultGroupSelection,
  normalizeGroupSelection,
  type GroupNavigationSelection,
  type GroupProductRoute,
} from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'
import { AuctionScreen } from './auction-screen'
import { GroupBasketsAdminScreen } from './group-baskets-admin-screen'
import { GroupCalendarScreen } from './group-calendar-screen'
import { GroupFormationScreen } from './group-formation-screen'
import { GroupGameScreen } from './group-game-screen'
import { GroupHallOfFameScreen } from './group-hall-of-fame-screen'
import { GroupHomeScreen } from './group-home-screen'
import { GroupInfoScreen } from './group-info-screen'
import { GroupLeagueAdminScreen } from './group-league-admin-screen'
import { GroupLiveScreen } from './group-live-screen'
import { GroupMarketCreateScreen } from './group-market-create-screen'
import { GroupMarketTradesScreen } from './group-market-trades-screen'
import { GroupPatchNotesScreen } from './group-patch-notes-screen'
import { GroupPlayersScreen } from './group-players-screen'
import { GroupProductShell } from './group-product-shell'
import { GroupRankingScreen } from './group-ranking-screen'
import { GroupRulesScreen } from './group-rules-screen'
import { GroupSettingsScreen } from './group-settings-screen'
import { GroupTeamsScreen } from './group-teams-screen'
import { GroupUsersAdminScreen } from './group-users-admin-screen'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  onLogout: () => void | Promise<void>
  onDisconnect: () => void | Promise<void>
  onExploreArchitecture: () => void
}

export function GroupDashboardScreen({ runtime, session, onLogout, onDisconnect, onExploreArchitecture }: Props) {
  void onLogout
  const [route, setRoute] = useState<GroupProductRoute>('home')
  const [selection, setSelection] = useState<GroupNavigationSelection>(() => getDefaultGroupSelection(runtime.group))
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const group = runtime.group

  useEffect(() => { setSelection(current => normalizeGroupSelection(group, current)) }, [group])

  if (route === 'auction') return <AuctionScreen runtime={runtime} session={session} onBack={() => setRoute('home')} />

  function selectLeague(leagueId: string) {
    setSelectedGameId(null)
    setSelection(current => normalizeGroupSelection(group, { leagueId, year: current.year }))
  }
  function selectYear(year: number) { setSelectedGameId(null); setSelection(current => ({ ...current, year })) }
  function navigate(next: GroupProductRoute) { setSelectedGameId(null); setRoute(next) }

  return (
    <GroupProductShell
      group={group}
      member={session.member}
      identityEmail={session.identity.email}
      route={route}
      selection={selection}
      onRouteChange={navigate}
      onLeagueChange={selectLeague}
      onYearChange={selectYear}
      onChangeGroup={onDisconnect}
      onExploreArchitecture={onExploreArchitecture}
    >
      {selectedGameId ? (
        <GroupGameScreen runtime={runtime} selection={selection} gameId={selectedGameId} onBack={() => setSelectedGameId(null)} />
      ) : route === 'home' ? (
        <GroupHomeScreen runtime={runtime} selection={selection} onNavigate={navigate} />
      ) : route === 'calendar' ? (
        <GroupCalendarScreen runtime={runtime} selection={selection} onOpenGame={setSelectedGameId} />
      ) : route === 'ranking' ? (
        <GroupRankingScreen runtime={runtime} selection={selection} />
      ) : route === 'live' ? (
        <GroupLiveScreen runtime={runtime} selection={selection} onOpenGame={setSelectedGameId} />
      ) : route === 'formation' ? (
        <GroupFormationScreen runtime={runtime} session={session} selection={selection} />
      ) : route === 'teams' ? (
        <GroupTeamsScreen runtime={runtime} selection={selection} />
      ) : route === 'players' ? (
        <GroupPlayersScreen runtime={runtime} selection={selection} />
      ) : route === 'market' ? (
        <GroupMarketCreateScreen runtime={runtime} session={session} selection={selection} />
      ) : route === 'market-trades' ? (
        <GroupMarketTradesScreen runtime={runtime} session={session} selection={selection} />
      ) : route === 'hall-of-fame' ? (
        <GroupHallOfFameScreen runtime={runtime} selection={selection} />
      ) : route === 'rules' ? (
        <GroupRulesScreen runtime={runtime} selection={selection} />
      ) : route === 'info' ? (
        <GroupInfoScreen />
      ) : route === 'patch-notes' ? (
        <GroupPatchNotesScreen />
      ) : route === 'group-users-admin' ? (
        <GroupUsersAdminScreen runtime={runtime} session={session} />
      ) : route === 'group-baskets-admin' ? (
        <GroupBasketsAdminScreen runtime={runtime} session={session} selection={selection} />
      ) : route === 'group-league-admin' ? (
        <GroupLeagueAdminScreen runtime={runtime} session={session} selection={selection} />
      ) : route === 'settings' ? (
        <GroupSettingsScreen runtime={runtime} session={session} />
      ) : (
        <PendingProductScreen route={route} onHome={() => navigate('home')} />
      )}
    </GroupProductShell>
  )
}

function PendingProductScreen({ route, onHome }: { route: GroupProductRoute; onHome: () => void }) {
  const item = findNavigationItem(route)
  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={760} alignSelf="center" padding="$4" paddingTop="$8" gap="$4">
        <H1>{item?.label ?? 'Fantazone'}</H1>
        <Card borderWidth={1} borderColor="$borderColor" padding="$4">
          <YStack gap="$3">
            <H2 size="$6">Sezione in migrazione</H2>
            <Paragraph color="$color10">La navigazione è già pronta; questa schermata verrà collegata ai servizi locali/GitHub nel prossimo blocco, senza ripristinare il vecchio backend.</Paragraph>
            <Button alignSelf="flex-start" onPress={onHome}>Torna alla Home</Button>
          </YStack>
        </Card>
      </YStack>
    </ScrollView>
  )
}
