import React from 'react'
import { Image } from 'react-native'
import { Cloud, Github, LockKeyhole, LogIn } from '@tamagui/lucide-icons-2'
import { H1, Paragraph, Spinner, Text, XStack, YStack, useMedia } from 'tamagui'
import { PrimaryAction, StatusPill, Surface } from '../components/design-system'

export function LoginScreen({ loading, error, onMicrosoftLogin }: {
  loading: boolean
  error?: string | null
  onMicrosoftLogin: () => void
}) {
  const media = useMedia()
  const compact = media.sm ?? false

  return (
    <YStack flex={1} backgroundColor="$background" justifyContent="center" padding={compact ? '$3' : '$6'}>
      <XStack
        width="100%"
        maxWidth={1120}
        alignSelf="center"
        gap="$6"
        alignItems="stretch"
        flexDirection={compact ? 'column' : 'row'}
      >
        <YStack flex={1.15} justifyContent="center" gap="$5" padding={compact ? '$2' : '$5'}>
          <XStack alignItems="center" gap="$3">
            <Image
              source={require('../assets/icon.png')}
              accessibilityLabel="Fantazone"
              style={{ width: 54, height: 54, borderRadius: 16 }}
            />
            <YStack>
              <Text color="$color12" fontSize="$7" fontWeight="900" letterSpacing={-0.3}>Fantazone</Text>
              <Text color="$color9" fontSize="$2" fontWeight="700">fanta.plus</Text>
            </YStack>
          </XStack>

          <YStack gap="$3">
            <StatusPill tone="blue">Zero backend · offline first</StatusPill>
            <H1
              color="$color12"
              fontSize={compact ? '$9' : '$11'}
              lineHeight={compact ? '$9' : '$11'}
              fontWeight="900"
              letterSpacing={-1}
              margin={0}
            >
              Il fantacalcio che resta tuo.
            </H1>
            <Paragraph color="$color10" fontSize="$5" lineHeight="$7" maxWidth={650}>
              I dati del gruppo vivono su GitHub, le tue impostazioni personali su OneDrive e l’app continua a funzionare anche quando la rete non collabora.
            </Paragraph>
          </YStack>

          <XStack gap="$3" flexWrap="wrap">
            <TrustItem icon={<Cloud size="$1.1" color="$blue10" />} title="OneDrive privato" text="Gruppi e preferenze del tuo account." />
            <TrustItem icon={<Github size="$1.1" color="$blue10" />} title="Repository GitHub" text="Storico e dati del fantacalcio." />
            <TrustItem icon={<LockKeyhole size="$1.1" color="$blue10" />} title="Credenziali locali" text="Il PAT resta sotto il tuo controllo." />
          </XStack>
        </YStack>

        <YStack flex={0.85} justifyContent="center">
          <Surface accent="neutral" padding="$6">
            <YStack gap="$5">
              <YStack gap="$2">
                <Text color="$color12" fontSize="$7" fontWeight="900">Accedi al tuo Fantazone</Text>
                <Paragraph color="$color10" lineHeight="$6">
                  Usa il tuo account Microsoft per ritrovare automaticamente i gruppi salvati nel tuo App Folder OneDrive.
                </Paragraph>
              </YStack>

              {error ? (
                <Surface accent="red" padding="$3">
                  <Paragraph color="$red11">{error}</Paragraph>
                </Surface>
              ) : null}

              <PrimaryAction
                disabled={loading}
                onPress={onMicrosoftLogin}
                icon={loading ? <Spinner color="white" /> : <LogIn size="$1" color="white" />}
              >
                {loading ? 'Accesso in corso…' : 'Continua con Microsoft'}
              </PrimaryAction>

              <YStack gap="$2" paddingTop="$1">
                <Text color="$color10" fontSize="$2" fontWeight="800">PERCHÉ SERVE MICROSOFT?</Text>
                <Paragraph size="$2" color="$color9" lineHeight="$5">
                  Fantazone usa esclusivamente lo spazio privato dedicato all’app su OneDrive per sincronizzare la lista dei gruppi tra i tuoi dispositivi. I dati del fantacalcio non vengono spostati su un backend Fantazone.
                </Paragraph>
              </YStack>
            </YStack>
          </Surface>
        </YStack>
      </XStack>
    </YStack>
  )
}

function TrustItem({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <YStack
      flexGrow={1}
      flexBasis={175}
      minWidth={165}
      gap="$2"
      padding="$3"
      borderRadius="$4"
      backgroundColor="$color2"
      borderWidth={1}
      borderColor="$color4"
    >
      {icon}
      <Text color="$color12" fontWeight="800" fontSize="$3">{title}</Text>
      <Text color="$color9" fontSize="$2" lineHeight="$4">{text}</Text>
    </YStack>
  )
}
