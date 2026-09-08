import React, { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShieldCheck, UserPlus, Users } from '@tamagui/lucide-icons-2'
import { Button, Input, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  GroupHelper,
  IdentityRole,
  type AuthenticatedGroupSession,
  type Group,
  type UserOfAGroup,
} from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
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

  const users = useMemo(
    () => [...group.users].sort((a, b) => Number(a.role === IdentityRole.None) - Number(b.role === IdentityRole.None) || a.email.localeCompare(b.email)),
    [group.users],
  )
  const active = users.filter(user => user.role !== IdentityRole.None)
  const admins = active.filter(user => GroupHelper.hasRole(user, IdentityRole.Admin) || GroupHelper.hasRole(user, IdentityRole.SuperAdmin))

  return (
    <AppScreen maxWidth={1180}>
      <PageIntro
        eyebrow="Amministrazione"
        title="Utenti e permessi"
        description="Gestisci membership e ruoli canonici del gruppo. Le modifiche finiscono in config/group.json e vengono rivalidate prima di ogni operazione privilegiata."
        action={(
          <Button variant="outlined" borderRadius="$4" icon={loading ? undefined : RefreshCw} disabled={loading} onPress={() => { void refresh() }}>
            {loading ? <Spinner /> : 'Aggiorna'}
          </Button>
        )}
      />

      <XStack gap="$3" flexWrap="wrap">
        <Metric label="Utenti attivi" value={active.length} tone="blue" />
        <Metric label="Admin" value={admins.length} tone="purple" />
        <Metric label="Disabilitati" value={users.length - active.length} tone="neutral" />
      </XStack>

      {error ? <Surface accent="red" padding="$3"><Paragraph color="$red11">{error}</Paragraph></Surface> : null}
      {status ? <Surface accent="green" padding="$3"><Paragraph color="$green11">{status}</Paragraph></Surface> : null}

      <Surface accent="blue" padding="$5">
        <YStack gap="$4">
          <XStack alignItems="center" gap="$2">
            <UserPlus size="$1.2" color="$blue10" />
            <YStack gap="$1" flex={1}>
              <Text color="$color12" fontSize="$6" fontWeight="900">Aggiungi o riattiva un utente</Text>
              <Paragraph color="$color10">Il nuovo account parte come Partecipante. La credenziale GitHub viene condivisa solo dal flusso Invita nelle Impostazioni.</Paragraph>
            </YStack>
          </XStack>
          <XStack gap="$3" flexWrap="wrap" alignItems="flex-end">
            <YStack flexGrow={1} flexBasis={280} gap="$1.5">
              <Text color="$color9" fontSize="$2" fontWeight="800">EMAIL MICROSOFT</Text>
              <Input value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} placeholder="email@esempio.it" />
            </YStack>
            <YStack flexGrow={1} flexBasis={240} gap="$1.5">
              <Text color="$color9" fontSize="$2" fontWeight="800">NOME VISUALIZZATO</Text>
              <Input value={username} onChangeText={setUsername} placeholder="Nome o nickname" />
            </YStack>
            <PrimaryAction disabled={loading || !email.trim()} onPress={() => { void addMember() }} icon={<UserPlus size="$1" color="white" />}>
              Aggiungi utente
            </PrimaryAction>
          </XStack>
        </YStack>
      </Surface>

      <YStack gap="$3">
        <XStack alignItems="center" gap="$2">
          <Users size="$1.2" color="$color9" />
          <Text color="$color12" fontSize="$6" fontWeight="900">Membri del gruppo</Text>
          <StatusPill tone="blue">{users.length} totali</StatusPill>
        </XStack>

        <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
          {users.map(user => {
            const disabled = user.role === IdentityRole.None
            const busy = actingEmail === user.email
            const current = same(user.email, session.member.email)
            return (
              <YStack
                key={user.email}
                flexGrow={1}
                flexBasis={360}
                minWidth={290}
                maxWidth={570}
                padding="$4"
                gap="$4"
                borderWidth={1}
                borderColor={disabled ? '$color5' : current ? '$blue6' : '$color5'}
                backgroundColor={disabled ? '$color2' : current ? '$blue2' : '$color2'}
                borderRadius="$5"
                opacity={disabled ? 0.62 : 1}
              >
                <XStack justifyContent="space-between" alignItems="flex-start" gap="$3">
                  <YStack flex={1} minWidth={0} gap="$1">
                    <Text color="$color12" fontWeight="900" fontSize="$5" numberOfLines={1}>{user.username || user.email.split('@')[0]}</Text>
                    <Text color="$color9" fontSize="$2" numberOfLines={1}>{user.email}</Text>
                  </YStack>
                  <StatusPill tone={disabled ? 'neutral' : current ? 'blue' : 'green'}>
                    {disabled ? 'Disabilitato' : current ? 'Sessione corrente' : 'Attivo'}
                  </StatusPill>
                </XStack>

                {!disabled ? (
                  <YStack gap="$2">
                    <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Ruoli</Text>
                    <XStack gap="$2" flexWrap="wrap">
                      <RoleButton user={user} flag={IdentityRole.Reader} label="Visitatore" busy={busy} onPress={() => { void toggle(user, IdentityRole.Reader) }} />
                      <RoleButton user={user} flag={IdentityRole.Participant} label="Partecipante" busy={busy} onPress={() => { void toggle(user, IdentityRole.Participant) }} />
                      <RoleButton user={user} flag={IdentityRole.Admin} label="Admin" busy={busy} onPress={() => { void toggle(user, IdentityRole.Admin) }} />
                      <RoleButton user={user} flag={IdentityRole.SuperAdmin} label="SuperAdmin" busy={busy} onPress={() => { void toggle(user, IdentityRole.SuperAdmin) }} />
                    </XStack>
                  </YStack>
                ) : (
                  <Paragraph color="$color9">L’account resta nello storico del gruppo ma non può accedere finché non viene riattivato.</Paragraph>
                )}

                <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
                  <XStack alignItems="center" gap="$2">
                    <ShieldCheck size="$1" color={GroupHelper.hasRole(user, IdentityRole.SuperAdmin) ? '$purple10' : '$color8'} />
                    <Text color="$color9" fontSize="$2">Flags: {user.role}</Text>
                  </XStack>
                  {disabled ? (
                    <Button borderRadius="$4" disabled={busy} onPress={() => { void reactivate(user) }}>{busy ? <Spinner /> : 'Riattiva'}</Button>
                  ) : (
                    <Button
                      variant="outlined"
                      borderRadius="$4"
                      borderColor="$red7"
                      color="$red10"
                      disabled={busy || current}
                      onPress={() => { void disable(user) }}
                    >
                      {busy ? <Spinner /> : 'Disabilita'}
                    </Button>
                  )}
                </XStack>
              </YStack>
            )
          })}
        </XStack>
      </YStack>
    </AppScreen>
  )
}

