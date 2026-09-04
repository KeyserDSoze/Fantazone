import React from 'react'
import { Button, Card, H1, H2, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui'

type Props = {
  onConnectGroup: () => void
}

const buildingBlocks = [
  {
    title: '1 · GitHub = stato durevole',
    body: 'Ogni lega vive in un repository Fantazone.<gruppo>. File versionati, history e SHA diventano persistenza e audit trail.',
    status: 'Repository-per-group',
  },
  {
    title: '2 · Actions = background jobs',
    body: 'Ingestion, ricalcoli e rebuild non richiedono un worker sempre acceso. I job deterministici girano nelle GitHub Actions.',
    status: 'Zero worker host',
  },
  {
    title: '3 · WebRTC = asta realtime',
    body: 'I rilanci non possono diventare commit. Durante l’asta il dispositivo del banditore è host autorevole e usa RTCDataChannel.',
    status: 'No commit per bid',
  },
  {
    title: '4 · Domain condiviso',
    body: 'Le regole pure vengono estratte da Fantasoccer in TypeScript e usate da app, test e Actions per evitare due implementazioni diverse.',
    status: 'Parity-first migration',
  },
]

export function PlatformOverviewScreen({ onConnectGroup }: Props) {
  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1040} alignSelf="center" padding="$5" gap="$5">
        <YStack gap="$2" paddingVertical="$5">
          <Text fontSize="$3" fontWeight="800" color="$blue10">ZERO-SERVER LAB</Text>
          <H1>Fantazone</H1>
          <Paragraph size="$5" color="$color10" maxWidth={760}>
            Un’app React Native reale che prova a sostituire backend, worker e realtime server con GitHub e WebRTC — mantenendo il comportamento di Fantasoccer sotto test.
          </Paragraph>
          <XStack gap="$3" flexWrap="wrap" marginTop="$2">
            <Button theme="accent" onPress={onConnectGroup}>Collega un gruppo reale</Button>
            <Button onPress={() => {
              if (typeof window !== 'undefined') window.open('https://github.com/KeyserDSoze/Fantazone', '_blank')
            }}>
              Apri il codice su GitHub
            </Button>
          </XStack>
        </YStack>

        <YStack gap="$3">
          <H2>Quattro primitive, quattro responsabilità</H2>
          <XStack gap="$3" flexWrap="wrap">
            {buildingBlocks.map(item => (
              <Card
                key={item.title}
                borderWidth={1}
                borderColor="$borderColor"
                padding="$4"
                flexGrow={1}
                flexBasis={420}
                minWidth={280}
              >
                <YStack gap="$2">
                  <Text fontWeight="800" fontSize="$5">{item.title}</Text>
                  <Paragraph color="$color10">{item.body}</Paragraph>
                  <Text fontSize="$2" fontWeight="700" color="$blue10">{item.status}</Text>
                </YStack>
              </Card>
            ))}
          </XStack>
        </YStack>

        <Card borderWidth={1} borderColor="$yellow8" padding="$4">
          <YStack gap="$2">
            <Text fontWeight="800">Cosa NON stiamo sostenendo</Text>
            <Paragraph>
              GitHub non è “il database migliore per tutto”. Questa repo studia quali workload si adattano bene a versioning, Actions e contenuti statici — e dove serve una primitiva diversa, come WebRTC per l’asta.
            </Paragraph>
          </YStack>
        </Card>

        <Card borderWidth={1} borderColor="$red8" padding="$4">
          <YStack gap="$2">
            <Text fontWeight="800">Il PAT condiviso è V1 didattica</Text>
            <Paragraph>
              Il link di invito attuale può contenere un bearer token codificato, non cifrato. È utile per prototipare il modello repository-per-gruppo, ma il target è GitHub App/OAuth con credenziali più strette e sostituibili.
            </Paragraph>
          </YStack>
        </Card>

        <YStack paddingVertical="$5" gap="$2">
          <H2>Come leggere il progetto</H2>
          <Paragraph>Parti da docs/01-feature-inventory.md, poi passa alla zero-server architecture e alla runtime topology. La migration checklist mostra cosa è realmente completato e cosa no.</Paragraph>
        </YStack>
      </YStack>
    </ScrollView>
  )
}
