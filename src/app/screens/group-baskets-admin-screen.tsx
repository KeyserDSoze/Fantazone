import React, { useEffect, useMemo, useState } from 'react'
import { Copy, Plus, RefreshCw, Trash2, Users } from '@tamagui/lucide-icons-2'
import { Button, Input, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  getCurrentSeasonYear,
  formatSeasonFromYear,
  IdentityRole,
  type AnnualTeam,
  type AuthenticatedGroupSession,
  type Group,
} from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import {
  addAnnualTeam,
  copyAnnualTeamsFromPreviousYear,
  createGroupBasket,
  deleteGroupBasket,
  removeAnnualTeam,
  toggleAnnualTeamCoOwner,
} from '../services/groupBasketAdminService'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  selection: GroupNavigationSelection
}

export function GroupBasketsAdminScreen({ runtime, session, selection }: Props) {
  const [group, setGroup] = useState<Group>(runtime.group)
  const [selectedBasketId, setSelectedBasketId] = useState<string | null>(runtime.group.baskets[0]?.id ?? null)
  const [basketName, setBasketName] = useState('')
  const [teamName, setTeamName] = useState('')
  const [teamOwner, setTeamOwner] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const year = selection.year ?? getCurrentSeasonYear()

  const basket = group.baskets.find(item => item.id === selectedBasketId) ?? null
  const yearly = basket?.years.find(item => item.year === year) ?? null
  const teams = yearly?.teams ?? []
  const activeUsers = useMemo(
    () => group.users.filter(user => user.role !== IdentityRole.None).slice().sort((a, b) => a.email.localeCompare(b.email)),
    [group],
  )
  const linkedLeagues = basket ? group.leagues.filter(league => league.basketsId.includes(basket.id)) : []

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const fresh = await runtime.refreshGroup()
      setGroup(fresh)
      setSelectedBasketId(current => fresh.baskets.some(item => item.id === current) ? current : (fresh.baskets[0]?.id ?? null))
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [runtime])

  async function createBasket() {
    setLoading(true); setError(null); setStatus(null)
    try {
      const result = await createGroupBasket(runtime, session.member, basketName, year)
      setGroup(result.group); setSelectedBasketId(result.basket.id); setBasketName('')
      setStatus(`Basket “${result.basket.name}” creato.`)
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function deleteBasket() {
    if (!basket) return
    setLoading(true); setError(null); setStatus(null)
    try {
      const fresh = await deleteGroupBasket(runtime, session.member, basket.id)
      setGroup(fresh); setSelectedBasketId(fresh.baskets[0]?.id ?? null)
      setStatus(`Basket “${basket.name}” eliminato.`)
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function addTeam() {
    if (!basket) return
    setLoading(true); setError(null); setStatus(null)
    try {
      const fresh = await addAnnualTeam(runtime, session.member, { basketId: basket.id, year, name: teamName, owner: teamOwner })
      setGroup(fresh); setTeamName(''); setTeamOwner('')
      setStatus('Squadra aggiunta all’anagrafica della stagione.')
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function removeTeam(team: AnnualTeam) {
    if (!basket) return
    setLoading(true); setError(null); setStatus(null)
    try {
      setGroup(await removeAnnualTeam(runtime, session.member, { basketId: basket.id, year, owner: team.owner }))
      setStatus(`${team.name} rimossa dall’anagrafica ${formatSeasonFromYear(year)}.`)
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function toggleCoOwner(team: AnnualTeam, email: string) {
    if (!basket) return
    setLoading(true); setError(null); setStatus(null)
    try {
      setGroup(await toggleAnnualTeamCoOwner(runtime, session.member, { basketId: basket.id, year, owner: team.owner, coOwner: email }))
      setStatus(`Co-owner aggiornati per ${team.name}.`)
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function copyPrevious() {
    if (!basket) return
    setLoading(true); setError(null); setStatus(null)
    try {
      const result = await copyAnnualTeamsFromPreviousYear(runtime, session.member, { basketId: basket.id, year })
      setGroup(result.group)
      setStatus(result.copied > 0
        ? `${result.copied} squadre copiate dal ${formatSeasonFromYear(year - 1)}${result.skipped.length ? `; ${result.skipped.length} saltate per conflitti di assegnazione.` : '.'}`
        : `Nessuna squadra copiata; ${result.skipped.length} assegnazioni erano già occupate.`)
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  return (
    <AppScreen maxWidth={1180}>
      <PageIntro
        eyebrow="Amministrazione"
        title="Basket e squadre"
        description={`Anagrafica canonica ${formatSeasonFromYear(year)}. Un account può appartenere a una sola squadra per stagione e ogni modifica viene controllata prima della scrittura.`}
        action={(
          <Button variant="outlined" borderRadius="$4" icon={loading ? undefined : RefreshCw} disabled={loading} onPress={() => { void refresh() }}>
            {loading ? <Spinner /> : 'Aggiorna'}
          </Button>
        )}
      />

      {error ? <Surface accent="red" padding="$3"><Paragraph color="$red11">{error}</Paragraph></Surface> : null}
      {status ? <Surface accent="green" padding="$3"><Paragraph color="$green11">{status}</Paragraph></Surface> : null}

      <Surface padding="$4">
        <YStack gap="$4">
          <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
            <YStack gap="$1">
              <Text color="$color12" fontSize="$6" fontWeight="900">Struttura del gruppo</Text>
              <Paragraph color="$color10">Scegli il basket da amministrare oppure creane uno nuovo.</Paragraph>
            </YStack>
            <StatusPill tone="purple">{group.baskets.length} basket</StatusPill>
          </XStack>

          <XStack gap="$2" flexWrap="wrap">
            {group.baskets.map(item => (
              <Button
                key={item.id}
                size="$3"
                borderRadius="$10"
                backgroundColor={item.id === selectedBasketId ? '$purple4' : '$color3'}
                borderColor={item.id === selectedBasketId ? '$purple7' : '$color5'}
                onPress={() => setSelectedBasketId(item.id)}
              >
                <Text color={item.id === selectedBasketId ? '$purple11' : '$color10'} fontWeight="800">{item.name}</Text>
              </Button>
            ))}
            {group.baskets.length === 0 ? <Text color="$color9">Nessun basket configurato.</Text> : null}
          </XStack>

          <XStack gap="$3" flexWrap="wrap" alignItems="flex-end">
            <YStack flex={1} minWidth={260} gap="$1.5">
              <Text color="$color9" fontSize="$2" fontWeight="800">NUOVO BASKET</Text>
              <Input value={basketName} onChangeText={setBasketName} placeholder="Nome basket" />
            </YStack>
            <PrimaryAction disabled={loading || !basketName.trim()} onPress={() => { void createBasket() }} icon={<Plus size="$1" color="white" />}>
              Crea basket
            </PrimaryAction>
          </XStack>
        </YStack>
      </Surface>

      {basket ? (
        <Surface accent="purple" padding="$5">
          <YStack gap="$4">
            <XStack justifyContent="space-between" alignItems="flex-start" gap="$4" flexWrap="wrap">
              <YStack flex={1} minWidth={260} gap="$2">
                <XStack alignItems="center" gap="$2" flexWrap="wrap">
                  <Text color="$color12" fontSize="$7" fontWeight="900">{basket.name}</Text>
                  <StatusPill tone={linkedLeagues.length > 0 ? 'blue' : 'neutral'}>{linkedLeagues.length} leghe collegate</StatusPill>
                </XStack>
                <Text color="$color9" fontSize="$2">ID tecnico · {basket.id}</Text>
                <Paragraph color="$color10">{linkedLeagues.length ? linkedLeagues.map(league => league.name).join(' · ') : 'Nessuna lega usa ancora questo basket.'}</Paragraph>
              </YStack>
              <Button
                variant="outlined"
                borderRadius="$4"
                icon={Trash2}
                disabled={loading}
                borderColor="$red7"
                color="$red10"
                onPress={() => { void deleteBasket() }}
              >
                Elimina basket
              </Button>
            </XStack>
            <Paragraph color="$color9" fontSize="$2">La cancellazione resta bloccata se il basket è collegato a una lega o contiene squadre in qualunque stagione.</Paragraph>
          </YStack>
        </Surface>
      ) : null}

      {basket ? (
        <Surface accent="blue" padding="$5">
          <YStack gap="$4">
            <XStack justifyContent="space-between" alignItems="flex-start" gap="$4" flexWrap="wrap">
              <YStack gap="$1">
                <XStack alignItems="center" gap="$2">
                  <Users size="$1.1" color="$blue10" />
                  <Text color="$color12" fontSize="$6" fontWeight="900">Squadre · {formatSeasonFromYear(year)}</Text>
                </XStack>
                <Paragraph color="$color10">{teams.length} squadre configurate in questo basket.</Paragraph>
              </YStack>
              <Button variant="outlined" borderRadius="$4" icon={Copy} disabled={loading} onPress={() => { void copyPrevious() }}>
                Copia dal {formatSeasonFromYear(year - 1)}
              </Button>
            </XStack>

            <XStack gap="$3" flexWrap="wrap" alignItems="flex-end">
              <YStack flexGrow={1} flexBasis={230} gap="$1.5">
                <Text color="$color9" fontSize="$2" fontWeight="800">NOME SQUADRA</Text>
                <Input value={teamName} onChangeText={setTeamName} placeholder="Nome squadra" />
              </YStack>
              <YStack flexGrow={1} flexBasis={280} gap="$1.5">
                <Text color="$color9" fontSize="$2" fontWeight="800">OWNER</Text>
                <Input value={teamOwner} onChangeText={setTeamOwner} autoCapitalize="none" autoCorrect={false} placeholder="owner@email.it" />
              </YStack>
              <PrimaryAction disabled={loading || !teamName.trim() || !teamOwner.trim()} onPress={() => { void addTeam() }} icon={<Plus size="$1" color="white" />}>
                Aggiungi squadra
              </PrimaryAction>
            </XStack>
            <Paragraph color="$color9" fontSize="$2">Owner e co-owner devono essere utenti attivi. Il service impedisce assegnazioni multiple nella stessa stagione.</Paragraph>
          </YStack>
        </Surface>
      ) : null}

      {basket ? (
        <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
          {teams.map(team => (
            <TeamCard
              key={team.owner}
              team={team}
              activeEmails={activeUsers.map(user => user.email)}
              loading={loading}
              onRemove={() => { void removeTeam(team) }}
              onToggleCoOwner={email => { void toggleCoOwner(team, email) }}
            />
          ))}
          {teams.length === 0 ? (
            <Surface padding="$5">
              <YStack minHeight={140} alignItems="center" justifyContent="center" gap="$2">
                <Users size="$2" color="$color8" />
                <Text color="$color12" fontWeight="900">Nessuna squadra</Text>
                <Paragraph color="$color10" textAlign="center">Aggiungi la prima squadra oppure copia le assegnazioni della stagione precedente.</Paragraph>
              </YStack>
            </Surface>
          ) : null}
        </XStack>
      ) : null}
    </AppScreen>
  )
}

function TeamCard({ team, activeEmails, loading, onRemove, onToggleCoOwner }: {
  team: AnnualTeam
  activeEmails: string[]
  loading: boolean
  onRemove: () => void
  onToggleCoOwner: (email: string) => void
}) {
  const [coOwner, setCoOwner] = useState('')
  return (
    <YStack
      flexGrow={1}
      flexBasis={420}
      minWidth={300}
      maxWidth={570}
      padding="$4"
      gap="$4"
      borderWidth={1}
      borderColor="$color5"
      backgroundColor="$color2"
      borderRadius="$5"
    >
      <XStack justifyContent="space-between" alignItems="flex-start" gap="$3">
        <YStack flex={1} minWidth={0} gap="$1">
          <Text color="$color12" fontWeight="900" fontSize="$5" numberOfLines={1}>{team.name}</Text>
          <Text color="$color9" fontSize="$2" numberOfLines={1}>Owner · {team.owner}</Text>
        </YStack>
        <Button size="$3" variant="outlined" borderRadius="$4" borderColor="$red7" color="$red10" disabled={loading} onPress={onRemove}>Rimuovi</Button>
      </XStack>

      <YStack gap="$2">
        <XStack alignItems="center" justifyContent="space-between" gap="$2">
          <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Co-owner</Text>
          <StatusPill tone={team.additionalOwners.length ? 'blue' : 'neutral'}>{team.additionalOwners.length}</StatusPill>
        </XStack>
        <XStack gap="$2" flexWrap="wrap">
          {team.additionalOwners.map(email => (
            <Button key={email} size="$2" borderRadius="$10" backgroundColor="$blue3" borderColor="$blue5" disabled={loading} onPress={() => onToggleCoOwner(email)}>
              <Text color="$blue11" fontWeight="800">{email} ×</Text>
            </Button>
          ))}
          {team.additionalOwners.length === 0 ? <Text color="$color9">Nessun co-owner assegnato.</Text> : null}
        </XStack>
      </YStack>

      <XStack gap="$2" flexWrap="wrap" alignItems="center">
        <Input flex={1} minWidth={240} value={coOwner} onChangeText={setCoOwner} autoCapitalize="none" autoCorrect={false} placeholder="co-owner@email.it" />
        <Button
          size="$3"
          borderRadius="$4"
          disabled={loading || !coOwner.trim() || !activeEmails.some(email => same(email, coOwner))}
          onPress={() => { onToggleCoOwner(coOwner); setCoOwner('') }}
        >
          Aggiungi
        </Button>
      </XStack>
    </YStack>
  )
}

function message(error: unknown): string { return error instanceof Error ? error.message : 'Operazione non riuscita.' }
function same(first: string, second: string): boolean { return first.trim().toLowerCase() === second.trim().toLowerCase() }
