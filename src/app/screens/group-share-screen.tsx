import React, { useMemo, useState } from 'react'
import { Platform, Share } from 'react-native'
import { Copy, KeyRound, LockKeyhole, Share2, ShieldCheck, UserPlus } from '@tamagui/lucide-icons-2'
import { Button, Input, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import { GroupHelper, IdentityRole, type AuthenticatedGroupSession } from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import { publicWebUrl } from '../config/publicOrigin'
import { createEncryptedInviteFragment } from '../services/groupInviteLink'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

export function GroupShareScreen({ runtime, session }: { runtime: GroupSessionRuntime; session: AuthenticatedGroupSession }) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteUsername, setInviteUsername] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const isSuperAdmin = useMemo(() => GroupHelper.hasRole(session.member, IdentityRole.SuperAdmin), [session.member])
  const isAdmin = useMemo(() => GroupHelper.hasRole(session.member, IdentityRole.Admin), [session.member])
  const canManage = isAdmin || isSuperAdmin

  async function createAndShareInvite() {
    if (!canManage) return
    const email = inviteEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setStatus('Inserisci l’email Microsoft con cui il partecipante farà login.')
      return
    }

    setSharing(true)
    setStatus(null)
    setInviteUrl('')
    try {
      const invited = await runtime.inviteMember(session.member, { email, username: inviteUsername })
      const fragment = await createEncryptedInviteFragment({
        v: 3,
        group: runtime.group.name,
        repository: runtime.connection.repository.full_name,
        email: invited.email,
        pat: runtime.connection.token,
      })
      const nextUrl = publicWebUrl(`/join${fragment}`)
      setInviteUrl(nextUrl)

      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(nextUrl)
        setStatus(`Utente ${invited.email} censito nel gruppo. Link cifrato copiato negli appunti.`)
      } else {
        await Share.share({
          title: `Invito Fantazone · ${runtime.group.name}`,
          message: `Unisciti al gruppo Fantazone ${runtime.group.name} con ${invited.email}: ${nextUrl}`,
        })
        setStatus(`Utente ${invited.email} censito nel gruppo. Link cifrato pronto per la condivisione.`)
      }
      setInviteEmail('')
      setInviteUsername('')
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : 'Impossibile creare l’invito cifrato.')
    } finally {
      setSharing(false)
    }
  }

  async function copyInviteAgain() {
    if (!inviteUrl) return
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl)
        setStatus('Link cifrato copiato negli appunti.')
      } else {
        await Share.share({ message: inviteUrl })
      }
    } catch {
      setStatus('Non riesco a copiare automaticamente il link: puoi selezionarlo manualmente qui sotto.')
    }
  }

  if (!canManage) {
    return (
      <AppScreen maxWidth={900}>
        <PageIntro
          eyebrow="Condivisione gruppo"
          title="Accesso riservato agli amministratori"
          description="Solo Admin e SuperAdmin possono censire nuovi partecipanti e generare link che trasferiscono la credenziale GitHub del gruppo."
        />
      </AppScreen>
    )
  }

  return (
    <AppScreen maxWidth={1080}>
      <PageIntro
        eyebrow="Condivisione gruppo"
        title={`Invita qualcuno in ${runtime.group.name}`}
        description="Censisci l’account Microsoft del partecipante e genera un link self-contained con il PAT del gruppo cifrato tramite AES-256-GCM."
      />

      <XStack gap="$4" flexWrap="wrap" alignItems="stretch">
        <YStack flexGrow={1} flexBasis={430} minWidth={280} gap="$4">
          <Surface accent="blue" padding="$5">
            <YStack gap="$4">
              <XStack gap="$3" alignItems="center">
                <YStack width={46} height={46} borderRadius="$4" backgroundColor="$blue4" alignItems="center" justifyContent="center">
                  <Share2 size="$1.2" color="$blue10" />
                </YStack>
                <YStack flex={1} gap="$1">
                  <Text color="$color12" fontSize="$6" fontWeight="900">Nuovo invito</Text>
                  <StatusPill tone="blue">Login Microsoft obbligatorio</StatusPill>
                </YStack>
              </XStack>

              <YStack gap="$2">
                <FieldLabel>Email Microsoft</FieldLabel>
                <Input
                  size="$4"
                  borderRadius="$4"
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="email@esempio.it"
                />
              </YStack>

              <YStack gap="$2">
                <FieldLabel>Nome visualizzato</FieldLabel>
                <Input
                  size="$4"
                  borderRadius="$4"
                  value={inviteUsername}
                  onChangeText={setInviteUsername}
                  placeholder="Opzionale"
                />
              </YStack>

              <PrimaryAction
                disabled={sharing}
                onPress={() => { void createAndShareInvite() }}
                icon={sharing ? <Spinner color="white" /> : <UserPlus size="$1" color="white" />}
              >
                {sharing ? 'Cifro e preparo il link…' : 'Censisci e crea link cifrato'}
              </PrimaryAction>
            </YStack>
          </Surface>

          {inviteUrl ? (
            <Surface accent="green" padding="$4">
              <YStack gap="$3">
                <XStack gap="$2" alignItems="center">
                  <ShieldCheck size="$1.1" color="$green10" />
                  <Text color="$color12" fontWeight="900">Invito pronto</Text>
                </XStack>
                <Input value={inviteUrl} selectTextOnFocus autoCapitalize="none" />
                <Button variant="outlined" icon={Copy} onPress={() => { void copyInviteAgain() }}>
                  Copia di nuovo
                </Button>
              </YStack>
            </Surface>
          ) : null}
        </YStack>

        <YStack flexGrow={1} flexBasis={430} minWidth={280} gap="$4">
          <Surface accent="yellow" padding="$5">
            <YStack gap="$4">
              <XStack gap="$3" alignItems="center">
                <YStack width={46} height={46} borderRadius="$4" backgroundColor="$yellow3" alignItems="center" justifyContent="center">
                  <LockKeyhole size="$1.2" color="$yellow10" />
                </YStack>
                <YStack flex={1} gap="$1">
                  <Text color="$color12" fontSize="$6" fontWeight="900">PAT cifrato nel link</Text>
                  <StatusPill tone="green">AES-256-GCM</StatusPill>
                </YStack>
              </XStack>

              <Paragraph color="$color10" lineHeight="$6">
                Il PAT non compare in chiaro nel link. Fantazone cifra la credenziale e autentica anche gruppo, repository ed email invitata: se il payload viene alterato, la decifratura fallisce.
              </Paragraph>

              <XStack gap="$3" alignItems="flex-start">
                <KeyRound size="$1" color="$yellow10" />
                <Paragraph color="$yellow11" size="$2" flex={1} lineHeight="$5">
                  Fantazone resta zero-backend: per rendere il link autosufficiente anche la chiave di decifratura viaggia nel frammento URL. Chi possiede il link completo può quindi entrare in possesso del PAT; trattalo sempre come una password e invialo solo alla persona destinataria.
                </Paragraph>
              </XStack>

              <YStack padding="$3" borderRadius="$4" backgroundColor="$color3" gap="$1">
                <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Repository</Text>
                <Text color="$color12" fontWeight="800">{runtime.connection.repository.full_name}</Text>
              </YStack>
            </YStack>
          </Surface>

          {status ? (
            <Surface padding="$3">
              <Paragraph color="$color10">{status}</Paragraph>
            </Surface>
          ) : null}
        </YStack>
      </XStack>
    </AppScreen>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text color="$color10" fontSize="$2" fontWeight="900">{children}</Text>
}
