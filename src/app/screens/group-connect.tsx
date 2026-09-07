import React, { useEffect, useMemo, useState } from 'react'
import { Linking } from 'react-native'
import {
  Button,
  Card,
  H2,
  Input,
  Paragraph,
  ScrollView,
  Spinner,
  Text,
  XStack,
  YStack,
} from 'tamagui'
import {
  ensureGroupInitialized,
  GitHubApiError,
  GitHubClient,
  normalizeGroupName,
  type GitHubRepo,
} from '@fantazone/github'
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
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack flex={1} justifyContent="center" alignItems="center" padding="$4" gap="$4">
        <Card borderWidth={1} borderColor="$blue8" padding="$4" width="100%" maxWidth={680}>
          <YStack gap="$2">
            <Text fontWeight="800" color="$blue10">SEI QUI PER VEDERE IL PROGETTO?</Text>
            <Paragraph>La modalità didattica mostra l’architettura zero-server senza chiedere credenziali GitHub.</Paragraph>
            <Button onPress={onExploreDemo}>Esplora l’architettura senza PAT</Button>
          </YStack>
        </Card>

        <Card borderWidth={1} borderColor="$borderColor" padding="$5" width="100%" maxWidth={680}>
          <YStack gap="$4">
            <YStack gap="$2">
              <H2>Collega o inizializza un gruppo</H2>
              <Paragraph color="$color10">
                Microsoft identifica l’utente; una repository GitHub privata contiene i dati e le Actions del gruppo. Il nome GitHub della repository e il nome visualizzato del gruppo sono indipendenti.
              </Paragraph>
            </YStack>

            <Card borderWidth={1} borderColor="$green8" padding="$4">
              <YStack gap="$2">
                <Text fontWeight="800">Guida consigliata · prima configurazione</Text>
                <Paragraph size="$2">1. Crea prima una repository GitHub, preferibilmente privata. Può chiamarsi come vuoi. Per esempio: <Text fontWeight="700">{suggestedRepositoryName}</Text>.</Paragraph>
                <Paragraph size="$2">2. Dopo che la repository esiste, crea un <Text fontWeight="700">Fine-grained personal access token</Text> e limita “Repository access” solo a quella repository.</Paragraph>
                <Paragraph size="$2">3. In “Repository permissions” imposta <Text fontWeight="700">Contents: Read and write</Text>, <Text fontWeight="700">Workflows: Read and write</Text> e <Text fontWeight="700">Actions: Read and write</Text>. Metadata resta in lettura automaticamente.</Paragraph>
                <Paragraph size="$2">4. Incolla qui sotto il PAT e il nome completo <Text fontWeight="700">owner/repository</Text>. Fantazone creerà i JSON canonici e i workflow gestiti senza rinominare la repository.</Paragraph>
                <Paragraph size="$2" color="$color9">Creare prima la repository è importante: così il PAT può essere ristretto esattamente a quella repo invece di ricevere accesso più ampio del necessario.</Paragraph>
                <XStack gap="$2" flexWrap="wrap">
                  <Button size="$3" variant="outlined" onPress={() => { void Linking.openURL(GITHUB_NEW_REPOSITORY_URL) }}>1 · Crea repository GitHub</Button>
                  <Button size="$3" variant="outlined" onPress={() => { void Linking.openURL(GITHUB_FINE_GRAINED_PAT_URL) }}>2 · Crea Fine-grained PAT</Button>
                </XStack>
              </YStack>
            </Card>

            <Card borderWidth={1} borderColor="$yellow8" padding="$3">
              <Paragraph size="$2">
                Il PAT è la credenziale condivisa del gruppo nello schema zero-backend. Viene salvato nei settings privati OneDrive dell’app e sul dispositivo; gli invitati non hanno bisogno di un account GitHub. Trattalo come una password del gruppo.
              </Paragraph>
            </Card>

            <YStack gap="$2">
              <Text fontWeight="700">Repository GitHub</Text>
              <Input
                value={repositoryFullName}
                onChangeText={setRepositoryFullName}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="tuo-account/fantazone-amici-del-bar"
              />
              <Paragraph size="$2" color="$color9">
                Può avere qualsiasi nome GitHub valido. Non è l’identità del gruppo e non deve cambiare quando rinomini il gruppo o una lega.
              </Paragraph>
            </YStack>

            <YStack gap="$2">
              <Text fontWeight="700">Personal Access Token del gruppo</Text>
              <Input value={pat} onChangeText={setPat} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="github_pat_..." />
            </YStack>

            <YStack gap="$2">
              <Text fontWeight="700">Nome visualizzato del gruppo</Text>
              <Input value={groupName} onChangeText={setGroupName} autoCapitalize="words" placeholder="Amici del Bar" />
              <Paragraph size="$2" color="$color9">
                Questo nome finisce in <Text fontWeight="700">settings.json</Text> e può essere cambiato in seguito senza toccare repository, ID o storico.
              </Paragraph>
            </YStack>

            <Card borderWidth={1} borderColor="$borderColor" padding="$3">
              <YStack gap="$2">
                <Text fontWeight="700">Primo amministratore</Text>
                <Paragraph size="$2" color="$color9">
                  Per un gruppo nuovo usiamo di default l’email Microsoft con cui hai appena effettuato l’accesso.
                </Paragraph>
                <Input value={creatorEmail} onChangeText={setCreatorEmail} autoCapitalize="none" autoCorrect={false} placeholder="admin@esempio.it" />
              </YStack>
            </Card>

            {error ? <Card borderWidth={1} borderColor="$red8" padding="$3"><Text>{error}</Text></Card> : null}

            <XStack gap="$3" flexWrap="wrap">
              <Button disabled={!canSubmit || !repositoryFullName.trim()} onPress={connectExistingGroup} flex={1} minWidth={220}>
                {loading ? <Spinner /> : 'Collega gruppo esistente'}
              </Button>
              <Button
                disabled={!canSubmit || !repositoryFullName.trim() || !groupName.trim() || !creatorEmail.trim()}
                onPress={initializeGroup}
                flex={1}
                minWidth={220}
                theme="accent"
              >
                {loading ? <Spinner /> : 'Inizializza questa repository'}
              </Button>
            </XStack>

            <Paragraph size="$2" color="$color9">
              “Inizializza” non cancella file esistenti: aggiunge solo il contratto Fantazone mancante e aggiorna esclusivamente i workflow gestiti da Fantazone.
            </Paragraph>
          </YStack>
        </Card>
      </YStack>
    </ScrollView>
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
