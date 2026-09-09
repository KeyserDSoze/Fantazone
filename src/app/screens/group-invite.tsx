import React, { useMemo, useState } from 'react'
import { Github, LockKeyhole, LogIn } from '@tamagui/lucide-icons-2'
import { Button, Input, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import { GitHubApiError } from '@fantazone/github'
import type { GroupInvitePayload } from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
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
  const [legacyPat, setLegacyPat] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const emailMatches = identityEmail.trim().toLowerCase() === invite.email
  const pat = invite.v === 3 ? invite.pat : legacyPat
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
    <AppScreen maxWidth={1040}>
      <PageIntro
        eyebrow="Invito Fantazone"
        title={`Unisciti a ${invite.group}`}
        description={invite.v === 3
          ? 'Verifica l’identità Microsoft e collega questo dispositivo al repository GitHub condiviso del gruppo.'
          : 'Questo invito usa il formato precedente e richiede una sola volta la credenziale GitHub condivisa del gruppo.'}
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

          <Surface accent="yellow" padding="$4">
            <XStack gap="$3" alignItems="flex-start">
              <LockKeyhole size="$1.2" color="$yellow10" />
              <YStack flex={1} gap="$1">
                <Text color="$color12" fontWeight="900">Tratta l’invito come una credenziale</Text>
                <Paragraph color="$color10" fontSize="$2" lineHeight="$5">
                  {invite.v === 3
                    ? 'Gli inviti correnti trasferiscono il PAT cifrato nel frammento URL. Fantazone ha già rimosso il frammento sensibile dall’indirizzo, verificherà la credenziale e la salverà nelle impostazioni private OneDrive; i link legacy restano compatibili.'
                    : 'Il PAT verrà salvato nelle impostazioni private OneDrive e nella cache credenziali del dispositivo dopo la verifica.'}
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
              ) : invite.v !== 3 ? (
                <YStack gap="$2">
                  <Text color="$color9" fontSize="$2" fontWeight="800">PERSONAL ACCESS TOKEN DEL GRUPPO</Text>
                  <Input
                    size="$4"
                    borderRadius="$4"
                    value={legacyPat}
                    onChangeText={setLegacyPat}
                    secureTextEntry
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="github_pat_..."
                    onSubmitEditing={() => { void join() }}
                  />
                </YStack>
              ) : null}

              {error ? <Surface accent="red" padding="$3"><Paragraph color="$red11">{error}</Paragraph></Surface> : null}

              <XStack gap="$3" flexWrap="wrap">
                <Button variant="outlined" borderRadius="$4" disabled={loading} onPress={onCancel} flexGrow={1} flexBasis={160}>Annulla invito</Button>
                {emailMatches ? (
                  <YStack flexGrow={1} flexBasis={220}>
                    <PrimaryAction disabled={!canSubmit} onPress={() => { void join() }} icon={loading ? <Spinner color="white" /> : <LogIn size="$1" color="white" />}>
                      {loading ? 'Verifica in corso…' : invite.v === 3 ? 'Verifica e unisciti' : 'Salva PAT e unisciti'}
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
