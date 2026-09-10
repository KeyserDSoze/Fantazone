import React, { useEffect, useMemo, useState } from 'react'
import { Eye, LockKeyhole, RefreshCw, ShieldCheck } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  getEvolutionCardCatalog,
  getVerifiedEvolutionCardIds,
  isEvolutionCardSelectionLocked,
  resolveFantazoneEvolutionSettings,
  shouldRevealEvolutionCards,
  type AuthenticatedGroupSession,
  type EvolutionCardCommitment,
  type RealDay,
} from '@fantazone/domain'
import { GroupEvolutionCardService } from '../services/groupEvolutionCardService'
import { readEvolutionCardSecret } from '../services/evolutionCardSecretStore'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'
import { PrimaryAction, StatusPill, Surface } from './design-system'

export function EvolutionCardPicker({
  runtime,
  session,
  leagueId,
  season,
  serieADay,
  owner,
}: {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  leagueId: string
  season: number
  serieADay: number
  owner: string
}) {
  const annual = runtime.group.leagues.find(item => item.id === leagueId)?.years.find(item => item.year === season)
  const evolution = annual ? resolveFantazoneEvolutionSettings(annual.settings) : null
  const catalog = useMemo(() => annual ? getEvolutionCardCatalog(annual.settings) : [], [annual?.settings])
  const service = useMemo(() => new GroupEvolutionCardService(runtime), [runtime])
  const [selected, setSelected] = useState<string[]>([])
  const [sealed, setSealed] = useState<EvolutionCardCommitment | null>(null)
  const [day, setDay] = useState<RealDay | null>(null)
  const [hasLocalSecret, setHasLocalSecret] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!annual || !evolution?.enabled || !evolution.coachCards.enabled) return
    setLoading(true)
    setError(null)
    try {
      const [cards, realCalendar, secret] = await Promise.all([
        runtime.evolutionRepository.getCards(leagueId, season, serieADay, { refresh: true }),
        runtime.realCalendarRepository.getCalendar(season, { refresh: true }),
        readEvolutionCardSecret(runtime.connection.repository.full_name, leagueId, season, serieADay, owner),
      ])
      const ownerKey = owner.trim().toLowerCase()
      setSealed(cards?.commitments[ownerKey] ?? null)
      setDay(realCalendar?.days.find(item => item.serieADay === serieADay) ?? null)
      setHasLocalSecret(Boolean(secret))
      if (secret?.cardIds.length) setSelected(secret.cardIds)
      else if (cards?.commitments[ownerKey]?.reveal) setSelected(cards.commitments[ownerKey].reveal!.cardIds)
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [runtime, leagueId, season, serieADay, owner, evolution?.enabled, evolution?.coachCards.enabled])

  if (!annual || !evolution?.enabled || !evolution.coachCards.enabled) return null

  const locked = day ? isEvolutionCardSelectionLocked(day, annual.settings) : false
  const revealDue = day ? (!evolution.coachCards.revealAtFirstKickoff || shouldRevealEvolutionCards(day, annual.settings)) : false
  const verified = sealed?.reveal
    ? getVerifiedEvolutionCardIds(sealed, { leagueId, year: season, serieADay, owner })
    : null

  function toggle(cardId: string) {
    if (locked || sealed?.reveal) return
    setSelected(current => {
      if (current.includes(cardId)) return current.filter(item => item !== cardId)
      if (current.length >= evolution.coachCards.cardsPerMatch) return current
      return [...current, cardId]
    })
    setMessage(null)
    setError(null)
  }

  async function commit() {
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const result = await service.commitCards({ session, leagueId, season, serieADay, owner, cardIds: selected })
      setSealed(result.commitment)
      setHasLocalSecret(true)
      setMessage('Carte sigillate: nel repository è stato pubblicato soltanto il commitment SHA-256.')
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  async function reveal() {
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const result = await service.revealCards({ session, leagueId, season, serieADay, owner })
      setSealed(result)
      setHasLocalSecret(false)
      setSelected(result.reveal?.cardIds ?? [])
      setMessage('Reveal pubblicato e verificato contro il commitment originale.')
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Surface accent="purple" padding="$5">
      <YStack gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap">
          <YStack flex={1} minWidth={260} gap="$1">
            <XStack alignItems="center" gap="$2">
              <LockKeyhole size="$1.1" color="$purple10" />
              <Text color="$color12" fontSize="$6" fontWeight="900">Carte Fantazone Evolution</Text>
            </XStack>
            <Paragraph color="$color10">
              Scegli fino a {evolution.coachCards.cardsPerMatch} carte. Prima del reveal gli avversari possono vedere soltanto l’hash della scelta, non le carte.
            </Paragraph>
          </YStack>
          <XStack gap="$2" alignItems="center" flexWrap="wrap">
            <StatusPill tone={verified ? 'green' : locked ? 'yellow' : 'purple'}>
              {verified ? 'Rivelate e verificate' : sealed ? 'Sigillate' : locked ? 'Scelta chiusa' : 'Scelta aperta'}
            </StatusPill>
            <Button size="$3" circular chromeless icon={loading ? undefined : RefreshCw} disabled={loading} onPress={() => { void refresh() }}>
              {loading ? <Spinner /> : null}
            </Button>
          </XStack>
        </XStack>

        {error ? <Paragraph color="$red11">{error}</Paragraph> : null}
        {message ? <Paragraph color="$green11">{message}</Paragraph> : null}

        <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
          {catalog.map(card => {
            const active = selected.includes(card.id)
            return (
              <Button
                key={card.id}
                height="auto"
                minHeight={118}
                flexGrow={1}
                flexBasis={250}
                maxWidth={380}
                padding="$3"
                borderRadius="$5"
                justifyContent="flex-start"
                alignItems="stretch"
                backgroundColor={active ? '$purple4' : '$color3'}
                borderColor={active ? '$purple7' : '$color5'}
                disabled={locked || Boolean(sealed?.reveal)}
                onPress={() => toggle(card.id)}
              >
                <YStack gap="$1.5" alignItems="flex-start">
                  <XStack justifyContent="space-between" width="100%" gap="$2">
                    <Text color={active ? '$purple11' : '$color12'} fontWeight="900" flex={1}>{active ? '✓ ' : ''}{card.name}</Text>
                    <Text color="$color8" fontSize="$1" fontWeight="800">{card.rarity.toUpperCase()}</Text>
                  </XStack>
                  <Paragraph color="$color10" size="$2" textAlign="left">{card.description}</Paragraph>
                </YStack>
              </Button>
            )
          })}
        </XStack>

        <XStack gap="$2" flexWrap="wrap" alignItems="center">
          {!sealed?.reveal && !locked ? (
            <PrimaryAction disabled={loading || selected.length === 0} onPress={() => { void commit() }} icon={<ShieldCheck size="$1" color="white" />}>
              {sealed ? 'Aggiorna scelta sigillata' : 'Sigilla carte'}
            </PrimaryAction>
          ) : null}
          {sealed && !sealed.reveal && hasLocalSecret && revealDue ? (
            <Button borderRadius="$4" icon={Eye} disabled={loading} onPress={() => { void reveal() }}>Rivela carte</Button>
          ) : null}
          {sealed && !sealed.reveal && !revealDue ? <Text color="$color9" fontSize="$2">Reveal automatico disponibile dal primo calcio d’inizio.</Text> : null}
          {sealed && !sealed.reveal && !hasLocalSecret ? <Text color="$red10" fontSize="$2">Il commitment esiste ma il segreto non è su questo dispositivo: il reveal non può essere ricostruito.</Text> : null}
        </XStack>
      </YStack>
    </Surface>
  )
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Operazione Evolution non riuscita.'
}
