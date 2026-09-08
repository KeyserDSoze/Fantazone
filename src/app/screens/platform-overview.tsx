import React from 'react'
import { Github, LockKeyhole } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Text, XStack, YStack } from 'tamagui'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'

type Props = {
  onConnectGroup: () => void
}

const buildingBlocks = [
  {
    number: '01',
    title: 'GitHub = stato durevole',
    body: 'Ogni gruppo vive in un repository Fantazone. File versionati, history e SHA diventano persistenza, replica e audit trail.',
    status: 'Repository per gruppo',
    tone: 'blue' as const,
  },
  {
    number: '02',
    title: 'Actions = background jobs',
    body: 'Ingestion, ricalcoli e rebuild non richiedono un worker sempre acceso: i job deterministici girano nelle GitHub Actions.',
    status: 'Zero worker host',
    tone: 'green' as const,
  },
  {
    number: '03',
    title: 'WebRTC = asta realtime',
    body: 'I rilanci non diventano commit. Durante l’asta il dispositivo del banditore è host autorevole e comunica via RTCDataChannel.',
    status: 'Realtime peer-to-peer',
    tone: 'purple' as const,
  },
  {
    number: '04',
    title: 'Domain condiviso',
    body: 'Le regole pure estratte da Fantasoccer sono TypeScript condiviso tra app, test e Actions, così non esistono due implementazioni della stessa regola.',
    status: 'Parity first',
    tone: 'yellow' as const,
  },
]

export function PlatformOverviewScreen({ onConnectGroup }: Props) {
  return (
    <AppScreen maxWidth={1180}>
      <PageIntro
        eyebrow="Zero-server lab"
        title="Fantazone, senza backend applicativo."
        description="Un’app React Native reale che sostituisce backend, worker e realtime server con primitive GitHub, replica offline e WebRTC — mantenendo il comportamento di Fantasoccer sotto test."
        action={(
          <XStack gap="$2" flexWrap="wrap">
            <PrimaryAction onPress={onConnectGroup}>Collega un gruppo reale</PrimaryAction>
            <Button
              variant="outlined"
              borderRadius="$4"
              icon={Github}
              onPress={() => {
                if (typeof window !== 'undefined') window.open('https://github.com/KeyserDSoze/Fantazone', '_blank')
              }}
            >
              Apri il codice
            </Button>
          </XStack>
        )}
      />

      <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
        {buildingBlocks.map(item => (
          <YStack
            key={item.number}
            flexGrow={1}
            flexBasis={470}
            minWidth={280}
            minHeight={220}
            padding="$5"
            gap="$4"
            borderWidth={1}
            borderColor="$color5"
            backgroundColor="$color2"
            borderRadius="$6"
          >
            <XStack justifyContent="space-between" alignItems="flex-start" gap="$3">
              <Text color="$color7" fontSize="$8" lineHeight="$8" fontWeight="900">{item.number}</Text>
              <StatusPill tone={item.tone}>{item.status}</StatusPill>
            </XStack>
            <YStack gap="$2" flex={1}>
              <Text color="$color12" fontSize="$6" fontWeight="900">{item.title}</Text>
              <Paragraph color="$color10" lineHeight="$6">{item.body}</Paragraph>
            </YStack>
          </YStack>
        ))}
      </XStack>

      <XStack gap="$4" flexWrap="wrap" alignItems="stretch">
        <YStack flexGrow={1} flexBasis={440} minWidth={280}>
          <Surface accent="yellow" padding="$5">
            <YStack gap="$2">
              <Text color="$color12" fontSize="$6" fontWeight="900">Non è “GitHub come database per tutto”</Text>
              <Paragraph color="$color10" lineHeight="$6">
                Fantazone studia quali workload si adattano a versioning, Actions e contenuti statici e usa primitive diverse quando serve. L’asta, per esempio, usa WebRTC proprio perché un commit per ogni rilancio sarebbe il modello sbagliato.
              </Paragraph>
            </YStack>
          </Surface>
        </YStack>

        <YStack flexGrow={1} flexBasis={440} minWidth={280}>
          <Surface accent="red" padding="$5">
            <XStack gap="$3" alignItems="flex-start">
              <LockKeyhole size="$1.3" color="$red10" />
              <YStack flex={1} gap="$2">
                <Text color="$color12" fontSize="$6" fontWeight="900">PAT condiviso: compromesso intenzionale</Text>
                <Paragraph color="$color10" lineHeight="$6">
                  Nell’architettura zero-backend attuale la credenziale del gruppo è disponibile al client e viene salvata nello spazio privato OneDrive. Va trattata come una password del gruppo e ruotata quando necessario.
                </Paragraph>
              </YStack>
            </XStack>
          </Surface>
        </YStack>
      </XStack>

      <Surface padding="$5">
        <YStack gap="$2">
          <Text color="$color12" fontSize="$6" fontWeight="900">Come leggere il progetto</Text>
          <Paragraph color="$color10" lineHeight="$6">
            Parti dall’inventario funzionale, passa alla zero-server architecture e alla runtime topology, poi usa la migration checklist per distinguere ciò che è già operativo dai gate ancora aperti.
          </Paragraph>
        </YStack>
      </Surface>
    </AppScreen>
  )
}
