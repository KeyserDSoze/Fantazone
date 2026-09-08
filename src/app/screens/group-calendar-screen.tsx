import React, { useEffect, useState } from 'react'
import { Calendar as CalendarIcon, ChevronRight, RefreshCw } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  CalendarHelper,
  GameResultHelper,
  formatSeasonFromYear,
  type Calendar,
  type CalendarGame,
} from '@fantazone/domain'
import { AppScreen, PageIntro, StatusPill, Surface } from '../components/design-system'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  selection: GroupNavigationSelection
  onOpenGame?: (gameId: string) => void
}

export function GroupCalendarScreen({ runtime, selection, onOpenGame }: Props) {
  const [calendar, setCalendar] = useState<Calendar | null>(null)
  const [roundKey, setRoundKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null

  async function loadCalendar() {
    if (!selection.leagueId || selection.year == null) {
      setCalendar(null)
      setRoundKey(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const value = await runtime.calendarRepository.getCalendar(selection.leagueId, selection.year, { refresh: true })
      setCalendar(value)
      if (!value) {
        setRoundKey(null)
        return
      }
      const keys = CalendarHelper.getAllRoundKeys(value)
      setRoundKey(current => current && keys.includes(current) ? current : (keys[0] ?? null))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossibile caricare il calendario.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCalendar()
  }, [runtime, selection.leagueId, selection.year])

  const roundKeys = calendar ? CalendarHelper.getAllRoundKeys(calendar) : []
  const days = calendar && roundKey ? CalendarHelper.getRound(calendar, roundKey) : []

  return (
    <AppScreen maxWidth={1120}>
      <PageIntro
        eyebrow={league?.name ?? 'Lega'}
        title="Calendario"
        description={selection.year != null
          ? `${formatSeasonFromYear(selection.year)} · giornate, risultati e prossimi scontri della tua lega.`
          : 'Giornate, risultati e prossimi scontri della tua lega.'}
        action={(
          <Button
            variant="outlined"
            borderRadius="$4"
            disabled={loading}
            icon={loading ? undefined : RefreshCw}
            onPress={() => { void loadCalendar() }}
          >
            {loading ? <Spinner /> : 'Aggiorna'}
          </Button>
        )}
      />

      {roundKeys.length > 1 ? (
        <YStack gap="$2">
          <Text color="$color9" fontSize="$2" fontWeight="800">FASE / GIRONE</Text>
          <XStack gap="$2" flexWrap="wrap">
            {roundKeys.map(key => {
              const active = key === roundKey
              return (
                <Button
                  key={key}
                  size="$3"
                  borderRadius="$10"
                  backgroundColor={active ? '$blue4' : '$color2'}
                  borderColor={active ? '$blue7' : '$color5'}
                  onPress={() => setRoundKey(key)}
                >
                  <Text color={active ? '$blue11' : '$color10'} fontWeight="800">{key}</Text>
                </Button>
              )
            })}
          </XStack>
        </YStack>
      ) : null}

      {error ? (
        <Surface accent="red" padding="$3">
          <Paragraph color="$red11">{error}</Paragraph>
        </Surface>
      ) : null}

      {!error && loading && !calendar ? (
        <YStack minHeight={220} alignItems="center" justifyContent="center" gap="$3">
          <Spinner size="large" />
          <Text color="$color9">Caricamento calendario…</Text>
        </YStack>
      ) : null}

      {!error && !loading && !calendar ? (
        <Surface padding="$4">
          <YStack minHeight={140} alignItems="center" justifyContent="center" gap="$3">
            <CalendarIcon size="$2" color="$color8" />
            <Paragraph color="$color10" textAlign="center">
              Il calendario non è ancora disponibile per questa lega e stagione.
            </Paragraph>
          </YStack>
        </Surface>
      ) : null}

      <YStack gap="$4">
        {days.map(day => (
          <Surface key={`${roundKey}-${day.number}`} padding="$4">
            <YStack gap="$4">
              <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
                <YStack gap="$1">
                  <StatusPill tone="blue">Serie A {day.serieADay}ª</StatusPill>
                  <Text color="$color12" fontSize="$7" fontWeight="900">Giornata {day.number}</Text>
                </YStack>
                <Text color="$color9" fontSize="$2">{day.games.length} partite</Text>
              </XStack>

              <XStack gap="$3" flexWrap="wrap">
                {day.games.map(game => (
                  <CalendarGameRow
                    key={game.id}
                    game={game}
                    onOpen={onOpenGame ? () => onOpenGame(game.id) : undefined}
                  />
                ))}
              </XStack>
            </YStack>
          </Surface>
        ))}
      </YStack>
    </AppScreen>
  )
}

function CalendarGameRow({ game, onOpen }: { game: CalendarGame; onOpen?: () => void }) {
  const played = GameResultHelper.hasValue(game.result)
  const score = game.result ? `${game.result.homeGoals}–${game.result.awayGoals}` : 'VS'
  return (
    <YStack
      flexGrow={1}
      flexBasis={320}
      minWidth={260}
      padding="$3.5"
      borderRadius="$4"
      backgroundColor="$color3"
      borderWidth={1}
      borderColor="$color5"
      gap="$3"
    >
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <Text flex={1} textAlign="left" fontWeight="800" color="$color12" numberOfLines={1}>{game.home}</Text>
        <YStack minWidth={64} height={38} alignItems="center" justifyContent="center" borderRadius="$3" backgroundColor="$color4">
          <Text fontSize="$5" color="$color12" fontWeight="900">{score}</Text>
        </YStack>
        <Text flex={1} textAlign="right" fontWeight="800" color="$color12" numberOfLines={1}>{game.away}</Text>
      </XStack>

      <Text textAlign="center" color="$color9" fontSize="$2">
        {played && game.result
          ? `${game.result.home.value.toFixed(1)} · ${game.result.away.value.toFixed(1)} punti`
          : 'Risultato non ancora disponibile'}
      </Text>

      {onOpen ? (
        <Button size="$2.5" chromeless iconAfter={ChevronRight} alignSelf="center" onPress={onOpen}>
          Dettaglio partita
        </Button>
      ) : null}
    </YStack>
  )
}
