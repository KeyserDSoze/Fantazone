import React from 'react'
import { Sparkles, Zap } from '@tamagui/lucide-icons-2'
import { Button, Input, Paragraph, Text, XStack, YStack } from 'tamagui'
import {
  getEvolutionCardCatalog,
  getEvolutionSkillCatalog,
  resolveFantazoneEvolutionSettings,
  type FantazoneEvolutionSettings,
  type LeagueSetting,
} from '@fantazone/domain'
import { StatusPill, Surface } from './design-system'

type Props = {
  settings: LeagueSetting
  onChange: (evolution: FantazoneEvolutionSettings) => void
}

export function FantazoneEvolutionSettingsPanel({ settings, onChange }: Props) {
  const evolution = resolveFantazoneEvolutionSettings(settings)
  const skills = getEvolutionSkillCatalog({ ...settings, evolution })
  const cards = getEvolutionCardCatalog({ ...settings, evolution })

  function patch<K extends keyof FantazoneEvolutionSettings>(key: K, value: FantazoneEvolutionSettings[K]) {
    onChange({ ...evolution, [key]: value })
  }

  function number(value: string, current: number, apply: (next: number) => void) {
    const parsed = Number(value.replace(',', '.'))
    if (Number.isFinite(parsed)) apply(parsed)
    else apply(current)
  }

  return (
    <Surface accent={evolution.enabled ? 'purple' : 'neutral'} padding="$5">
      <YStack gap="$5">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$4" flexWrap="wrap">
          <XStack gap="$3" alignItems="flex-start" flex={1} minWidth={260}>
            <YStack width={48} height={48} borderRadius="$5" backgroundColor={evolution.enabled ? '$purple4' : '$color3'} alignItems="center" justifyContent="center">
              <Sparkles size="$1.4" color={evolution.enabled ? '$purple10' : '$color9'} />
            </YStack>
            <YStack gap="$1" flex={1}>
              <XStack gap="$2" alignItems="center" flexWrap="wrap">
                <Text color="$color12" fontSize="$7" fontWeight="900">Fantazone Evolution</Text>
                <StatusPill tone={evolution.enabled ? 'purple' : 'neutral'}>{evolution.enabled ? 'Attivo' : 'Classico'}</StatusPill>
              </XStack>
              <Paragraph color="$color10" maxWidth={800}>
                Modalità avanzata con skill stagionali dei calciatori, famiglie, carte tattiche, morale, stato di forma e interazioni con l’avversario. Se è spenta, la lega mantiene esattamente le regole classiche.
              </Paragraph>
            </YStack>
          </XStack>
          <EvolutionToggle
            active={evolution.enabled}
            label={evolution.enabled ? 'Evolution attivo' : 'Attiva Evolution'}
            onPress={() => patch('enabled', !evolution.enabled)}
          />
        </XStack>

        <XStack gap="$2" flexWrap="wrap">
          <StatusPill tone="blue">{skills.length} skill disponibili</StatusPill>
          <StatusPill tone="blue">{cards.length} carte disponibili</StatusPill>
          <StatusPill tone="neutral">Rule engine v{evolution.schemaVersion}</StatusPill>
        </XStack>

        <YStack opacity={evolution.enabled ? 1 : 0.55} gap="$5">
          <Module
            title="Skill giocatori"
            description="Assegna prima dell’asta skill permanenti per la stagione, filtrate per ruolo e potenza."
            enabled={evolution.playerSkills.enabled}
            onToggle={() => patch('playerSkills', { ...evolution.playerSkills, enabled: !evolution.playerSkills.enabled })}
          >
            <Numeric label="Skill per giocatore" value={evolution.playerSkills.skillsPerPlayer} onChange={value => number(value, evolution.playerSkills.skillsPerPlayer, next => patch('playerSkills', { ...evolution.playerSkills, skillsPerPlayer: Math.max(0, Math.round(next)) }))} />
            <Numeric label="Potenza minima" value={evolution.playerSkills.minPower} onChange={value => number(value, evolution.playerSkills.minPower, next => patch('playerSkills', { ...evolution.playerSkills, minPower: next }))} />
            <Numeric label="Potenza massima" value={evolution.playerSkills.maxPower} onChange={value => number(value, evolution.playerSkills.maxPower, next => patch('playerSkills', { ...evolution.playerSkills, maxPower: next }))} />
          </Module>

          <Module
            title="Carte allenatore"
            description="Le carte scelte restano coperte, si bloccano prima del turno e vengono rivelate al primo kickoff. Se il reveal non arriva entro la finestra di sicurezza, la carta viene forfeited per impedire reveal selettivi dopo aver visto la partita."
            enabled={evolution.coachCards.enabled}
            onToggle={() => patch('coachCards', { ...evolution.coachCards, enabled: !evolution.coachCards.enabled })}
          >
            <Numeric label="Carte per partita" value={evolution.coachCards.cardsPerMatch} onChange={value => number(value, evolution.coachCards.cardsPerMatch, next => patch('coachCards', { ...evolution.coachCards, cardsPerMatch: Math.max(0, Math.round(next)) }))} />
            <Numeric label="Carte nel deck stagionale" value={evolution.coachCards.cardsInSeasonDeck} onChange={value => number(value, evolution.coachCards.cardsInSeasonDeck, next => patch('coachCards', { ...evolution.coachCards, cardsInSeasonDeck: Math.max(0, Math.round(next)) }))} />
            <Numeric label="Blocco prima del kickoff (min)" value={evolution.coachCards.lockMinutesBeforeFirstKickoff} onChange={value => number(value, evolution.coachCards.lockMinutesBeforeFirstKickoff, next => patch('coachCards', { ...evolution.coachCards, lockMinutesBeforeFirstKickoff: Math.max(0, Math.round(next)) }))} />
            <Numeric label="Finestra reveal dopo kickoff (sec)" value={evolution.coachCards.revealGraceSecondsAfterFirstKickoff} onChange={value => number(value, evolution.coachCards.revealGraceSecondsAfterFirstKickoff, next => patch('coachCards', { ...evolution.coachCards, revealGraceSecondsAfterFirstKickoff: Math.max(0, Math.min(600, Math.round(next))) }))} />
          </Module>

          <Module
            title="Famiglie"
            description="La squadra reale del calciatore è la sua famiglia. Il bonus si applica ai titolari della stessa famiglia."
            enabled={evolution.families.enabled}
            onToggle={() => patch('families', { ...evolution.families, enabled: !evolution.families.enabled })}
          >
            {evolution.families.thresholds.map((threshold, index) => (
              <Numeric
                key={threshold.minPlayers}
                label={`${threshold.minPlayers} della stessa squadra`}
                value={threshold.bonusPerPlayer}
                onChange={value => number(value, threshold.bonusPerPlayer, next => patch('families', {
                  ...evolution.families,
                  thresholds: evolution.families.thresholds.map((item, itemIndex) => itemIndex === index ? { ...item, bonusPerPlayer: next } : item),
                }))}
              />
            ))}
          </Module>

          <Module
            title="Morale"
            description="Tiene memoria di panchina e tribuna per la rosa del singolo allenatore; il ritorno in campo può partire con un malus."
            enabled={evolution.morale.enabled}
            onToggle={() => patch('morale', { ...evolution.morale, enabled: !evolution.morale.enabled })}
          >
            <Numeric label="Tribuna consecutiva" value={evolution.morale.tribuneConsecutiveDays} onChange={value => number(value, evolution.morale.tribuneConsecutiveDays, next => patch('morale', { ...evolution.morale, tribuneConsecutiveDays: Math.max(1, Math.round(next)) }))} />
            <Numeric label="Panchina senza ingresso" value={evolution.morale.benchUnusedConsecutiveDays} onChange={value => number(value, evolution.morale.benchUnusedConsecutiveDays, next => patch('morale', { ...evolution.morale, benchUnusedConsecutiveDays: Math.max(1, Math.round(next)) }))} />
            <Numeric label="Misto panchina / tribuna" value={evolution.morale.mixedUnusedConsecutiveDays} onChange={value => number(value, evolution.morale.mixedUnusedConsecutiveDays, next => patch('morale', { ...evolution.morale, mixedUnusedConsecutiveDays: Math.max(1, Math.round(next)) }))} />
            <Numeric label="Malus per calo" value={evolution.morale.penaltyPerDrop} onChange={value => number(value, evolution.morale.penaltyPerDrop, next => patch('morale', { ...evolution.morale, penaltyPerDrop: next }))} />
          </Module>

          <Module
            title="Momentum"
            description="Un bonus reale nella partita precedente dà uno stato di forma alla partita successiva; i bonus Evolution non si autoalimentano."
            enabled={evolution.momentum.enabled}
            onToggle={() => patch('momentum', { ...evolution.momentum, enabled: !evolution.momentum.enabled })}
          >
            <Numeric label="Bonus partita successiva" value={evolution.momentum.nextMatchBonus} onChange={value => number(value, evolution.momentum.nextMatchBonus, next => patch('momentum', { ...evolution.momentum, nextMatchBonus: next }))} />
          </Module>

          <Module
            title="Lock progressivo della formazione"
            description="Durante la giornata ogni calciatore resta spostabile finché non è iniziata la sua vera partita di Serie A. È indipendente dal limite massimo di cambi live."
            enabled={evolution.progressiveLineupLock.enabled}
            onToggle={() => patch('progressiveLineupLock', { ...evolution.progressiveLineupLock, enabled: !evolution.progressiveLineupLock.enabled })}
          >
            <EvolutionToggle
              active={evolution.progressiveLineupLock.keepDelayedMatchesEditable}
              label="Rinviate modificabili"
              onPress={() => patch('progressiveLineupLock', { ...evolution.progressiveLineupLock, keepDelayedMatchesEditable: !evolution.progressiveLineupLock.keepDelayedMatchesEditable })}
            />
          </Module>

          <Surface accent="blue" padding="$4">
            <XStack gap="$3" alignItems="flex-start" flexWrap="wrap">
              <Zap size="$1.2" color="$blue10" />
              <YStack flex={1} minWidth={220} gap="$1">
                <Text color="$color12" fontWeight="900">Punteggio spiegabile</Text>
                <Paragraph color="$color10">Gli eventi reali non vengono riscritti: Evolution applica modificatori separati e conserva una traccia di ogni skill, carta, sinergia, morale o annullamento che cambia il punteggio.</Paragraph>
              </YStack>
            </XStack>
          </Surface>
        </YStack>
      </YStack>
    </Surface>
  )
}

