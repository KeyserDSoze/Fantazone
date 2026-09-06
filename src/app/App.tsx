import React, { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { Button, Card, Paragraph, Spinner, TamaguiProvider, Text, Theme, XStack, YStack } from 'tamagui'
import type { AuthenticatedGroupSession, ExternalIdentity, GroupInvitePayload } from '@fantazone/domain'
import { ensureGroupInitialized, GitHubClient } from '@fantazone/github'
import config from './tamagui.config'
import { GroupConnectScreen, type ConnectedGroup } from './screens/group-connect'
import { GroupDashboardScreen } from './screens/group-dashboard'
import { GroupInviteScreen } from './screens/group-invite'
import { GroupPickerScreen } from './screens/group-picker'
import { GroupReconnectScreen } from './screens/group-reconnect'
import { LoginScreen } from './screens/login'
import { PlatformOverviewScreen } from './screens/platform-overview'
import {
  credentialOwnerKey,
  loadRepositoryToken,
  removeRepositoryToken,
  saveGroupConnection,
} from './services/groupCredentialStorage'
import { reconnectStoredGroup, shouldRecoverStoredGroupCredential } from './services/groupReconnect'
import { clearPendingGroupInvite, loadPendingGroupInvite } from './services/pendingGroupInvite'
import { repositoryPersistentCache } from './services/repositoryPersistentCache'
import { GroupSessionRuntime } from './services/groupSessionRuntime'
import {
  beginMicrosoftAppLogin,
  completePendingMicrosoftAppLogin,
  ensureMicrosoftAppSession,
  logoutMicrosoftAppSession,
  restoreMicrosoftAppSession,
  type MicrosoftAppSession,
} from './services/webIdentityAuth'
import {
  createStoredGroup,
  emptyUserSettings,
  loadUserSettings,
  removeStoredGroup,
  saveUserSettings,
  upsertStoredGroup,
  type StoredGroup,
  type UserSettings,
} from './services/userSettingsOneDrive'

type ThemeName = 'light' | 'dark'
type ViewName = 'groups' | 'architecture'
const SESSION_REFRESH_LEAD_MS = 2 * 60 * 1000
const SESSION_REFRESH_RETRY_MS = 30 * 1000
const GROUP_SYNC_INTERVAL_MS = 60 * 1000

export default function App() {
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [microsoftSession, setMicrosoftSession] = useState<MicrosoftAppSession | null>(null)
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [runtime, setRuntime] = useState<GroupSessionRuntime | null>(null)
  const [authenticatedSession, setAuthenticatedSession] = useState<AuthenticatedGroupSession | null>(null)
  const [pendingInvite, setPendingInvite] = useState<GroupInvitePayload | null>(null)
  const [view, setView] = useState<ViewName>('groups')
  const [addingGroup, setAddingGroup] = useState(false)
  const [reconnectingGroup, setReconnectingGroup] = useState<StoredGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [loginLoading, setLoginLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function restoreMicrosoftSession() {
      try {
        const invite = loadPendingGroupInvite()
        if (active) setPendingInvite(invite)

        const completed = await completePendingMicrosoftAppLogin() ?? await restoreMicrosoftAppSession()
        if (!active || !completed) return
        const remoteSettings = await loadUserSettings(completed.graphAccessToken)
        if (!active) return
        setMicrosoftSession(completed)
        setSettings(remoteSettings)
      } catch (caught) {
        if (active) setError(toMessage(caught))
      } finally {
        if (active) setLoading(false)
      }
    }
    void restoreMicrosoftSession()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!microsoftSession) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const session = microsoftSession

    async function refreshSession() {
      try {
        const refreshed = await ensureMicrosoftAppSession(session)
        if (!active) return
        setMicrosoftSession(current =>
          current?.identity.subject === session.identity.subject ? refreshed : current)
      } catch (caught) {
        if (!active) return
        if (Date.now() >= session.expiresAt) {
          clearMicrosoftUi()
          setError('La sessione Microsoft è scaduta e non è stato possibile rinnovarla. Accedi di nuovo.')
          return
        }
        setError(`Rinnovo sessione Microsoft non riuscito: ${toMessage(caught)}`)
        timer = setTimeout(() => { void refreshSession() }, SESSION_REFRESH_RETRY_MS)
      }
    }

    const delay = Math.max(1000, session.expiresAt - Date.now() - SESSION_REFRESH_LEAD_MS)
    timer = setTimeout(() => { void refreshSession() }, delay)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [microsoftSession?.expiresAt, microsoftSession?.refreshToken])

  useEffect(() => {
    if (!runtime || !microsoftSession) return
    let active = true
    let syncing = false
    const activeRuntime = runtime
    const identity = microsoftSession.identity

    async function synchronizeOpenGroup() {
      if (syncing) return
      syncing = true
      try {
        const result = await activeRuntime.syncRepositoryRevision()
        if (!active) return
        if (result.changed) {
          try {
            await authorizeIdentity(activeRuntime, identity, false)
          } catch (caught) {
            if (!active) return
            setRuntime(null)
            setAuthenticatedSession(null)
            setError(`Il gruppo è stato aggiornato e l’accesso deve essere verificato di nuovo: ${toMessage(caught)}`)
            return
          }
        }
        setError(current => current?.startsWith('Sincronizzazione gruppo non riuscita:') ? null : current)
      } catch (caught) {
        if (active) setError(`Sincronizzazione gruppo non riuscita: ${toMessage(caught)}`)
      } finally {
        syncing = false
      }
    }

    void synchronizeOpenGroup()
    const timer = setInterval(() => { void synchronizeOpenGroup() }, GROUP_SYNC_INTERVAL_MS)
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void synchronizeOpenGroup()
    })

    return () => {
      active = false
      clearInterval(timer)
      subscription.remove()
    }
  }, [runtime, microsoftSession?.identity.subject])

  async function loginWithMicrosoft() {
    setLoginLoading(true)
    setError(null)
    try {
      const completed = await beginMicrosoftAppLogin(pendingInvite?.email)
      if (!completed) return
      const remoteSettings = await loadUserSettings(completed.graphAccessToken)
      setMicrosoftSession(completed)
      setSettings(remoteSettings)
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoginLoading(false)
    }
  }

  async function connectAndRemember(connection: ConnectedGroup) {
    if (!microsoftSession) return
    setLoading(true)
    setError(null)
    try {
      const session = await freshMicrosoftSession()
      const opened = await openGroupConnection(connection)
      await saveGroupConnection(connection, credentialOwnerKey(session.identity))
      const next = upsertStoredGroup(settings ?? emptyUserSettings(), createStoredGroup({
        name: connection.groupName,
        repository: connection.repository.full_name,
      }))
      await saveUserSettings(session.graphAccessToken, next)
      setSettings(next)
      await authorizeIdentity(opened, session.identity)
      setRuntime(opened)
      setAddingGroup(false)
      setReconnectingGroup(null)
      setView('groups')
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  async function joinInvitedGroup(connection: ConnectedGroup) {
    if (!microsoftSession || !pendingInvite) throw new Error('Invito Fantazone non disponibile.')
    if (microsoftSession.identity.email.toLowerCase() !== pendingInvite.email) {
      throw new Error(`Questo invito è per ${pendingInvite.email}.`)
    }
    if (connection.repository.full_name.toLowerCase() !== pendingInvite.repository.toLowerCase()) {
      throw new Error(`Il PAT deve aprire esattamente ${pendingInvite.repository}.`)
    }

    const session = await freshMicrosoftSession()
    const invitedConnection: ConnectedGroup = { ...connection, expectedEmail: pendingInvite.email }
    const opened = await openGroupConnection(invitedConnection)
    await authorizeIdentity(opened, session.identity)
    await saveGroupConnection(invitedConnection, credentialOwnerKey(session.identity))

    const current = settings ?? emptyUserSettings()
    const existing = current.groups.find(group => group.repository.toLowerCase() === pendingInvite.repository.toLowerCase())
    const next = existing
      ? current
      : upsertStoredGroup(current, createStoredGroup({ name: pendingInvite.group, repository: pendingInvite.repository }))
    if (!existing) await saveUserSettings(session.graphAccessToken, next)

    setSettings(next)
    setRuntime(opened)
    setPendingInvite(null)
    setAddingGroup(false)
    setReconnectingGroup(null)
    clearPendingGroupInvite()
    setError(null)
    setView('groups')
  }

  async function openStoredGroup(group: StoredGroup) {
    if (!microsoftSession) return
    setLoading(true)
    setError(null)
    try {
      const session = await freshMicrosoftSession()
      const ownerKey = credentialOwnerKey(session.identity)
      const token = await loadRepositoryToken(group.repository, ownerKey)
      if (!token) {
        setReconnectingGroup(group)
        return
      }

      try {
        const connection = await reconnectStoredGroup(token, group)
        const opened = await openGroupConnection(connection)
        await saveGroupConnection(connection, ownerKey)
        await authorizeIdentity(opened, session.identity)
        setRuntime(opened)
        setReconnectingGroup(null)
      } catch (caught) {
        if (shouldRecoverStoredGroupCredential(caught)) {
          await removeRepositoryToken(group.repository, ownerKey)
          setReconnectingGroup(group)
          return
        }
        throw caught
      }
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  async function reconnectAndOpen(connection: ConnectedGroup) {
    if (!microsoftSession || !reconnectingGroup) throw new Error('Gruppo da ricollegare non disponibile.')
    if (connection.repository.full_name.toLowerCase() !== reconnectingGroup.repository.toLowerCase()) {
      throw new Error(`Il PAT deve aprire esattamente ${reconnectingGroup.repository}.`)
    }

    const session = await freshMicrosoftSession()
    const opened = await openGroupConnection(connection)
    await saveGroupConnection(connection, credentialOwnerKey(session.identity))
    await authorizeIdentity(opened, session.identity)
    setRuntime(opened)
    setReconnectingGroup(null)
    setAddingGroup(false)
    setError(null)
    setView('groups')
  }

  async function removeRememberedGroup(group: StoredGroup) {
    if (!microsoftSession || !settings) return
    setLoading(true)
    setError(null)
    try {
      const session = await freshMicrosoftSession()
      const ownerKey = credentialOwnerKey(session.identity)
      await removeRepositoryToken(group.repository, ownerKey)
      const next = removeStoredGroup(settings, group.id)
      await saveUserSettings(session.graphAccessToken, next)
      setSettings(next)
      setAddingGroup(next.groups.length === 0)
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  async function freshMicrosoftSession(): Promise<MicrosoftAppSession> {
    if (!microsoftSession) throw new Error('Sessione Microsoft non disponibile.')
    const refreshed = await ensureMicrosoftAppSession(microsoftSession)
    if (refreshed !== microsoftSession) setMicrosoftSession(refreshed)
    return refreshed
  }

  async function authorizeIdentity(opened: GroupSessionRuntime, identity: ExternalIdentity, refreshMembership = true) {
    const resolution = await opened.resolveIdentity(identity, { refreshMembership })
    if (resolution.status === 'authorized') {
      setAuthenticatedSession({ group: opened.group, identity, member: resolution.member })
      return
    }
    if (resolution.status === 'disabled') throw new Error(`L’utente ${identity.email} è disabilitato nel gruppo ${opened.group.name}.`)
    if (resolution.status === 'invite-email-mismatch') {
      throw new Error(`Questo invito è per ${resolution.expectedEmail}, ma hai effettuato l’accesso come ${identity.email}.`)
    }
    throw new Error(`L’email ${identity.email} non è censita nel gruppo ${opened.group.name}.`)
  }

  function cancelPendingInvite() {
    clearPendingGroupInvite()
    setPendingInvite(null)
    setError(null)
  }

  function closeGroup() {
    setRuntime(null)
    setAuthenticatedSession(null)
    setError(null)
  }

  function clearMicrosoftUi() {
    setRuntime(null)
    setAuthenticatedSession(null)
    setMicrosoftSession(null)
    setSettings(null)
    setAddingGroup(false)
    setReconnectingGroup(null)
    setView('groups')
  }

  async function logoutMicrosoft() {
    setError(null)
    try {
      await logoutMicrosoftAppSession()
    } finally {
      clearMicrosoftUi()
    }
  }

  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <Theme name={theme}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <YStack flex={1} backgroundColor="$background">
          {microsoftSession ? (
            <XStack padding="$3" justifyContent="flex-end" gap="$2">
              {view === 'architecture' ? (
                <Button size="$3" onPress={() => setView('groups')}>Gruppi</Button>
              ) : (
                <Button size="$3" onPress={() => setView('architecture')}>Come funziona</Button>
              )}
              <Button size="$3" onPress={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>
                Tema {theme === 'dark' ? 'chiaro' : 'scuro'}
              </Button>
            </XStack>
          ) : null}

          {loading ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$3">
              <Spinner size="large" />
              <Text>Caricamento fanta.plus...</Text>
            </YStack>
          ) : !microsoftSession ? (
            <LoginScreen loading={loginLoading} error={error} onMicrosoftLogin={loginWithMicrosoft} />
          ) : pendingInvite ? (
            <GroupInviteScreen
              invite={pendingInvite}
              identityEmail={microsoftSession.identity.email}
              onConnected={joinInvitedGroup}
              onCancel={cancelPendingInvite}
              onUseAnotherAccount={logoutMicrosoft}
            />
          ) : view === 'architecture' ? (
            <PlatformOverviewScreen onConnectGroup={() => setView('groups')} />
          ) : runtime && authenticatedSession ? (
            <GroupDashboardScreen
              runtime={runtime}
              session={authenticatedSession}
              onLogout={closeGroup}
              onDisconnect={closeGroup}
              onExploreArchitecture={() => setView('architecture')}
            />
          ) : reconnectingGroup ? (
            <GroupReconnectScreen
              group={reconnectingGroup}
              onConnected={reconnectAndOpen}
              onCancel={() => { setReconnectingGroup(null); setError(null) }}
            />
          ) : settings && (settings.groups.length === 0 || addingGroup) ? (
            <YStack flex={1}>
              {settings.groups.length > 0 ? (
                <XStack padding="$3"><Button onPress={() => { setAddingGroup(false); setError(null) }}>← I miei gruppi</Button></XStack>
              ) : null}
              {settings.groups.length === 0 ? (
                <Card marginHorizontal="$4" marginTop="$3" padding="$3" borderWidth={1} borderColor="$yellow8">
                  <Paragraph>Non hai ancora gruppi. Crea il primo repository Fantazone oppure collega un gruppo esistente.</Paragraph>
                </Card>
              ) : null}
              {error ? <Card margin="$4" padding="$3" borderWidth={1} borderColor="$red8"><Text>{error}</Text></Card> : null}
              <GroupConnectScreen
                onConnected={connectAndRemember}
                onExploreDemo={() => setView('architecture')}
                defaultCreatorEmail={microsoftSession.identity.email}
              />
            </YStack>
          ) : settings ? (
            <GroupPickerScreen
              groups={settings.groups}
              userEmail={microsoftSession.identity.email}
              error={error}
              onOpen={openStoredGroup}
              onAdd={() => { setAddingGroup(true); setError(null) }}
              onRemove={removeRememberedGroup}
              onLogout={logoutMicrosoft}
            />
          ) : (
            <YStack flex={1} justifyContent="center" alignItems="center" padding="$4">
              <Card padding="$4" borderWidth={1} borderColor="$red8">
                <Paragraph>{error ?? 'Impossibile caricare le impostazioni OneDrive.'}</Paragraph>
                <Button marginTop="$3" onPress={logoutMicrosoft}>Torna al login</Button>
              </Card>
            </YStack>
          )}
        </YStack>
      </Theme>
    </TamaguiProvider>
  )
}

async function openGroupConnection(connection: ConnectedGroup): Promise<GroupSessionRuntime> {
  const client = new GitHubClient(connection.token)
  await ensureGroupInitialized(client, connection.repository, connection.groupName)
  return GroupSessionRuntime.open(connection, client, { persistentCache: repositoryPersistentCache })
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Errore imprevisto in fanta.plus.'
}
