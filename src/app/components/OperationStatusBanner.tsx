import React from 'react'
import { Card, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import { useOperationStatus } from '../services/operationStatus'

export function OperationStatusBanner() {
  const busy = useOperationStatus(state => state.busy)
  const title = useOperationStatus(state => state.title)
  const detail = useOperationStatus(state => state.detail)
  const connectivity = useOperationStatus(state => state.connectivity)
  const pendingWrites = useOperationStatus(state => state.pendingWrites)
  const lastSyncedAt = useOperationStatus(state => state.lastSyncedAt)

  if (!busy && connectivity !== 'offline' && pendingWrites === 0) return null

  return (
    <Card marginHorizontal="$3" marginBottom="$2" padding="$3" borderWidth={1} borderColor={busy ? '$blue8' : '$yellow8'}>
      <XStack gap="$3" alignItems="center">
        {busy ? <Spinner /> : null}
        <YStack flex={1} gap="$1">
          <Text fontWeight="800">
            {busy ? (title ?? 'Operazione in corso') : connectivity === 'offline' ? 'Modalità offline' : 'Modifiche da sincronizzare'}
          </Text>
          <Paragraph size="$2" color="$color10">
            {busy
              ? (detail ?? 'Fantazone sta completando l’operazione richiesta.')
              : connectivity === 'offline'
                ? `Stai usando la copia locale${pendingWrites > 0 ? ` · ${pendingWrites} modifica${pendingWrites === 1 ? '' : 'he'} in attesa` : ''}.`
                : `${pendingWrites} modifica${pendingWrites === 1 ? '' : 'he'} in attesa di sincronizzazione.`}
          </Paragraph>
          {!busy && lastSyncedAt ? (
            <Text fontSize="$1" color="$color9">Ultima sincronizzazione: {new Date(lastSyncedAt).toLocaleTimeString()}</Text>
          ) : null}
        </YStack>
      </XStack>
    </Card>
  )
}
