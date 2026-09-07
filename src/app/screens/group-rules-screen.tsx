import React from 'react'
import { Card, H1, H2, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui'
import {
  FormationType,
  MarketType,
  formatSeasonFromYear,
} from '@fantazone/domain'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = { runtime: GroupSessionRuntime; selection: GroupNavigationSelection }

export function GroupRulesScreen({ runtime, selection }: Props) {
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null
  const annual = selection.year != null ? league?.years.find(item => item.year === selection.year) ?? null : null
  const settings = annual?.settings ?? null

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={980} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <YStack gap="$1" paddingTop="$2">
          <H1>Regolamento</H1>
          <Paragraph color="$color10">{league?.name ?? 'Lega'}{selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}</Paragraph>
        </YStack>

        {!settings ? (
          <Card borderWidth={1} borderColor="$borderColor" padding="$4"><Paragraph color="$color10">Nessuna configurazione annuale disponibile.</Paragraph></Card>
        ) : (
          <>
            <RuleSection title="Punteggi partita">
              <Rule label="Primo gol" value={`${settings.pointForFirstGoal} punti`} />
              <Rule label="Gol successivi" value={`ogni ${settings.pointForNextGoal} punti`} />
              <Rule label="Vittoria" value={`${settings.pointForVictory} pt classifica`} />
              <Rule label="Pareggio" value={`${settings.pointForDraw} pt classifica`} />
              <Rule label="Sconfitta" value={`${settings.pointForDefeat} pt classifica`} />
              <Rule label="Fattore casa" value={`${settings.pointInHome} fantapunti`} />
              <Rule label="Autogol sotto soglia" value={`differenza ${settings.differencePointForOwnGoal}`} />
            </RuleSection>

            <RuleSection title="Bonus difesa e fair play">
              <Rule label="Difesa forte" value={`${settings.pointForStrongDefense} pt`} />
              <Rule label="Difesa a 4" value={`${settings.pointForStrongDefense4} pt`} />
              <Rule label="Difesa a 5" value={`${settings.pointForStrongDefense5} pt`} />
              <Rule label="Clean sheet" value={`${settings.pointForCleanSheet} pt`} />
              <Rule label="Fair play" value={`${settings.pointForGoodPeople} pt`} />
            </RuleSection>

            <RuleSection title="Economia e mercato">
              <Rule label="Budget iniziale" value={String(settings.startingMoney)} />
              <Rule label="Premio per gol" value={String(settings.moneyForGoal)} />
              <Rule label="Costo per gol subito" value={String(settings.moneyForSufferedGoal)} />
              <Rule label="Mercato" value={marketLabel(settings.market)} />
              <Rule label="Asta casuale" value={settings.randomAuction ? 'Sì' : 'No'} />
            </RuleSection>

            <RuleSection title="Formazione e calendario">
              <Rule label="Tipo formazione" value={settings.formation === FormationType.Best ? 'Migliore automatica' : 'Normale'} />
              <Rule label="Giornata rinviata" value={`${settings.delayedDay} giorni`} />
              <Rule label="Giornata annullata" value={`${settings.cancelledDay} giorni`} />
              <Rule label="Classifica per value points" value={settings.rankWithValuePoints ? 'Sì' : 'No'} />
            </RuleSection>
          </>
        )}
      </YStack>
    </ScrollView>
  )
}

function RuleSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card borderWidth={1} borderColor="$borderColor" padding="$4"><YStack gap="$3"><H2 size="$6">{title}</H2>{children}</YStack></Card>
}

function Rule({ label, value }: { label: string; value: string }) {
  return <XStack justifyContent="space-between" gap="$4" alignItems="center"><Text color="$color10" flex={1}>{label}</Text><Text fontWeight="800" textAlign="right">{value}</Text></XStack>
}

function marketLabel(value: MarketType): string {
  switch (value) {
    case MarketType.WithVote: return 'Con votazione'
    case MarketType.WithoutVote: return 'Senza votazione'
    case MarketType.Denied: return 'Disabilitato'
    default: return 'Non configurato'
  }
}
