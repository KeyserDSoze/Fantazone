import React, { useMemo, useState } from 'react'
import { Linking } from 'react-native'
import {
  ExternalLink,
  Github,
  Pencil,
  UserRound,
} from '@tamagui/lucide-icons-2'
import { Button, Input, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import { GroupHelper, IdentityRole, type AuthenticatedGroupSession } from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

export function GroupSettingsScreen({ runtime, session }: { runtime: GroupSessionRuntime; session: AuthenticatedGroupSession }) {
  const group = runtime.group
  const connection = runtime.connection
  const [displayGroupName, setDisplayGroupName] = useState(group.name)
  const [leagueNames, setLeagueNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(group.leagues.map(league => [league.id, league.name || league.id])),
  )
  const [displayStatus, setDisplayStatus] = useState<string | null>(null)
  const [savingDisplay, setSavingDisplay] = useState(false)
  const isSuperAdmin = useMemo(() => GroupHelper.hasRole(session.member, IdentityRole.SuperAdmin), [session.member])
  const isAdmin = useMemo(() => GroupHelper.hasRole(session.member, IdentityRole.Admin), [session.member])
  const canManage = isAdmin || isSuperAdmin

  async function saveDisplaySettings() {
    setSavingDisplay(true)
    setDisplayStatus(null)
    try {
      await runtime.updateDisplaySettings(session.member, {
        groupName: displayGroupName,
        leagueNames,
      })
      setDisplayGroupName(runtime.group.name)
      setLeagueNames(Object.fromEntries(runtime.group.leagues.map(league => [league.id, league.name || league.id])))
      setDisplayStatus('Nomi aggiornati in settings.json. ID, calendari e storico non cambiano.')
    } catch (caught) {
      setDisplayStatus(caught instanceof Error ? caught.message : 'Impossibile aggiornare i nomi visualizzati.')
    } finally {
      setSavingDisplay(false)
    }
  }

  const repositoryUrl = connection.repository.html_url ?? `https://github.com/${connection.repository.full_name}`

  return (
    <AppScreen maxWidth={1160}>
      <PageIntro
        eyebrow="Gruppo e account"
        title="Impostazioni"
        description="Gestisci identità, repository e nomi visualizzati mantenendo l’architettura zero-backend di Fantazone. Gli inviti sono raccolti nella pagina dedicata Condividi gruppo."
      />

      <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
        <Surface padding="$5">
          <YStack width={420} maxWidth="100%" minHeight={220} gap="$4">
            <XStack gap="$3" alignItems="center">
              <YStack
                width={46}
                height={46}
                borderRadius="$4"
                alignItems="center"
                justifyContent="center"
                backgroundColor="$color4"
              >
                <Github size="$1.2" color="$color11" />
              </YStack>
              <YStack flex={1} minWidth={0}>
                <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Repository del gruppo</Text>
                <Text color="$color12" fontSize="$6" fontWeight="900" numberOfLines={1}>{runtime.group.name}</Text>
              </YStack>
            </XStack>

            <YStack gap="$2">
              <SettingLine label="Repository" value={connection.repository.full_name} />
              <SettingLine label="Branch" value={connection.repository.default_branch} />
              <SettingLine label="Architettura" value="GitHub + OneDrive" />
            </YStack>

            <Paragraph size="$2" color="$color9">
              Il nome tecnico della repository può essere diverso dal nome mostrato nell’app. Dati e storico restano nel repository del gruppo.
            </Paragraph>

            <Button
              alignSelf="flex-start"
              variant="outlined"
              borderRadius="$4"
              icon={ExternalLink}
              onPress={() => { void Linking.openURL(repositoryUrl) }}
            >
              Apri repository
            </Button>
          </YStack>
        </Surface>

        <Surface accent="blue" padding="$5">
          <YStack width={420} maxWidth="100%" minHeight={220} gap="$4">
            <XStack gap="$3" alignItems="center">
              <YStack
                width={46}
                height={46}
                borderRadius="$4"
                alignItems="center"
                justifyContent="center"
                backgroundColor="$blue4"
              >
                <UserRound size="$1.2" color="$blue10" />
              </YStack>
              <YStack flex={1} minWidth={0}>
                <Text color="$blue10" fontSize="$1" fontWeight="900" textTransform="uppercase">Account Microsoft</Text>
                <Text color="$color12" fontSize="$6" fontWeight="900" numberOfLines={1}>
                  {session.identity.displayName || session.member.username}
                </Text>
              </YStack>
            </XStack>

            <YStack gap="$2">
              <SettingLine label="Email" value={session.identity.email} />
              <SettingLine label="Membership" value="Sincronizzata dal gruppo" />
            </YStack>

            <XStack gap="$2" flexWrap="wrap">
              <StatusPill tone={isSuperAdmin ? 'blue' : isAdmin ? 'green' : 'neutral'}>
                {isSuperAdmin ? 'SuperAdmin' : isAdmin ? 'Admin' : 'Partecipante'}
              </StatusPill>
              <StatusPill tone="neutral">OneDrive privato</StatusPill>
            </XStack>

            <Paragraph size="$2" color="$color9">
              Ruoli e abilitazioni vengono riletti dal repository del gruppo durante la sincronizzazione.
            </Paragraph>
          </YStack>
        </Surface>
      </XStack>

      {canManage ? (
        <Surface accent="green" padding="$5">
          <YStack gap="$5">
            <XStack gap="$3" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap">
              <XStack gap="$3" alignItems="center" flex={1} minWidth={260}>
                <YStack
                  width={46}
                  height={46}
                  borderRadius="$4"
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor="$green4"
                >
                  <Pencil size="$1.2" color="$green10" />
                </YStack>
                <YStack gap="$1" flex={1}>
                  <Text color="$green10" fontSize="$1" fontWeight="900" textTransform="uppercase">Presentazione</Text>
                  <Text color="$color12" fontSize="$6" fontWeight="900">Nomi visualizzati</Text>
                  <Paragraph size="$2" color="$color9">
                    Rinomina gruppo e leghe senza modificare ID stabili, path Git, calendario o storico.
                  </Paragraph>
                </YStack>
              </XStack>
              <StatusPill tone="green">settings.json</StatusPill>
            </XStack>

            <YStack gap="$2">
              <FieldLabel>Nome del gruppo</FieldLabel>
              <Input
                size="$4"
                borderRadius="$4"
                value={displayGroupName}
                onChangeText={setDisplayGroupName}
                placeholder="Amici del Bar"
              />
            </YStack>

            <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
              {group.leagues.map(league => (
                <YStack key={league.id} gap="$2" flexGrow={1} flexBasis={300} minWidth={260}>
                  <FieldLabel>Lega · {league.id}</FieldLabel>
                  <Input
                    size="$4"
                    borderRadius="$4"
                    value={leagueNames[league.id] ?? league.name ?? league.id}
                    onChangeText={value => setLeagueNames(current => ({ ...current, [league.id]: value }))}
                    placeholder={league.id}
                  />
                </YStack>
              ))}
            </XStack>

            <XStack gap="$3" justifyContent="space-between" alignItems="center" flexWrap="wrap">
              <Paragraph size="$2" color="$color9" flex={1} minWidth={240}>
                Queste modifiche cambiano solo ciò che le persone vedono nell’app.
              </Paragraph>
              <PrimaryAction
                disabled={savingDisplay}
                onPress={() => { void saveDisplaySettings() }}
                icon={savingDisplay ? <Spinner color="white" /> : undefined}
              >
                {savingDisplay ? 'Salvataggio…' : 'Salva nomi'}
              </PrimaryAction>
            </XStack>

            {displayStatus ? (
              <YStack padding="$3" borderRadius="$4" backgroundColor="$color3">
                <Paragraph size="$2" color="$color10">{displayStatus}</Paragraph>
              </YStack>
            ) : null}
          </YStack>
        </Surface>
      ) : null}
    </AppScreen>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text color="$color10" fontSize="$2" fontWeight="900">{children}</Text>
}

function SettingLine({ label, value }: { label: string; value: string }) {
  return (
    <XStack gap="$3" justifyContent="space-between" alignItems="center">
      <Text color="$color9" fontSize="$2">{label}</Text>
      <Text color="$color12" fontSize="$2" fontWeight="800" textAlign="right" numberOfLines={1}>{value}</Text>
    </XStack>
  )
}
