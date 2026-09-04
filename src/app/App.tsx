import React, { useEffect, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { Button, Spinner, TamaguiProvider, Text, Theme, XStack, YStack } from 'tamagui'
import config from './tamagui.config'
import { GroupConnectScreen, type ConnectedGroup } from './screens/group-connect'
import { GroupDashboardScreen } from './screens/group-dashboard'
import { PlatformOverviewScreen } from './screens/platform-overview'
import {
  clearGroupConnection,
  loadGroupConnection,
  saveGroupConnection,
} from './services/groupCredentialStorage'

type ThemeName = 'light' | 'dark'
type ViewName = 'connect' | 'architecture'

export default function App() {
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [group, setGroup] = useState<ConnectedGroup | null>(null)
  const [view, setView] = useState<ViewName>('connect')
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    let active = true
    loadGroupConnection()
      .then(connection => {
        if (active && connection) setGroup(connection)
      })
      .finally(() => {
        if (active) setRestoring(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function connectGroup(connection: ConnectedGroup) {
    setGroup(connection)
    setView('connect')
    await saveGroupConnection(connection)
  }

  async function disconnectGroup() {
    await clearGroupConnection()
    setGroup(null)
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
              <Text>Ripristino del gruppo...</Text>
            </YStack>
          ) : view === 'architecture' ? (
            <PlatformOverviewScreen onConnectGroup={() => setView('connect')} />
          ) : group ? (
            <GroupDashboardScreen
              group={group}
              onDisconnect={disconnectGroup}
              onExploreArchitecture={() => setView('architecture')}
            />
          ) : (
            <GroupConnectScreen onConnected={connectGroup} onExploreDemo={() => setView('architecture')} />
          )}
        </YStack>
      </Theme>
    </TamaguiProvider>
  )
}
