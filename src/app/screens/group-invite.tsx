import React, { useMemo, useState } from 'react'
import { Github, KeyRound, LockKeyhole, LogIn } from '@tamagui/lucide-icons-2'
import { Button, Input, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import { GitHubApiError } from '@fantazone/github'
import type { GroupInvitePayload } from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import { decryptInvitePat, isValidInviteUnlockCode } from '../services/groupInviteLink'
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
  const [unlockCode, setUnlockCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const emailMatches = identityEmail.trim().toLowerCase() === invite.email
  const canSubmit = useMemo(
    () => emailMatches && isValidInviteUnlockCode(unlockCode) && !loading,
    [emailMatches, unlockCode, loading],
  )

  async function join() {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const pat = await decryptInvitePat(invite, unlockCode)
      const connection = await connectKnownGroup(pat, { name: invite.group, repository: invite.repository })
      await onConnected({ ...connection, expectedEmail: invite.email })
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppScreen maxWidth={1040}>
      <PageIntro
        eyebrow="Invito Fantazone"
        title={`Unisciti a ${invite.group}`}
        description="Verifica l’identità Microsoft e usa il codice di sblocco ricevuto separatamente per decifrare la credenziale GitHub del gruppo."
      />

      <XStack gap="$4" flexWrap="wrap" alignItems="stretch">
        <YStack flexGrow={1} flexBasis={420} minWidth={280} gap="$4">
          <Surface accent="blue" padding="$5">
            <YStack gap="$4">
              <XStack alignItems="center" gap="$3">
                <YStack width={44} height={44} borderRadius="$4" backgroundColor="$blue3" borderWidth={1} borderColor="$blue5" alignItems="center" justifyContent="center">
                  <Github size="$1.2" color="$blue10" />
                </YStack>
                <YStack flex={1} gap="$1">
                  <Text color="$color12" fontSize="$6" fontWeight="900">Gruppo invitato</Text>
                  <StatusPill tone="blue">Repository verificato al collegamento</StatusPill>
                </YStack>
              </XStack>
              <InviteMeta label="Gruppo" value={invite.group} />
              <InviteMeta label="Repository" value={invite.repository} />
              <InviteMeta label="Email invitata" value={invite.email} />
            </YStack>
          </Surface>

          <Surface accent="green" padding="$4">
            <XStack gap="$3" alignItems="flex-start">
              <LockKeyhole size="$1.2" color="$green10" />
              <YStack flex={1} gap="$1">
                <Text color="$color12" fontWeight="900">Il link da solo non sblocca il PAT</Text>
                <Paragraph color="$color10" fontSize="$2" lineHeight="$5">
                  Il frammento dell’invito contiene solo il PAT cifrato AES-256-GCM e i dati necessari a identificare gruppo, repository ed email. La chiave deriva dal codice casuale generato per questo invito e quel codice non viaggia nel link né viene salvato insieme al payload.
                </Paragraph>
              </YStack>
            </XStack>
          </Surface>
        </YStack>

        <YStack flexGrow={1} flexBasis={420} minWidth={280}>
          <Surface padding="$6">
            <YStack gap="$5">
              <YStack gap="$2">
                <Text color="$color12" fontSize="$7" fontWeight="900">Conferma il tuo accesso</Text>
                <Paragraph color="$color10">Fantazone accetta l’invito solo per l’account Microsoft a cui è stato intestato.</Paragraph>
              </YStack>

              <YStack gap="$2" padding="$3" borderRadius="$4" backgroundColor={emailMatches ? '$green2' : '$red2'} borderWidth={1} borderColor={emailMatches ? '$green5' : '$red5'}>
                <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Account corrente</Text>
                <Text color="$color12" fontSize="$5" fontWeight="900">{identityEmail}</Text>
                <StatusPill tone={emailMatches ? 'green' : 'red'}>{emailMatches ? 'Corrisponde all’invito' : 'Account diverso'}</StatusPill>
              </YStack>

              {!emailMatches ? (
                <YStack gap="$3">
                  <Paragraph color="$red11">Questo invito è destinato a {invite.email}. Accedi con l’account Microsoft corretto per continuare.</Paragraph>
                  <PrimaryAction onPress={() => { void onUseAnotherAccount() }} icon={<LogIn size="$1" color="white" />}>Usa un altro account Microsoft</PrimaryAction>
                </YStack>
              ) : (
                <YStack gap="$2">
                  <XStack gap="$2" alignItems="center">
                    <KeyRound size="$1" color="$blue10" />
                    <Text color="$color9" fontSize="$2" fontWeight="800">CODICE DI SBLOCCO DELL’INVITO</Text>
                  </XStack>
                  <Input
                    size="$4"
                    borderRadius="$4"
                    value={unlockCode}
                    onChangeText={setUnlockCode}
                    secureTextEntry
                    autoFocus
                    autoCapitalize="characters"
                    autoCorrect={false}
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                    onSubmitEditing={() => { void join() }}
                  />
                  <Paragraph color="$color9" fontSize="$2">
                    Inserisci il codice ricevuto separatamente dal link. Spazi e trattini sono accettati.
                  </Paragraph>
                </YStack>
              )}

              {error ? <Surface accent="red" padding="$3"><Paragraph color="$red11">{error}</Paragraph></Surface> : null}

              <XStack gap="$3" flexWrap="wrap">
                <Button variant="outlined" borderRadius="$4" disabled={loading} onPress={onCancel} flexGrow={1} flexBasis={160}>Annulla invito</Button>
                {emailMatches ? (
                  <YStack flexGrow={1} flexBasis={220}>
                    <PrimaryAction disabled={!canSubmit} onPress={() => { void join() }} icon={loading ? <Spinner color="white" /> : <LogIn size="$1" color="white" />}>
                      {loading ? 'Decifro e verifico…' : 'Sblocca e unisciti'}
                    </PrimaryAction>
                  </YStack>
                ) : null}
              </XStack>
            </YStack>
          </Surface>
        </YStack>
      </XStack>
    </AppScreen>
  )
}

function InviteMeta({ label, value }: { label: string; value: string }) {
  return (
    <YStack gap="$1" padding="$3" borderRadius="$4" backgroundColor="$color3">
      <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">{label}</Text>
      <Text color="$color12" fontWeight="800" numberOfLines={2}>{value}</Text>
    </YStack>
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
