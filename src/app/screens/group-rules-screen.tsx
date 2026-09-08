import React from 'react'
import { CalendarDays, Coins, ShieldCheck, Trophy } from '@tamagui/lucide-icons-2'
import { Paragraph, Text, XStack, YStack } from 'tamagui'
import {
  FormationType,
  MarketType,
  formatSeasonFromYear,
} from '@fantazone/domain'
import { AppScreen, PageIntro, StatusPill, Surface } from '../components/design-system'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = { runtime: GroupSessionRuntime; selection: GroupNavigationSelection }

export function GroupRulesScreen({ runtime, selection }: Props) {
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null
  const annual = selection.year != null ? league?.years.find(item => item.year === selection.year) ?? null : null
  const settings = annual?.settings ?? null

  return (
    <AppScreen maxWidth={1160}>
      <PageIntro
        eyebrow="Regole della lega"
        title="Regolamento"
        description={`${league?.name ?? 'Lega'}${selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}. Tutti i parametri che determinano punteggi, bonus, mercato e gestione della stagione in un’unica vista leggibile.`}
      />

      {!settings ? (
        <Surface padding="$5">
          <YStack minHeight={160} alignItems="center" justifyContent="center" gap="$3">
            <CalendarDays size="$2" color="$color8" />
            <Paragraph color="$color10" textAlign="center">Nessuna configurazione annuale disponibile per la selezione corrente.</Paragraph>
          </YStack>
        </Surface>
      ) : (
        <>
          <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
            <RuleSection
              icon={<Trophy size="$1.2" color="$blue10" />}
              eyebrow="Partita"
              title="Punteggi"
              accent="blue"
            >
              <Rule label="Primo gol" value={`${settings.pointForFirstGoal} punti`} />
              <Rule label="Gol successivi" value={`ogni ${settings.pointForNextGoal} punti`} />
              <Rule label="Vittoria" value={`${settings.pointForVictory} pt classifica`} />
              <Rule label="Pareggio" value={`${settings.pointForDraw} pt classifica`} />
              <Rule label="Sconfitta" value={`${settings.pointForDefeat} pt classifica`} />
              <Rule label="Fattore casa" value={`${settings.pointInHome} fantapunti`} />
              <Rule label="Autogol sotto soglia" value={`differenza ${settings.differencePointForOwnGoal}`} />
            </RuleSection>

            <RuleSection
              icon={<ShieldCheck size="$1.2" color="$green10" />}
              eyebrow="Bonus"
              title="Difesa e fair play"
              accent="green"
            >
              <Rule label="Difesa forte" value={`${settings.pointForStrongDefense} pt`} />
              <Rule label="Difesa a 4" value={`${settings.pointForStrongDefense4} pt`} />
              <Rule label="Difesa a 5" value={`${settings.pointForStrongDefense5} pt`} />
              <Rule label="Clean sheet" value={`${settings.pointForCleanSheet} pt`} />
              <Rule label="Fair play" value={`${settings.pointForGoodPeople} pt`} />
            </RuleSection>

            <RuleSection
              icon={<Coins size="$1.2" color="$yellow10" />}
              eyebrow="Crediti"
              title="Economia e mercato"
              accent="yellow"
            >
              <Rule label="Budget iniziale" value={String(settings.startingMoney)} />
              <Rule label="Premio per gol" value={String(settings.moneyForGoal)} />
              <Rule label="Costo per gol subito" value={String(settings.moneyForSufferedGoal)} />
              <Rule label="Mercato" value={marketLabel(settings.market)} />
              <Rule label="Asta casuale" value={settings.randomAuction ? 'Sì' : 'No'} />
            </RuleSection>

            <RuleSection
              icon={<CalendarDays size="$1.2" color="$purple10" />}
              eyebrow="Stagione"
              title="Formazione e calendario"
              accent="purple"
            >
              <Rule label="Tipo formazione" value={settings.formation === FormationType.Best ? 'Migliore automatica' : 'Normale'} />
              <Rule label="Giornata rinviata" value={`${settings.delayedDay} giorni`} />
              <Rule label="Giornata annullata" value={`${settings.cancelledDay} giorni`} />
              <Rule label="Classifica per value points" value={settings.rankWithValuePoints ? 'Sì' : 'No'} />
            </RuleSection>
          </XStack>

          <Surface padding="$4">
            <XStack gap="$3" alignItems="center" justifyContent="space-between" flexWrap="wrap">
              <YStack gap="$1" flex={1} minWidth={240}>
                <Text color="$color12" fontWeight="900">Configurazione attiva</Text>
                <Paragraph size="$2" color="$color9">Questi valori sono quelli usati dai calcoli Fantazone per la stagione selezionata.</Paragraph>
              </YStack>
              <XStack gap="$2" flexWrap="wrap">
                <StatusPill tone={settings.market === MarketType.Denied ? 'yellow' : 'green'}>{marketLabel(settings.market)}</StatusPill>
                <StatusPill tone="blue">{settings.formation === FormationType.Best ? 'Formazione automatica' : 'Formazione normale'}</StatusPill>
              </XStack>
            </XStack>
          </Surface>
        </>
      )}
    </AppScreen>
  )
}

function RuleSection({
  icon,
  eyebrow,
  title,
  accent,
  children,
}: {
  icon: React.ReactNode
  eyebrow: string
  title: string
  accent: 'blue' | 'green' | 'yellow' | 'purple'
  children: React.ReactNode
}) {
  const borderColor = accent === 'blue'
    ? '$blue5'
    : accent === 'green'
      ? '$green5'
      : accent === 'yellow'
        ? '$yellow5'
        : '$purple5'
  const iconBackground = accent === 'blue'
    ? '$blue3'
    : accent === 'green'
      ? '$green3'
      : accent === 'yellow'
        ? '$yellow3'
        : '$purple3'

  return (
    <YStack
      flexGrow={1}
      flexBasis={480}
      minWidth={280}
      padding="$5"
      borderRadius="$6"
      borderWidth={1}
      borderColor={borderColor}
      backgroundColor="$color2"
      gap="$4"
    >
      <XStack gap="$3" alignItems="center">
        <YStack
          width={46}
          height={46}
          borderRadius="$4"
          backgroundColor={iconBackground}
          alignItems="center"
          justifyContent="center"
        >
          {icon}
        </YStack>
        <YStack gap="$1">
          <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">{eyebrow}</Text>
          <Text color="$color12" fontSize="$6" fontWeight="900">{title}</Text>
        </YStack>
      </XStack>
      <YStack gap="$1">{children}</YStack>
    </YStack>
  )
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <XStack
      justifyContent="space-between"
      gap="$4"
      alignItems="center"
      paddingVertical="$2.5"
      borderBottomWidth={1}
      borderBottomColor="$color4"
    >
      <Text color="$color9" flex={1}>{label}</Text>
      <Text color="$color12" fontWeight="900" textAlign="right">{value}</Text>
    </XStack>
  )
}

function marketLabel(value: MarketType): string {
  switch (value) {
    case MarketType.WithVote: return 'Mercato con votazione'
    case MarketType.WithoutVote: return 'Mercato senza votazione'
    case MarketType.Denied: return 'Mercato disabilitato'
    default: return 'Mercato non configurato'
  }
}
