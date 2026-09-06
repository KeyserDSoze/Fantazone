import React, { useMemo, useState } from 'react'
import { Button, Card, H2, Input, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import { GitHubApiError } from '@fantazone/github'
import type { GroupInvitePayload } from '@fantazone/domain'
import { connectKnownGroup } from '../services/groupReconnect'
import type { GroupConnection } from '../services/groupSessionRuntime'

type Props = {
  invite: GroupInvitePayload
  identityEmail: string
  onConnected: (connection: GroupConnection) => void | Promise<void>
  onCancel: () => void
  onUseAnotherAccount: () => void | Promise<void>
}

export function GroupInviteScreen({ invite, identityEmail, onConnected, onCancel, onUseAnotherAccount }: Props) {
  const [pat, setPat] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const emailMatches = identityEmail.trim().toLowerCase() === invite.email
  const canSubmit = useMemo(() => emailMatches && pat.trim().length > 0 && !loading, [emailMatches, pat, loading])

  async function join() {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const connection = await connectKnownGroup(pat, { name: invite.group, repository: invite.repository })
      await onConnected({ ...connection, expectedEmail: invite.email })
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack flex={1} justifyContent="center" alignItems="center" padding="$4" gap="$4">
        <Card borderWidth={1} borderColor="$blue8" padding="$5" width="100%" maxWidth={560}>
          <YStack gap="$4">
            <YStack gap="$2">
              <Text fontWeight="800" color="$blue10">INVITO FANTAZONE</Text>
              <H2>Unisciti a {invite.group}</H2>
              <Paragraph color="$color10">
                L’invito identifica il gruppo e l’email attesa, ma non contiene credenziali GitHub.
              </Paragraph>
            </YStack>

            <Card borderWidth={1} borderColor="$borderColor" padding="$3">
              <YStack gap="$1">
                <Text fontWeight="700">Repository</Text>
                <Text>{invite.repository}</Text>
                <Text fontWeight="700" marginTop="$2">Email invitata</Text>
                <Text>{invite.email}</Text>
              </YStack>
            </Card>

            {!emailMatches ? (
              <Card borderWidth={1} borderColor="$red8" padding="$3">
                <YStack gap="$2">
                  <Paragraph>
                    Hai effettuato l’accesso come {identityEmail}, ma questo invito è destinato a {invite.email}.
                  </Paragraph>
                  <Button onPress={onUseAnotherAccount}>Usa un altro account Microsoft</Button>
                </YStack>
              </Card>
            ) : (
              <>
                <Card borderWidth={1} borderColor="$yellow8" padding="$3">
                  <Paragraph size="$2">
                    Inserisci un PAT GitHub che possa aprire esattamente questo repository. Il PAT resta solo sul dispositivo e non viene salvato nel link né in OneDrive.
                  </Paragraph>
                </Card>
                <YStack gap="$2">
                  <Text fontWeight="700">Personal Access Token</Text>
                  <Input
                    value={pat}
                    onChangeText={setPat}
                    secureTextEntry
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="github_pat_..."
                    onSubmitEditing={() => { void join() }}
                  />
                </YStack>
              </>
            )}

            {error ? <Card borderWidth={1} borderColor="$red8" padding="$3"><Text>{error}</Text></Card> : null}

            <XStack gap="$3" flexWrap="wrap">
              <Button disabled={loading} onPress={onCancel} flex={1} minWidth={160}>Annulla invito</Button>
              {emailMatches ? (
                <Button disabled={!canSubmit} onPress={join} flex={1} minWidth={220} theme="accent">
                  {loading ? <Spinner /> : 'Verifica PAT e unisciti'}
                </Button>
              ) : null}
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
  return error instanceof Error ? error.message : 'Impossibile completare l’invito.'
}
