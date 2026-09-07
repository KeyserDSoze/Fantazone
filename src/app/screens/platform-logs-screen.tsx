import React, { useEffect, useMemo, useState } from 'react'
import { Linking } from 'react-native'
import { Button, Card, H1, H2, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import { GitHubClient, type GitHubWorkflowRun } from '@fantazone/github'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = { runtime: GroupSessionRuntime }
type Source = 'platform' | 'group'
type SourceFilter = 'all' | Source
type StatusFilter = 'all' | 'failed' | 'running'
type SourcedRun = { source: Source; repository: string; run: GitHubWorkflowRun }

const WINDOW_MS = 24 * 60 * 60 * 1000

export function PlatformLogsScreen({ runtime }: Props) {
  const [runs, setRuns] = useState<SourcedRun[]>([])
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  async function load() {
    setLoading(true)
    setErrors([])
    try {
      const publicPlatform = new GitHubClient()
      const groupClient = new GitHubClient(runtime.connection.token)
      const [platformResult, groupResult] = await Promise.allSettled([
        publicPlatform.listWorkflowRuns(runtime.platformTarget.owner, runtime.platformTarget.repo, { perPage: 100 }),
        groupClient.listWorkflowRuns(runtime.target.owner, runtime.target.repo, { perPage: 100 }),
      ])
      const threshold = Date.now() - WINDOW_MS
      const next: SourcedRun[] = []
      const nextErrors: string[] = []

      if (platformResult.status === 'fulfilled') {
        next.push(...platformResult.value.workflow_runs
          .filter(run => timestamp(run.created_at) >= threshold)
          .map(run => ({
            source: 'platform' as const,
            repository: `${runtime.platformTarget.owner}/${runtime.platformTarget.repo}`,
            run,
          })))
      } else {
        nextErrors.push(`Piattaforma: ${toMessage(platformResult.reason)}`)
      }

      if (groupResult.status === 'fulfilled') {
        next.push(...groupResult.value.workflow_runs
          .filter(run => timestamp(run.created_at) >= threshold)
          .map(run => ({
            source: 'group' as const,
            repository: `${runtime.target.owner}/${runtime.target.repo}`,
            run,
          })))
      } else {
        nextErrors.push(`Gruppo: ${toMessage(groupResult.reason)}`)
      }

      next.sort((left, right) => timestamp(right.run.created_at) - timestamp(left.run.created_at))
      setRuns(next)
      setErrors(nextErrors)
      setLastRefresh(new Date())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [runtime])
  useEffect(() => {
    const timer = setInterval(() => { void load() }, 60_000)
    return () => clearInterval(timer)
  }, [runtime])

  const filtered = useMemo(() => runs.filter(item => {
    if (sourceFilter !== 'all' && item.source !== sourceFilter) return false
    if (statusFilter === 'failed' && item.run.conclusion !== 'failure') return false
    if (statusFilter === 'running' && !['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(item.run.status)) return false
    return true
  }), [runs, sourceFilter, statusFilter])

  const stats = useMemo(() => ({
    total: runs.length,
    failed: runs.filter(item => item.run.conclusion === 'failure').length,
    running: runs.filter(item => ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(item.run.status)).length,
    platform: runs.filter(item => item.source === 'platform').length,
    group: runs.filter(item => item.source === 'group').length,
  }), [runs])

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1080} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1">
            <H1>Log operativi</H1>
            <Paragraph color="$color10">GitHub Actions della piattaforma e del gruppo nelle ultime 24 ore.</Paragraph>
            {lastRefresh ? <Text color="$color9" fontSize="$2">Aggiornato {formatDate(lastRefresh.toISOString())}</Text> : null}
          </YStack>
          <Button onPress={() => { void load() }} disabled={loading}>{loading ? <Spinner /> : 'Aggiorna'}</Button>
        </XStack>

        {errors.map(error => (
          <Card key={error} borderWidth={1} borderColor="$orange8" padding="$3">
            <Paragraph color="$orange10">{error}</Paragraph>
          </Card>
        ))}

        <XStack gap="$3" flexWrap="wrap">
          <Stat label="Run" value={stats.total} />
          <Stat label="Falliti" value={stats.failed} />
          <Stat label="In corso" value={stats.running} />
          <Stat label="Piattaforma" value={stats.platform} />
          <Stat label="Gruppo" value={stats.group} />
        </XStack>

        <Card borderWidth={1} borderColor="$borderColor" padding="$3">
          <YStack gap="$3">
            <YStack gap="$2">
              <Text fontWeight="800">Sorgente</Text>
              <XStack gap="$2" flexWrap="wrap">
                <FilterButton active={sourceFilter === 'all'} label="Tutte" onPress={() => setSourceFilter('all')} />
                <FilterButton active={sourceFilter === 'platform'} label="Piattaforma" onPress={() => setSourceFilter('platform')} />
                <FilterButton active={sourceFilter === 'group'} label="Gruppo" onPress={() => setSourceFilter('group')} />
              </XStack>
            </YStack>
            <YStack gap="$2">
              <Text fontWeight="800">Stato</Text>
              <XStack gap="$2" flexWrap="wrap">
                <FilterButton active={statusFilter === 'all'} label="Tutti" onPress={() => setStatusFilter('all')} />
                <FilterButton active={statusFilter === 'failed'} label="Solo errori" onPress={() => setStatusFilter('failed')} />
                <FilterButton active={statusFilter === 'running'} label="In corso" onPress={() => setStatusFilter('running')} />
              </XStack>
            </YStack>
          </YStack>
        </Card>

        {loading && runs.length === 0 ? (
          <Card padding="$6" alignItems="center"><Spinner /><Paragraph marginTop="$2">Caricamento Actions…</Paragraph></Card>
        ) : filtered.length === 0 ? (
          <Card padding="$5">
            <YStack gap="$2">
              <H2 size="$5">Nessun run nel filtro corrente</H2>
              <Paragraph color="$color10">Non risultano esecuzioni GitHub Actions corrispondenti nelle ultime 24 ore.</Paragraph>
            </YStack>
          </Card>
        ) : (
          <YStack gap="$3">
            {filtered.map(item => <RunCard key={`${item.source}-${item.run.id}`} item={item} />)}
          </YStack>
        )}
      </YStack>
    </ScrollView>
  )
}

function RunCard({ item }: { item: SourcedRun }) {
  const failed = item.run.conclusion === 'failure'
  const running = ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(item.run.status)
  return (
    <Card borderWidth={1} borderColor={failed ? '$red8' : running ? '$yellow8' : '$borderColor'} padding="$4">
      <YStack gap="$3">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap">
          <YStack flex={1} minWidth={240} gap="$1">
            <XStack gap="$2" alignItems="center" flexWrap="wrap">
              <Text fontWeight="900" fontSize="$5">{item.run.name || workflowName(item.run.path)}</Text>
              <Text color={item.source === 'platform' ? '$purple10' : '$blue10'} fontWeight="700">
                {item.source === 'platform' ? 'Piattaforma' : 'Gruppo'}
              </Text>
            </XStack>
            <Text color="$color10">{item.run.display_title || item.run.head_commit?.message || 'Run GitHub Actions'}</Text>
            <Text color="$color9" fontSize="$2">{item.repository} · #{item.run.run_number}</Text>
          </YStack>
          <Text color={failed ? '$red10' : running ? '$yellow10' : '$green10'} fontWeight="900">
            {statusLabel(item.run)}
          </Text>
        </XStack>

        <XStack gap="$4" flexWrap="wrap">
          <Meta label="Avvio" value={formatDate(item.run.run_started_at || item.run.created_at)} />
          <Meta label="Trigger" value={item.run.event} />
          <Meta label="Branch" value={item.run.head_branch || '—'} />
          <Meta label="Commit" value={shortSha(item.run.head_sha)} />
          {item.run.actor?.login ? <Meta label="Actor" value={item.run.actor.login} /> : null}
        </XStack>

        <Button alignSelf="flex-start" variant="outlined" onPress={() => { void Linking.openURL(item.run.html_url) }}>
          Apri su GitHub Actions
        </Button>
      </YStack>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card flex={1} minWidth={120} borderWidth={1} borderColor="$borderColor" padding="$3">
      <YStack gap="$1"><Text color="$color10">{label}</Text><Text fontSize="$7" fontWeight="900">{value}</Text></YStack>
    </Card>
  )
}

function FilterButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <Button size="$3" variant="outlined" backgroundColor={active ? '$color4' : 'transparent'} onPress={onPress}>{label}</Button>
}

function Meta({ label, value }: { label: string; value: string }) {
  return <YStack gap="$1"><Text color="$color9" fontSize="$1">{label}</Text><Text fontSize="$2">{value}</Text></YStack>
}

function statusLabel(run: GitHubWorkflowRun): string {
  if (run.status !== 'completed') return run.status.replaceAll('_', ' ')
  if (!run.conclusion) return 'completato'
  switch (run.conclusion) {
    case 'success': return 'successo'
    case 'failure': return 'errore'
    case 'cancelled': return 'annullato'
    case 'skipped': return 'saltato'
    default: return run.conclusion.replaceAll('_', ' ')
  }
}

function workflowName(path: string): string {
  return path.split('/').at(-1)?.replace(/\.ya?ml$/i, '') || 'Workflow'
}

function shortSha(value: string): string { return value ? value.slice(0, 7) : '—' }
function timestamp(value: string): number { const parsed = new Date(value).getTime(); return Number.isNaN(parsed) ? 0 : parsed }
function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(parsed)
}
function toMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