function RoleButton({ user, flag, label, busy, onPress }: { user: UserOfAGroup; flag: RoleFlag; label: string; busy: boolean; onPress: () => void }) {
  const active = GroupHelper.hasRole(user, flag)
  return (
    <Button
      size="$3"
      borderRadius="$10"
      disabled={busy}
      backgroundColor={active ? '$blue4' : '$color3'}
      borderColor={active ? '$blue7' : '$color5'}
      onPress={onPress}
    >
      <Text color={active ? '$blue11' : '$color10'} fontWeight="800">{active ? '✓ ' : ''}{label}</Text>
    </Button>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'blue' | 'purple' | 'neutral' }) {
  const background = tone === 'blue' ? '$blue2' : tone === 'purple' ? '$purple2' : '$color2'
  const border = tone === 'blue' ? '$blue5' : tone === 'purple' ? '$purple5' : '$color5'
  return (
    <YStack flexGrow={1} flexBasis={180} minWidth={150} padding="$4" gap="$1" borderWidth={1} borderColor={border} backgroundColor={background} borderRadius="$5">
      <Text color="$color9" fontSize="$2" fontWeight="800">{label}</Text>
      <Text color="$color12" fontSize="$8" lineHeight="$8" fontWeight="900">{value}</Text>
    </YStack>
  )
}

function message(error: unknown): string { return error instanceof Error ? error.message : 'Operazione non riuscita.' }
function same(a: string, b: string): boolean { return a.trim().toLowerCase() === b.trim().toLowerCase() }
