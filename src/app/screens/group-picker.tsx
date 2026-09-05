import React from 'react'
import { Button, Card, H2, Paragraph, Text, YStack } from 'tamagui'
import type { StoredGroup } from '../services/userSettingsOneDrive'

export function GroupPickerScreen({
  groups,
  userEmail,
  error,
  onOpen,
  onAdd,
  onLogout,
}: {
  groups: StoredGroup[]
  userEmail: string
  error?: string | null
  onOpen: (group: StoredGroup) => void
  onAdd: () => void
  onLogout: () => void
}) {
  return (
    <YStack flex={1} padding="$4" alignItems="center" justifyContent="center">
      <Card width="100%" maxWidth={640} padding="$5" borderWidth={1} borderColor="$borderColor">
        <YStack gap="$4">
          <YStack gap="$1">
            <H2>I tuoi gruppi</H2>
            <Paragraph color="$color10">Account Microsoft: {userEmail}</Paragraph>
          </YStack>
          {error ? <Card borderWidth={1} borderColor="$red8" padding="$3"><Text>{error}</Text></Card> : null}
          <YStack gap="$2">
            {groups.map(group => (
              <Button key={group.id} size="$5" justifyContent="flex-start" onPress={() => onOpen(group)}>
                {group.name} · {group.repository}
              </Button>
            ))}
          </YStack>
          <Button theme="accent" onPress={onAdd}>Aggiungi un gruppo</Button>
          <Button chromeless onPress={onLogout}>Esci dall’account Microsoft</Button>
        </YStack>
      </Card>
    </YStack>
  )
}
