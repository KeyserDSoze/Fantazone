import React, { useMemo, useState } from 'react'
import { Button, Card, H2, Input, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import { GitHubApiError } from '@fantazone/github'
import { reconnectStoredGroup } from '../services/groupReconnect'
import type { GroupConnection } from '../services/groupSessionRuntime'
import type { StoredGroup } from '../services/userSettingsOneDrive'

type Props = {
  group: StoredGroup
  onConnected: (connection: GroupConnection) => void | Promise<void>
  onCancel: () => void
}

export function GroupReconnectScreen({ group, onConnected, onCancel }: Props) {
  const [pat, setPat] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSubmit = useMemo(() => pat.trim().length > 0 && !loading, [pat, loading])

  async function reconnect() {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const connection = await reconnectStoredGroup(pat, group)
      await onConnected(connection)
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack flex={1} justifyContent="center" alignItems="center" padding="$4" gap="$4">
        <Card borderWidth={1} borderColor="$borderColor" padding="$5" width="100%" maxWidth={560}>
          <YStack gap="$4">
            <YStack gap="$2">
              <Text fontWeight="800" color="$blue10">CREDENZIALE GRUPPO DA AGGIORNARE</Text>
              <H2>Ricollega {group.name}</H2>
              <Paragraph color="$color10">
                Il gruppo è già nei settings OneDrive, ma la credenziale condivisa manca oppure non è più valida. Inserisci il PAT corrente del gruppo per sostituirla.
              </Paragraph>
            </YStack>

            <Card borderWidth={1} borderColor="$borderColor" padding="$3">
              <YStack gap="$1">
                <Text fontWeight="700">Repository</Text>
                <Text>{group.repository}</Text>
                <Paragraph size="$2" color="$color9">
                  Il repository è fissato dai settings sincronizzati e non può essere sostituito durante il ricollegamento.
                </Paragraph>
              </YStack>
            </Card>

            <Card borderWidth={1} borderColor="$yellow8" padding="$3">
              <Paragraph size="$2">
                fanta.plus verifica token, repository esatto, lettura, scrittura e documenti canonici. Se il runtime deve essere aggiornato, viene verificata anche la possibilità effettiva di modificare il workflow. Dopo il successo il PAT viene salvato in OneDrive e sul dispositivo.
              </Paragraph>
            </Card>

            <YStack gap="$2">
              <Text fontWeight="700">Personal Access Token del gruppo</Text>
              <Input
                value={pat}
                onChangeText={setPat}
                secureTextEntry
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="github_pat_..."
                onSubmitEditing={() => { void reconnect() }}
              />
            </YStack>

            {error ? <Card borderWidth={1} borderColor="$red8" padding="$3"><Text>{error}</Text></Card> : null}

            <XStack gap="$3" flexWrap="wrap">
              <Button disabled={loading} onPress={onCancel} flex={1} minWidth={160}>Annulla</Button>
              <Button disabled={!canSubmit} onPress={reconnect} flex={1} minWidth={220} theme="accent">
                {loading ? <Spinner /> : 'Verifica PAT e aggiorna gruppo'}
              </Button>
            </XStack>
          </YStack>
        </Card>
      </YStack>
    </ScrollView>
  )
}

function toMessage(error: unknown): string {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) return 'PAT non valido o scaduto.'
    if (error.status === 403) return 'Il PAT non ha i permessi GitHub necessari per questo repository.'
    return `GitHub ha risposto con errore ${error.status}.`
  }
  return error instanceof Error ? error.message : 'Impossibile ricollegare il gruppo.'
}
