import React from 'react'
import { Card, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import { useOperationStatus } from '../services/operationStatus'
import { VersionUpdateBanner } from './VersionUpdateBanner'

export function OperationStatusBanner() {
  const busy = useOperationStatus(state => state.busy)
  const title = useOperationStatus(state => state.title)
  const detail = useOperationStatus(state => state.detail)
  const connectivity = useOperationStatus(state => state.connectivity)
  const pendingWrites = useOperationStatus(state => state.pendingWrites)
  const lastSyncedAt = useOperationStatus(state => state.lastSyncedAt)

  let operationOverlay: React.ReactNode = null

  if (!busy && (connectivity === 'offline' || pendingWrites > 0 || lastSyncedAt)) {
    const label = connectivity === 'offline'
      ? `Offline · copia locale${pendingWrites > 0 ? ` · ${pendingWrites} modifica${pendingWrites === 1 ? '' : 'he'} in attesa` : ''}`
      : pendingWrites > 0
        ? `Sincronizzazione · ${pendingWrites} modifica${pendingWrites === 1 ? '' : 'he'} in attesa`
        : `Sincronizzato${lastSyncedAt ? ` · ${new Date(lastSyncedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}`

    operationOverlay = (
      <Card
        position="absolute"
        left="$3"
        bottom="$3"
        zIndex={1000}
        maxWidth="92%"
        paddingHorizontal="$3"
        paddingVertical="$2"
        borderWidth={1}
        borderColor={connectivity === 'offline' ? '$yellow8' : pendingWrites > 0 ? '$blue8' : '$green8'}
        backgroundColor={connectivity === 'offline' ? '$yellow2' : pendingWrites > 0 ? '$blue2' : '$green2'}
        elevation={8}
      >
        <Text fontSize="$2" fontWeight="700" numberOfLines={1}>{label}</Text>
      </Card>
    )
  } else if (busy) {
    operationOverlay = (
      <Card
        position="absolute"
        left="$3"
        bottom="$3"
        zIndex={1000}
        width={420}
        maxWidth="92%"
        padding="$3"
        borderWidth={1}
        borderColor="$blue8"
        backgroundColor="$color2"
        elevation={10}
      >
        <XStack gap="$3" alignItems="center">
          <Spinner />
          <YStack flex={1} gap="$1">
            <Text fontWeight="800">{title ?? 'Operazione in corso'}</Text>
            <Paragraph size="$2" color="$color10">
              {detail ?? 'Fantazone sta completando l’operazione richiesta.'}
            </Paragraph>
          </YStack>
        </XStack>
      </Card>
    )
  }

  return (
    <>
      {operationOverlay}
      <VersionUpdateBanner />
    </>
  )
}
