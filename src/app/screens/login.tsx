import React from 'react'
import { Image } from 'react-native'
import { Button, Card, H2, Paragraph, Spinner, Text, YStack } from 'tamagui'

export function LoginScreen({ loading, error, onMicrosoftLogin }: {
  loading: boolean
  error?: string | null
  onMicrosoftLogin: () => void
}) {
  return (
    <YStack flex={1} justifyContent="center" alignItems="center" padding="$4" backgroundColor="$background">
      <Card width="100%" maxWidth={520} padding="$5" borderWidth={1} borderColor="$borderColor">
        <YStack gap="$4" alignItems="center">
          <Image
            source={{ uri: '/brand/logo.png' }}
            accessibilityLabel="fanta.plus"
            style={{ width: 280, height: 180, resizeMode: 'contain' }}
          />
          <YStack gap="$2" alignItems="center">
            <H2 textAlign="center">Il tuo fantacalcio, senza backend.</H2>
            <Paragraph textAlign="center" color="$color10">
              Accedi con Microsoft. I tuoi gruppi vengono sincronizzati nel tuo OneDrive, nello spazio privato dedicato a fanta.plus.
            </Paragraph>
          </YStack>
          {error ? <Card width="100%" borderWidth={1} borderColor="$red8" padding="$3"><Text>{error}</Text></Card> : null}
          <Button width="100%" size="$5" theme="accent" disabled={loading} onPress={onMicrosoftLogin}>
            {loading ? <Spinner /> : 'Accedi con Microsoft'}
          </Button>
          <Paragraph size="$2" textAlign="center" color="$color9">
            fanta.plus richiede solo l’accesso al proprio App Folder OneDrive per leggere e salvare le impostazioni dei gruppi.
          </Paragraph>
        </YStack>
      </Card>
    </YStack>
  )
}
