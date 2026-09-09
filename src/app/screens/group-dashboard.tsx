import React, { useEffect, useState } from 'react'
import type { AuthenticatedGroupSession, Group } from '@fantazone/domain'
import type { BrowserNavigationMode, GroupBrowserPage } from '../services/appRouting'
import {
  getDefaultGroupSelection,
  normalizeGroupSelection,
  type GroupNavigationSelection,
  type GroupProductRoute,
} from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'
import { markManualGroupSwitchRequest } from '../services/groupSwitcher'
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
import { GroupShareScreen } from './group-share-screen'
import { GroupTeamsScreen } from './group-teams-screen'
import { GroupUsersAdminScreen } from './group-users-admin-screen'
import { PlatformLogsScreen } from './platform-logs-screen'
import { SerieAAdminScreen } from './serie-a-admin-screen'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  theme: 'light' | 'dark'
  browserPage?: GroupBrowserPage | null
  onBrowserNavigate?: (page: GroupBrowserPage, mode?: BrowserNavigationMode) => void
  onToggleTheme: () => void
  onLogout: () => void | Promise<void>
  onDisconnect: () => void | Promise<void>
  onExploreArchitecture: () => void
}

const GROUP_SELECTION_STORAGE_PREFIX = 'fantazone:group-selection:v1'

function getStoredGroupSelection(group: Group, identityEmail: string): GroupNavigationSelection {
  const fallback = getDefaultGroupSelection(group)
  const storage = getWebStorage()
  if (!storage) return fallback

  try {
    const raw = storage.getItem(getGroupSelectionStorageKey(group.id, identityEmail))
    if (!raw) return fallback

    const parsed = JSON.parse(raw) as Partial<GroupNavigationSelection> | null
    if (!parsed || typeof parsed !== 'object') return fallback

    const leagueId = parsed.leagueId == null
      ? null
      : typeof parsed.leagueId === 'string'
        ? parsed.leagueId
        : fallback.leagueId
    const year = parsed.year == null
      ? null
      : typeof parsed.year === 'number' && Number.isInteger(parsed.year)
        ? parsed.year
        : fallback.year

    return normalizeGroupSelection(group, { leagueId, year })
  } catch {
    return fallback
  }
}

function storeGroupSelection(groupId: string, identityEmail: string, selection: GroupNavigationSelection): void {
  const storage = getWebStorage()
  if (!storage) return

  try {
    storage.setItem(getGroupSelectionStorageKey(groupId, identityEmail), JSON.stringify(selection))
  } catch {
    // localStorage may be unavailable or full: the in-memory selection remains valid.
  }
}

function getGroupSelectionStorageKey(groupId: string, identityEmail: string): string {
  return `${GROUP_SELECTION_STORAGE_PREFIX}:${encodeURIComponent(identityEmail.trim().toLowerCase())}:${encodeURIComponent(groupId)}`
}

function getWebStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

export function GroupDashboardScreen({
  runtime,
  session,
  theme,
  browserPage,
  onBrowserNavigate,
  onToggleTheme,
  onLogout,
  onDisconnect,
  onExploreArchitecture,
}: Props) {
  void onLogout
  const [route, setRoute] = useState<GroupProductRoute>(() => browserPage?.route ?? 'home')
  const [selection, setSelection] = useState<GroupNavigationSelection>(() => getStoredGroupSelection(runtime.group, session.identity.email))
  const [selectedGameId, setSelectedGameId] = useState<string | null>(() => browserPage?.gameId ?? null)
  const group = runtime.group

  useEffect(() => { setSelection(current => normalizeGroupSelection(group, current)) }, [group])
  useEffect(() => {
    if (!browserPage) return
    setRoute(browserPage.route)
    setSelectedGameId(browserPage.gameId)
  }, [browserPage?.route, browserPage?.gameId])

  if (route === 'auction') return <AuctionScreen runtime={runtime} session={session} onBack={() => navigate('home')} />

  function selectLeague(leagueId: string) {
    clearSelectedGame('replace')
    setSelection(current => {
      const next = normalizeGroupSelection(group, { leagueId, year: current.year })
      storeGroupSelection(group.id, session.identity.email, next)
      return next
    })
  }

  function selectYear(year: number) {
    clearSelectedGame('replace')
    setSelection(current => {
      const next = normalizeGroupSelection(group, { ...current, year })
      storeGroupSelection(group.id, session.identity.email, next)
      return next
    })
  }

  function navigate(next: GroupProductRoute) {
    setRoute(next)
    setSelectedGameId(null)
    onBrowserNavigate?.({ route: next, gameId: null }, 'push')
  }

  function openGame(gameId: string) {
    setSelectedGameId(gameId)
    onBrowserNavigate?.({ route, gameId }, 'push')
  }

  function closeGame() {
    clearSelectedGame('replace')
  }

  function clearSelectedGame(mode: BrowserNavigationMode) {
    if (!selectedGameId) return
    setSelectedGameId(null)
    onBrowserNavigate?.({ route, gameId: null }, mode)
  }

  function changeGroup() {
    markManualGroupSwitchRequest()
    void onDisconnect()
  }

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
      onChangeGroup={changeGroup}
      onExploreArchitecture={onExploreArchitecture}
    >
      {selectedGameId ? (
        <GroupGameScreen runtime={runtime} selection={selection} gameId={selectedGameId} onBack={closeGame} />
      ) : route === 'home' ? (
        <GroupHomeScreen runtime={runtime} selection={selection} onNavigate={navigate} />
      ) : route === 'calendar' ? (
        <GroupCalendarScreen runtime={runtime} selection={selection} onOpenGame={openGame} />
      ) : route === 'ranking' ? (
        <GroupRankingScreen runtime={runtime} selection={selection} />
      ) : route === 'live' ? (
        <GroupLiveScreen runtime={runtime} selection={selection} onOpenGame={openGame} />
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
      ) : route === 'share-group' ? (
        <GroupShareScreen runtime={runtime} session={session} />
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
