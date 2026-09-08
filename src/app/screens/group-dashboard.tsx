import React, { useEffect, useState } from 'react'
import type { AuthenticatedGroupSession } from '@fantazone/domain'
import {
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
import { GroupPushNotificationsScreen } from './group-push-notifications-screen'
import { GroupRankingScreen } from './group-ranking-screen'
import { GroupRulesScreen } from './group-rules-screen'
import { GroupSettingsScreen } from './group-settings-screen'
import { GroupTeamsScreen } from './group-teams-screen'
import { GroupUsersAdminScreen } from './group-users-admin-screen'
import { PlatformLogsScreen } from './platform-logs-screen'
import { SerieAAdminScreen } from './serie-a-admin-screen'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void | Promise<void>
  onDisconnect: () => void | Promise<void>
  onExploreArchitecture: () => void
}

export function GroupDashboardScreen({
  runtime,
  session,
  theme,
  onToggleTheme,
  onLogout,
  onDisconnect,
  onExploreArchitecture,
}: Props) {
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
      theme={theme}
      onToggleTheme={onToggleTheme}
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
      ) : route === 'push-notifications' ? (
        <GroupPushNotificationsScreen runtime={runtime} session={session} />
      ) : route === 'patch-notes' ? (
        <GroupPatchNotesScreen />
      ) : route === 'group-users-admin' ? (
        <GroupUsersAdminScreen runtime={runtime} session={session} />
      ) : route === 'group-baskets-admin' ? (
        <GroupBasketsAdminScreen runtime={runtime} session={session} selection={selection} />
      ) : route === 'group-league-admin' ? (
        <GroupLeagueAdminScreen runtime={runtime} session={session} selection={selection} />
      ) : route === 'logs' ? (
        <PlatformLogsScreen runtime={runtime} />
      ) : route === 'serie-a-admin' ? (
        <SerieAAdminScreen runtime={runtime} session={session} selection={selection} />
      ) : route === 'settings' ? (
        <GroupSettingsScreen runtime={runtime} session={session} />
      ) : (
        <UnreachableRoute route={route} />
      )}
    </GroupProductShell>
  )
}

/** Adding a GroupProductRoute without wiring a screen must fail typecheck. */
function UnreachableRoute({ route }: { route: never }) {
  void route
  return null
}
