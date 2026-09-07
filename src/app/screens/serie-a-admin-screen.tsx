import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, H1, H2, H3, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import { RealGameHelper, type AuthenticatedGroupSession, type RealCalendar } from '@fantazone/domain'
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
      <YStack padding="$4"><Card padding="$4"><Paragraph>Seleziona una stagione per amministrare la Serie A.</Paragraph></Card></YStack>
    )
  }

  const canWrite = access?.canWrite === true

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1100} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <YStack gap="$1" paddingTop="$2">
          <H1>Gestione Serie A</H1>
          <Paragraph color="$color10">Calendario globale {season}: rinvii manuali e producer piattaforma, senza endpoint backend.</Paragraph>
        </YStack>

        <Card borderWidth={1} borderColor={canWrite ? '$green8' : '$orange8'} padding="$4">
          <YStack gap="$2">
            <H2 size="$5">Accesso piattaforma</H2>
            <Text fontWeight="700">{access?.repository ?? `${runtime.platformTarget.owner}/${runtime.platformTarget.repo}`}</Text>
            <Paragraph color="$color10">
              {access == null
                ? 'Verifica permessi in corso…'
                : canWrite
                  ? `Scrittura abilitata sul branch ${access.branch}. Ogni operazione rivalida ruolo SuperAdmin e permesso push.`
                  : access.reason}
            </Paragraph>
          </YStack>
        </Card>

        {error ? <Card borderWidth={1} borderColor="$red8" padding="$3"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {notice ? <Card borderWidth={1} borderColor="$green8" padding="$3"><Paragraph color="$green10">{notice}</Paragraph></Card> : null}

        <XStack gap="$3" flexWrap="wrap">
          <StatCard label="Partite" value={stats.total} />
          <StatCard label="Rinviate" value={stats.delayed} />
          <StatCard label="Giocate" value={stats.played} />
          <StatCard label="Da giocare" value={stats.upcoming} />
        </XStack>

        <Card borderWidth={1} borderColor="$borderColor" padding="$4">
          <YStack gap="$3">
            <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
              <YStack gap="$1">
                <H2 size="$5">Producer globali</H2>
                <Paragraph color="$color10">Il browser invia solo il workflow_dispatch; la Action esegue il producer e committa i dati canonici.</Paragraph>
              </YStack>
              <Button onPress={() => void load()} disabled={loading || busy != null}>{loading ? <Spinner /> : 'Ricarica dati'}</Button>
            </XStack>
            <XStack gap="$2" flexWrap="wrap">
              <JobButton label="Aggiorna calendario" job="ingest-serie-a" busy={busy} disabled={!canWrite} onRun={runJob} />
              <JobButton label="Aggiorna giocatori/squadre" job="ingest-master-data" busy={busy} disabled={!canWrite} onRun={runJob} />
              <JobButton label="Ricalcola statistiche" job="rebuild-player-stats" busy={busy} disabled={!canWrite} onRun={runJob} />
              <JobButton label="Aggiorna probabilità" job="ingest-player-odds" busy={busy} disabled={!canWrite} onRun={runJob} />
              <JobButton label="Aggiorna immagini" job="ingest-player-images" busy={busy} disabled={!canWrite} onRun={runJob} />
            </XStack>
          </YStack>
        </Card>

        {changes.size > 0 ? (
          <Card borderWidth={1} borderColor="$orange8" padding="$3">
            <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
              <Paragraph color="$orange10" fontWeight="700">{changes.size} modifica/e ai rinvii non ancora salvata/e.</Paragraph>
              <XStack gap="$2">
                <Button onPress={() => void load()} disabled={busy != null}>Annulla e ricarica</Button>
                <Button onPress={() => void saveChanges()} disabled={!canWrite || busy != null}>{busy === 'save' ? <Spinner /> : 'Salva modifiche'}</Button>
              </XStack>
            </XStack>
          </Card>
        ) : null}

        {loading ? (
          <Card padding="$6" alignItems="center"><Spinner /><Paragraph marginTop="$2">Caricamento calendario…</Paragraph></Card>
        ) : !calendar ? (
          <Card padding="$5">
            <YStack gap="$3">
              <H2 size="$5">Calendario non disponibile</H2>
              <Paragraph color="$color10">Puoi avviare “Aggiorna calendario” per creare o aggiornare la stagione supportata dal provider.</Paragraph>
            </YStack>
          </Card>
        ) : (
          <YStack gap="$3">
            {calendar.days.slice().sort((a, b) => a.serieADay - b.serieADay).map(day => {
              const isExpanded = expandedDays.has(day.serieADay)
              const delayed = day.games.filter(game => game.delayed).length
              const played = day.games.filter(game => RealGameHelper.isPlayed(game)).length
              return (
                <Card key={day.serieADay} borderWidth={1} borderColor="$borderColor" padding="$0">
                  <YStack>
                    <XStack padding="$3" justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
                      <YStack gap="$1">
                        <H3>Giornata {day.serieADay}</H3>
                        <Text color="$color10">{day.games.length} partite · {played} giocate · {delayed} rinviate</Text>
                      </YStack>
                      <XStack gap="$2" flexWrap="wrap">
                        <Button size="$3" onPress={() => void runJob('ingest-serie-a', day.serieADay)} disabled={!canWrite || busy != null}>
                          {busy === `ingest-serie-a-${day.serieADay}` ? <Spinner /> : 'Aggiorna giornata'}
                        </Button>
                        <Button size="$3" onPress={() => void runJob('ingest-final-votes', day.serieADay)} disabled={!canWrite || busy != null}>
                          {busy === `ingest-final-votes-${day.serieADay}` ? <Spinner /> : 'Importa voti finali'}
                        </Button>
                        <Button size="$3" onPress={() => toggleDay(day.serieADay)}>{isExpanded ? 'Chiudi' : 'Partite'}</Button>
                      </XStack>
                    </XStack>
                    {isExpanded ? (
                      <YStack borderTopWidth={1} borderTopColor="$borderColor">
                        {day.games.map((game, gameIndex) => {
                          const changeKey = delayedChangeKey({ serieADay: day.serieADay, home: game.home.name, away: game.away.name })
                          const modified = changes.has(changeKey)
                          return (
                            <XStack key={`${game.home.name}-${game.away.name}`} padding="$3" gap="$3" justifyContent="space-between" alignItems="center" flexWrap="wrap" borderBottomWidth={gameIndex < day.games.length - 1 ? 1 : 0} borderBottomColor="$borderColor">
                              <YStack flex={1} minWidth={250} gap="$1">
                                <Text fontWeight="800">{game.home.name} – {game.away.name}</Text>
                                <Text color="$color10">{formatGame(game.date, game.homeGoals, game.awayGoals)}</Text>
                                {modified ? <Text color="$orange10" fontWeight="700">Modifica locale non salvata</Text> : null}
                              </YStack>
                              <Button size="$3" onPress={() => toggleDelayed(day.serieADay, gameIndex)} disabled={!canWrite || busy != null}>
                                {game.delayed ? 'Segna non rinviata' : 'Segna rinviata'}
                              </Button>
                            </XStack>
                          )
                        })}
                      </YStack>
                    ) : null}
                  </YStack>
                </Card>
              )
            })}
          </YStack>
        )}
      </YStack>
    </ScrollView>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card flex={1} minWidth={140} borderWidth={1} borderColor="$borderColor" padding="$3">
      <YStack gap="$1"><Text color="$color10">{label}</Text><Text fontSize="$7" fontWeight="900">{value}</Text></YStack>
    </Card>
  )
}

function JobButton({
  label,
  job,
  busy,
  disabled,
  onRun,
}: {
  label: string
  job: SerieAPlatformJob
  busy: string | null
  disabled: boolean
  onRun: (job: SerieAPlatformJob) => Promise<void>
}) {
  return (
    <Button onPress={() => void onRun(job)} disabled={disabled || busy != null}>
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
