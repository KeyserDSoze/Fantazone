import React, { useState } from 'react'
import { Button, Card, H2, Paragraph, Text, XStack, YStack } from 'tamagui'
import type { StoredGroup } from '../services/userSettingsOneDrive'

export function GroupPickerScreen({
  groups,
  userEmail,
  error,
  onOpen,
  onAdd,
  onRemove,
  onLogout,
}: {
  groups: StoredGroup[]
  userEmail: string
  error?: string | null
  onOpen: (group: StoredGroup) => void
  onAdd: () => void
  onRemove: (group: StoredGroup) => void
  onLogout: () => void
}) {
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)

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
            {groups.map(group => {
              const confirmingRemoval = pendingRemovalId === group.id
              return (
                <Card key={group.id} padding="$3" borderWidth={1} borderColor="$borderColor">
                  <YStack gap="$2">
                    <YStack gap="$1">
                      <Text fontWeight="700">{group.name}</Text>
                      <Paragraph color="$color10">{group.repository}</Paragraph>
                    </YStack>
                    {confirmingRemoval ? (
                      <YStack gap="$2">
                        <Paragraph size="$2" color="$color10">
                          Il gruppo verrà rimosso dai settings OneDrive e il PAT locale verrà cancellato da questo dispositivo. Il repository GitHub non verrà eliminato.
                        </Paragraph>
                        <XStack gap="$2" flexWrap="wrap">
                          <Button
                            borderColor="$red8"
                            color="$red10"
                            onPress={() => {
                              setPendingRemovalId(null)
                              onRemove(group)
                            }}
                          >
                            Conferma rimozione
                          </Button>
                          <Button chromeless onPress={() => setPendingRemovalId(null)}>Annulla</Button>
                        </XStack>
                      </YStack>
                    ) : (
                      <XStack gap="$2" flexWrap="wrap">
                        <Button flex={1} minWidth={160} onPress={() => onOpen(group)}>Apri gruppo</Button>
                        <Button chromeless color="$red10" onPress={() => setPendingRemovalId(group.id)}>Rimuovi</Button>
                      </XStack>
                    )}
                  </YStack>
                </Card>
              )
            })}
          </YStack>
          <Button theme="accent" onPress={onAdd}>Aggiungi un gruppo</Button>
          <Button chromeless onPress={onLogout}>Esci dall’account Microsoft</Button>
        </YStack>
      </Card>
    </YStack>
  )
}
