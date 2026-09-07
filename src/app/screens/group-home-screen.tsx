import React, { useEffect, useState } from 'react'
import { Button, Card, H1, H2, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import { RealCalendarHelper, formatSeasonFromYear, type RealDay } from '@fantazone/domain'
import type { GroupNavigationSelection, GroupProductRoute } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

export function GroupHomeScreen({
  runtime,
  selection,
  onNavigate,
}: {
  runtime: GroupSessionRuntime
  selection: GroupNavigationSelection
  onNavigate: (route: GroupProductRoute) => void
}) {
  const [day, setDay] = useState<RealDay | null>(null)
  const [isLive, setIsLive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const year = selection.year
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null

  async function loadSerieADay() {
    if (year == null) {
      setDay(null)
      setIsLive(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const calendar = await runtime.realCalendarRepository.getCalendar(year, { refresh: true })
      if (!calendar) {
        setDay(null)
        setIsLive(false)
        return
      }
      const context = RealCalendarHelper.context(calendar, new Date())
      setDay(context.liveDay ?? context.nextDay ?? context.lastDay)
      setIsLive(context.isLive)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossibile caricare la giornata di Serie A.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSerieADay()
  }, [runtime, year])

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={980} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <YStack gap="$1" paddingTop="$2">
          <H1>{runtime.group.name}</H1>
          <Paragraph color="$color10">
            {league?.name ?? 'Lega'}{year != null ? ` · ${formatSeasonFromYear(year)}` : ''}
          </Paragraph>
        </YStack>

        <Card borderWidth={1} borderColor={isLive ? '$red8' : '$borderColor'} padding="$4">
          <YStack gap="$3">
            <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
              <YStack gap="$1">
                <H2 size="$6">{isLive ? 'Serie A · Live' : 'Serie A'}</H2>
                <Paragraph color="$color10">{day ? `${day.serieADay}ª giornata` : 'Nessuna giornata disponibile'}</Paragraph>
              </YStack>
              <Button size="$3" variant="outlined" disabled={loading} onPress={() => { void loadSerieADay() }}>
                {loading ? <Spinner /> : 'Aggiorna'}
              </Button>
            </XStack>

            {error ? <Paragraph color="$red10">{error}</Paragraph> : null}
            {!error && loading && !day ? <Spinner size="large" /> : null}
            {!error && day ? (
              <YStack gap="$2">
                {day.games.map((game, index) => {
                  const hasScore = game.homeGoals != null && game.awayGoals != null
                  return (
                    <XStack
                      key={`${game.home.name}-${game.away.name}-${index}`}
                      padding="$3"
                      gap="$2"
                      alignItems="center"
                      justifyContent="space-between"
                      borderRadius="$3"
                      backgroundColor="$color2"
                    >
                      <Text flex={1} textAlign="right" fontWeight="700">{game.home.name}</Text>
                      <Text minWidth={56} textAlign="center" fontWeight="800">{hasScore ? `${game.homeGoals} - ${game.awayGoals}` : 'vs'}</Text>
                      <Text flex={1} fontWeight="700">{game.away.name}</Text>
                    </XStack>
                  )
                })}
              </YStack>
            ) : null}
          </YStack>
        </Card>

        <XStack gap="$3" flexWrap="wrap">
          <HomeAction title="La mia formazione" description="Prepara la squadra per il prossimo turno." onPress={() => onNavigate('formation')} />
          <HomeAction title="Classifica" description="Controlla la posizione nella tua lega." onPress={() => onNavigate('ranking')} />
          <HomeAction title="Calendario" description="Apri giornate, risultati e prossimi incontri." onPress={() => onNavigate('calendar')} />
          <HomeAction title="Live" description="Segui risultati e voti durante la giornata." onPress={() => onNavigate('live')} />
        </XStack>
      </YStack>
    </ScrollView>
  )
}

function HomeAction({ title, description, onPress }: { title: string; description: string; onPress: () => void }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={320}>
      <YStack gap="$2">
        <H2 size="$5">{title}</H2>
        <Paragraph color="$color10">{description}</Paragraph>
        <Button alignSelf="flex-start" variant="outlined" onPress={onPress}>Apri</Button>
      </YStack>
    </Card>
  )
}
