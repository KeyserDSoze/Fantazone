import React, { useEffect, useRef, useState } from 'react'
import { Button, Card, H2, Paragraph, Text, XStack, YStack } from 'tamagui'
import { consumeManualGroupSwitchRequest } from '../services/groupSwitcher'
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
  const autoOpenAttempted = useRef(false)

  useEffect(() => {
    if (autoOpenAttempted.current || groups.length === 0) return
    autoOpenAttempted.current = true
    if (consumeManualGroupSwitchRequest()) return

    const preferred = groups.length === 1
      ? groups[0]
      : groups.find(group => group.isDefault === true)
    if (preferred) onOpen(preferred)
  }, [groups, onOpen])

  return (
    <YStack flex={1} padding="$4" alignItems="center" justifyContent="center">
      <Card width="100%" maxWidth={640} padding="$5" borderWidth={1} borderColor="$borderColor">
        <YStack gap="$4">
          <YStack gap="$1">
            <H2>I tuoi gruppi</H2>
            <Paragraph color="$color10">Account Microsoft: {userEmail}</Paragraph>
            {groups.length > 1 ? (
              <Paragraph size="$2" color="$color9">
                Il gruppo predefinito si apre automaticamente all’avvio. Puoi sempre cambiarlo dal menu interno.
              </Paragraph>
            ) : null}
          </YStack>
          {error ? <Card borderWidth={1} borderColor="$red8" padding="$3"><Text>{error}</Text></Card> : null}
          <YStack gap="$2">
            {groups.map(group => {
              const confirmingRemoval = pendingRemovalId === group.id
              const isDefault = group.isDefault === true
              return (
                <Card key={group.id} padding="$3" borderWidth={1} borderColor={isDefault ? '$blue8' : '$borderColor'}>
                  <YStack gap="$2">
                    <XStack justifyContent="space-between" alignItems="flex-start" gap="$2" flexWrap="wrap">
                      <YStack gap="$1" flex={1} minWidth={220}>
                        <Text fontWeight="700">{group.name}</Text>
                        <Paragraph color="$color10">{group.repository}</Paragraph>
                      </YStack>
                      {isDefault ? <Text color="$blue10" fontWeight="800">Predefinito</Text> : null}
                    </XStack>
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
                      <YStack gap="$2">
                        <XStack gap="$2" flexWrap="wrap">
                          <Button flex={1} minWidth={160} onPress={() => onOpen(group)}>Apri gruppo</Button>
                          <Button chromeless color="$red10" onPress={() => setPendingRemovalId(group.id)}>Rimuovi</Button>
                        </XStack>
                        {groups.length > 1 ? (
                          isDefault ? (
                            <Button
                              size="$2"
                              chromeless
                              alignSelf="flex-start"
                              onPress={() => onOpen({ ...group, isDefault: false })}
                            >
                              Apri senza gruppo predefinito
                            </Button>
                          ) : (
                            <Button
                              size="$2"
                              variant="outlined"
                              alignSelf="flex-start"
                              onPress={() => onOpen({ ...group, isDefault: true })}
                            >
                              Apri e rendi predefinito
                            </Button>
                          )
                        ) : null}
                      </YStack>
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
