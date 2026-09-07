import React, { useEffect, useState } from 'react'
import { Button, Card, H1, H2, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  CalendarHelper,
  GameResultHelper,
  formatSeasonFromYear,
  type Calendar,
  type CalendarGame,
} from '@fantazone/domain'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  selection: GroupNavigationSelection
}

export function GroupCalendarScreen({ runtime, selection }: Props) {
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
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={980} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1">
            <H1>Calendario</H1>
            <Paragraph color="$color10">
              {league?.name ?? 'Lega'}{selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}
            </Paragraph>
          </YStack>
          <Button variant="outlined" disabled={loading} onPress={() => { void loadCalendar() }}>
            {loading ? <Spinner /> : 'Aggiorna'}
          </Button>
        </XStack>

        {roundKeys.length > 1 ? (
          <XStack gap="$2" flexWrap="wrap">
            {roundKeys.map(key => (
              <Button
                key={key}
                size="$3"
                variant="outlined"
                backgroundColor={key === roundKey ? '$color3' : 'transparent'}
                borderColor={key === roundKey ? '$blue8' : '$borderColor'}
                onPress={() => setRoundKey(key)}
              >
                {key}
              </Button>
            ))}
          </XStack>
        ) : null}

        {error ? (
          <Card borderWidth={1} borderColor="$red8" padding="$4"><Paragraph color="$red10">{error}</Paragraph></Card>
        ) : null}
        {!error && loading && !calendar ? <Spinner size="large" /> : null}
        {!error && !loading && !calendar ? (
          <Card borderWidth={1} borderColor="$borderColor" padding="$4">
            <Paragraph color="$color10">Il calendario non è ancora disponibile per questa lega e stagione.</Paragraph>
          </Card>
        ) : null}

        {days.map(day => (
          <Card key={`${roundKey}-${day.number}`} borderWidth={1} borderColor="$borderColor" padding="$4">
            <YStack gap="$3">
              <XStack justifyContent="space-between" alignItems="center" gap="$3">
                <H2 size="$6">Giornata {day.number}</H2>
                <Text color="$color10">Serie A {day.serieADay}ª</Text>
              </XStack>
              <YStack gap="$2">
                {day.games.map(game => <CalendarGameRow key={game.id} game={game} />)}
              </YStack>
            </YStack>
          </Card>
        ))}
      </YStack>
    </ScrollView>
  )
}

function CalendarGameRow({ game }: { game: CalendarGame }) {
  const played = GameResultHelper.hasValue(game.result)
  const score = game.result ? `${game.result.homeGoals} - ${game.result.awayGoals}` : 'vs'
  return (
    <YStack padding="$3" borderRadius="$3" backgroundColor="$color2" gap="$1">
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <Text flex={1} textAlign="right" fontWeight="700" numberOfLines={1}>{game.home}</Text>
        <Text minWidth={64} textAlign="center" fontWeight="800">{played ? score : 'vs'}</Text>
        <Text flex={1} fontWeight="700" numberOfLines={1}>{game.away}</Text>
      </XStack>
      {played && game.result ? (
        <Text textAlign="center" color="$color10" fontSize="$2">
          {game.result.home.value.toFixed(1)} · {game.result.away.value.toFixed(1)} punti
        </Text>
      ) : null}
    </YStack>
  )
}
