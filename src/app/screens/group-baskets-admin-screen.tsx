import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, H1, H2, Input, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  getCurrentSeasonYear,
  formatSeasonFromYear,
  IdentityRole,
  type AnnualTeam,
  type AuthenticatedGroupSession,
  type Group,
} from '@fantazone/domain'
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
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1040} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1">
            <H1>Basket e squadre</H1>
            <Paragraph color="$color10">Anagrafica canonica · {formatSeasonFromYear(year)}. Un account può appartenere a una sola squadra per stagione.</Paragraph>
          </YStack>
          <Button variant="outlined" disabled={loading} onPress={() => { void refresh() }}>{loading ? <Spinner /> : 'Aggiorna'}</Button>
        </XStack>

        {error ? <Card borderWidth={1} borderColor="$red8" padding="$3"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {status ? <Card borderWidth={1} borderColor="$green8" padding="$3"><Paragraph color="$green10">{status}</Paragraph></Card> : null}

        <Card borderWidth={1} borderColor="$borderColor" padding="$4">
          <YStack gap="$3">
            <H2 size="$6">Basket</H2>
            <XStack gap="$2" flexWrap="wrap">
              {group.baskets.map(item => (
                <Button key={item.id} size="$3" variant="outlined" backgroundColor={item.id === selectedBasketId ? '$color4' : 'transparent'} borderColor={item.id === selectedBasketId ? '$purple8' : '$borderColor'} onPress={() => setSelectedBasketId(item.id)}>
                  {item.name}
                </Button>
              ))}
              {group.baskets.length === 0 ? <Text color="$color10">Nessun basket configurato.</Text> : null}
            </XStack>
            <XStack gap="$2" flexWrap="wrap">
              <Input flex={1} minWidth={260} value={basketName} onChangeText={setBasketName} placeholder="Nuovo basket" />
              <Button disabled={loading || !basketName.trim()} onPress={() => { void createBasket() }}>Crea basket</Button>
            </XStack>
          </YStack>
        </Card>

        {basket ? (
          <Card borderWidth={1} borderColor="$purple8" padding="$4">
            <YStack gap="$3">
              <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap">
                <YStack flex={1} minWidth={240}>
                  <H2 size="$6">{basket.name}</H2>
                  <Paragraph color="$color10">ID: {basket.id}</Paragraph>
                  <Paragraph color="$color10">Leghe collegate: {linkedLeagues.length ? linkedLeagues.map(league => league.name).join(', ') : 'nessuna'}</Paragraph>
                </YStack>
                <Button variant="outlined" disabled={loading} borderColor="$red8" color="$red10" onPress={() => { void deleteBasket() }}>Elimina basket</Button>
              </XStack>
              <Paragraph color="$color9">La cancellazione è consentita solo quando il basket non è collegato a leghe e non contiene squadre in nessuna stagione.</Paragraph>
            </YStack>
          </Card>
        ) : null}

        {basket ? (
          <Card borderWidth={1} borderColor="$blue8" padding="$4">
            <YStack gap="$3">
              <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
                <YStack><H2 size="$6">Squadre · {formatSeasonFromYear(year)}</H2><Paragraph color="$color10">{teams.length} squadre configurate.</Paragraph></YStack>
                <Button variant="outlined" disabled={loading} onPress={() => { void copyPrevious() }}>Copia dal {formatSeasonFromYear(year - 1)}</Button>
              </XStack>
              <XStack gap="$2" flexWrap="wrap">
                <Input flex={1} minWidth={220} value={teamName} onChangeText={setTeamName} placeholder="Nome squadra" />
                <Input flex={1} minWidth={260} value={teamOwner} onChangeText={setTeamOwner} autoCapitalize="none" autoCorrect={false} placeholder="owner@email.it" />
                <Button disabled={loading || !teamName.trim() || !teamOwner.trim()} onPress={() => { void addTeam() }}>Aggiungi squadra</Button>
              </XStack>
              <Paragraph color="$color9">Owner e co-owner devono essere utenti attivi del gruppo. Il service impedisce assegnazioni multiple nella stessa stagione.</Paragraph>
            </YStack>
          </Card>
        ) : null}

        {basket ? (
          <YStack gap="$3">
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
            {teams.length === 0 ? <Card borderWidth={1} borderColor="$borderColor" padding="$4"><Paragraph color="$color10">Nessuna squadra per questa stagione.</Paragraph></Card> : null}
          </YStack>
        ) : null}
      </YStack>
    </ScrollView>
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
    <Card borderWidth={1} borderColor="$borderColor" padding="$4">
      <YStack gap="$3">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap">
          <YStack flex={1} minWidth={240}>
            <Text fontWeight="900" fontSize="$5">{team.name}</Text>
            <Text color="$color10">Owner · {team.owner}</Text>
          </YStack>
          <Button size="$3" variant="outlined" borderColor="$red8" color="$red10" disabled={loading} onPress={onRemove}>Rimuovi</Button>
        </XStack>
        <YStack gap="$2">
          <Text fontWeight="700">Co-owner</Text>
          <XStack gap="$2" flexWrap="wrap">
            {team.additionalOwners.map(email => (
              <Button key={email} size="$2" variant="outlined" disabled={loading} onPress={() => onToggleCoOwner(email)}>{email} ×</Button>
            ))}
            {team.additionalOwners.length === 0 ? <Text color="$color10">Nessuno</Text> : null}
          </XStack>
          <XStack gap="$2" flexWrap="wrap">
            <Input flex={1} minWidth={260} value={coOwner} onChangeText={setCoOwner} autoCapitalize="none" autoCorrect={false} placeholder="co-owner@email.it" />
            <Button size="$3" disabled={loading || !coOwner.trim() || !activeEmails.some(email => same(email, coOwner))} onPress={() => { onToggleCoOwner(coOwner); setCoOwner('') }}>Aggiungi co-owner</Button>
          </XStack>
        </YStack>
      </YStack>
    </Card>
  )
}

function message(error: unknown): string { return error instanceof Error ? error.message : 'Operazione non riuscita.' }
function same(first: string, second: string): boolean { return first.trim().toLowerCase() === second.trim().toLowerCase() }
