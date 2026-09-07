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
import { GroupCalendarScreen } from './group-calendar-screen'
import { GroupFormationScreen } from './group-formation-screen'
import { GroupHomeScreen } from './group-home-screen'
import { GroupProductShell } from './group-product-shell'
import { GroupRankingScreen } from './group-ranking-screen'
import { GroupSettingsScreen } from './group-settings-screen'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  onLogout: () => void | Promise<void>
  onDisconnect: () => void | Promise<void>
  onExploreArchitecture: () => void
}

export function GroupDashboardScreen({
  runtime,
  session,
  onLogout,
  onDisconnect,
  onExploreArchitecture,
}: Props) {
  void onLogout
  const [route, setRoute] = useState<GroupProductRoute>('home')
  const [selection, setSelection] = useState<GroupNavigationSelection>(() => getDefaultGroupSelection(runtime.group))
  const group = runtime.group

  useEffect(() => {
    setSelection(current => normalizeGroupSelection(group, current))
  }, [group])

  if (route === 'auction') {
    return <AuctionScreen runtime={runtime} session={session} onBack={() => setRoute('home')} />
  }

  function selectLeague(leagueId: string) {
    setSelection(current => normalizeGroupSelection(group, { leagueId, year: current.year }))
  }

  return (
    <GroupProductShell
      group={group}
      member={session.member}
      identityEmail={session.identity.email}
      route={route}
      selection={selection}
      onRouteChange={setRoute}
      onLeagueChange={selectLeague}
      onYearChange={year => setSelection(current => ({ ...current, year }))}
      onChangeGroup={onDisconnect}
      onExploreArchitecture={onExploreArchitecture}
    >
      {route === 'home' ? (
        <GroupHomeScreen runtime={runtime} selection={selection} onNavigate={setRoute} />
      ) : route === 'calendar' ? (
        <GroupCalendarScreen runtime={runtime} selection={selection} />
      ) : route === 'ranking' ? (
        <GroupRankingScreen runtime={runtime} selection={selection} />
      ) : route === 'formation' ? (
        <GroupFormationScreen runtime={runtime} session={session} selection={selection} />
      ) : route === 'settings' ? (
        <GroupSettingsScreen runtime={runtime} session={session} />
      ) : (
        <PendingProductScreen route={route} onHome={() => setRoute('home')} />
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
