import React, { useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { Button, Card, H1, Paragraph, TamaguiProvider, Text, Theme, XStack, YStack } from 'tamagui'
import config from './tamagui.config'
import { GroupConnectScreen, type ConnectedGroup } from './screens/group-connect'

type ThemeName = 'light' | 'dark'

export default function App() {
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [group, setGroup] = useState<ConnectedGroup | null>(null)

  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <Theme name={theme}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <YStack flex={1} backgroundColor="$background">
          <XStack padding="$3" justifyContent="flex-end">
            <Button size="$3" onPress={() => setTheme(current => (current === 'dark' ? 'light' : 'dark'))}>
              Tema {theme === 'dark' ? 'chiaro' : 'scuro'}
            </Button>
          </XStack>

          {group ? (
            <YStack flex={1} alignItems="center" justifyContent="center" padding="$6" gap="$4">
              <Card borderWidth={1} borderColor="$borderColor" padding="$6" maxWidth={640} width="100%">
                <YStack gap="$3">
                  <H1>Fantazone</H1>
                  <Paragraph>Gruppo collegato direttamente a GitHub.</Paragraph>
                  <Text fontWeight="700">{group.groupName}</Text>
                  <Text>{group.repository.full_name}</Text>
                  <Button onPress={() => setGroup(null)}>Cambia gruppo</Button>
                </YStack>
              </Card>
            </YStack>
          ) : (
            <GroupConnectScreen onConnected={setGroup} />
          )}
        </YStack>
      </Theme>
    </TamaguiProvider>
  )
}
