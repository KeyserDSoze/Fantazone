import React, { useEffect, useState } from 'react'
import { Button, Card, H1, H2, Input, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  GroupHelper,
  IdentityRole,
  type AuthenticatedGroupSession,
  type Group,
  type UserOfAGroup,
} from '@fantazone/domain'
import {
  disableGroupMember,
  setGroupMemberRole,
  toggleGroupMemberRole,
} from '../services/groupUserAdminService'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = { runtime: GroupSessionRuntime; session: AuthenticatedGroupSession }

type RoleFlag = IdentityRole.Reader | IdentityRole.Participant | IdentityRole.Admin | IdentityRole.SuperAdmin

export function GroupUsersAdminScreen({ runtime, session }: Props) {
  const [group, setGroup] = useState<Group>(runtime.group)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [actingEmail, setActingEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try { setGroup(await runtime.refreshGroup()) }
    catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [runtime])

  async function addMember() {
    const normalized = email.trim().toLowerCase()
    if (!normalized || !normalized.includes('@')) { setError('Inserisci una email valida.'); return }
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      const invited = await runtime.inviteMember(session.member, { email: normalized, username })
      setGroup(await runtime.refreshGroup())
      setEmail('')
      setUsername('')
      setStatus(`${invited.email} è ora censito nel gruppo. Per condividere il PAT usa “Invita nel gruppo” nelle Impostazioni.`)
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function toggle(user: UserOfAGroup, flag: RoleFlag) {
    setActingEmail(user.email)
    setError(null)
    setStatus(null)
    try {
      setGroup(await toggleGroupMemberRole(runtime, session.member, user.email, flag))
      setStatus(`Ruoli aggiornati per ${user.email}.`)
    } catch (caught) { setError(message(caught)) }
    finally { setActingEmail(null) }
  }

  async function disable(user: UserOfAGroup) {
    setActingEmail(user.email)
    setError(null)
    setStatus(null)
    try {
      setGroup(await disableGroupMember(runtime, session.member, user.email))
      setStatus(`${user.email} è stato disabilitato nel gruppo.`)
    } catch (caught) { setError(message(caught)) }
    finally { setActingEmail(null) }
  }

  async function reactivate(user: UserOfAGroup) {
    setActingEmail(user.email)
    setError(null)
    setStatus(null)
    try {
      setGroup(await setGroupMemberRole(runtime, session.member, user.email, IdentityRole.Participant))
      setStatus(`${user.email} è stato riattivato come Partecipante.`)
    } catch (caught) { setError(message(caught)) }
    finally { setActingEmail(null) }
  }

  const users = [...group.users].sort((a, b) => Number(a.role === IdentityRole.None) - Number(b.role === IdentityRole.None) || a.email.localeCompare(b.email))

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={980} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1"><H1>Utenti del gruppo</H1><Paragraph color="$color10">Membership e ruoli canonici in config/group.json.</Paragraph></YStack>
          <Button variant="outlined" disabled={loading} onPress={() => { void refresh() }}>{loading ? <Spinner /> : 'Aggiorna'}</Button>
        </XStack>

        {error ? <Card borderWidth={1} borderColor="$red8" padding="$3"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {status ? <Card borderWidth={1} borderColor="$green8" padding="$3"><Paragraph color="$green10">{status}</Paragraph></Card> : null}

        <Card borderWidth={1} borderColor="$blue8" padding="$4">
          <YStack gap="$3">
            <H2 size="$6">Aggiungi o riattiva utente</H2>
            <Paragraph color="$color10">L’utente viene censito come Partecipante. La condivisione della credenziale GitHub resta nel flusso invito delle Impostazioni.</Paragraph>
            <XStack gap="$3" flexWrap="wrap">
              <Input flex={1} minWidth={260} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} placeholder="email@esempio.it" />
              <Input flex={1} minWidth={220} value={username} onChangeText={setUsername} placeholder="Nome visualizzato" />
              <Button disabled={loading || !email.trim()} onPress={() => { void addMember() }}>Aggiungi</Button>
            </XStack>
          </YStack>
        </Card>

        <YStack gap="$3">
          {users.map(user => {
            const disabled = user.role === IdentityRole.None
            const busy = actingEmail === user.email
            return (
              <Card key={user.email} borderWidth={1} borderColor={disabled ? '$color6' : '$borderColor'} padding="$4" opacity={disabled ? 0.6 : 1}>
                <YStack gap="$3">
                  <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap">
                    <YStack flex={1} minWidth={220}>
                      <Text fontWeight="900" fontSize="$5">{user.username}</Text>
                      <Text color="$color10">{user.email}</Text>
                      {same(user.email, session.member.email) ? <Text color="$blue10" fontSize="$2">Sessione corrente</Text> : null}
                    </YStack>
                    {disabled ? (
                      <Button disabled={busy} onPress={() => { void reactivate(user) }}>{busy ? <Spinner /> : 'Riattiva'}</Button>
                    ) : (
                      <Button variant="outlined" disabled={busy || same(user.email, session.member.email)} onPress={() => { void disable(user) }}>
                        {busy ? <Spinner /> : 'Disabilita'}
                      </Button>
                    )}
                  </XStack>

                  {!disabled ? (
                    <XStack gap="$2" flexWrap="wrap">
                      <RoleButton user={user} flag={IdentityRole.Reader} label="Visitatore" busy={busy} onPress={() => { void toggle(user, IdentityRole.Reader) }} />
                      <RoleButton user={user} flag={IdentityRole.Participant} label="Partecipante" busy={busy} onPress={() => { void toggle(user, IdentityRole.Participant) }} />
                      <RoleButton user={user} flag={IdentityRole.Admin} label="Admin" busy={busy} onPress={() => { void toggle(user, IdentityRole.Admin) }} />
                      <RoleButton user={user} flag={IdentityRole.SuperAdmin} label="SuperAdmin" busy={busy} onPress={() => { void toggle(user, IdentityRole.SuperAdmin) }} />
                    </XStack>
                  ) : <Text color="$color9">Accesso disabilitato</Text>}
                </YStack>
              </Card>
            )
          })}
        </YStack>
      </YStack>
    </ScrollView>
  )
}

function RoleButton({ user, flag, label, busy, onPress }: { user: UserOfAGroup; flag: RoleFlag; label: string; busy: boolean; onPress: () => void }) {
  const active = GroupHelper.hasRole(user, flag)
  return <Button size="$3" variant="outlined" disabled={busy} backgroundColor={active ? '$color4' : 'transparent'} borderColor={active ? '$blue8' : '$borderColor'} onPress={onPress}>{label}</Button>
}

function message(error: unknown): string { return error instanceof Error ? error.message : 'Operazione non riuscita.' }
function same(a: string, b: string): boolean { return a.trim().toLowerCase() === b.trim().toLowerCase() }
