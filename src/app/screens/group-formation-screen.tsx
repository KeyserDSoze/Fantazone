import React, { useEffect, useMemo, useState } from 'react'
import { Image } from 'react-native'
import {
  AlertTriangle,
  CalendarDays,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
} from '@tamagui/lucide-icons-2'
import { Button, H2, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  FantaSoccerRole,
  PlayerInTeamStatus,
  Role,
  applyFormationPositions,
  calculateAutomaticFormation,
  formatSeasonFromYear,
  getLiveFormationChangesRemaining,
  getPlayerKey,
  validateFormation,
  type AuthenticatedGroupSession,
  type FormationPositionUpdate,
  type GameWrapper,
  type Player,
  type Team,
} from '@fantazone/domain'
import { GitHubChanceRepository, GitHubStatPlayersRepository } from '@fantazone/github'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import { resolveFormationTarget, type FormationTarget } from '../services/groupFormationTarget'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'
import { isNetworkFailure } from '../services/networkStatus'
import { countPendingMutations, enqueueFormationMutation } from '../services/offlineOutbox'
import {
  beginOperation,
  endOperation,
  markConnectivity,
  setPendingWrites,
  updateOperation,
} from '../services/operationStatus'
import { getPlayerImageUrlFromName } from '../utils/playerImage'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  selection: GroupNavigationSelection
}

type PositionState = Record<string, FantaSoccerRole>

