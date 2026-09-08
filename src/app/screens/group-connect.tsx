import React, { useEffect, useMemo, useState } from 'react'
import { Linking } from 'react-native'
import {
  ArrowUpRight,
  CheckCircle2,
  Github,
  KeyRound,
  Layers3,
  PlayCircle,
  PlusCircle,
  ShieldCheck,
} from '@tamagui/lucide-icons-2'
import {
  Button,
  Input,
  Paragraph,
  Spinner,
  Text,
  XStack,
  YStack,
  useMedia,
} from 'tamagui'
import {
  ensureGroupInitialized,
  GitHubApiError,
  GitHubClient,
  normalizeGroupName,
  type GitHubRepo,
} from '@fantazone/github'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import { connectKnownGroup } from '../services/groupReconnect'
import type { GroupConnection } from '../services/groupSessionRuntime'

export type ConnectedGroup = GroupConnection

type Props = {
  onConnected: (group: ConnectedGroup) => void
  onExploreDemo: () => void
  defaultCreatorEmail?: string
}

const GITHUB_NEW_REPOSITORY_URL = 'https://github.com/new'
const GITHUB_FINE_GRAINED_PAT_URL = 'https://github.com/settings/personal-access-tokens/new'

export function GroupConnectScreen({ onConnected, onExploreDemo, defaultCreatorEmail }: Props) {
  const [pat, setPat] = useState('')
  const [repositoryFullName, setRepositoryFullName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [creatorEmail, setCreatorEmail] = useState(defaultCreatorEmail?.trim().toLowerCase() ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const media = useMedia()
  const stackColumns = media.md ?? false

  const canSubmit = useMemo(() => pat.trim().length > 0 && !loading, [pat, loading])
  const suggestedRepositoryName = useMemo(() => {
    const slug = normalizeGroupName(groupName).toLowerCase()
    return `fantazone-${slug || 'lega'}`
  }, [groupName])

  useEffect(() => {
    const normalized = defaultCreatorEmail?.trim().toLowerCase()
    if (normalized) setCreatorEmail(current => current || normalized)
  }, [defaultCreatorEmail])

  async function connectRepository(repository: GitHubRepo, name: string, client?: GitHubClient) {
    const connection = await connectKnownGroup(
      pat.trim(),
      { name, repository: repository.full_name },
      client ?? new GitHubClient(pat.trim()),
    )
    onConnected(connection)
  }

  async function connectExistingGroup() {
    if (!canSubmit) return
    const target = parseRepository(repositoryFullName)
    if (!target) {
      setError('Inserisci la repository completa nel formato owner/repository.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const client = new GitHubClient(pat.trim())
      await client.validateToken()
      const repository = await client.getRepository(target.owner, target.repo)
      await connectRepository(repository, groupName.trim() || repository.name, client)
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  async function initializeGroup() {
    const target = parseRepository(repositoryFullName)
    const adminEmail = creatorEmail.trim().toLowerCase()
    if (!canSubmit || !target || !groupName.trim() || !adminEmail || !adminEmail.includes('@')) {
      setError('Per inizializzare un gruppo servono PAT, owner/repository, nome del gruppo e una email amministratore valida.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const client = new GitHubClient(pat.trim())
      await client.validateToken()
      const repository = await client.getRepository(target.owner, target.repo)
      await ensureGroupInitialized(client, repository, groupName.trim(), {
        initialAdmin: { email: adminEmail },
      })
      onConnected({
        token: pat.trim(),
        repository,
        groupName: groupName.trim(),
        expectedEmail: adminEmail,
      })
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppScreen maxWidth={1180}>
      <PageIntro
        eyebrow="Configura il tuo spazio"
        title="Collega Fantazone a una repository GitHub."
        description="Una sola configurazione iniziale: poi il gruppo si apre come una normale app, con cache locale e sincronizzazione progressiva."
      />

      <XStack gap="$4" flexDirection={stackColumns ? 'column' : 'row'} alignItems="flex-start">
        <YStack flex={0.9} width={stackColumns ? '100%' : undefined} gap="$4">
          <Surface accent="blue" padding="$4">
            <YStack gap="$3">
              <StatusPill tone="blue">Setup consigliato</StatusPill>
              <Text color="$color12" fontSize="$6" fontWeight="900">Tre passaggi, permessi minimi.</Text>
              <SetupStep
                number="1"
                icon={<Github size="$1" color="$blue10" />}
                title="Crea la repository"
                description={`Privata è consigliato. Il nome può essere qualsiasi cosa, ad esempio ${suggestedRepositoryName}.`}
              />
              <SetupStep
                number="2"
                icon={<KeyRound size="$1" color="$blue10" />}
                title="Crea un Fine-grained PAT"
                description="Limita Repository access alla sola repository del gruppo."
              />
              <SetupStep
                number="3"
                icon={<ShieldCheck size="$1" color="$blue10" />}
                title="Concedi solo ciò che serve"
                description="Contents, Workflows e Actions in Read and write. Metadata resta in lettura."
              />
              <XStack gap="$2" flexWrap="wrap" paddingTop="$1">
                <Button
                  flex={1}
                  minWidth={180}
                  variant="outlined"
                  icon={PlusCircle}
                  iconAfter={ArrowUpRight}
                  onPress={() => { void Linking.openURL(GITHUB_NEW_REPOSITORY_URL) }}
                >
                  Crea repository
                </Button>
                <Button
                  flex={1}
                  minWidth={180}
                  variant="outlined"
                  icon={KeyRound}
                  iconAfter={ArrowUpRight}
                  onPress={() => { void Linking.openURL(GITHUB_FINE_GRAINED_PAT_URL) }}
                >
                  Crea PAT
                </Button>
              </XStack>
            </YStack>
          </Surface>

          <Surface accent="yellow" padding="$4">
            <YStack gap="$2">
              <Text color="$color12" fontWeight="900">Il PAT è una credenziale del gruppo</Text>
              <Paragraph size="$2" color="$color10" lineHeight="$5">
                Nello schema zero-backend viene salvato nei settings privati OneDrive dell’app e sul dispositivo. Trattalo come una password e limita sempre l’accesso alla singola repository.
              </Paragraph>
            </YStack>
          </Surface>

          <Button
            variant="outlined"
            borderRadius="$4"
            minHeight={56}
            icon={PlayCircle}
            justifyContent="flex-start"
            onPress={onExploreDemo}
          >
            Esplora l’architettura senza usare un PAT
          </Button>
        </YStack>

        <YStack flex={1.1} width={stackColumns ? '100%' : undefined}>
          <Surface padding="$5">
            <YStack gap="$5">
              <YStack gap="$2">
                <Text color="$color12" fontSize="$7" fontWeight="900">Dati del gruppo</Text>
                <Paragraph color="$color10">
                  Puoi collegare un gruppo già inizializzato oppure completare una repository che contiene già dati ma non ancora il contratto Fantazone.
                </Paragraph>
              </YStack>

              <Field
                label="Repository GitHub"
                helper="Formato owner/repository. Il nome GitHub è indipendente dal nome visualizzato del gruppo."
              >
                <Input
                  size="$4"
                  borderRadius="$4"
                  value={repositoryFullName}
                  onChangeText={setRepositoryFullName}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="tuo-account/fantazone-amici-del-bar"
                />
              </Field>

              <Field
                label="Personal Access Token"
                helper="Fine-grained PAT con accesso alla sola repository del gruppo."
              >
                <Input
                  size="$4"
                  borderRadius="$4"
                  value={pat}
                  onChangeText={setPat}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="github_pat_..."
                />
              </Field>

              <Field
                label="Nome visualizzato del gruppo"
                helper="Puoi cambiarlo in seguito senza rinominare repository, ID o storico."
              >
                <Input
                  size="$4"
                  borderRadius="$4"
                  value={groupName}
                  onChangeText={setGroupName}
                  autoCapitalize="words"
                  placeholder="Amici del Bar"
                />
              </Field>

              <Field
                label="Primo amministratore"
                helper="Per un gruppo nuovo proponiamo l’email Microsoft con cui hai effettuato l’accesso."
              >
                <Input
                  size="$4"
                  borderRadius="$4"
                  value={creatorEmail}
                  onChangeText={setCreatorEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="admin@esempio.it"
                />
              </Field>

              {error ? (
                <Surface accent="red" padding="$3">
                  <Paragraph color="$red11">{error}</Paragraph>
                </Surface>
              ) : null}

              <YStack gap="$2.5">
                <PrimaryAction
                  disabled={!canSubmit || !repositoryFullName.trim() || !groupName.trim() || !creatorEmail.trim()}
                  onPress={initializeGroup}
                  icon={loading ? <Spinner color="white" /> : <Layers3 size="$1" color="white" />}
                >
                  {loading ? 'Configurazione in corso…' : 'Inizializza o completa la repository'}
                </PrimaryAction>
                <Button
                  size="$4"
                  borderRadius="$4"
                  variant="outlined"
                  disabled={!canSubmit || !repositoryFullName.trim()}
                  icon={CheckCircle2}
                  onPress={connectExistingGroup}
                >
                  Collega gruppo già inizializzato
                </Button>
                <Paragraph size="$2" color="$color9" textAlign="center">
                  L’inizializzazione non cancella i file esistenti: aggiunge il contratto Fantazone mancante e aggiorna soltanto i workflow gestiti dall’app.
                </Paragraph>
              </YStack>
            </YStack>
          </Surface>
        </YStack>
      </XStack>
    </AppScreen>
  )
}

function SetupStep({
  number,
  icon,
  title,
  description,
}: {
  number: string
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <XStack gap="$3" alignItems="flex-start">
      <YStack
        width={38}
        height={38}
        borderRadius="$10"
        backgroundColor="$blue4"
        borderWidth={1}
        borderColor="$blue6"
        alignItems="center"
        justifyContent="center"
      >
        {icon}
      </YStack>
      <YStack flex={1} gap="$1">
        <Text color="$blue10" fontSize="$1" fontWeight="900">PASSAGGIO {number}</Text>
        <Text color="$color12" fontWeight="800">{title}</Text>
        <Paragraph size="$2" color="$color10" lineHeight="$5">{description}</Paragraph>
      </YStack>
    </XStack>
  )
}

function Field({
  label,
  helper,
  children,
}: {
  label: string
  helper: string
  children: React.ReactNode
}) {
  return (
    <YStack gap="$2">
      <Text color="$color12" fontWeight="800">{label}</Text>
      {children}
      <Paragraph size="$2" color="$color9" lineHeight="$4">{helper}</Paragraph>
    </YStack>
  )
}

function parseRepository(value: string): { owner: string; repo: string } | null {
  const parts = value.trim().split('/').map(part => part.trim()).filter(Boolean)
  return parts.length === 2 ? { owner: parts[0], repo: parts[1] } : null
}

function toMessage(error: unknown): string {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) return 'PAT non valido o scaduto.'
    if (error.status === 403) return 'Il PAT non ha i permessi necessari. Verifica Contents, Workflows e Actions in Read and write.'
    if (error.status === 404) return 'Repository non trovata oppure il PAT non è autorizzato ad accedervi.'
    if (error.status === 422) return 'GitHub ha rifiutato l’operazione. Controlla repository e permessi del PAT.'
    return `GitHub ha risposto con errore ${error.status}.`
  }
  return error instanceof Error ? error.message : 'Errore imprevisto durante il collegamento a GitHub.'
}
