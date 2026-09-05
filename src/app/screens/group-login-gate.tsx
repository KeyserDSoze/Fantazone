import React, { useMemo } from 'react'
import { Linking } from 'react-native'
import { Button, Card, H1, H2, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import type { ExternalIdentityProvider, Group } from '@fantazone/domain'
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
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={900} alignSelf="center" padding="$5" gap="$5">
        <YStack gap="$2" paddingVertical="$3">
          <Text fontSize="$3" fontWeight="800" color="$green10">1. GRUPPO SELEZIONATO</Text>
          <H1>{group.name}</H1>
          <Paragraph color="$color10">
            Repository aperto: <Text fontWeight="700">{connection.repository.full_name}</Text>. config/group.json è la sorgente della membership Fantazone.
          </Paragraph>
        </YStack>

        {connection.expectedEmail ? (
          <Card borderWidth={1} borderColor="$green8" padding="$4">
            <YStack gap="$1">
              <Text fontWeight="800">Invito intestato a</Text>
              <Text fontSize="$5">{connection.expectedEmail}</Text>
              <Paragraph size="$2">Google/Microsoft riceverà questa email come suggerimento; una email diversa verrà rifiutata anche se fosse censita nel gruppo.</Paragraph>
            </YStack>
          </Card>
        ) : null}

        <XStack gap="$3" flexWrap="wrap">
          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={280}>
            <YStack gap="$1"><Text fontSize="$7" fontWeight="800">{group.leagues.length}</Text><Text color="$color10">leghe</Text></YStack>
          </Card>
          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={280}>
            <YStack gap="$1"><Text fontSize="$7" fontWeight="800">{group.users.length}</Text><Text color="$color10">utenti censiti</Text></YStack>
          </Card>
          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={280}>
            <YStack gap="$1"><Text fontSize="$7" fontWeight="800">{years.length}</Text><Text color="$color10">stagioni</Text></YStack>
          </Card>
        </XStack>

        <Card borderWidth={1} borderColor="$blue8" padding="$5">
          <YStack gap="$3">
            <Text fontSize="$3" fontWeight="800" color="$blue10">2. IDENTITÀ UTENTE</Text>
            <H2 size="$7">Accedi al gruppo</H2>
            <Paragraph>
              Il PAT dimostra soltanto che il browser può leggere il repository. L’accesso Fantazone nasce solo se l’email verificata dal provider è ammessa in <Text fontWeight="700">group.users</Text>.
            </Paragraph>
            {loginError ? <Card borderWidth={1} borderColor="$red8" padding="$3"><Text color="$red10">{loginError}</Text></Card> : null}
            <XStack gap="$3" flexWrap="wrap">
              <Button flex={1} minWidth={220} disabled={loginLoading} onPress={() => onLogin('microsoft')}>
                {loginLoading ? <Spinner /> : 'Accedi con Microsoft'}
              </Button>
              <Button flex={1} minWidth={220} disabled={loginLoading} onPress={() => onLogin('google')}>
                {loginLoading ? <Spinner /> : 'Accedi con Google'}
              </Button>
            </XStack>
            <Paragraph size="$2" color="$color9">
              Gli inviti con nuova email vengono creati solo dopo un login Admin/SuperAdmin: prima si aggiorna group.users, poi viene generato il link da condividere.
            </Paragraph>
          </YStack>
        </Card>

        <Card borderWidth={1} borderColor="$borderColor" padding="$4">
          <YStack gap="$3">
            <H2 size="$6">Repository del gruppo</H2>
            <Text fontWeight="700">{connection.repository.full_name}</Text>
            <Text color="$color10">Branch: {connection.repository.default_branch}</Text>
            <Text color="$color10">Visibilità: {connection.repository.private ? 'privato' : 'pubblico'}</Text>
            <XStack gap="$3" flexWrap="wrap">
              <Button onPress={() => Linking.openURL(repositoryUrl)}>Apri su GitHub</Button>
              <Button onPress={onExploreArchitecture}>Come funziona</Button>
              <Button onPress={onChangeGroup}>Cambia gruppo</Button>
            </XStack>
          </YStack>
        </Card>
      </YStack>
    </ScrollView>
  )
}
