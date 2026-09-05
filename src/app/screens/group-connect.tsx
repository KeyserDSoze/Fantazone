import React, { useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'
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
  createAndInitializeGroup,
  GitHubApiError,
  GitHubClient,
  parseInviteFragment,
  type GitHubRepo,
} from '@fantazone/github'
import type { GroupConnection } from '../services/groupSessionRuntime'

export type ConnectedGroup = GroupConnection

type Props = {
  onConnected: (group: ConnectedGroup) => void
  onExploreDemo: () => void
}

export function GroupConnectScreen({ onConnected, onExploreDemo }: Props) {
  const [pat, setPat] = useState('')
  const [groupName, setGroupName] = useState('')
  const [repositories, setRepositories] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = useMemo(() => pat.trim().length > 0 && !loading, [pat, loading])

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return
    try {
      const invite = parseInviteFragment(window.location.hash)
      if (!invite) return
      setPat(invite.pat)
      setGroupName(invite.group)
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`)
    } catch {
      setError('Il link di invito non è valido.')
    }
  }, [])

  async function discover() {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const client = new GitHubClient(pat.trim())
      await client.validateToken()
      const found = await client.discoverFantazoneRepositories()
      setRepositories(found)

      if (groupName.trim()) {
        const exact = await client.findGroup(groupName)
        if (exact) {
          onConnected({ token: pat.trim(), repository: exact, groupName: groupName.trim() })
          return
        }
      }

      if (found.length === 1) {
        const repository = found[0]
        onConnected({
          token: pat.trim(),
          repository,
          groupName: repository.name.replace(/^Fantazone\./, ''),
        })
      } else if (found.length === 0) {
        setError('Nessun repository Fantazone.* trovato. Puoi creare il gruppo qui sotto.')
      }
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  async function createGroup() {
    if (!canSubmit || !groupName.trim()) {
      setError('Inserisci PAT e nome del gruppo.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const client = new GitHubClient(pat.trim())
      await client.validateToken()
      const initialized = await createAndInitializeGroup(client, groupName.trim(), { isPrivate: true })
      onConnected({ token: pat.trim(), repository: initialized.repository, groupName: initialized.groupName })
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack flex={1} justifyContent="center" alignItems="center" padding="$4" gap="$4">
        <Card borderWidth={1} borderColor="$blue8" padding="$4" width="100%" maxWidth={560}>
          <YStack gap="$2">
            <Text fontWeight="800" color="$blue10">SEI QUI PER VEDERE IL PROGETTO?</Text>
            <Paragraph>La modalità didattica mostra l’architettura zero-server senza chiedere credenziali GitHub.</Paragraph>
            <Button onPress={onExploreDemo}>Esplora l’architettura senza PAT</Button>
          </YStack>
        </Card>

        <Card borderWidth={1} borderColor="$borderColor" padding="$5" width="100%" maxWidth={560}>
          <YStack gap="$4">
            <YStack gap="$2">
              <H2>Collega un gruppo Fantazone</H2>
              <Paragraph color="$color10">
                Prima scegliamo il repository del gruppo tramite PAT. Il login Fantazone con Google/Microsoft avverrà solo dopo questa selezione.
              </Paragraph>
            </YStack>

            <Card borderWidth={1} borderColor="$yellow8" padding="$3">
              <Paragraph size="$2">
                Usa un PAT fine-grained dedicato ai repository Fantazone necessari. I nuovi repository gruppo vengono creati privati perché GroupRaw contiene anche gli utenti e le loro email.
              </Paragraph>
            </Card>

            <YStack gap="$2">
              <Text fontWeight="700">Personal Access Token</Text>
              <Input
                value={pat}
                onChangeText={setPat}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="github_pat_..."
              />
            </YStack>

            <YStack gap="$2">
              <Text fontWeight="700">Nome gruppo</Text>
              <Input
                value={groupName}
                onChangeText={setGroupName}
                autoCapitalize="words"
                placeholder="Amici del Bar"
              />
              <Paragraph size="$2" color="$color9">
                Il repository corrispondente sarà Fantazone.&lt;nome-normalizzato&gt;.
              </Paragraph>
            </YStack>

            {error ? (
              <Card borderWidth={1} borderColor="$red8" padding="$3">
                <Text>{error}</Text>
              </Card>
            ) : null}

            <XStack gap="$3" flexWrap="wrap">
              <Button disabled={!canSubmit} onPress={discover} flex={1} minWidth={180}>
                {loading ? <Spinner /> : 'Cerca gruppi'}
              </Button>
              <Button disabled={!canSubmit || !groupName.trim()} onPress={createGroup} flex={1} minWidth={180} theme="accent">
                Crea / inizializza gruppo
              </Button>
            </XStack>

            {repositories.length > 1 ? (
              <YStack gap="$2">
                <Text fontWeight="700">Gruppi trovati</Text>
                {repositories.map(repository => (
                  <Button
                    key={repository.full_name}
                    justifyContent="flex-start"
                    onPress={() =>
                      onConnected({
                        token: pat.trim(),
                        repository,
                        groupName: repository.name.replace(/^Fantazone\./, ''),
                      })
                    }
                  >
                    {repository.name}
                  </Button>
                ))}
              </YStack>
            ) : null}
          </YStack>
        </Card>
      </YStack>
    </ScrollView>
  )
}

function toMessage(error: unknown): string {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) return 'PAT non valido o scaduto.'
    if (error.status === 403) return 'Il PAT non ha i permessi GitHub necessari.'
    if (error.status === 422) return 'GitHub ha rifiutato la creazione del repository. Controlla nome e permessi.'
    return `GitHub ha risposto con errore ${error.status}.`
  }
  return error instanceof Error ? error.message : 'Errore imprevisto durante il collegamento a GitHub.'
}
