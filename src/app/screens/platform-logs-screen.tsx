import React, { useEffect, useMemo, useState } from 'react'
import { ExternalLink, RefreshCw } from '@tamagui/lucide-icons-2'
import { Linking } from 'react-native'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import { GitHubClient, type GitHubWorkflowRun } from '@fantazone/github'
import { AppScreen, PageIntro, StatusPill, Surface } from '../components/design-system'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = { runtime: GroupSessionRuntime }
type Source = 'platform' | 'group'
type SourceFilter = 'all' | Source
type StatusFilter = 'all' | 'failed' | 'running'
type SourcedRun = { source: Source; repository: string; run: GitHubWorkflowRun }

const WINDOW_MS = 24 * 60 * 60 * 1000
const RUNNING_STATUSES = ['queued', 'in_progress', 'waiting', 'requested', 'pending']

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
    if (statusFilter === 'running' && !RUNNING_STATUSES.includes(item.run.status)) return false
    return true
  }), [runs, sourceFilter, statusFilter])

  const stats = useMemo(() => ({
    total: runs.length,
    failed: runs.filter(item => item.run.conclusion === 'failure').length,
    running: runs.filter(item => RUNNING_STATUSES.includes(item.run.status)).length,
    platform: runs.filter(item => item.source === 'platform').length,
    group: runs.filter(item => item.source === 'group').length,
  }), [runs])

  return (
    <AppScreen maxWidth={1220}>
      <PageIntro
        eyebrow="Osservabilità"
        title="Log operativi"
        description={`GitHub Actions della piattaforma e del gruppo nelle ultime 24 ore${lastRefresh ? ` · aggiornato ${formatDate(lastRefresh.toISOString())}` : ''}.`}
        action={(
          <Button variant="outlined" borderRadius="$4" icon={loading ? undefined : RefreshCw} onPress={() => { void load() }} disabled={loading}>
            {loading ? <Spinner /> : 'Aggiorna'}
          </Button>
        )}
      />

      {errors.map(error => (
        <Surface key={error} accent="yellow" padding="$3"><Paragraph color="$yellow11">{error}</Paragraph></Surface>
      ))}

      <XStack gap="$3" flexWrap="wrap">
        <Stat label="Run" value={stats.total} tone="blue" />
        <Stat label="In corso" value={stats.running} tone="yellow" />
        <Stat label="Falliti" value={stats.failed} tone="red" />
        <Stat label="Piattaforma" value={stats.platform} tone="purple" />
        <Stat label="Gruppo" value={stats.group} tone="green" />
      </XStack>

      <Surface padding="$4">
        <XStack gap="$5" flexWrap="wrap" alignItems="flex-end">
          <YStack gap="$2" flexGrow={1} flexBasis={320}>
            <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Sorgente</Text>
            <XStack gap="$2" flexWrap="wrap">
              <FilterButton active={sourceFilter === 'all'} label="Tutte" onPress={() => setSourceFilter('all')} />
              <FilterButton active={sourceFilter === 'platform'} label="Piattaforma" onPress={() => setSourceFilter('platform')} tone="purple" />
              <FilterButton active={sourceFilter === 'group'} label="Gruppo" onPress={() => setSourceFilter('group')} tone="blue" />
            </XStack>
          </YStack>
          <YStack gap="$2" flexGrow={1} flexBasis={320}>
            <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Stato</Text>
            <XStack gap="$2" flexWrap="wrap">
              <FilterButton active={statusFilter === 'all'} label="Tutti" onPress={() => setStatusFilter('all')} />
              <FilterButton active={statusFilter === 'failed'} label="Solo errori" onPress={() => setStatusFilter('failed')} tone="red" />
              <FilterButton active={statusFilter === 'running'} label="In corso" onPress={() => setStatusFilter('running')} tone="yellow" />
            </XStack>
          </YStack>
          <StatusPill tone="blue">{filtered.length} visibili</StatusPill>
        </XStack>
      </Surface>

      {loading && runs.length === 0 ? (
        <YStack minHeight={220} alignItems="center" justifyContent="center" gap="$3"><Spinner size="large" /><Text color="$color9">Caricamento Actions…</Text></YStack>
      ) : filtered.length === 0 ? (
        <Surface padding="$5">
          <YStack minHeight={140} justifyContent="center" gap="$2">
            <Text color="$color12" fontSize="$6" fontWeight="900">Nessun run nel filtro corrente</Text>
            <Paragraph color="$color10">Non risultano esecuzioni GitHub Actions corrispondenti nelle ultime 24 ore.</Paragraph>
          </YStack>
        </Surface>
      ) : (
        <YStack gap="$3">
          {filtered.map(item => <RunCard key={`${item.source}-${item.run.id}`} item={item} />)}
        </YStack>
      )}
    </AppScreen>
  )
}

