import React, { useEffect, useMemo, useState } from 'react'
import { Sparkles } from '@tamagui/lucide-icons-2'
import { Paragraph, Text, XStack, YStack } from 'tamagui'
import {
  getEvolutionSkillCatalog,
  getPlayerKey,
  resolveFantazoneEvolutionSettings,
  type EvolutionSeasonSkillDocument,
} from '@fantazone/domain'
import { StatusPill, Surface } from './design-system'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

export function AuctionEvolutionSkillStrip({
  runtime,
  leagueId,
  season,
  playerName,
}: {
  runtime: GroupSessionRuntime
  leagueId: string
  season: number
  playerName: string | null
}) {
  const league = runtime.group.leagues.find(item => item.id === leagueId)
  const settings = league?.years.find(item => item.year === season)?.settings
  const evolution = settings ? resolveFantazoneEvolutionSettings(settings) : null
  const [document, setDocument] = useState<EvolutionSeasonSkillDocument | null>(null)

  useEffect(() => {
    let active = true
    if (!settings || !evolution?.enabled || !evolution.playerSkills.enabled) {
      setDocument(null)
      return () => { active = false }
    }
    void runtime.evolutionRepository.getSkills(leagueId, season, { refresh: true })
      .then(value => { if (active) setDocument(value) })
      .catch(() => { if (active) setDocument(null) })
    return () => { active = false }
  }, [runtime, leagueId, season, evolution?.enabled, evolution?.playerSkills.enabled])

  const skills = useMemo(() => {
    if (!playerName || !settings || !document) return []
    const assignment = document.assignments.find(item => item.playerKey === getPlayerKey(playerName))
    if (!assignment?.skillIds.length) return []
    const catalog = new Map(getEvolutionSkillCatalog(settings).map(skill => [skill.id, skill] as const))
    return assignment.skillIds.map(id => catalog.get(id)).filter((value): value is NonNullable<typeof value> => Boolean(value))
  }, [playerName, settings, document])

  if (!playerName || !evolution?.enabled || !evolution.playerSkills.enabled) return null

  return (
    <Surface accent="purple" padding="$4">
      <XStack gap="$3" alignItems="flex-start" flexWrap="wrap">
        <YStack width={42} height={42} borderRadius="$4" backgroundColor="$purple4" alignItems="center" justifyContent="center">
          <Sparkles size="$1.1" color="$purple10" />
        </YStack>
        <YStack flex={1} minWidth={240} gap="$2">
          <XStack alignItems="center" gap="$2" flexWrap="wrap">
            <Text color="$color12" fontSize="$5" fontWeight="900">Skill Fantazone Evolution</Text>
            <StatusPill tone="purple">visibili in asta</StatusPill>
          </XStack>
          {skills.length ? (
            <XStack gap="$2" flexWrap="wrap">
              {skills.map(skill => (
                <YStack key={skill.id} flexGrow={1} flexBasis={240} minWidth={220} padding="$3" borderRadius="$4" backgroundColor="$purple3" borderWidth={1} borderColor="$purple6" gap="$1">
                  <XStack justifyContent="space-between" alignItems="center" gap="$2">
                    <Text color="$purple11" fontWeight="900">{skill.name}</Text>
                    <Text color="$color8" fontSize="$1" fontWeight="800">{skill.rarity.toUpperCase()} · PWR {skill.power}</Text>
                  </XStack>
                  <Paragraph color="$color10" size="$2">{skill.description}</Paragraph>
                </YStack>
              ))}
            </XStack>
          ) : (
            <Paragraph color="$color9">Skill non ancora disponibile per questo giocatore. Se l’asta è appena stata creata, aggiorna la sessione.</Paragraph>
          )}
        </YStack>
      </XStack>
    </Surface>
  )
}
