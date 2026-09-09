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
  const [unlockCode, setUnlockCode] = useState('')
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
    setUnlockCode('')
    try {
      const invited = await runtime.inviteMember(session.member, { email, username: inviteUsername })
      const encrypted = await createEncryptedInviteFragment({
        group: runtime.group.name,
        repository: runtime.connection.repository.full_name,
        email: invited.email,
        pat: runtime.connection.token,
      })
      const nextUrl = publicWebUrl(`/join${encrypted.fragment}`)
      setInviteUrl(nextUrl)
      setUnlockCode(encrypted.unlockCode)

      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(nextUrl)
        setStatus(`Utente ${invited.email} censito. Ho copiato solo il link: invia il codice di sblocco separatamente.`)
      } else {
        await Share.share({
          title: `Invito Fantazone · ${runtime.group.name}`,
          message: `Unisciti al gruppo Fantazone ${runtime.group.name} con ${invited.email}: ${nextUrl}`,
        })
        setStatus(`Utente ${invited.email} censito. Condividi il codice di sblocco con un messaggio separato.`)
      }
      setInviteEmail('')
      setInviteUsername('')
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : 'Impossibile creare l’invito cifrato.')
    } finally {
      setSharing(false)
    }
  }

  async function shareValue(value: string, kind: 'link' | 'code') {
    if (!value) return
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        setStatus(kind === 'link'
          ? 'Link cifrato copiato. Il codice di sblocco va inviato separatamente.'
          : 'Codice di sblocco copiato. Non inviarlo nello stesso messaggio del link.')
      } else {
        await Share.share({
          title: kind === 'link' ? `Invito Fantazone · ${runtime.group.name}` : 'Codice di sblocco Fantazone',
          message: value,
        })
      }
    } catch {
      setStatus('Non riesco a condividere automaticamente questo dato. Puoi copiarlo manualmente dalla schermata.')
    }
  }

  if (!canManage) {
    return (
      <AppScreen maxWidth={900}>
        <PageIntro
          eyebrow="Condivisione gruppo"
          title="Accesso riservato agli amministratori"
          description="Solo Admin e SuperAdmin possono censire nuovi partecipanti e generare inviti per il repository condiviso del gruppo."
        />
      </AppScreen>
    )
  }

  return (
    <AppScreen maxWidth={1080}>
      <PageIntro
        eyebrow="Condivisione gruppo"
        title={`Invita qualcuno in ${runtime.group.name}`}
        description="Censisci l’account Microsoft e genera due elementi separati: un link con il PAT cifrato AES-256-GCM e un codice casuale necessario per sbloccarlo."
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
                {sharing ? 'Cifro e genero il codice…' : 'Censisci e crea invito protetto'}
              </PrimaryAction>
            </YStack>
          </Surface>

          {inviteUrl && unlockCode ? (
            <Surface accent="green" padding="$4">
              <YStack gap="$4">
                <XStack gap="$2" alignItems="center">
                  <ShieldCheck size="$1.1" color="$green10" />
                  <Text color="$color12" fontWeight="900">Invito pronto</Text>
                </XStack>

                <YStack gap="$2">
                  <FieldLabel>1 · Link cifrato</FieldLabel>
                  <Input value={inviteUrl} selectTextOnFocus autoCapitalize="none" />
                  <Button variant="outlined" icon={Copy} onPress={() => { void shareValue(inviteUrl, 'link') }}>
                    Copia / condividi link
                  </Button>
                </YStack>

                <YStack gap="$2" padding="$4" borderRadius="$5" backgroundColor="$yellow2" borderWidth={1} borderColor="$yellow6">
                  <XStack gap="$2" alignItems="center">
                    <KeyRound size="$1" color="$yellow10" />
                    <FieldLabel>2 · Codice di sblocco</FieldLabel>
                  </XStack>
                  <Text color="$color12" fontSize="$5" fontWeight="900" letterSpacing={1}>
                    {unlockCode}
                  </Text>
                  <Paragraph color="$yellow11" size="$2">
                    Questo codice viene generato casualmente per il singolo invito e non è contenuto nel link. Inoltralo con un messaggio o canale separato.
                  </Paragraph>
                  <Button variant="outlined" icon={Copy} onPress={() => { void shareValue(unlockCode, 'code') }}>
                    Copia / condividi codice
                  </Button>
                </YStack>
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
                  <Text color="$color12" fontSize="$6" fontWeight="900">Due fattori separati</Text>
                  <StatusPill tone="green">AES-256-GCM · codice 160 bit</StatusPill>
                </YStack>
              </XStack>

              <Paragraph color="$color10" lineHeight="$6">
                Il PAT non compare in chiaro nel link. Gruppo, repository ed email sono autenticati insieme al ciphertext: se il payload viene modificato, la decifratura fallisce.
              </Paragraph>

              <XStack gap="$3" alignItems="flex-start">
                <KeyRound size="$1" color="$yellow10" />
                <Paragraph color="$yellow11" size="$2" flex={1} lineHeight="$5">
                  Il link non contiene più la chiave. Fantazone deriva la chiave AES dal codice casuale generato sul dispositivo dell’amministratore. Chi intercetta soltanto il link oppure soltanto il codice non può recuperare il PAT.
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