function RunCard({ item }: { item: SourcedRun }) {
  const failed = item.run.conclusion === 'failure'
  const running = RUNNING_STATUSES.includes(item.run.status)
  const tone = failed ? 'red' : running ? 'yellow' : item.run.conclusion === 'success' ? 'green' : 'neutral'
  return (
    <YStack
      padding="$4"
      gap="$4"
      borderWidth={1}
      borderColor={failed ? '$red6' : running ? '$yellow6' : '$color5'}
      backgroundColor={failed ? '$red2' : running ? '$yellow2' : '$color2'}
      borderRadius="$5"
    >
      <XStack justifyContent="space-between" alignItems="flex-start" gap="$4" flexWrap="wrap">
        <YStack flex={1} minWidth={260} gap="$1.5">
          <XStack gap="$2" alignItems="center" flexWrap="wrap">
            <Text color="$color12" fontWeight="900" fontSize="$5">{item.run.name || workflowName(item.run.path)}</Text>
            <StatusPill tone={item.source === 'platform' ? 'purple' : 'blue'}>{item.source === 'platform' ? 'Piattaforma' : 'Gruppo'}</StatusPill>
          </XStack>
          <Text color="$color10">{item.run.display_title || item.run.head_commit?.message || 'Run GitHub Actions'}</Text>
          <Text color="$color8" fontSize="$2">{item.repository} · run #{item.run.run_number}</Text>
        </YStack>
        <StatusPill tone={tone}>{statusLabel(item.run)}</StatusPill>
      </XStack>

      <XStack gap="$3" flexWrap="wrap">
        <Meta label="Avvio" value={formatDate(item.run.run_started_at || item.run.created_at)} />
        <Meta label="Trigger" value={item.run.event} />
        <Meta label="Branch" value={item.run.head_branch || '—'} />
        <Meta label="Commit" value={shortSha(item.run.head_sha)} />
        {item.run.actor?.login ? <Meta label="Actor" value={item.run.actor.login} /> : null}
      </XStack>

      <Button alignSelf="flex-start" variant="outlined" borderRadius="$4" icon={ExternalLink} onPress={() => { void Linking.openURL(item.run.html_url) }}>
        Apri su GitHub Actions
      </Button>
    </YStack>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'blue' | 'green' | 'yellow' | 'red' | 'purple' }) {
  const background = tone === 'blue' ? '$blue2' : tone === 'green' ? '$green2' : tone === 'yellow' ? '$yellow2' : tone === 'red' ? '$red2' : '$purple2'
  const border = tone === 'blue' ? '$blue5' : tone === 'green' ? '$green5' : tone === 'yellow' ? '$yellow5' : tone === 'red' ? '$red5' : '$purple5'
  return (
    <YStack flexGrow={1} flexBasis={150} minWidth={135} padding="$4" gap="$1" borderWidth={1} borderColor={border} backgroundColor={background} borderRadius="$5">
      <Text color="$color9" fontSize="$2" fontWeight="800">{label}</Text>
      <Text color="$color12" fontSize="$8" lineHeight="$8" fontWeight="900">{value}</Text>
    </YStack>
  )
}

function FilterButton({ active, label, onPress, tone = 'blue' }: { active: boolean; label: string; onPress: () => void; tone?: 'blue' | 'purple' | 'red' | 'yellow' }) {
  const background = !active ? '$color3' : tone === 'purple' ? '$purple4' : tone === 'red' ? '$red4' : tone === 'yellow' ? '$yellow4' : '$blue4'
  const border = !active ? '$color5' : tone === 'purple' ? '$purple7' : tone === 'red' ? '$red7' : tone === 'yellow' ? '$yellow7' : '$blue7'
  const color = !active ? '$color10' : tone === 'purple' ? '$purple11' : tone === 'red' ? '$red11' : tone === 'yellow' ? '$yellow11' : '$blue11'
  return (
    <Button size="$3" borderRadius="$10" backgroundColor={background} borderColor={border} onPress={onPress}>
      <Text color={color} fontWeight="800">{label}</Text>
    </Button>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <YStack flexGrow={1} flexBasis={120} minWidth={100} padding="$2.5" borderRadius="$3" backgroundColor="$color3" gap="$1">
      <Text color="$color8" fontSize="$1" fontWeight="800">{label}</Text>
      <Text color="$color12" fontSize="$2" fontWeight="700" numberOfLines={1}>{value}</Text>
    </YStack>
  )
}

function statusLabel(run: GitHubWorkflowRun): string {
  if (run.status !== 'completed') return run.status.replaceAll('_', ' ')
  if (!run.conclusion) return 'completato'
  switch (run.conclusion) {
    case 'success': return 'Successo'
    case 'failure': return 'Errore'
    case 'cancelled': return 'Annullato'
    case 'skipped': return 'Saltato'
    default: return run.conclusion.replaceAll('_', ' ')
  }
}

function workflowName(path: string): string { return path.split('/').at(-1)?.replace(/\.ya?ml$/i, '') || 'Workflow' }
function shortSha(value: string): string { return value ? value.slice(0, 7) : '—' }
function timestamp(value: string): number { const parsed = new Date(value).getTime(); return Number.isNaN(parsed) ? 0 : parsed }
function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(parsed)
}
function toMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
