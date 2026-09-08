import React, { useEffect, useState } from 'react'
import {
  Calendar,
  RefreshCw,
  Trophy,
  Users,
  Zap,
} from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import { RealCalendarHelper, formatSeasonFromYear, type RealDay } from '@fantazone/domain'
import { AppScreen, FeatureCard, PageIntro, StatusPill, Surface } from '../components/design-system'
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
    <AppScreen>
      <PageIntro
        eyebrow={league?.name ?? 'La tua lega'}
        title={`Bentornato in ${runtime.group.name}`}
        description={year != null
          ? `${formatSeasonFromYear(year)} · tutto quello che ti serve per la prossima giornata, in un solo posto.`
          : 'Tutto quello che ti serve per gestire la tua squadra, in un solo posto.'}
      />

      <Surface accent={isLive ? 'red' : 'blue'} padding="$5">
        <YStack gap="$5">
          <XStack justifyContent="space-between" alignItems="flex-start" gap="$4" flexWrap="wrap">
            <YStack gap="$2" flex={1} minWidth={230}>
              <StatusPill tone={isLive ? 'red' : 'blue'}>
                {isLive ? 'Serie A live' : 'Serie A'}
              </StatusPill>
              <Text color="$color12" fontSize="$8" fontWeight="900" letterSpacing={-0.4}>
                {day ? `${day.serieADay}ª giornata` : 'Prossima giornata'}
              </Text>
              <Paragraph color="$color10" fontSize="$4">
                {isLive
                  ? 'Le partite sono in corso. Qui trovi il quadro aggiornato del turno.'
                  : 'Risultati e calendario del turno di Serie A collegato alla tua stagione.'}
              </Paragraph>
            </YStack>
            <Button
              size="$3"
              borderRadius="$4"
              variant="outlined"
              disabled={loading}
              icon={loading ? undefined : RefreshCw}
              onPress={() => { void loadSerieADay() }}
            >
              {loading ? <Spinner /> : 'Aggiorna'}
            </Button>
          </XStack>

          {error ? (
            <Surface accent="red" padding="$3">
              <Paragraph color="$red11">{error}</Paragraph>
            </Surface>
          ) : null}

          {!error && loading && !day ? (
            <YStack minHeight={180} justifyContent="center" alignItems="center" gap="$3">
              <Spinner size="large" />
              <Text color="$color9">Aggiornamento della giornata…</Text>
            </YStack>
          ) : null}

          {!error && day ? (
            <XStack gap="$3" flexWrap="wrap">
              {day.games.map((game, index) => {
                const hasScore = game.homeGoals != null && game.awayGoals != null
                return (
                  <YStack
                    key={`${game.home.name}-${game.away.name}-${index}`}
                    flexGrow={1}
                    flexBasis={320}
                    minWidth={260}
                    padding="$3.5"
                    gap="$3"
                    borderRadius="$4"
                    backgroundColor="$color2"
                    borderWidth={1}
                    borderColor={isLive && hasScore ? '$red5' : '$color5'}
                  >
                    <XStack alignItems="center" justifyContent="space-between" gap="$3">
                      <Text flex={1} textAlign="left" color="$color12" fontWeight="800" numberOfLines={1}>
                        {game.home.name}
                      </Text>
                      <YStack
                        minWidth={62}
                        height={38}
                        paddingHorizontal="$2"
                        borderRadius="$3"
                        alignItems="center"
                        justifyContent="center"
                        backgroundColor={hasScore ? '$color4' : '$color3'}
                      >
                        <Text color="$color12" fontSize="$5" fontWeight="900">
                          {hasScore ? `${game.homeGoals}–${game.awayGoals}` : 'VS'}
                        </Text>
                      </YStack>
                      <Text flex={1} textAlign="right" color="$color12" fontWeight="800" numberOfLines={1}>
                        {game.away.name}
                      </Text>
                    </XStack>
                  </YStack>
                )
              })}
            </XStack>
          ) : null}
        </YStack>
      </Surface>

      <YStack gap="$3">
        <XStack alignItems="flex-end" justifyContent="space-between" gap="$3" flexWrap="wrap">
          <YStack gap="$1">
            <Text color="$color12" fontSize="$7" fontWeight="900">La tua giornata</Text>
            <Paragraph color="$color9">Vai subito alle sezioni che usi di più.</Paragraph>
          </YStack>
        </XStack>

        <XStack gap="$3" flexWrap="wrap">
          <FeatureCard
            icon={<Users size="$1.3" color="$blue10" />}
            title="La mia formazione"
            description="Prepara titolari e panchina per il prossimo turno e salva anche offline."
            meta="Squadra"
            onPress={() => onNavigate('formation')}
          />
          <FeatureCard
            icon={<Trophy size="$1.3" color="$blue10" />}
            title="Classifica"
            description="Controlla posizione, distacchi e andamento della tua lega."
            meta="Lega"
            onPress={() => onNavigate('ranking')}
          />
          <FeatureCard
            icon={<Calendar size="$1.3" color="$blue10" />}
            title="Calendario"
            description="Apri giornate, risultati e prossimi scontri del campionato."
            meta="Partite"
            onPress={() => onNavigate('calendar')}
          />
          <FeatureCard
            icon={<Zap size="$1.3" color="$blue10" />}
            title="Live"
            description="Segui risultati e aggiornamenti della giornata mentre si gioca."
            meta="Tempo reale"
            onPress={() => onNavigate('live')}
          />
        </XStack>
      </YStack>
    </AppScreen>
  )
}
