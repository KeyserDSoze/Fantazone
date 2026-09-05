import React, { useMemo, useState } from 'react'
import { Linking, Platform, Share } from 'react-native'
import { Button, Card, H1, H2, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui'
import { createInviteFragment } from '@fantazone/github'
import { publicWebUrl } from '../config/publicOrigin'
import type { ConnectedGroup } from './group-connect'

type Props = {
  group: ConnectedGroup
  onDisconnect: () => void | Promise<void>
  onExploreArchitecture: () => void
}

export function GroupDashboardScreen({ group, onDisconnect, onExploreArchitecture }: Props) {
  const [shareStatus, setShareStatus] = useState<string | null>(null)

  const inviteUrl = useMemo(() => {
    const fragment = createInviteFragment({
      v: 1,
      group: group.groupName,
      repository: group.repository.name,
      pat: group.token,
    })
    return publicWebUrl(`/${fragment}`)
  }, [group])

  async function shareGroup() {
    setShareStatus(null)
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(inviteUrl)
      setShareStatus('Link copiato. Contiene il PAT del gruppo: condividilo solo con partecipanti fidati.')
      return
    }

    await Share.share({
      title: `Invito Fantazone · ${group.groupName}`,
      message: `Unisciti al gruppo Fantazone ${group.groupName}: ${inviteUrl}`,
    })
  }

  const repositoryUrl = group.repository.html_url ?? `https://github.com/${group.repository.full_name}`

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={980} alignSelf="center" padding="$5" gap="$5">
        <YStack gap="$2" paddingVertical="$4">
          <Text fontSize="$3" fontWeight="800" color="$green10">GRUPPO COLLEGATO</Text>
          <H1>{group.groupName}</H1>
          <Paragraph color="$color10">La sorgente durevole di questo gruppo è un repository GitHub con JSON leggibili e versionati.</Paragraph>
        </YStack>

        <XStack gap="$3" flexWrap="wrap">
          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={360}>
            <YStack gap="$2">
              <H2 size="$6">Repository</H2>
              <Text fontWeight="700">{group.repository.full_name}</Text>
              <Text color="$color10">Branch: {group.repository.default_branch}</Text>
              <Text color="$color10">Visibilità: {group.repository.private ? 'privato' : 'pubblico'}</Text>
              <Button marginTop="$2" onPress={() => Linking.openURL(repositoryUrl)}>Apri su GitHub</Button>
            </YStack>
          </Card>

          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={360}>
            <YStack gap="$2">
              <H2 size="$6">Autorizzazione V1</H2>
              <Text>GitHub PAT</Text>
              <Text color="$color10">Il token non viene mostrato. Su native è persistito con SecureStore; sul web la V1 usa storage locale.</Text>
              <Text fontSize="$2" color="$red10">Il link di invito contiene il bearer token codificato: non è crittografia.</Text>
            </YStack>
          </Card>
        </XStack>

        <Card borderWidth={1} borderColor="$borderColor" padding="$4">
          <YStack gap="$3">
            <H2 size="$6">Azioni</H2>
            <XStack gap="$3" flexWrap="wrap">
              <Button theme="accent" onPress={shareGroup}>Condividi invito fanta.plus</Button>
              <Button onPress={onExploreArchitecture}>Esplora architettura</Button>
              <Button onPress={onDisconnect}>Cambia gruppo</Button>
            </XStack>
            {shareStatus ? <Paragraph size="$2" color="$color10">{shareStatus}</Paragraph> : null}
          </YStack>
        </Card>
      </YStack>
    </ScrollView>
  )
}
