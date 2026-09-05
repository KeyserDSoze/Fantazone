import React, { useEffect, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { Button, Card, Paragraph, Spinner, TamaguiProvider, Text, Theme, XStack, YStack } from 'tamagui'
import config from './tamagui.config'
import { GroupConnectScreen, type ConnectedGroup } from './screens/group-connect'
import { GroupLoginGateScreen } from './screens/group-login-gate'
import { PlatformOverviewScreen } from './screens/platform-overview'
import {
  clearGroupConnection,
  loadGroupConnection,
  saveGroupConnection,
} from './services/groupCredentialStorage'
import { GroupSessionRuntime } from './services/groupSessionRuntime'

type ThemeName = 'light' | 'dark'
type ViewName = 'connect' | 'architecture'

export default function App() {
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [runtime, setRuntime] = useState<GroupSessionRuntime | null>(null)
  const [view, setView] = useState<ViewName>('connect')
  const [restoring, setRestoring] = useState(true)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function restore() {
      try {
        const connection = await loadGroupConnection()
        if (!connection || !active) return
        const opened = await GroupSessionRuntime.open(connection)
        if (active) setRuntime(opened)
      } catch (error) {
        if (active) setConnectionError(toMessage(error))
      } finally {
        if (active) setRestoring(false)
      }
    }
    void restore()
    return () => {
      active = false
    }
  }, [])

  async function connectGroup(connection: ConnectedGroup) {
    setRestoring(true)
    setConnectionError(null)
    try {
      const opened = await GroupSessionRuntime.open(connection)
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

  async function disconnectGroup() {
    await clearGroupConnection()
    setRuntime(null)
    setConnectionError(null)
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
          ) : runtime ? (
            <GroupLoginGateScreen
              connection={runtime.connection}
              group={runtime.group}
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

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Errore durante il caricamento del gruppo.'
}
