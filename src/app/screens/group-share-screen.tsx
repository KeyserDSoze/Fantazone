import React, { useMemo, useState } from 'react'
import { Platform, Share } from 'react-native'
import { Copy, KeyRound, LockKeyhole, Share2, ShieldCheck, UserPlus } from '@tamagui/lucide-icons-2'
import { Button, Input, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import { GroupHelper, IdentityRole, type AuthenticatedGroupSession } from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import { publicWebUrl } from '../config/publicOrigin'
import {
  createEncryptedInviteFragment,
  createSharedPasswordInviteFragment,
  generateSharedInvitePassword,
  isValidSharedInvitePassword,
} from '../services/groupInviteLink'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type ShareMode = 'email' | 'shared'

export function GroupShareScreen({ runtime, session }: { runtime: GroupSessionRuntime; session: AuthenticatedGroupSession }) {
  const [mode, setMode] = useState<ShareMode>('email')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteUsername, setInviteUsername] = useState('')
  const [sharedPassword, setSharedPassword] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [outOfBandSecret, setOutOfBandSecret] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [generatingPassword, setGeneratingPassword] = useState(false)
  const isSuperAdmin = useMemo(() => GroupHelper.hasRole(session.member, IdentityRole.SuperAdmin), [session.member])
  const isAdmin = useMemo(() => GroupHelper.hasRole(session.member, IdentityRole.Admin), [session.member])
  const canManage = isAdmin || isSuperAdmin

  function selectMode(next: ShareMode) {
    setMode(next)
    setInviteUrl('')
    setOutOfBandSecret('')
    setStatus(null)
  }

  async function createAndShareInvite() {
    if (!canManage) return
    setSharing(true)
    setStatus(null)
    setInviteUrl('')
    setOutOfBandSecret('')

    try {
      let nextUrl: string
      let secret: string
      let successMessage: string

      if (mode === 'email') {
        const email = inviteEmail.trim().toLowerCase()
        if (!email || !email.includes('@')) throw new Error('Inserisci l’email Microsoft con cui il partecipante farà login.')

        const invited = await runtime.inviteMember(session.member, { email, username: inviteUsername })
        const encrypted = await createEncryptedInviteFragment({
          group: runtime.group.name,
          repository: runtime.connection.repository.full_name,
          email: invited.email,
          pat: runtime.connection.token,
        })
        nextUrl = publicWebUrl(`/join${encrypted.fragment}`)
        secret = encrypted.unlockCode
        successMessage = `Invito per ${invited.email} pronto. Invia il codice di sblocco separatamente dal link.`
        setInviteEmail('')
        setInviteUsername('')
      } else {
        if (!isValidSharedInvitePassword(sharedPassword)) {
          throw new Error('La password condivisa deve contenere almeno 16 caratteri.')
        }
        const encrypted = await createSharedPasswordInviteFragment({
          group: runtime.group.name,
          repository: runtime.connection.repository.full_name,
          pat: runtime.connection.token,
        }, sharedPassword)
        nextUrl = publicWebUrl(`/join${encrypted.fragment}`)
        secret = sharedPassword.trim()
        successMessage = 'Accesso generale pronto. Chi ha link e password potrà entrare con Microsoft ed essere censito come Partecipante.'
      }

      setInviteUrl(nextUrl)
      setOutOfBandSecret(secret)

      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(nextUrl)
        setStatus(`${successMessage} Ho copiato solo il link negli appunti.`)
      } else {
        await Share.share({
          title: `Invito Fantazone · ${runtime.group.name}`,
          message: `Unisciti al gruppo Fantazone ${runtime.group.name}: ${nextUrl}`,
        })
        setStatus(successMessage)
      }
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : 'Impossibile creare l’invito cifrato.')
    } finally {
      setSharing(false)
    }
  }

  async function generatePassword() {
    setGeneratingPassword(true)
    setStatus(null)
    try {
      setSharedPassword(await generateSharedInvitePassword())
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : 'Impossibile generare una password sicura.')
    } finally {
      setGeneratingPassword(false)
    }
  }

  async function shareValue(value: string, kind: 'link' | 'secret') {
    if (!value) return
    const secretName = mode === 'email' ? 'codice di sblocco' : 'password del gruppo'
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        setStatus(kind === 'link'
          ? `Link cifrato copiato. Il ${secretName} va inviato separatamente.`
          : `${mode === 'email' ? 'Codice di sblocco' : 'Password del gruppo'} copiato. Non inviarlo nello stesso messaggio del link.`)
      } else {
        await Share.share({
          title: kind === 'link' ? `Invito Fantazone · ${runtime.group.name}` : `Fantazone · ${secretName}`,
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
          description="Solo Admin e SuperAdmin possono generare inviti per il repository condiviso del gruppo."
        />
      </AppScreen>
    )
  }

  return (
    <AppScreen maxWidth={1080}>
      <PageIntro
        eyebrow="Condivisione gruppo"
        title={`Condividi l’accesso a ${runtime.group.name}`}
        description="Scegli se creare un invito personale legato a una email Microsoft oppure un accesso generale protetto da una password che puoi consegnare manualmente a più persone."
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

              <XStack gap="$2" flexWrap="wrap">
                <Button
                  flexGrow={1}
                  flexBasis={180}
                  borderRadius="$4"
                  variant={mode === 'email' ? undefined : 'outlined'}
                  backgroundColor={mode === 'email' ? '$blue5' : undefined}
                  onPress={() => selectMode('email')}
                >
                  Via email
                </Button>
                <Button
                  flexGrow={1}
                  flexBasis={180}
                  borderRadius="$4"
                  variant={mode === 'shared' ? undefined : 'outlined'}
                  backgroundColor={mode === 'shared' ? '$blue5' : undefined}
                  onPress={() => selectMode('shared')}
                >
                  Password condivisa
                </Button>
              </XStack>

              {mode === 'email' ? (
                <>
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
                  <Paragraph color="$color9" size="$2">
                    L’account viene censito come Partecipante se non esiste già. Se è già attivo, Fantazone genera semplicemente un nuovo invito senza riscriverlo.
                  </Paragraph>
                </>
              ) : (
                <>
                  <YStack gap="$2">
                    <FieldLabel>Password condivisa del gruppo</FieldLabel>
                    <Input
                      size="$4"
                      borderRadius="$4"
                      value={sharedPassword}
                      onChangeText={setSharedPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="Almeno 16 caratteri"
                    />
                  </YStack>
                  <Button
                    variant="outlined"
                    borderRadius="$4"
                    disabled={generatingPassword}
                    icon={generatingPassword ? undefined : KeyRound}
                    onPress={() => { void generatePassword() }}
                  >
                    {generatingPassword ? 'Genero…' : 'Genera password sicura'}
                  </Button>
                  <Paragraph color="$color9" size="$2">
                    Non devi censire le email in anticipo. Chi conosce link e password entra con Microsoft e, al primo accesso, viene aggiunto automaticamente come Partecipante.
                  </Paragraph>
                </>
              )}

              <PrimaryAction
                disabled={sharing}
                onPress={() => { void createAndShareInvite() }}
                icon={sharing ? <Spinner color="white" /> : <UserPlus size="$1" color="white" />}
              >
                {sharing
                  ? 'Cifro e preparo il link…'
                  : mode === 'email'
                    ? 'Censisci e crea invito protetto'
                    : 'Crea accesso generale protetto'}
              </PrimaryAction>
            </YStack>
          </Surface>

          {inviteUrl && outOfBandSecret ? (
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
                    <FieldLabel>2 · {mode === 'email' ? 'Codice di sblocco' : 'Password condivisa'}</FieldLabel>
                  </XStack>
                  <Text color="$color12" fontSize="$5" fontWeight="900" letterSpacing={1}>
                    {outOfBandSecret}
                  </Text>
                  <Paragraph color="$yellow11" size="$2">
                    {mode === 'email'
                      ? 'Il codice è casuale e vale per questo invito personale. Non è contenuto nel link: inoltralo con un messaggio o canale separato.'
                      : 'La password non è contenuta nel link. Puoi consegnare gli stessi link e password alle persone autorizzate usando, preferibilmente, canali separati.'}
                  </Paragraph>
                  <Button variant="outlined" icon={Copy} onPress={() => { void shareValue(outOfBandSecret, 'secret') }}>
                    Copia / condividi {mode === 'email' ? 'codice' : 'password'}
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
                  <Text color="$color12" fontSize="$6" fontWeight="900">Due modalità, stessa protezione</Text>
                  <StatusPill tone="green">PBKDF2-SHA-256 · AES-256-GCM</StatusPill>
                </YStack>
              </XStack>

              <Paragraph color="$color10" lineHeight="$6">
                Il PAT non compare mai in chiaro nel link. Fantazone deriva la chiave dalla credenziale separata e autentica modalità, gruppo, repository e dati dell’invito insieme al ciphertext.
              </Paragraph>

              <YStack gap="$3">
                <SecurityMode
                  title="Via email"
                  text="L’invito è legato a una sola email Microsoft e usa un codice casuale dedicato. È ideale per dare o rigenerare l’accesso a una persona precisa."
                />
                <SecurityMode
                  title="Password condivisa"
                  text="Lo stesso link può essere usato da più account Microsoft. I nuovi account vengono censiti solo come Partecipanti; un account disabilitato non viene riattivato automaticamente."
                />
              </YStack>

              <XStack gap="$3" alignItems="flex-start">
                <KeyRound size="$1" color="$yellow10" />
                <Paragraph color="$yellow11" size="$2" flex={1} lineHeight="$5">
                  Link e segreto restano due fattori separati. Per le password scelte manualmente Fantazone usa una derivazione lenta con salt prima di creare la chiave AES, così il link non contiene materiale sufficiente per decifrare il PAT da solo.
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

function SecurityMode({ title, text }: { title: string; text: string }) {
  return (
    <YStack padding="$3" borderRadius="$4" backgroundColor="$color3" gap="$1">
      <Text color="$color12" fontWeight="900">{title}</Text>
      <Paragraph color="$color9" size="$2" lineHeight="$5">{text}</Paragraph>
    </YStack>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text color="$color10" fontSize="$2" fontWeight="900">{children}</Text>
}
