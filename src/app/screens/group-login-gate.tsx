import React, { useMemo } from 'react'
import { Github, LogIn, ShieldCheck } from '@tamagui/lucide-icons-2'
import { Linking } from 'react-native'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import type { ExternalIdentityProvider, Group } from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import { GOOGLE_LOGIN_ENABLED } from '../config/identity'
import type { GroupConnection } from '../services/groupSessionRuntime'

type Props = {
  connection: GroupConnection
  group: Group
  onChangeGroup: () => void | Promise<void>
  onExploreArchitecture: () => void
  onLogin: (provider: ExternalIdentityProvider) => void | Promise<void>
  loginLoading?: boolean
  loginError?: string | null
}

export function GroupLoginGateScreen({
  connection,
  group,
  onChangeGroup,
  onExploreArchitecture,
  onLogin,
  loginLoading = false,
  loginError,
}: Props) {
  const years = useMemo(() => {
    const values = new Set<number>()
    group.leagues.forEach(league => league.years.forEach(year => values.add(year.year)))
    group.baskets.forEach(basket => basket.years.forEach(year => values.add(year.year)))
    return [...values].sort((a, b) => b - a)
  }, [group])

  const repositoryUrl = connection.repository.html_url ?? `https://github.com/${connection.repository.full_name}`

  return (
    <AppScreen maxWidth={1120}>
      <PageIntro
        eyebrow="Gruppo selezionato"
        title={group.name}
        description={`Repository ${connection.repository.full_name}. Il PAT dimostra l’accesso GitHub; l’identità Fantazone viene invece autorizzata usando l’email verificata dal provider.`}
        action={<Button variant="outlined" borderRadius="$4" onPress={() => { void onChangeGroup() }}>Cambia gruppo</Button>}
      />

      <XStack gap="$3" flexWrap="wrap">
        <Metric label="Leghe" value={group.leagues.length} />
        <Metric label="Utenti censiti" value={group.users.length} />
        <Metric label="Stagioni" value={years.length} />
      </XStack>

      {connection.expectedEmail ? (
        <Surface accent="green" padding="$4">
          <XStack alignItems="center" gap="$3" flexWrap="wrap">
            <ShieldCheck size="$1.2" color="$green10" />
            <YStack flex={1} minWidth={240} gap="$1">
              <Text color="$color12" fontWeight="900">Invito intestato a</Text>
              <Text color="$color12" fontSize="$5" fontWeight="900">{connection.expectedEmail}</Text>
              <Paragraph color="$color10" fontSize="$2">Microsoft riceverà questa email come suggerimento; un’identità diversa verrà rifiutata anche se censita nel gruppo.</Paragraph>
            </YStack>
            <StatusPill tone="green">Identità vincolata</StatusPill>
          </XStack>
        </Surface>
      ) : null}

      <XStack gap="$4" flexWrap="wrap" alignItems="stretch">
        <YStack flexGrow={1} flexBasis={500} minWidth={290}>
          <Surface accent="blue" padding="$6">
            <YStack gap="$5">
              <XStack alignItems="center" gap="$3">
                <YStack width={48} height={48} borderRadius="$4" backgroundColor="$blue3" borderWidth={1} borderColor="$blue5" alignItems="center" justifyContent="center">
                  <LogIn size="$1.3" color="$blue10" />
                </YStack>
                <YStack flex={1} gap="$1">
                  <Text color="$color12" fontSize="$7" fontWeight="900">Accedi al gruppo</Text>
                  <Paragraph color="$color10">Verifica la tua identità esterna prima di aprire i dati e le funzioni del fantacalcio.</Paragraph>
                </YStack>
              </XStack>

              <Paragraph color="$color10" lineHeight="$6">
                La membership è definita in <Text color="$color12" fontWeight="900">config/group.json</Text>. La credenziale GitHub da sola non concede un ruolo Fantazone.
              </Paragraph>

              {loginError ? <Surface accent="red" padding="$3"><Paragraph color="$red11">{loginError}</Paragraph></Surface> : null}

              <YStack gap="$2">
                <PrimaryAction
                  disabled={loginLoading}
                  onPress={() => { void onLogin('microsoft') }}
                  icon={loginLoading ? <Spinner color="white" /> : <LogIn size="$1" color="white" />}
                >
                  {loginLoading ? 'Accesso in corso…' : 'Continua con Microsoft'}
                </PrimaryAction>
                {GOOGLE_LOGIN_ENABLED ? (
                  <Button size="$5" variant="outlined" borderRadius="$4" disabled={loginLoading} onPress={() => { void onLogin('google') }}>
                    {loginLoading ? <Spinner /> : 'Continua con Google'}
                  </Button>
                ) : null}
              </YStack>

              <Paragraph color="$color9" fontSize="$2">Gli inviti a nuovi account vengono generati solo dopo che Admin/SuperAdmin ha censito l’email nel gruppo.</Paragraph>
            </YStack>
          </Surface>
        </YStack>

        <YStack flexGrow={1} flexBasis={380} minWidth={280}>
          <Surface padding="$5">
            <YStack gap="$4">
              <XStack alignItems="center" gap="$3">
                <Github size="$1.2" color="$color10" />
                <YStack flex={1} gap="$1">
                  <Text color="$color12" fontSize="$6" fontWeight="900">Repository del gruppo</Text>
                  <StatusPill tone={connection.repository.private ? 'purple' : 'blue'}>{connection.repository.private ? 'Privato' : 'Pubblico'}</StatusPill>
                </YStack>
              </XStack>
              <RepositoryMeta label="Repository" value={connection.repository.full_name} />
              <RepositoryMeta label="Branch" value={connection.repository.default_branch} />
              <XStack gap="$2" flexWrap="wrap">
                <Button variant="outlined" borderRadius="$4" onPress={() => { void Linking.openURL(repositoryUrl) }}>Apri su GitHub</Button>
                <Button variant="outlined" borderRadius="$4" onPress={onExploreArchitecture}>Come funziona</Button>
              </XStack>
            </YStack>
          </Surface>
        </YStack>
      </XStack>
    </AppScreen>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <YStack flexGrow={1} flexBasis={220} minWidth={170} padding="$4" borderWidth={1} borderColor="$color5" backgroundColor="$color2" borderRadius="$5" gap="$1">
      <Text color="$color9" fontSize="$2" fontWeight="800">{label}</Text>
      <Text color="$color12" fontSize="$8" lineHeight="$8" fontWeight="900">{value}</Text>
    </YStack>
  )
}

function RepositoryMeta({ label, value }: { label: string; value: string }) {
  return (
    <YStack gap="$1" padding="$3" borderRadius="$4" backgroundColor="$color3">
      <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">{label}</Text>
      <Text color="$color12" fontWeight="800" numberOfLines={2}>{value}</Text>
    </YStack>
  )
}
