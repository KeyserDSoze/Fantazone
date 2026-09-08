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
    const tone = connectivity === 'offline' ? 'yellow' : pendingWrites > 0 ? 'blue' : 'green'
    const borderColor = tone === 'yellow' ? '$yellow7' : tone === 'blue' ? '$blue7' : '$green7'
    const backgroundColor = tone === 'yellow' ? '$yellow3' : tone === 'blue' ? '$blue3' : '$green3'
    const dotColor = tone === 'yellow' ? '$yellow10' : tone === 'blue' ? '$blue10' : '$green10'

    operationOverlay = (
      <Card
        position="absolute"
        left="$3"
        bottom="$3"
        zIndex={1000}
        maxWidth="92%"
        paddingHorizontal="$3"
        paddingVertical="$2.5"
        borderWidth={1}
        borderColor={borderColor}
        backgroundColor={backgroundColor}
        borderRadius="$10"
        elevation={8}
      >
        <XStack alignItems="center" gap="$2">
          <YStack width={7} height={7} borderRadius="$10" backgroundColor={dotColor} />
          <Text color="$color12" fontSize="$2" fontWeight="800" numberOfLines={1}>{label}</Text>
        </XStack>
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
        padding="$3.5"
        borderWidth={1}
        borderColor="$blue7"
        backgroundColor="$color2"
        borderRadius="$5"
        elevation={12}
      >
        <XStack gap="$3" alignItems="center">
          <YStack
            width={38}
            height={38}
            borderRadius="$10"
            alignItems="center"
            justifyContent="center"
            backgroundColor="$blue3"
          >
            <Spinner color="$blue10" />
          </YStack>
          <YStack flex={1} gap="$1">
            <Text color="$color12" fontWeight="900">{title ?? 'Operazione in corso'}</Text>
            <Paragraph size="$2" color="$color9" lineHeight="$4">
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
