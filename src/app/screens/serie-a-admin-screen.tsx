import React, { useEffect, useMemo, useState } from 'react'
import { CalendarDays, RefreshCw, ShieldCheck } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import { RealGameHelper, type AuthenticatedGroupSession, type RealCalendar } from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'
import {
  delayedChangeKey,
  dispatchSerieAPlatformJob,
  getSerieAAdminAccess,
  saveSerieADelayedChanges,
  type SerieAAdminAccess,
  type SerieADelayedChange,
  type SerieAPlatformJob,
} from '../services/serieAAdminService'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  selection: GroupNavigationSelection
}

export function SerieAAdminScreen({ runtime, session, selection }: Props) {
  const season = selection.year
  const [calendar, setCalendar] = useState<RealCalendar | null>(null)
  const [access, setAccess] = useState<SerieAAdminAccess | null>(null)
  const [changes, setChanges] = useState<Map<string, SerieADelayedChange>>(new Map())
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function load() {
    if (!season) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const nextCalendar = await runtime.realCalendarRepository.getCalendar(season, { refresh: true })
      setCalendar(nextCalendar)
      setChanges(new Map())
      try {
        setAccess(await getSerieAAdminAccess(runtime, session.member))
      } catch (accessError) {
        setAccess({
          canWrite: false,
          repository: `${runtime.platformTarget.owner}/${runtime.platformTarget.repo}`,
          branch: runtime.platformTarget.ref ?? null,
          reason: accessError instanceof Error ? accessError.message : 'Impossibile verificare i permessi del repository piattaforma.',
        })
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare il calendario Serie A.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [season])

  const stats = useMemo(() => {
    let total = 0
    let delayed = 0
    let played = 0
    let upcoming = 0
    for (const day of calendar?.days ?? []) {
      for (const game of day.games) {
        total += 1
        if (game.delayed) delayed += 1
        else if (RealGameHelper.isPlayed(game)) played += 1
        else upcoming += 1
      }
    }
    return { total, delayed, played, upcoming }
  }, [calendar])

  function toggleDelayed(serieADay: number, gameIndex: number) {
    if (!calendar) return
    const day = calendar.days.find(item => item.serieADay === serieADay)
    const game = day?.games[gameIndex]
    if (!day || !game) return
    const delayed = !game.delayed
    const change: SerieADelayedChange = {
      serieADay,
      home: game.home.name,
      away: game.away.name,
      delayed,
    }
    const key = delayedChangeKey(change)
    setCalendar(current => current ? {
      ...current,
      days: current.days.map(item => item.serieADay !== serieADay ? item : {
        ...item,
        games: item.games.map((candidate, index) => index === gameIndex ? { ...candidate, delayed } : candidate),
      }),
    } : current)
    setChanges(current => {
      const next = new Map(current)
      next.set(key, change)
      return next
    })
  }

  function toggleDay(serieADay: number) {
    setExpandedDays(current => {
      const next = new Set(current)
      if (next.has(serieADay)) next.delete(serieADay)
      else next.add(serieADay)
      return next
    })
  }

  async function saveChanges() {
    if (!season || changes.size === 0) return
    setBusy('save')
    setError(null)
    setNotice(null)
    try {
      const result = await saveSerieADelayedChanges(runtime, session.member, season, [...changes.values()])
      setCalendar(result.calendar)
      setChanges(new Map())
      setNotice(result.changedGames > 0
        ? `${result.changedGames} partita/e aggiornate nel calendario Serie A canonico.`
        : 'Il calendario fresco conteneva già gli stessi valori: nessuna scrittura necessaria.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Impossibile salvare le modifiche Serie A.')
    } finally {
      setBusy(null)
    }
  }

  async function runJob(job: SerieAPlatformJob, day?: number) {
    if (!season) return
    const jobKey = `${job}-${day ?? 'season'}`
    setBusy(jobKey)
    setError(null)
    setNotice(null)
    try {
      await dispatchSerieAPlatformJob(runtime, session.member, { job, season, day })
      setNotice(`${jobLabel(job)} avviato${day ? ` per la giornata ${day}` : ` per la stagione ${season}`}. I dati cambieranno quando la GitHub Action avrà completato il job.`)
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : `Impossibile avviare ${jobLabel(job)}.`)
    } finally {
      setBusy(null)
    }
  }

  if (!season) {
    return (
      <AppScreen maxWidth={900}>
        <PageIntro eyebrow="SuperAdmin" title="Gestione Serie A" description="Seleziona una stagione per amministrare i dati globali della piattaforma." />
        <Surface accent="yellow" padding="$5"><Paragraph color="$color10">Nessuna stagione selezionata.</Paragraph></Surface>
      </AppScreen>
    )
  }

  const canWrite = access?.canWrite === true

  return (
    <AppScreen maxWidth={1240}>
      <PageIntro
        eyebrow="Piattaforma"
        title="Gestione Serie A"
        description={`Calendario globale ${season}: rinvii manuali e producer piattaforma gestiti tramite GitHub Actions, senza endpoint backend.`}
        action={(
          <Button variant="outlined" borderRadius="$4" icon={loading ? undefined : RefreshCw} onPress={() => { void load() }} disabled={loading || busy != null}>
            {loading ? <Spinner /> : 'Ricarica dati'}
          </Button>
        )}
      />

      <Surface accent={canWrite ? 'green' : 'yellow'} padding="$5">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$4" flexWrap="wrap">
          <XStack alignItems="flex-start" gap="$3" flex={1} minWidth={280}>
            <YStack width={44} height={44} borderRadius="$4" backgroundColor={canWrite ? '$green3' : '$yellow3'} borderWidth={1} borderColor={canWrite ? '$green5' : '$yellow5'} alignItems="center" justifyContent="center">
              <ShieldCheck size="$1.2" color={canWrite ? '$green10' : '$yellow10'} />
            </YStack>
            <YStack flex={1} gap="$1">
              <Text color="$color12" fontSize="$6" fontWeight="900">Accesso piattaforma</Text>
              <Text color="$color9" fontSize="$2">{access?.repository ?? `${runtime.platformTarget.owner}/${runtime.platformTarget.repo}`}</Text>
              <Paragraph color="$color10">
                {access == null
                  ? 'Verifica permessi in corso…'
                  : canWrite
                    ? `Scrittura abilitata sul branch ${access.branch}. Ogni operazione rivalida ruolo SuperAdmin e permesso push.`
                    : access.reason}
              </Paragraph>
            </YStack>
          </XStack>
          <StatusPill tone={access == null ? 'neutral' : canWrite ? 'green' : 'yellow'}>
            {access == null ? 'Verifica…' : canWrite ? 'Scrittura abilitata' : 'Solo lettura'}
          </StatusPill>
        </XStack>
      </Surface>

      {error ? <Surface accent="red" padding="$3"><Paragraph color="$red11">{error}</Paragraph></Surface> : null}
      {notice ? <Surface accent="green" padding="$3"><Paragraph color="$green11">{notice}</Paragraph></Surface> : null}

      <XStack gap="$3" flexWrap="wrap">
        <Stat label="Partite" value={stats.total} tone="blue" />
        <Stat label="Giocate" value={stats.played} tone="green" />
        <Stat label="Da giocare" value={stats.upcoming} tone="neutral" />
        <Stat label="Rinviate" value={stats.delayed} tone="yellow" />
      </XStack>

      <Surface padding="$5">
        <YStack gap="$4">
          <XStack alignItems="center" gap="$2">
            <CalendarDays size="$1.2" color="$blue10" />
            <YStack flex={1} gap="$1">
              <Text color="$color12" fontSize="$6" fontWeight="900">Producer globali</Text>
              <Paragraph color="$color10">Il browser invia soltanto il workflow_dispatch; la Action esegue il producer e committa i dati canonici.</Paragraph>
            </YStack>
          </XStack>
          <XStack gap="$2" flexWrap="wrap">
            <JobButton label="Aggiorna calendario" job="ingest-serie-a" busy={busy} disabled={!canWrite} onRun={runJob} />
            <JobButton label="Aggiorna giocatori/squadre" job="ingest-master-data" busy={busy} disabled={!canWrite} onRun={runJob} />
            <JobButton label="Ricalcola statistiche" job="rebuild-player-stats" busy={busy} disabled={!canWrite} onRun={runJob} />
            <JobButton label="Aggiorna probabilità" job="ingest-player-odds" busy={busy} disabled={!canWrite} onRun={runJob} />
            <JobButton label="Aggiorna immagini" job="ingest-player-images" busy={busy} disabled={!canWrite} onRun={runJob} />
          </XStack>
        </YStack>
      </Surface>

      {changes.size > 0 ? (
        <Surface accent="yellow" padding="$4">
          <XStack justifyContent="space-between" alignItems="center" gap="$4" flexWrap="wrap">
            <YStack gap="$1">
              <Text color="$color12" fontWeight="900">Modifiche locali non salvate</Text>
              <Paragraph color="$yellow11">{changes.size} partita/e hanno uno stato rinvio diverso dal documento canonico.</Paragraph>
            </YStack>
            <XStack gap="$2" flexWrap="wrap">
              <Button variant="outlined" borderRadius="$4" onPress={() => { void load() }} disabled={busy != null}>Annulla e ricarica</Button>
              <PrimaryAction onPress={() => { void saveChanges() }} disabled={!canWrite || busy != null}>
                {busy === 'save' ? <Spinner color="white" /> : 'Salva modifiche'}
              </PrimaryAction>
            </XStack>
          </XStack>
        </Surface>
      ) : null}

      {loading && !calendar ? (
        <YStack minHeight={220} alignItems="center" justifyContent="center" gap="$3"><Spinner size="large" /><Text color="$color9">Caricamento calendario…</Text></YStack>
      ) : !calendar ? (
        <Surface padding="$5">
          <YStack gap="$2">
            <Text color="$color12" fontSize="$6" fontWeight="900">Calendario non disponibile</Text>
            <Paragraph color="$color10">Avvia “Aggiorna calendario” per creare o aggiornare la stagione supportata dal provider.</Paragraph>
          </YStack>
        </Surface>
      ) : (
        <YStack gap="$3">
          <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
            <Text color="$color12" fontSize="$6" fontWeight="900">Calendario canonico</Text>
            <StatusPill tone="blue">38 giornate</StatusPill>
          </XStack>
          {calendar.days.slice().sort((a, b) => a.serieADay - b.serieADay).map(day => {
            const isExpanded = expandedDays.has(day.serieADay)
            const delayed = day.games.filter(game => game.delayed).length
            const played = day.games.filter(game => RealGameHelper.isPlayed(game)).length
            return (
              <YStack key={day.serieADay} borderWidth={1} borderColor="$color5" backgroundColor="$color2" borderRadius="$5" overflow="hidden">
                <XStack padding="$4" justifyContent="space-between" alignItems="center" gap="$4" flexWrap="wrap">
                  <YStack gap="$1">
                    <XStack alignItems="center" gap="$2">
                      <Text color="$color12" fontSize="$5" fontWeight="900">Giornata {day.serieADay}</Text>
                      {delayed > 0 ? <StatusPill tone="yellow">{delayed} rinviate</StatusPill> : null}
                    </XStack>
                    <Text color="$color9" fontSize="$2">{day.games.length} partite · {played} giocate</Text>
                  </YStack>
                  <XStack gap="$2" flexWrap="wrap">
                    <Button size="$3" borderRadius="$4" onPress={() => { void runJob('ingest-serie-a', day.serieADay) }} disabled={!canWrite || busy != null}>
                      {busy === `ingest-serie-a-${day.serieADay}` ? <Spinner /> : 'Aggiorna giornata'}
                    </Button>
                    <Button size="$3" variant="outlined" borderRadius="$4" onPress={() => { void runJob('ingest-final-votes', day.serieADay) }} disabled={!canWrite || busy != null}>
                      {busy === `ingest-final-votes-${day.serieADay}` ? <Spinner /> : 'Importa voti finali'}
                    </Button>
                    <Button size="$3" chromeless onPress={() => toggleDay(day.serieADay)}>{isExpanded ? 'Chiudi' : 'Mostra partite'}</Button>
                  </XStack>
                </XStack>

                {isExpanded ? (
                  <YStack borderTopWidth={1} borderTopColor="$color5">
                    {day.games.map((game, gameIndex) => {
                      const changeKey = delayedChangeKey({ serieADay: day.serieADay, home: game.home.name, away: game.away.name })
                      const modified = changes.has(changeKey)
                      return (
                        <XStack
                          key={`${game.home.name}-${game.away.name}`}
                          padding="$4"
                          gap="$4"
                          justifyContent="space-between"
                          alignItems="center"
                          flexWrap="wrap"
                          borderBottomWidth={gameIndex < day.games.length - 1 ? 1 : 0}
                          borderBottomColor="$color4"
                          backgroundColor={modified ? '$yellow2' : 'transparent'}
                        >
                          <YStack flex={1} minWidth={250} gap="$1">
                            <Text color="$color12" fontWeight="900">{game.home.name} – {game.away.name}</Text>
                            <Text color="$color9" fontSize="$2">{formatGame(game.date, game.homeGoals, game.awayGoals)}</Text>
                            {modified ? <Text color="$yellow11" fontSize="$2" fontWeight="800">Modifica locale non salvata</Text> : null}
                          </YStack>
                          <XStack alignItems="center" gap="$2">
                            <StatusPill tone={game.delayed ? 'yellow' : RealGameHelper.isPlayed(game) ? 'green' : 'neutral'}>
                              {game.delayed ? 'Rinviata' : RealGameHelper.isPlayed(game) ? 'Giocata' : 'Da giocare'}
                            </StatusPill>
                            <Button size="$3" variant="outlined" borderRadius="$4" onPress={() => toggleDelayed(day.serieADay, gameIndex)} disabled={!canWrite || busy != null}>
                              {game.delayed ? 'Segna regolare' : 'Segna rinviata'}
                            </Button>
                          </XStack>
                        </XStack>
                      )
                    })}
                  </YStack>
                ) : null}
              </YStack>
            )
          })}
        </YStack>
      )}
    </AppScreen>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'blue' | 'green' | 'yellow' }) {
  const background = tone === 'blue' ? '$blue2' : tone === 'green' ? '$green2' : tone === 'yellow' ? '$yellow2' : '$color2'
  const border = tone === 'blue' ? '$blue5' : tone === 'green' ? '$green5' : tone === 'yellow' ? '$yellow5' : '$color5'
  return (
    <YStack flexGrow={1} flexBasis={180} minWidth={150} padding="$4" gap="$1" borderWidth={1} borderColor={border} backgroundColor={background} borderRadius="$5">
      <Text color="$color9" fontSize="$2" fontWeight="800">{label}</Text>
      <Text color="$color12" fontSize="$8" lineHeight="$8" fontWeight="900">{value}</Text>
    </YStack>
  )
}

