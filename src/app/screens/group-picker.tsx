import React, { useEffect, useRef, useState } from 'react'
import { ArrowRight, Github, LogOut, Plus, Star, Trash2, Users } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Text, XStack, YStack } from 'tamagui'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import { consumeManualGroupSwitchRequest } from '../services/groupSwitcher'
import type { StoredGroup } from '../services/userSettingsOneDrive'

export function GroupPickerScreen({
  groups,
  userEmail,
  error,
  autoOpen = true,
  onOpen,
  onAdd,
  onRemove,
  onLogout,
}: {
  groups: StoredGroup[]
  userEmail: string
  error?: string | null
  autoOpen?: boolean
  onOpen: (group: StoredGroup) => void
  onAdd: () => void
  onRemove: (group: StoredGroup) => void
  onLogout: () => void
}) {
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)
  const autoOpenAttempted = useRef(false)

  useEffect(() => {
    if (!autoOpen || autoOpenAttempted.current || groups.length === 0) return
    autoOpenAttempted.current = true
    if (consumeManualGroupSwitchRequest()) return

    const preferred = groups.length === 1
      ? groups[0]
      : groups.find(group => group.isDefault === true)
    if (preferred) onOpen(preferred)
  }, [autoOpen, groups, onOpen])

  return (
    <AppScreen maxWidth={1120}>
      <PageIntro
        eyebrow="I tuoi spazi"
        title="Scegli il gruppo e torna in campo."
        description={`Connesso come ${userEmail}. I gruppi vengono ritrovati dal tuo spazio privato OneDrive.`}
        action={(
          <PrimaryAction onPress={onAdd} icon={<Plus size="$1" color="white" />}>
            Nuovo gruppo
          </PrimaryAction>
        )}
      />

      {error ? (
        <Surface accent="red" padding="$3">
          <Paragraph color="$red11">{error}</Paragraph>
        </Surface>
      ) : null}

      <XStack gap="$4" flexWrap="wrap" alignItems="stretch">
        {groups.map(group => {
          const confirmingRemoval = pendingRemovalId === group.id
          const isDefault = group.isDefault === true
          return (
            <Surface key={group.id} accent={isDefault ? 'blue' : 'neutral'} padding="$4">
              <YStack width={320} maxWidth="100%" gap="$4">
                <XStack justifyContent="space-between" alignItems="flex-start" gap="$3">
                  <YStack
                    width={46}
                    height={46}
                    borderRadius="$4"
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor={isDefault ? '$blue4' : '$color4'}
                  >
                    <Users size="$1.2" color={isDefault ? '$blue11' : '$color10'} />
                  </YStack>
                  {isDefault ? <StatusPill tone="blue">Predefinito</StatusPill> : null}
                </XStack>

                <YStack gap="$1.5">
                  <Text color="$color12" fontSize="$6" fontWeight="900">{group.name}</Text>
                  <XStack alignItems="center" gap="$1.5">
                    <Github size="$0.8" color="$color9" />
                    <Text color="$color9" fontSize="$2" numberOfLines={1}>{group.repository}</Text>
                  </XStack>
                </YStack>

                {confirmingRemoval ? (
                  <YStack gap="$3">
                    <Surface accent="red" padding="$3">
                      <Paragraph size="$2" color="$red11" lineHeight="$5">
                        Rimuoviamo questo gruppo dai settings OneDrive e cancelliamo il PAT locale da questo dispositivo. Il repository GitHub resta intatto.
                      </Paragraph>
                    </Surface>
                    <XStack gap="$2" flexWrap="wrap">
                      <Button
                        flex={1}
                        minWidth={150}
                        borderColor="$red8"
                        color="$red11"
                        icon={Trash2}
                        onPress={() => {
                          setPendingRemovalId(null)
                          onRemove(group)
                        }}
                      >
                        Conferma
                      </Button>
                      <Button chromeless onPress={() => setPendingRemovalId(null)}>Annulla</Button>
                    </XStack>
                  </YStack>
                ) : (
                  <YStack gap="$2">
                    <Button
                      size="$4"
                      borderRadius="$4"
                      backgroundColor={isDefault ? '$blue9' : '$color4'}
                      borderColor={isDefault ? '$blue9' : '$color6'}
                      color={isDefault ? 'white' : '$color12'}
                      fontWeight="800"
                      iconAfter={ArrowRight}
                      onPress={() => onOpen(group)}
                    >
                      Apri gruppo
                    </Button>

                    {groups.length > 1 ? (
                      <Button
                        size="$2.5"
                        chromeless={!isDefault}
                        variant={isDefault ? undefined : 'outlined'}
                        icon={Star}
                        justifyContent="flex-start"
                        onPress={() => onOpen({ ...group, isDefault: !isDefault })}
                      >
                        {isDefault ? 'Apri senza predefinito' : 'Apri e rendi predefinito'}
                      </Button>
                    ) : null}

                    <Button
                      size="$2.5"
                      chromeless
                      color="$red10"
                      icon={Trash2}
                      justifyContent="flex-start"
                      onPress={() => setPendingRemovalId(group.id)}
                    >
                      Rimuovi da questo account
                    </Button>
                  </YStack>
                )}
              </YStack>
            </Surface>
          )
        })}
      </XStack>

      <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap" paddingTop="$2">
        <XStack alignItems="center" gap="$2">
          <YStack width={8} height={8} borderRadius="$10" backgroundColor="$green9" />
          <Text color="$color9" fontSize="$2">Sincronizzazione OneDrive privata</Text>
        </XStack>
        <Button chromeless icon={LogOut} color="$color10" onPress={onLogout}>
          Esci dall’account Microsoft
        </Button>
      </XStack>
    </AppScreen>
  )
}
