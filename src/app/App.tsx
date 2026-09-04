import React from 'react'
import { StatusBar } from 'expo-status-bar'
import { Button, Card, H1, Paragraph, TamaguiProvider, XStack, YStack } from 'tamagui'
import config from './tamagui.config'

export default function App() {
  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <StatusBar style="auto" />
      <YStack flex={1} alignItems="center" justifyContent="center" padding="$6" gap="$4">
        <Card bordered padding="$6" maxWidth={640} width="100%">
          <YStack gap="$3">
            <H1>Fantazone</H1>
            <Paragraph>
              Zero-server Fantasoccer migration: GitHub persistence, Actions jobs and WebRTC auctions.
            </Paragraph>
            <XStack gap="$3" flexWrap="wrap">
              <Button disabled>Connect Google / Microsoft</Button>
              <Button disabled>Open Fantazone group</Button>
            </XStack>
          </YStack>
        </Card>
      </YStack>
    </TamaguiProvider>
  )
}