export function GroupFormationScreen({ runtime, session, selection }: Props) {
  const [target, setTarget] = useState<FormationTarget | null>(null)
  const [wrapper, setWrapper] = useState<GameWrapper | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [positions, setPositions] = useState<PositionState>({})
  const [automaticBackup, setAutomaticBackup] = useState<PositionState | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [automaticLoading, setAutomaticLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null
  const chanceRepository = useMemo(() => new GitHubChanceRepository(runtime.store, runtime.platformTarget), [runtime])
  const statRepository = useMemo(() => new GitHubStatPlayersRepository(runtime.store, runtime.platformTarget), [runtime])

  async function loadFormation() {
    if (!selection.leagueId || selection.year == null) {
      setError('Seleziona una lega e una stagione per gestire la formazione.')
      setTarget(null)
      setWrapper(null)
      setTeam(null)
      setAutomaticBackup(null)
      return
    }

    setLoading(true)
    setError(null)
    setStatus(null)
    setAutomaticBackup(null)
    beginOperation('Caricamento formazione', 'Controllo calendario, partita e squadra corrente…')
    try {
      const [calendar, realCalendar] = await Promise.all([
        runtime.calendarRepository.getCalendar(selection.leagueId, selection.year, { refresh: true }),
        runtime.realCalendarRepository.getCalendar(selection.year, { refresh: true }),
      ])
      if (!calendar) throw new Error('Il calendario della lega non è ancora disponibile.')

      updateOperation('Individuazione della partita e della formazione modificabile…')
      const resolved = resolveFormationTarget({
        group: runtime.group,
        leagueId: selection.leagueId,
        season: selection.year,
        identityEmail: session.identity.email,
        calendar,
        realCalendar,
      })
      if (!resolved) throw new Error('Non hai una squadra o una partita disponibile nella lega selezionata.')

      const game = await runtime.gameComposer.getGame({
        leagueId: selection.leagueId,
        season: selection.year,
        gameId: resolved.gameId,
      })
      if (!game) throw new Error('La partita della formazione non è disponibile.')

      const seasonTeam = await runtime.teamRepository.getTeam(
        resolved.basketId,
        selection.year,
        resolved.owner,
        { refresh: true },
      )
      if (!seasonTeam) throw new Error('La squadra corrente non è disponibile.')

      const currentTeam = game.isLiveFormationWindow
        ? await runtime.teamRepository.getTeamDay(
            resolved.basketId,
            selection.year,
            game.serieADay,
            resolved.owner,
            { refresh: true },
          ) ?? seasonTeam
        : seasonTeam

      setTarget(resolved)
      setWrapper(game)
      setTeam(currentTeam)
      setPositions(positionStateFromTeam(currentTeam))
    } catch (caught) {
      setTarget(null)
      setWrapper(null)
      setTeam(null)
      setPositions({})
      setAutomaticBackup(null)
      setError(toMessage(caught))
    } finally {
      endOperation()
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadFormation()
  }, [runtime, session.identity.email, selection.leagueId, selection.year])

  const activePlayers = useMemo(() => team?.players.filter(player => player.status === PlayerInTeamStatus.Active) ?? [], [team])
  const previewTeam = useMemo(() => {
    if (!team) return null
    return applyFormationPositions(team, formationUpdates(activePlayers, positions))
  }, [team, activePlayers, positions])
  const validation = useMemo(() => previewTeam ? validateFormation(previewTeam) : null, [previewTeam])
  const liveChangesRemaining = wrapper?.isLiveFormationWindow
    ? getLiveFormationChangesRemaining(team, { liveFormationChanges: wrapper.liveFormationChangesAllowed })
    : null

  async function applyAutomaticProposal() {
    if (!team || !wrapper || selection.year == null) return
    if (wrapper.isLiveFormationWindow) {
      setError('Durante il live sono ammessi soltanto gli scambi previsti dalla regola della lega: la proposta automatica è disabilitata.')
      return
    }
    setAutomaticLoading(true)
    setError(null)
    setStatus(null)
    beginOperation('Formazione automatica', 'Caricamento di probabilità, statistiche e calendario Serie A…')
    try {
      const [chances, stats, realCalendar] = await Promise.all([
        chanceRepository.get(selection.year, wrapper.serieADay, { refresh: true }),
        statRepository.getStats(selection.year, { refresh: true }),
        runtime.realCalendarRepository.getCalendar(selection.year, { refresh: true }),
      ])
      if (!chances) {
        throw new Error(`Probabilità Serie A ${selection.year}/${wrapper.serieADay} non disponibili. Esegui prima il producer delle probabilità.`)
      }
      updateOperation('Calcolo della proposta migliore con i dati disponibili…')
      const realDay = realCalendar?.days.find(day => day.serieADay === wrapper.serieADay) ?? null
      const result = calculateAutomaticFormation({ team, chances, stats, realDay })
      const preview = applyFormationPositions(team, result.updates)
      const checked = validateFormation(preview)
      if (!checked.valid) throw new Error(checked.errors[0] ?? 'La proposta automatica non produce una formazione valida.')

      setAutomaticBackup({ ...positions })
      setPositions(Object.fromEntries(result.updates.map(update => [update.playerKey, update.position])) as PositionState)
      setStatus(stats
        ? 'Proposta automatica applicata localmente usando probabilità, stato, statistiche recenti e difficoltà della partita. Controllala e premi Salva formazione per renderla effettiva.'
        : 'Proposta automatica applicata localmente usando le probabilità disponibili. Le statistiche della stagione non sono ancora disponibili; controllala prima di salvare.')
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      endOperation()
      setAutomaticLoading(false)
    }
  }

  function restoreAutomaticBackup() {
    if (!automaticBackup) return
    setPositions(automaticBackup)
    setAutomaticBackup(null)
    setError(null)
    setStatus('Ripristinata la formazione precedente alla proposta automatica.')
  }

  async function saveFormation() {
    if (!selection.leagueId || selection.year == null || !target || !team) return
    const updates = formationUpdates(activePlayers, positions)
    const preview = applyFormationPositions(team, updates)
    const checked = validateFormation(preview)
    if (!checked.valid) {
      setError(checked.errors[0] ?? 'Formazione non valida.')
      return
    }

    setSaving(true)
    setError(null)
    setStatus(null)
    beginOperation('Salvataggio formazione', 'Verifica della formazione e sincronizzazione con il gruppo…')
    try {
      const saved = await runtime.formationWriter.saveGameFormation({
        session,
        leagueId: selection.leagueId,
        season: selection.year,
        gameId: target.gameId,
        owner: target.owner,
        positions: updates,
      })
      setTeam(saved.team)
      setPositions(positionStateFromTeam(saved.team))
      setAutomaticBackup(null)
      markConnectivity('online')
      if (saved.source === 'day' && wrapper?.isLiveFormationWindow) {
        const remaining = getLiveFormationChangesRemaining(saved.team, { liveFormationChanges: wrapper.liveFormationChangesAllowed })
        setStatus(`Modifica live salvata sulla giornata ${saved.serieADay}. Modifiche ancora disponibili: ${remaining}.`)
      } else {
        setStatus('Formazione sincronizzata con il gruppo. La GitHub Action determinerà la TeamDay corretta dal timestamp del commit, senza riscrivere le giornate già congelate.')
      }
    } catch (caught) {
      if (isNetworkFailure(caught) && wrapper?.isLiveFormationWindow) {
        markConnectivity('offline')
        setError('Le modifiche live richiedono una connessione attiva: non vengono messe in coda perché potrebbero essere sincronizzate dopo la chiusura della finestra valida.')
      } else if (isNetworkFailure(caught)) {
        updateOperation('Connessione assente: salvataggio della modifica sul dispositivo…')
        await enqueueFormationMutation(runtime.connection.repository.full_name, {
          identityEmail: session.identity.email,
          leagueId: selection.leagueId,
          season: selection.year,
          gameId: target.gameId,
          owner: target.owner,
          positions: updates,
        })
        const localTeam: Team = { ...preview, lastUpdate: new Date().toISOString() }
        setTeam(localTeam)
        setPositions(positionStateFromTeam(localTeam))
        setAutomaticBackup(null)
        const pending = await countPendingMutations(runtime.connection.repository.full_name)
        setPendingWrites(pending)
        markConnectivity('offline')
        setStatus('Formazione salvata sul dispositivo. Verrà rivalidata e sincronizzata automaticamente appena torna la connessione; per il cutoff farà fede il momento del commit GitHub.')
      } else {
        setError(toMessage(caught))
      }
    } finally {
      endOperation()
      setSaving(false)
    }
  }

  return (
    <AppScreen maxWidth={1180}>
      <PageIntro
        eyebrow="Matchday"
        title="La mia formazione"
        description={`${league?.name ?? 'Lega'}${selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}. Prepara l’undici, ordina la panchina e salva: la giornata corretta viene determinata dal commit senza toccare gli snapshot già congelati.`}
        action={(
          <Button
            variant="outlined"
            borderRadius="$4"
            disabled={loading || saving || automaticLoading}
            icon={loading ? undefined : RefreshCw}
            onPress={() => { void loadFormation() }}
          >
            {loading ? <Spinner /> : 'Aggiorna'}
          </Button>
        )}
      />

      {error ? (
        <Surface accent="red" padding="$3">
          <XStack alignItems="flex-start" gap="$3">
            <AlertTriangle size="$1" color="$red10" />
            <Paragraph color="$red11" flex={1}>{error}</Paragraph>
          </XStack>
        </Surface>
      ) : null}

      {status ? (
        <Surface accent="green" padding="$3">
          <XStack alignItems="flex-start" gap="$3">
            <ShieldCheck size="$1" color="$green10" />
            <Paragraph color="$green11" flex={1}>{status}</Paragraph>
          </XStack>
        </Surface>
      ) : null}

      {loading && !team ? (
        <YStack minHeight={260} alignItems="center" justifyContent="center" gap="$3">
          <Spinner size="large" />
          <Text color="$color9">Sto preparando squadra e prossima partita…</Text>
        </YStack>
      ) : null}

      {wrapper && target ? (
        <Surface accent={wrapper.isLiveFormationWindow ? 'red' : 'blue'} padding="$5">
          <XStack gap="$4" justifyContent="space-between" alignItems="center" flexWrap="wrap">
            <XStack gap="$3" alignItems="center" flex={1} minWidth={260}>
              <YStack
                width={52}
                height={52}
                borderRadius="$5"
                backgroundColor={wrapper.isLiveFormationWindow ? '$red4' : '$blue4'}
                borderWidth={1}
                borderColor={wrapper.isLiveFormationWindow ? '$red6' : '$blue6'}
                alignItems="center"
                justifyContent="center"
              >
                <CalendarDays size="$1.4" color={wrapper.isLiveFormationWindow ? '$red10' : '$blue10'} />
              </YStack>
              <YStack gap="$1" flex={1} minWidth={0}>
                <Text color={wrapper.isLiveFormationWindow ? '$red10' : '$blue10'} fontSize="$2" fontWeight="900" textTransform="uppercase">
                  {wrapper.isLiveFormationWindow ? 'Formazione live' : 'Prossima sfida'}
                </Text>
                <H2 color="$color12" fontSize="$7" lineHeight="$7">{wrapper.game.home} vs {wrapper.game.away}</H2>
                <Text color="$color9">Giornata fanta {wrapper.fantasyDay} · Serie A {wrapper.serieADay}ª</Text>
              </YStack>
            </XStack>
            <StatusPill tone={wrapper.isLiveFormationWindow ? 'red' : wrapper.canEdit ? 'green' : 'yellow'}>
              {wrapper.isLiveFormationWindow ? `${liveChangesRemaining ?? 0} cambi rimasti` : wrapper.canEdit ? 'Turno futuro' : 'Giornata iniziata'}
            </StatusPill>
          </XStack>
          {wrapper.isLiveFormationWindow ? (
            <YStack marginTop="$3" gap="$1.5">
              <Paragraph size="$2" color="$red11" maxWidth={860}>
                Il salvataggio modifica esclusivamente la TeamDay della giornata corrente. Ogni modifica valida deve essere uno scambio tra due giocatori e consuma un cambio.
              </Paragraph>
              <Text size="$2" color="$color9">
                Modulo {wrapper.allowLiveModuleChange ? 'modificabile' : 'bloccato'}
                {wrapper.liveFormationDeadline ? ` · finestra fino alle ${new Date(wrapper.liveFormationDeadline).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : ''}
              </Text>
            </YStack>
          ) : (
            <Paragraph marginTop="$3" size="$2" color="$color9" maxWidth={820}>
              Modifichi la squadra corrente. Le TeamDay già congelate restano immutabili; l’Action assegna il commit alla giornata valida in base al timestamp.
            </Paragraph>
          )}
        </Surface>
      ) : null}

      {team ? (
        <>
          <Surface accent={validation?.valid === false ? 'yellow' : 'neutral'} padding="$5">
            <YStack gap="$4">
              <XStack justifyContent="space-between" gap="$4" flexWrap="wrap" alignItems="flex-start">
                <YStack gap="$1" flex={1} minWidth={240}>
                  <Text color="$color8" fontSize="$2" fontWeight="900" textTransform="uppercase">Squadra</Text>
                  <Text color="$color12" fontSize="$7" fontWeight="900">{team.name}</Text>
                  <Text color="$color9">{team.owner}</Text>
                </YStack>
                <StatusPill tone={validation?.valid === false ? 'yellow' : 'green'}>
                  {validation?.valid === false ? 'Da sistemare' : 'Formazione valida'}
                </StatusPill>
              </XStack>

              <FormationSummary players={activePlayers} positions={positions} />

              {validation?.valid === false ? (
                <Paragraph color="$yellow11">{validation.errors[0]}</Paragraph>
              ) : null}

              <XStack gap="$2" flexWrap="wrap">
                <Button
                  borderRadius="$4"
                  backgroundColor="$purple3"
                  borderColor="$purple6"
                  color="$purple11"
                  disabled={saving || automaticLoading || wrapper?.isLiveFormationWindow === true}
                  icon={automaticLoading ? undefined : Sparkles}
                  onPress={() => { void applyAutomaticProposal() }}
                >
                  {automaticLoading ? <Spinner /> : 'Proponi automaticamente'}
                </Button>
                {automaticBackup ? (
                  <Button
                    variant="outlined"
                    borderRadius="$4"
                    disabled={saving || automaticLoading}
                    icon={RotateCcw}
                    onPress={restoreAutomaticBackup}
                  >
                    Ripristina precedente
                  </Button>
                ) : null}
              </XStack>
              <Paragraph size="$2" color="$color9" maxWidth={850}>
                {wrapper?.isLiveFormationWindow
                  ? 'Durante il live la proposta automatica è disabilitata: valgono soltanto gli scambi consentiti dalla regola annuale.'
                  : 'La proposta automatica resta sul dispositivo finché non salvi. Usa probabilità, indisponibilità, forma recente e difficoltà casa/avversario mantenendo la logica Fantasoccer.'}
              </Paragraph>
            </YStack>
          </Surface>

          {ROLE_ORDER.map(role => {
            const players = activePlayers.filter(player => player.role === role)
            if (players.length === 0) return null
            return (
              <YStack key={role} gap="$3">
                <XStack justifyContent="space-between" alignItems="center" gap="$3">
                  <YStack gap="$1">
                    <Text color="$color12" fontSize="$6" fontWeight="900">{roleLabel(role)}</Text>
                    <Text color="$color8" fontSize="$2">{players.length} giocatori disponibili</Text>
                  </YStack>
                  <StatusPill tone="neutral">{roleShortLabel(role)}</StatusPill>
                </XStack>
                <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
                  {players.map(player => (
                    <PlayerPositionCard
                      key={getPlayerKey(player.name)}
                      player={player}
                      value={positions[getPlayerKey(player.name)] ?? player.position}
                      disabled={saving || automaticLoading}
                      onChange={position => setPositions(current => ({ ...current, [getPlayerKey(player.name)]: position }))}
                    />
                  ))}
                </XStack>
              </YStack>
            )
          })}

          <Surface accent={validation?.valid === true ? 'blue' : 'yellow'} padding="$4">
            <XStack gap="$4" justifyContent="space-between" alignItems="center" flexWrap="wrap">
              <YStack gap="$1" flex={1} minWidth={240}>
                <Text color="$color12" fontWeight="900" fontSize="$5">
                  {validation?.valid === true ? 'Pronta da salvare' : 'Completa la formazione'}
                </Text>
                <Paragraph color="$color9" size="$2">
                  {wrapper?.isLiveFormationWindow
                    ? 'Il salvataggio live è immediato e richiede rete: il server GitHub deve verificare limite, scambio e modulo prima della scadenza.'
                    : 'Il salvataggio aggiorna la squadra corrente; in assenza di rete la modifica resta in coda offline e verrà rivalidata alla sincronizzazione.'}
                </Paragraph>
              </YStack>
              <PrimaryAction
                disabled={saving || automaticLoading || validation?.valid !== true || (wrapper?.isLiveFormationWindow === true && (liveChangesRemaining ?? 0) <= 0)}
                onPress={() => { void saveFormation() }}
                icon={saving ? <Spinner color="white" /> : <Save size="$1" color="white" />}
              >
                {saving ? 'Salvataggio…' : wrapper?.isLiveFormationWindow ? 'Salva modifica live' : 'Salva formazione'}
              </PrimaryAction>
            </XStack>
          </Surface>
        </>
      ) : null}
    </AppScreen>
  )
}

function PlayerPositionCard({
  player,
  value,
  disabled,
  onChange,
}: {
  player: Player
  value: FantaSoccerRole
  disabled: boolean
  onChange: (position: FantaSoccerRole) => void
}) {
  const options = positionOptions(player.role)
  const current = options.find(option => option.position === value)?.label ?? 'Tribuna'
  return (
    <YStack
      flexGrow={1}
      flexBasis={330}
      minWidth={270}
      maxWidth={560}
      padding="$4"
      borderWidth={1}
      borderColor={isStarterPosition(value) ? '$blue6' : '$color5'}
      backgroundColor={isStarterPosition(value) ? '$blue2' : '$color2'}
      borderRadius="$5"
      gap="$4"
    >
      <XStack gap="$3" alignItems="center">
        <PlayerAvatar name={player.name} />
        <YStack flex={1} minWidth={0} gap="$1">
          <Text color="$color12" fontWeight="900" fontSize="$5" numberOfLines={1}>{player.name}</Text>
          <Text color="$color9" numberOfLines={1}>{player.team.name} · {player.price}</Text>
        </YStack>
        <StatusPill tone={positionTone(value)}>{current}</StatusPill>
      </XStack>

      <XStack gap="$2" flexWrap="wrap">
        {options.map(option => {
          const selected = value === option.position
          return (
            <Button
              key={option.position}
              size="$3"
              borderRadius="$10"
              disabled={disabled}
              backgroundColor={selected ? '$blue4' : '$color3'}
              borderColor={selected ? '$blue8' : '$color5'}
              pressStyle={{ scale: 0.97 }}
              onPress={() => onChange(option.position)}
            >
              <Text color={selected ? '$blue11' : '$color10'} fontWeight="800">{option.label}</Text>
            </Button>
          )
        })}
      </XStack>
    </YStack>
  )
}

function PlayerAvatar({ name }: { name: string }) {
  const urls = getPlayerImageUrlFromName(name)
  const [source, setSource] = useState(urls.src)

  useEffect(() => {
    setSource(urls.src)
  }, [urls.src])

  return (
    <YStack
      width={58}
      height={58}
      borderRadius="$10"
      overflow="hidden"
      backgroundColor="$color4"
      borderWidth={1}
      borderColor="$color5"
    >
      <Image
        source={{ uri: source }}
        accessibilityLabel={name}
        onError={() => setSource(urls.fallback)}
        style={{ width: 58, height: 58 }}
      />
    </YStack>
  )
}

function FormationSummary({ players, positions }: { players: Player[]; positions: PositionState }) {
  const values = players.map(player => positions[getPlayerKey(player.name)] ?? player.position)
  const starters = values.filter(position => position >= FantaSoccerRole.GoalKeeper && position <= FantaSoccerRole.Forward).length
  const bench = values.filter(position => position >= FantaSoccerRole.BackupGoalKeeper && position <= FantaSoccerRole.SecondBackupForward).length
  const tribune = values.filter(position => position === FantaSoccerRole.Tribune).length

  return (
    <XStack gap="$2" flexWrap="wrap">
      <FormationMetric label="Titolari" value={starters} emphasized={starters === 11} />
      <FormationMetric label="Panchina" value={bench} emphasized={false} />
      <FormationMetric label="Tribuna" value={tribune} emphasized={false} />
      <FormationMetric label="Rosa attiva" value={players.length} emphasized={false} />
    </XStack>
  )
}

function FormationMetric({ label, value, emphasized }: { label: string; value: number; emphasized: boolean }) {
  return (
    <YStack
      flexGrow={1}
      flexBasis={120}
      minWidth={105}
      padding="$3"
      borderRadius="$4"
      backgroundColor={emphasized ? '$green3' : '$color3'}
      borderWidth={1}
      borderColor={emphasized ? '$green6' : '$color4'}
      gap="$1"
    >
      <Text color={emphasized ? '$green10' : '$color8'} fontSize="$1" fontWeight="900" textTransform="uppercase">{label}</Text>
      <Text color="$color12" fontSize="$7" fontWeight="900">{value}</Text>
    </YStack>
  )
}

function positionStateFromTeam(team: Team): PositionState {
  return Object.fromEntries(
    team.players
      .filter(player => player.status === PlayerInTeamStatus.Active)
      .map(player => [getPlayerKey(player.name), player.position]),
  ) as PositionState
}

function formationUpdates(players: Player[], positions: PositionState): FormationPositionUpdate[] {
  return players.map(player => ({
    playerKey: getPlayerKey(player.name),
    position: positions[getPlayerKey(player.name)] ?? player.position,
  }))
}

function positionOptions(role: Role): Array<{ position: FantaSoccerRole; label: string }> {
  switch (role) {
    case Role.GoalKeeper:
      return [
        { position: FantaSoccerRole.GoalKeeper, label: 'Titolare' },
        { position: FantaSoccerRole.BackupGoalKeeper, label: 'Riserva' },
        { position: FantaSoccerRole.Tribune, label: 'Tribuna' },
      ]
    case Role.Defensor:
      return [
        { position: FantaSoccerRole.Defensor, label: 'Titolare' },
        { position: FantaSoccerRole.FirstBackupDefensor, label: 'Riserva 1' },
        { position: FantaSoccerRole.SecondBackupDefensor, label: 'Riserva 2' },
        { position: FantaSoccerRole.Tribune, label: 'Tribuna' },
      ]
    case Role.Midfielder:
      return [
        { position: FantaSoccerRole.Midfielder, label: 'Titolare' },
        { position: FantaSoccerRole.FirstBackupMidfielder, label: 'Riserva 1' },
        { position: FantaSoccerRole.SecondBackupMidfielder, label: 'Riserva 2' },
        { position: FantaSoccerRole.Tribune, label: 'Tribuna' },
      ]
    case Role.Forward:
      return [
        { position: FantaSoccerRole.Forward, label: 'Titolare' },
        { position: FantaSoccerRole.FirstBackupForward, label: 'Riserva 1' },
        { position: FantaSoccerRole.SecondBackupForward, label: 'Riserva 2' },
        { position: FantaSoccerRole.Tribune, label: 'Tribuna' },
      ]
    default:
      return [{ position: FantaSoccerRole.Tribune, label: 'Tribuna' }]
  }
}

function isStarterPosition(position: FantaSoccerRole): boolean {
  return position >= FantaSoccerRole.GoalKeeper && position <= FantaSoccerRole.Forward
}

function positionTone(position: FantaSoccerRole): 'blue' | 'neutral' | 'yellow' {
  if (isStarterPosition(position)) return 'blue'
  if (position === FantaSoccerRole.Tribune) return 'neutral'
  return 'yellow'
}

const ROLE_ORDER = [Role.GoalKeeper, Role.Defensor, Role.Midfielder, Role.Forward] as const

function roleLabel(role: Role): string {
  switch (role) {
    case Role.GoalKeeper: return 'Portieri'
    case Role.Defensor: return 'Difensori'
    case Role.Midfielder: return 'Centrocampisti'
    case Role.Forward: return 'Attaccanti'
    default: return 'Giocatori'
  }
}

function roleShortLabel(role: Role): string {
  switch (role) {
    case Role.GoalKeeper: return 'P'
    case Role.Defensor: return 'D'
    case Role.Midfielder: return 'C'
    case Role.Forward: return 'A'
    default: return '—'
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Errore imprevisto durante la gestione della formazione.'
}
