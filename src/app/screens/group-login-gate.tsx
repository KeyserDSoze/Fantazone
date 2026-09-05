import React, { useMemo, useState } from 'react'
import { Linking, Platform, Share } from 'react-native'
import { Button, Card, H1, H2, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui'
import { createInviteFragment } from '@fantazone/github'
import type { ExternalIdentityProvider, Group } from '@fantazone/domain'
import type { GroupConnection } from '../services/groupSessionRuntime'

type Props = {
  connection: GroupConnection
  group: Group
  onChangeGroup: () => void | Promise<void>
  onExploreArchitecture: () => void
  onLogin?: (provider: ExternalIdentityProvider) => void | Promise<void>
}

export function GroupLoginGateScreen({
  connection,
  group,
  onChangeGroup,
  onExploreArchitecture,
  onLogin,
}: Props) {
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const years = useMemo(() => {
    const values = new Set<number>()
    group.leagues.forEach(league => league.years.forEach(year => values.add(year.year)))
    group.baskets.forEach(basket => basket.years.forEach(year => values.add(year.year)))
    return [...values].sort((a, b) => b - a)
  }, [group])

  const inviteUrl = useMemo(() => {
    const fragment = createInviteFragment({
      v: 1,
      group: connection.groupName,
      repository: connection.repository.name,
      pat: connection.token,
    })
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return `${window.location.origin}${window.location.pathname}${fragment}`
    }
    // Replaced once the final public domain supplied by the project is configured.
    return `https://keyserdsoze.github.io/Fantazone/${fragment}`
  }, [connection])

  async function shareGroup() {
    setShareStatus(null)
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(inviteUrl)
      setShareStatus('Link copiato. Contiene il PAT del gruppo: condividilo solo con partecipanti fidati.')
      return
    }
    await Share.share({
      title: `Invito Fantazone · ${group.name}`,
      message: `Unisciti al gruppo Fantazone ${group.name}: ${inviteUrl}`,
    })
  }

  const repositoryUrl = connection.repository.html_url ?? `https://github.com/${connection.repository.full_name}`

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={900} alignSelf="center" padding="$5" gap="$5">
        <YStack gap="$2" paddingVertical="$3">
          <Text fontSize="$3" fontWeight="800" color="$green10">1. GRUPPO SELEZIONATO</Text>
          <H1>{group.name}</H1>
          <Paragraph color="$color10">
            Il repository è stato aperto e config/group.json è stato caricato. Ora l’identità utente deve essere verificata dentro questo gruppo.
          </Paragraph>
        </YStack>

        <XStack gap="$3" flexWrap="wrap">
          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={280}>
            <YStack gap="$1">
              <Text fontSize="$7" fontWeight="800">{group.leagues.length}</Text>
              <Text color="$color10">leghe</Text>
            </YStack>
          </Card>
          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={280}>
            <YStack gap="$1">
              <Text fontSize="$7" fontWeight="800">{group.users.length}</Text>
              <Text color="$color10">utenti nel JSON</Text>
            </YStack>
          </Card>
          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={280}>
            <YStack gap="$1">
              <Text fontSize="$7" fontWeight="800">{years.length}</Text>
              <Text color="$color10">stagioni</Text>
            </YStack>
          </Card>
        </XStack>

        <Card borderWidth={1} borderColor="$blue8" padding="$5">
          <YStack gap="$3">
            <Text fontSize="$3" fontWeight="800" color="$blue10">2. IDENTITÀ UTENTE</Text>
            <H2 size="$7">Accedi al gruppo</H2>
            <Paragraph>
              Google o Microsoft proveranno chi sei. Subito dopo Fantazone confronterà l’email restituita con <Text fontWeight="700">GroupRaw.u</Text> di questo repository. Il PAT non identifica l’utente Fantazone.
            </Paragraph>
            <XStack gap="$3" flexWrap="wrap">
              <Button
                flex={1}
                minWidth={220}
                disabled={!onLogin}
                onPress={() => onLogin?.('microsoft')}
              >
                Accedi con Microsoft
              </Button>
              <Button
                flex={1}
                minWidth={220}
                disabled={!onLogin}
                onPress={() => onLogin?.('google')}
              >
                Accedi con Google
              </Button>
            </XStack>
            {!onLogin ? (
              <Paragraph size="$2" color="$color9">
                Il boundary di login è pronto. I redirect OAuth verranno collegati al dominio definitivo senza cambiare questa sequenza.
              </Paragraph>
            ) : null}
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
              <Button onPress={shareGroup}>Condividi invito</Button>
              <Button onPress={onExploreArchitecture}>Come funziona</Button>
              <Button onPress={onChangeGroup}>Cambia gruppo</Button>
            </XStack>
            {shareStatus ? <Paragraph size="$2" color="$color10">{shareStatus}</Paragraph> : null}
          </YStack>
        </Card>
      </YStack>
    </ScrollView>
  )
}