function JobButton({ label, job, busy, disabled, onRun }: {
  label: string
  job: SerieAPlatformJob
  busy: string | null
  disabled: boolean
  onRun: (job: SerieAPlatformJob) => Promise<void>
}) {
  return (
    <Button borderRadius="$4" onPress={() => { void onRun(job) }} disabled={disabled || busy != null}>
      {busy === `${job}-season` ? <Spinner /> : label}
    </Button>
  )
}

function jobLabel(job: SerieAPlatformJob): string {
  switch (job) {
    case 'ingest-serie-a': return 'Aggiornamento calendario Serie A'
    case 'ingest-master-data': return 'Aggiornamento anagrafiche Serie A'
    case 'rebuild-player-stats': return 'Ricalcolo statistiche giocatori'
    case 'ingest-final-votes': return 'Import voti finali'
    case 'ingest-player-odds': return 'Aggiornamento probabilità giocatori'
    case 'ingest-player-images': return 'Aggiornamento immagini giocatori'
  }
}

function formatGame(date: string | null, homeGoals: number | null, awayGoals: number | null): string {
  const score = homeGoals != null && awayGoals != null ? ` · ${homeGoals}-${awayGoals}` : ''
  if (!date) return `Orario non disponibile${score}`
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return `${date}${score}`
  return `${new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(parsed)}${score}`
}
