import React, { useEffect, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { Button, Card, Paragraph, Spinner, TamaguiProvider, Text, Theme, XStack, YStack } from 'tamagui'
import type { AuthenticatedGroupSession, ExternalIdentity, ExternalIdentityProvider } from '@fantazone/domain'
import { ensureGroupInitialized, GitHubClient } from '@fantazone/github'
import config from './tamagui.config'
import { GroupConnectScreen, type ConnectedGroup } from './screens/group-connect'
import { GroupDashboardScreen } from './screens/group-dashboard'
import { GroupLoginGateScreen } from './screens/group-login-gate'
import { PlatformOverviewScreen } from './screens/platform-overview'
import {
  clearGroupConnection,
  loadGroupConnection,
  saveGroupConnection,
} from './services/groupCredentialStorage'
import { GroupSessionRuntime } from './services/groupSessionRuntime'
import {
  beginExternalLogin,
  completePendingExternalLogin,
} from './services/webIdentityAuth'

type ThemeName = 'light' | 'dark'
type ViewName = 'connect' | 'architecture'

export default function App() {
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [runtime, setRuntime] = useState<GroupSessionRuntime | null>(null)
  const [authenticatedSession, setAuthenticatedSession] = useState<AuthenticatedGroupSession | null>(null)
  const [view, setView] = useState<ViewName>('connect')
  const [restoring, setRestoring] = useState(true)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)

  useEffect(() => {
    let active = true
    async function restore() {
      try {
        const connection = await loadGroupConnection()
        if (!connection || !active) return
        const opened = await openGroupConnection(connection)
        if (!active) return
        setRuntime(opened)

        try {
          // The only identity that can survive a navigation is the identity
          // produced by the just-completed Microsoft PKCE callback. We never
          // trust a plain locally-stored email/subject as an authenticated user.
          const callbackIdentity = await completePendingExternalLogin()
          if (callbackIdentity && active) await authorizeIdentity(opened, callbackIdentity)
        } catch (error) {
          if (active) setLoginError(toMessage(error))
        }
      } catch (error) {
        if (active) setConnectionError(toMessage(error))
      } finally {
        if (active) setRestoring(false)
      }
    }
    void restore()
    return () => { active = false }
  }, [])

  async function connectGroup(connection: ConnectedGroup) {
    setRestoring(true)
    setConnectionError(null)
    setLoginError(null)
    setAuthenticatedSession(null)
    try {
      const opened = await openGroupConnection(connection)
      await saveGroupConnection(connection)
      setRuntime(opened)
      setView('connect')
    } catch (error) {
      setRuntime(null)
      setConnectionError(toMessage(error))
    } finally {
      setRestoring(false)
    }
  }

  async function login(provider: ExternalIdentityProvider) {
    if (!runtime) return
    setLoginLoading(true)
    setLoginError(null)
    try {
      const identity = await beginExternalLogin(provider, runtime.connection.expectedEmail)
      if (identity) await authorizeIdentity(runtime, identity)
    } catch (error) {
      setLoginError(toMessage(error))
    } finally {
      setLoginLoading(false)
    }
  }

  async function authorizeIdentity(opened: GroupSessionRuntime, identity: ExternalIdentity) {
    const resolution = await opened.resolveIdentity(identity)
    if (resolution.status === 'authorized') {
      setAuthenticatedSession({ group: opened.group, identity, member: resolution.member })
      setLoginError(null)
      return
    }
    setAuthenticatedSession(null)
    if (resolution.status === 'invite-email-mismatch') {
      throw new Error(`Questo invito è per ${resolution.expectedEmail}, ma hai effettuato l’accesso come ${resolution.identity.email}.`)
    }
    if (resolution.status === 'disabled') {
      throw new Error(`L’utente ${resolution.identity.email} è disabilitato nel gruppo ${opened.group.name}.`)
    }
    throw new Error(`L’email ${resolution.identity.email} non è censita in config/group.json per il gruppo ${opened.group.name}.`)
  }

  async function logoutIdentity() {
    setAuthenticatedSession(null)
    setLoginError(null)
  }

  async function disconnectGroup() {
    await clearGroupConnection()
    setRuntime(null)
    setAuthenticatedSession(null)
    setConnectionError(null)
    setLoginError(null)
    setView('connect')
  }

  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <Theme name={theme}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <YStack flex={1} backgroundColor="$background">
          <XStack padding="$3" justifyContent="flex-end" gap="$2">
            {view === 'architecture' ? (
              <Button size="$3" onPress={() => setView('connect')}>Gruppo</Button>
            ) : (
              <Button size="$3" onPress={() => setView('architecture')}>Come funziona</Button>
            )}
            <Button size="$3" onPress={() => setTheme(current => (current === 'dark' ? 'light' : 'dark'))}>
              Tema {theme === 'dark' ? 'chiaro' : 'scuro'}
            </Button>
          </XStack>

          {restoring ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$3">
              <Spinner size="large" />
              <Text>Caricamento del gruppo...</Text>
            </YStack>
          ) : view === 'architecture' ? (
            <PlatformOverviewScreen onConnectGroup={() => setView('connect')} />
          ) : runtime && authenticatedSession ? (
            <GroupDashboardScreen
              runtime={runtime}
              session={authenticatedSession}
              onLogout={logoutIdentity}
              onDisconnect={disconnectGroup}
              onExploreArchitecture={() => setView('architecture')}
            />
          ) : runtime ? (
            <GroupLoginGateScreen
              connection={runtime.connection}
              group={runtime.group}
              onLogin={login}
              loginLoading={loginLoading}
              loginError={loginError}
              onChangeGroup={disconnectGroup}
              onExploreArchitecture={() => setView('architecture')}
            />
          ) : connectionError ? (
            <YStack flex={1} justifyContent="center" alignItems="center" padding="$4">
              <Card width="100%" maxWidth={560} padding="$5" borderWidth={1} borderColor="$red8">
                <YStack gap="$3">
                  <Text fontWeight="800" color="$red10">Impossibile aprire il gruppo</Text>
                  <Paragraph>{connectionError}</Paragraph>
                  <Button onPress={disconnectGroup}>Inserisci di nuovo PAT / gruppo</Button>
                </YStack>
              </Card>
            </YStack>
          ) : (
            <GroupConnectScreen onConnected={connectGroup} onExploreDemo={() => setView('architecture')} />
          )}
        </YStack>
      </Theme>
    </TamaguiProvider>
  )
}

async function openGroupConnection(connection: ConnectedGroup): Promise<GroupSessionRuntime> {
  const client = new GitHubClient(connection.token)
  // App releases can raise GROUP_REPOSITORY_RUNTIME_VERSION when group-owned
  // workflows/templates change. Current groups do zero writes; outdated groups
  // receive only Fantazone-managed artifact upgrades before the runtime opens.
  await ensureGroupInitialized(client, connection.repository, connection.groupName)
  return GroupSessionRuntime.open(connection, client)
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Errore durante il caricamento del gruppo.'
}
