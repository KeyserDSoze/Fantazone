import React, { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { Button, Card, Paragraph, Spinner, TamaguiProvider, Text, Theme, XStack, YStack } from 'tamagui'
import type { AuthenticatedGroupSession, ExternalIdentity, GroupInvitePayload } from '@fantazone/domain'
import { ensureGroupInitialized, GitHubClient, type GitHubRepo } from '@fantazone/github'
import config from './tamagui.config'
import { OperationStatusBanner } from './components/OperationStatusBanner'
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
import { browserConnectivity, isNetworkFailure } from './services/networkStatus'
import { countPendingMutations, flushFormationOutbox } from './services/offlineOutbox'
import {
  clearCachedIdentity,
  loadCachedIdentity,
  loadCachedUserSettings,
  saveCachedIdentity,
  saveCachedUserSettings,
} from './services/offlineUserState'
import {
  beginOperation,
  endOperation,
  markConnectivity,
  markSynced,
  setPendingWrites,
  updateOperation,
} from './services/operationStatus'
import { clearPendingGroupInvite, loadPendingGroupInvite } from './services/pendingGroupInvite'
import { hydrateRepositoryOfflineSnapshot } from './services/repositoryOfflineSnapshot'
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
  reconcileStoredGroup,
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
      beginOperation('Apertura Fantazone', 'Ripristino della sessione e dei dati salvati sul dispositivo…')
      try {
        const invite = loadPendingGroupInvite()
        if (active) setPendingInvite(invite)

        let completed = await completePendingMicrosoftAppLogin()
        let restoreError: unknown = null
        if (!completed) {
          try {
            completed = await restoreMicrosoftAppSession()
          } catch (caught) {
            restoreError = caught
          }
        }

        if (completed) {
          updateOperation('Sincronizzazione delle impostazioni personali da OneDrive…')
          await saveCachedIdentity(completed.identity)
          let nextSettings: UserSettings
          try {
            nextSettings = await loadUserSettings(completed.graphAccessToken)
            await saveCachedUserSettings(completed.identity, nextSettings)
            markConnectivity('online')
          } catch (caught) {
            const cached = await loadCachedUserSettings(completed.identity)
            if (!cached || !isNetworkFailure(caught)) throw caught
            nextSettings = cached
            markConnectivity('offline')
          }
          if (!active) return
          setMicrosoftSession(completed)
          setSettings(nextSettings)
          return
        }

        updateOperation('Apertura della copia locale dell’ultimo accesso…')
        const identity = await loadCachedIdentity()
        const cachedSettings = identity ? await loadCachedUserSettings(identity) : null
        if (identity && cachedSettings) {
          if (!active) return
          setMicrosoftSession(localMicrosoftSession(identity))
          setSettings(cachedSettings)
          markConnectivity(browserConnectivity())
          return
        }

        if (restoreError && !isNetworkFailure(restoreError)) throw restoreError
      } catch (caught) {
        if (active) setError(toMessage(caught))
      } finally {
        endOperation()
        if (active) setLoading(false)
      }
    }
    void restoreMicrosoftSession()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!microsoftSession?.graphAccessToken) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const session = microsoftSession

    async function refreshSession() {
      try {
        const refreshed = await ensureMicrosoftAppSession(session)
        if (!active) return
        setMicrosoftSession(current =>
          current?.identity.subject === session.identity.subject ? refreshed : current)
        await saveCachedIdentity(refreshed.identity)
        markConnectivity('online')
      } catch (caught) {
        if (!active) return
        if (isNetworkFailure(caught)) {
          setMicrosoftSession(current => current?.identity.subject === session.identity.subject
            ? localMicrosoftSession(session.identity)
            : current)
          markConnectivity('offline')
          return
        }
        if (Date.now() >= session.expiresAt) {
          setMicrosoftSession(localMicrosoftSession(session.identity))
          setError('La sessione Microsoft deve essere rinnovata prima della prossima sincronizzazione OneDrive.')
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
  }, [microsoftSession?.expiresAt, microsoftSession?.refreshToken, microsoftSession?.graphAccessToken])

  useEffect(() => {
    if (!runtime || !microsoftSession || !authenticatedSession) return
    let active = true
    let syncing = false
    const activeRuntime = runtime
    const identity = microsoftSession.identity
    const session = authenticatedSession

    async function synchronizeOpenGroup() {
      if (syncing) return
      syncing = true
      beginOperation('Sincronizzazione gruppo', 'Controllo se il repository contiene aggiornamenti…')
      try {
        const result = await activeRuntime.syncRepositoryRevision()
        if (!active) return
        if (result.offline) {
          markConnectivity('offline')
          setPendingWrites(await countPendingMutations(activeRuntime.connection.repository.full_name))
          return
        }

        markConnectivity('online')
        if (result.changed) {
          updateOperation('Aggiornamento della copia locale del gruppo…')
          await hydrateRepositoryOfflineSnapshot(activeRuntime.connection, updateOperation)
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

        const pending = await countPendingMutations(activeRuntime.connection.repository.full_name)
        if (pending > 0) {
          updateOperation(`Invio di ${pending} modifica${pending === 1 ? '' : 'he'} salvata${pending === 1 ? '' : 'e'} offline…`)
          const flushed = await flushFormationOutbox(activeRuntime, session)
          setPendingWrites(flushed.remaining)
        } else {
          setPendingWrites(0)
        }
        markSynced()
        setError(current => current?.startsWith('Sincronizzazione gruppo non riuscita:') ? null : current)
      } catch (caught) {
        if (!active) return
        if (isNetworkFailure(caught)) {
          markConnectivity('offline')
          setPendingWrites(await countPendingMutations(activeRuntime.connection.repository.full_name))
        } else {
          setError(`Sincronizzazione gruppo non riuscita: ${toMessage(caught)}`)
        }
      } finally {
        endOperation()
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
  }, [runtime, authenticatedSession, microsoftSession?.identity.subject])

  async function loginWithMicrosoft() {
    setLoginLoading(true)
    setError(null)
    beginOperation('Accesso Microsoft', 'Apertura della procedura di autenticazione…')
    try {
      const completed = await beginMicrosoftAppLogin(pendingInvite?.email)
      if (!completed) return
      updateOperation('Caricamento dei tuoi gruppi da OneDrive…')
      const remoteSettings = await loadUserSettings(completed.graphAccessToken)
      await Promise.all([
        saveCachedIdentity(completed.identity),
        saveCachedUserSettings(completed.identity, remoteSettings),
      ])
      setMicrosoftSession(completed)
      setSettings(remoteSettings)
      markConnectivity('online')
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      endOperation()
      setLoginLoading(false)
    }
  }

  async function connectAndRemember(connection: ConnectedGroup) {
    if (!microsoftSession) return
    setLoading(true)
    setError(null)
    beginOperation('Collegamento del gruppo', 'Verifica dell’accesso e preparazione del repository…')
    try {
      const session = await freshMicrosoftSession(true)
      const opened = await openGroupConnection(connection)
      updateOperation('Verifica della tua appartenenza al gruppo…')
      await authorizeIdentity(opened, session.identity)
      await saveGroupConnection(connection, credentialOwnerKey(session.identity))
      const next = upsertStoredGroup(settings ?? emptyUserSettings(), createStoredGroup({
        name: opened.group.name,
        repository: connection.repository.full_name,
        pat: connection.token,
      }))
      updateOperation('Salvataggio del gruppo nelle impostazioni private OneDrive…')
      await saveSettingsRemoteAndLocal(session, next)
      setSettings(next)
      setRuntime(opened)
      setAddingGroup(false)
      setReconnectingGroup(null)
      setView('groups')
      markSynced()
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      endOperation()
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

    beginOperation('Ingresso nel gruppo', 'Verifica dell’invito e preparazione della copia locale…')
    try {
      const session = await freshMicrosoftSession(true)
      const invitedConnection: ConnectedGroup = { ...connection, expectedEmail: pendingInvite.email }
      const opened = await openGroupConnection(invitedConnection)
      await authorizeIdentity(opened, session.identity)
      await saveGroupConnection(invitedConnection, credentialOwnerKey(session.identity))

      const current = settings ?? emptyUserSettings()
      const existing = current.groups.find(group => group.repository.toLowerCase() === pendingInvite.repository.toLowerCase())
      const stored = existing
        ? { ...existing, name: opened.group.name, repository: pendingInvite.repository, pat: invitedConnection.token }
        : createStoredGroup({ name: opened.group.name, repository: pendingInvite.repository, pat: invitedConnection.token })
      const next = upsertStoredGroup(current, stored)
      updateOperation('Salvataggio del nuovo gruppo su OneDrive…')
      await saveSettingsRemoteAndLocal(session, next)

      setSettings(next)
      setRuntime(opened)
      setPendingInvite(null)
      setAddingGroup(false)
      setReconnectingGroup(null)
      clearPendingGroupInvite()
      setError(null)
      setView('groups')
      markSynced()
    } finally {
      endOperation()
    }
  }

  async function openStoredGroup(group: StoredGroup) {
    if (!microsoftSession) return
    setLoading(true)
    setError(null)
    beginOperation('Apertura del gruppo', 'Caricamento delle credenziali e verifica della copia locale…')
    try {
      const session = await freshMicrosoftSession(false)
      const ownerKey = credentialOwnerKey(session.identity)
      const localToken = await loadRepositoryToken(group.repository, ownerKey)
      const token = group.pat?.trim() || localToken
      if (!token) {
        setReconnectingGroup(group)
        return
      }

      try {
        updateOperation('Controllo degli aggiornamenti del repository…')
        const connection = await reconnectStoredGroup(token, group)
        const opened = await openGroupConnection(connection)
        await authorizeIdentity(opened, session.identity)
        await saveGroupConnection(connection, ownerKey)

        const reconciled = reconcileStoredGroup(settings ?? emptyUserSettings(), group, {
          name: opened.group.name,
          repository: connection.repository.full_name,
          pat: connection.token,
        })
        if (reconciled.changed) {
          if (session.graphAccessToken) await saveSettingsRemoteAndLocal(session, reconciled.settings)
          else await saveCachedUserSettings(session.identity, reconciled.settings)
          setSettings(reconciled.settings)
        }

        setRuntime(opened)
        setReconnectingGroup(null)
        markConnectivity('online')
        setPendingWrites(await countPendingMutations(connection.repository.full_name))
      } catch (caught) {
        if (isNetworkFailure(caught)) {
          updateOperation('Nessuna rete: apertura della copia locale del gruppo…')
          const connection = offlineConnection(token, group)
          const opened = await GroupSessionRuntime.open(connection, new GitHubClient(token), {
            persistentCache: repositoryPersistentCache,
          })
          await authorizeIdentity(opened, session.identity, false)
          setRuntime(opened)
          setReconnectingGroup(null)
          markConnectivity('offline')
          setPendingWrites(await countPendingMutations(connection.repository.full_name))
          return
        }
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
      endOperation()
      setLoading(false)
    }
  }

  async function reconnectAndOpen(connection: ConnectedGroup) {
    if (!microsoftSession || !reconnectingGroup) throw new Error('Gruppo da ricollegare non disponibile.')
    if (connection.repository.full_name.toLowerCase() !== reconnectingGroup.repository.toLowerCase()) {
      throw new Error(`Il PAT deve aprire esattamente ${reconnectingGroup.repository}.`)
    }

    beginOperation('Ricollegamento del gruppo', 'Verifica della nuova credenziale e aggiornamento della copia locale…')
    try {
      const session = await freshMicrosoftSession(true)
      const opened = await openGroupConnection(connection)
      await authorizeIdentity(opened, session.identity)
      await saveGroupConnection(connection, credentialOwnerKey(session.identity))
      const next = upsertStoredGroup(settings ?? emptyUserSettings(), {
        ...reconnectingGroup,
        name: opened.group.name,
        repository: connection.repository.full_name,
        pat: connection.token,
      })
      updateOperation('Aggiornamento delle impostazioni private OneDrive…')
      await saveSettingsRemoteAndLocal(session, next)
      setSettings(next)
      setRuntime(opened)
      setReconnectingGroup(null)
      setAddingGroup(false)
      setError(null)
      setView('groups')
      markSynced()
    } finally {
      endOperation()
    }
  }

  async function removeRememberedGroup(group: StoredGroup) {
    if (!microsoftSession || !settings) return
    setLoading(true)
    setError(null)
    beginOperation('Rimozione del gruppo', 'Aggiornamento delle impostazioni personali…')
    try {
      const session = await freshMicrosoftSession(true)
      const ownerKey = credentialOwnerKey(session.identity)
      const next = removeStoredGroup(settings, group.id)
      await saveSettingsRemoteAndLocal(session, next)
      await removeRepositoryToken(group.repository, ownerKey)
      setSettings(next)
      setAddingGroup(next.groups.length === 0)
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      endOperation()
      setLoading(false)
    }
  }

  async function freshMicrosoftSession(requireGraph: boolean): Promise<MicrosoftAppSession> {
    if (!microsoftSession) throw new Error('Sessione Microsoft non disponibile.')
    if (!microsoftSession.graphAccessToken) {
      if (!requireGraph) return microsoftSession
      return reauthenticateForOneDrive(microsoftSession.identity)
    }

    try {
      const refreshed = await ensureMicrosoftAppSession(microsoftSession)
      if (refreshed !== microsoftSession) {
        setMicrosoftSession(refreshed)
        await saveCachedIdentity(refreshed.identity)
      }
      return refreshed
    } catch (caught) {
      if (!requireGraph && isNetworkFailure(caught)) {
        const local = localMicrosoftSession(microsoftSession.identity)
        setMicrosoftSession(local)
        markConnectivity('offline')
        return local
      }
      return reauthenticateForOneDrive(microsoftSession.identity)
    }
  }

  async function reauthenticateForOneDrive(identity: ExternalIdentity): Promise<MicrosoftAppSession> {
    if (browserConnectivity() === 'offline') {
      throw new Error('Per sincronizzare con OneDrive serve una connessione Internet. I dati locali restano disponibili.')
    }
    updateOperation('La sincronizzazione OneDrive richiede di rinnovare l’accesso Microsoft…')
    const completed = await beginMicrosoftAppLogin(identity.email)
    if (!completed) {
      throw new Error('Completa nuovamente il login Microsoft per sincronizzare con OneDrive.')
    }
    await saveCachedIdentity(completed.identity)
    setMicrosoftSession(completed)
    return completed
  }

  async function saveSettingsRemoteAndLocal(session: MicrosoftAppSession, next: UserSettings): Promise<void> {
    if (!session.graphAccessToken) throw new Error('La sessione Microsoft deve essere rinnovata per sincronizzare OneDrive.')
    await saveUserSettings(session.graphAccessToken, next)
    await saveCachedUserSettings(session.identity, next)
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
    setPendingWrites(0)
    setError(null)
  }

  function clearMicrosoftUi() {
    setRuntime(null)
    setAuthenticatedSession(null)
    setMicrosoftSession(null)
    setSettings(null)
    setAddingGroup(false)
    setReconnectingGroup(null)
    setPendingWrites(0)
    setView('groups')
  }

  async function logoutMicrosoft() {
    setError(null)
    try {
      await Promise.all([logoutMicrosoftAppSession(), clearCachedIdentity()])
    } finally {
      clearMicrosoftUi()
    }
  }

  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <Theme name={theme}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <YStack flex={1} backgroundColor="$background">
          <OperationStatusBanner />

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
              theme={theme}
              onToggleTheme={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
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
  updateOperation('Controllo della configurazione Fantazone nel repository…')
  await ensureGroupInitialized(client, connection.repository, connection.groupName)
  updateOperation('Apertura dei dati del gruppo…')
  const runtime = await GroupSessionRuntime.open(connection, client, { persistentCache: repositoryPersistentCache })
  await hydrateRepositoryOfflineSnapshot(connection, updateOperation)
  return runtime
}

function offlineConnection(token: string, group: StoredGroup): ConnectedGroup {
  const [owner, repo] = group.repository.split('/', 2)
  if (!owner || !repo) throw new Error(`Repository non valida: ${group.repository}`)
  const repository: GitHubRepo = {
    name: repo,
    full_name: `${owner}/${repo}`,
    private: true,
    owner: { login: owner },
    default_branch: 'main',
    permissions: { pull: true, push: true },
  }
  return { token, repository, groupName: group.name }
}

function localMicrosoftSession(identity: ExternalIdentity): MicrosoftAppSession {
  return { identity, graphAccessToken: '', expiresAt: 0 }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Errore imprevisto in fanta.plus.'
}
