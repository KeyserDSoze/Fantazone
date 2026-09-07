import React, { useMemo, useState } from 'react'
import { Linking, Platform, Share } from 'react-native'
import { Button, Card, H1, H2, Input, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import { createInviteFragment } from '@fantazone/github'
import { GroupHelper, IdentityRole, type AuthenticatedGroupSession } from '@fantazone/domain'
import { publicWebUrl } from '../config/publicOrigin'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

export function GroupSettingsScreen({ runtime, session }: { runtime: GroupSessionRuntime; session: AuthenticatedGroupSession }) {
  const group = runtime.group
  const connection = runtime.connection
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteUsername, setInviteUsername] = useState('')
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [displayGroupName, setDisplayGroupName] = useState(group.name)
  const [leagueNames, setLeagueNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(group.leagues.map(league => [league.id, league.name || league.id])),
  )
  const [displayStatus, setDisplayStatus] = useState<string | null>(null)
  const [savingDisplay, setSavingDisplay] = useState(false)
  const canManage = useMemo(() =>
    GroupHelper.hasRole(session.member, IdentityRole.Admin) ||
    GroupHelper.hasRole(session.member, IdentityRole.SuperAdmin), [session.member])

  async function saveDisplaySettings() {
    setSavingDisplay(true)
    setDisplayStatus(null)
    try {
      await runtime.updateDisplaySettings(session.member, {
        groupName: displayGroupName,
        leagueNames,
      })
      setDisplayGroupName(runtime.group.name)
      setLeagueNames(Object.fromEntries(runtime.group.leagues.map(league => [league.id, league.name || league.id])))
      setDisplayStatus('Nomi aggiornati in settings.json. ID, calendari e storico non cambiano.')
    } catch (caught) {
      setDisplayStatus(caught instanceof Error ? caught.message : 'Impossibile aggiornare i nomi visualizzati.')
    } finally {
      setSavingDisplay(false)
    }
  }

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
        group: runtime.group.name,
        repository: connection.repository.full_name,
        email: invited.email,
        pat: connection.token,
      })
      const inviteUrl = publicWebUrl(`/${fragment}`)
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl)
        setShareStatus(`Utente ${invited.email} censito nel gruppo e invito copiato.`)
      } else {
        await Share.share({
          title: `Invito Fantazone · ${runtime.group.name}`,
          message: `Unisciti al gruppo Fantazone ${runtime.group.name} con ${invited.email}: ${inviteUrl}`,
        })
        setShareStatus(`Utente ${invited.email} censito nel gruppo e invito pronto.`)
      }
      setInviteEmail('')
      setInviteUsername('')
    } catch (caught) {
      setShareStatus(caught instanceof Error ? caught.message : 'Impossibile creare l’invito.')
    } finally {
      setSharing(false)
    }
  }

  const repositoryUrl = connection.repository.html_url ?? `https://github.com/${connection.repository.full_name}`

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={980} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <YStack gap="$1" paddingTop="$2">
          <H1>Impostazioni</H1>
          <Paragraph color="$color10">Account, nomi visualizzati e collegamento zero-backend.</Paragraph>
        </YStack>

        <XStack gap="$3" flexWrap="wrap">
          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={360}>
            <YStack gap="$2">
              <H2 size="$6">Gruppo</H2>
              <Text fontWeight="700">{runtime.group.name}</Text>
              <Text color="$color10">{connection.repository.full_name}</Text>
              <Text color="$color10">Branch: {connection.repository.default_branch}</Text>
              <Paragraph size="$2" color="$color9">Il nome GitHub della repository è tecnico e può essere diverso dal nome del gruppo.</Paragraph>
              <Button marginTop="$2" variant="outlined" onPress={() => Linking.openURL(repositoryUrl)}>Apri repository</Button>
            </YStack>
          </Card>

          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={360}>
            <YStack gap="$2">
              <H2 size="$6">Account</H2>
              <Text>{session.identity.displayName || session.member.username}</Text>
              <Text color="$color10">{session.identity.email}</Text>
              <Text color="$color10">Ruolo flags: {session.member.role}</Text>
              <Paragraph size="$2" color="$color9">La membership viene riletta dal repository quando il gruppo si sincronizza.</Paragraph>
            </YStack>
          </Card>
        </XStack>

        {canManage ? (
          <Card borderWidth={1} borderColor="$green8" padding="$4">
            <YStack gap="$3">
              <H2 size="$6">Nomi visualizzati</H2>
              <Paragraph>
                Questi valori vivono in <Text fontWeight="700">settings.json</Text> nella root della repository. Puoi rinominare gruppo e leghe senza cambiare gli ID stabili, i path Git, il calendario o lo storico.
              </Paragraph>
              <YStack gap="$2">
                <Text fontWeight="700">Nome del gruppo</Text>
                <Input value={displayGroupName} onChangeText={setDisplayGroupName} placeholder="Amici del Bar" />
              </YStack>
              {group.leagues.map(league => (
                <YStack key={league.id} gap="$1">
                  <Text fontWeight="700">Lega · {league.id}</Text>
                  <Input
                    value={leagueNames[league.id] ?? league.name ?? league.id}
                    onChangeText={value => setLeagueNames(current => ({ ...current, [league.id]: value }))}
                    placeholder={league.id}
                  />
                </YStack>
              ))}
              <Button theme="accent" disabled={savingDisplay} onPress={saveDisplaySettings}>
                {savingDisplay ? <Spinner /> : 'Salva nomi visualizzati'}
              </Button>
              {displayStatus ? <Paragraph size="$2" color="$color10">{displayStatus}</Paragraph> : null}
            </YStack>
          </Card>
        ) : null}

        {canManage ? (
          <Card borderWidth={1} borderColor="$blue8" padding="$4">
            <YStack gap="$3">
              <H2 size="$6">Invita nel gruppo</H2>
              <Paragraph>
                L’email viene salvata in <Text fontWeight="700">config/group.json</Text>; il link trasferisce la credenziale GitHub condivisa del gruppo e l’app la sincronizza nello spazio privato OneDrive dell’invitato.
              </Paragraph>
              <Card borderWidth={1} borderColor="$yellow8" padding="$3">
                <Paragraph size="$2">Tratta il link come una password del gruppo: chi lo possiede può usare il PAT finché non viene ruotato.</Paragraph>
              </Card>
              <XStack gap="$3" flexWrap="wrap">
                <Input flex={1} minWidth={240} value={inviteEmail} onChangeText={setInviteEmail} autoCapitalize="none" autoCorrect={false} placeholder="email@esempio.it" />
                <Input flex={1} minWidth={200} value={inviteUsername} onChangeText={setInviteUsername} placeholder="Nome visualizzato (opzionale)" />
              </XStack>
              <Button theme="accent" disabled={sharing} onPress={inviteAndShare}>{sharing ? <Spinner /> : 'Censisci utente e copia invito'}</Button>
              <Paragraph size="$2" color="$color9">L’invitato accede con l’email Microsoft indicata. fanta.plus verifica il PAT condiviso e lo salva in OneDrive e sul dispositivo.</Paragraph>
              {shareStatus ? <Paragraph size="$2" color="$color10">{shareStatus}</Paragraph> : null}
            </YStack>
          </Card>
        ) : null}
      </YStack>
    </ScrollView>
  )
}