function Module({ title, description, enabled, onToggle, children }: { title: string; description: string; enabled: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <YStack gap="$3" paddingTop="$2">
      <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
        <YStack flex={1} minWidth={220} gap="$1">
          <Text color="$color12" fontSize="$5" fontWeight="900">{title}</Text>
          <Paragraph color="$color10" size="$2">{description}</Paragraph>
        </YStack>
        <EvolutionToggle active={enabled} label={enabled ? 'Attivo' : 'Disattivo'} onPress={onToggle} />
      </XStack>
      <XStack gap="$3" flexWrap="wrap" alignItems="flex-end" opacity={enabled ? 1 : 0.55}>{children}</XStack>
    </YStack>
  )
}

function Numeric({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return (
    <YStack minWidth={185} flexGrow={1} flexBasis={190} maxWidth={250} gap="$1.5">
      <Text color="$color9" fontSize="$2" fontWeight="800">{label}</Text>
      <Input value={String(value)} keyboardType="numeric" borderRadius="$4" onChangeText={onChange} />
    </YStack>
  )
}

function EvolutionToggle({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Button size="$3" borderRadius="$10" backgroundColor={active ? '$purple4' : '$color3'} borderColor={active ? '$purple7' : '$color5'} onPress={onPress}>
      <Text color={active ? '$purple11' : '$color10'} fontWeight="800">{active ? '✓ ' : ''}{label}</Text>
    </Button>
  )
}
