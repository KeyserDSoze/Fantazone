import React, { useMemo, useState } from 'react'
import { Linking, Platform, Share } from 'react-native'
import { Button, Card, H1, H2, Input, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import { createInviteFragment } from '@fantazone/github'
import { GroupHelper, IdentityRole, type AuthenticatedGroupSession } from '@fantazone/domain'
import { publicWebUrl } from '../config/publicOrigin'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  onLogout: () => void | Promise<void>
  onDisconnect: () => void | Promise<void>
  onExploreArchitecture: () => void
}

export function GroupDashboardScreen({ runtime, session, onLogout, onDisconnect, onExploreArchitecture }: Props) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteUsername, setInviteUsername] = useState('')
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const group = runtime.group
  const connection = runtime.connection
  const canInvite = useMemo(() =>
    GroupHelper.hasRole(session.member, IdentityRole.Admin) ||
    GroupHelper.hasRole(session.member, IdentityRole.SuperAdmin), [session.member])

  async function inviteAndShare() {
    const email = inviteEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setShareStatus('Inserisci l’email con cui il partecipante farà login.')
      return
    }
    setSharing(true)
    setShareStatus(null)
    try {
      const invited = await runtime.inviteMember(session.member, { email, username: inviteUsername })
      const fragment = createInviteFragment({
        v: 3,
        group: connection.groupName,
        repository: connection.repository.full_name,
        email: invited.email,
        pat: connection.token,
      })
      const inviteUrl = publicWebUrl(`/${fragment}`)
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl)
        setShareStatus(`Utente ${invited.email} censito in group.users e invito con credenziale gruppo copiato.`)
      } else {
        await Share.share({
          title: `Invito Fantazone · ${group.name}`,
          message: `Unisciti al gruppo Fantazone ${group.name} con ${invited.email}: ${inviteUrl}`,
        })
        setShareStatus(`Utente ${invited.email} censito in group.users e invito con credenziale gruppo pronto.`)
      }
      setInviteEmail('')
      setInviteUsername('')
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : 'Impossibile creare l’invito.')
    } finally {
      setSharing(false)
    }
  }

  const repositoryUrl = connection.repository.html_url ?? `https://github.com/${connection.repository.full_name}`

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={980} alignSelf="center" padding="$5" gap="$5">
        <YStack gap="$2" paddingVertical="$4">
          <Text fontSize="$3" fontWeight="800" color="$green10">SESSIONE AUTENTICATA</Text>
          <H1>{group.name}</H1>
          <Paragraph color="$color10">
            {session.member.username} · {session.identity.email} · provider {session.identity.provider}
          </Paragraph>
        </YStack>

        <XStack gap="$3" flexWrap="wrap">
          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={360}>
            <YStack gap="$2">
              <H2 size="$6">Repository</H2>
              <Text fontWeight="700">{connection.repository.full_name}</Text>
              <Text color="$color10">Branch: {connection.repository.default_branch}</Text>
              <Text color="$color10">Visibilità: {connection.repository.private ? 'privato' : 'pubblico'}</Text>
              <Button marginTop="$2" onPress={() => Linking.openURL(repositoryUrl)}>Apri su GitHub</Button>
            </YStack>
          </Card>

          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={360}>
            <YStack gap="$2">
              <H2 size="$6">Identità</H2>
              <Text>{session.identity.displayName || session.member.username}</Text>
              <Text color="$color10">{session.identity.email}</Text>
              <Text color="$color10">Ruolo flags: {session.member.role}</Text>
              <Text fontSize="$2" color="$color9">La membership viene riletta dal repository quando la sessione viene ricostruita.</Text>
            </YStack>
          </Card>
        </XStack>

        {canInvite ? (
          <Card borderWidth={1} borderColor="$blue8" padding="$4">
            <YStack gap="$3">
              <H2 size="$6">Invita nel gruppo</H2>
              <Paragraph>
                Prima salviamo l’email in <Text fontWeight="700">config/group.json → users</Text>. Poi generiamo un link che include la credenziale GitHub condivisa del gruppo, necessaria perché i partecipanti non devono avere un account GitHub.
              </Paragraph>
              <Card borderWidth={1} borderColor="$yellow8" padding="$3">
                <Paragraph size="$2">
                  Tratta il link come una password del gruppo: invialo solo alla persona invitata. Chi possiede il link possiede anche il PAT finché non viene ruotato.
                </Paragraph>
              </Card>
              <XStack gap="$3" flexWrap="wrap">
                <Input flex={1} minWidth={240} value={inviteEmail} onChangeText={setInviteEmail} autoCapitalize="none" autoCorrect={false} placeholder="email@esempio.it" />
                <Input flex={1} minWidth={200} value={inviteUsername} onChangeText={setInviteUsername} placeholder="Nome visualizzato (opzionale)" />
              </XStack>
              <Button theme="accent" disabled={sharing} onPress={inviteAndShare}>
                {sharing ? <Spinner /> : 'Censisci utente e copia invito'}
              </Button>
              <Paragraph size="$2" color="$color9">
                L’invitato deve soltanto accedere con l’email Microsoft indicata. fanta.plus verifica il PAT condiviso e lo salva nel suo spazio app OneDrive e sul dispositivo. I nuovi invitati ricevono il ruolo Participant; un utente già presente mantiene i propri ruoli.
              </Paragraph>
              {shareStatus ? <Paragraph size="$2" color="$color10">{shareStatus}</Paragraph> : null}
            </YStack>
          </Card>
        ) : null}

        <Card borderWidth={1} borderColor="$borderColor" padding="$4">
          <YStack gap="$3">
            <H2 size="$6">Azioni</H2>
            <XStack gap="$3" flexWrap="wrap">
              <Button onPress={onExploreArchitecture}>Esplora architettura</Button>
              <Button onPress={onLogout}>Esci dall’identità</Button>
              <Button onPress={onDisconnect}>Cambia gruppo</Button>
            </XStack>
          </YStack>
        </Card>
      </YStack>
    </ScrollView>
  )
}
