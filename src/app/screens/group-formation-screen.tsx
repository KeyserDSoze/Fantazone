import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, H1, H2, H3, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  FantaSoccerRole,
  PlayerInTeamStatus,
  Role,
  applyFormationPositions,
  formatSeasonFromYear,
  getPlayerKey,
  validateFormation,
  type AuthenticatedGroupSession,
  type FormationPositionUpdate,
  type GameWrapper,
  type Player,
  type Team,
} from '@fantazone/domain'
import { resolveFormationTarget, type FormationTarget } from '../services/groupFormationTarget'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

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
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null

  async function loadFormation() {
    if (!selection.leagueId || selection.year == null) {
      setError('Seleziona una lega e una stagione per gestire la formazione.')
      setTarget(null)
      setWrapper(null)
      setTeam(null)
      return
    }

    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      const [calendar, realCalendar] = await Promise.all([
        runtime.calendarRepository.getCalendar(selection.leagueId, selection.year, { refresh: true }),
        runtime.realCalendarRepository.getCalendar(selection.year, { refresh: true }),
      ])
      if (!calendar) throw new Error('Il calendario della lega non è ancora disponibile.')

      const resolved = resolveFormationTarget({
        group: runtime.group,
        leagueId: selection.leagueId,
        season: selection.year,
        identityEmail: session.identity.email,
        calendar,
        realCalendar,
      })
      if (!resolved) throw new Error('Non hai una squadra o una partita disponibile nella lega selezionata.')

      const [game, currentTeam] = await Promise.all([
        runtime.gameComposer.getGame({ leagueId: selection.leagueId, season: selection.year, gameId: resolved.gameId }),
        runtime.teamRepository.getTeam(resolved.basketId, selection.year, resolved.owner, { refresh: true }),
      ])
      if (!game) throw new Error('La partita della formazione non è disponibile.')
      if (!currentTeam) throw new Error('La squadra corrente non è disponibile.')

      setTarget(resolved)
      setWrapper(game)
      setTeam(currentTeam)
      setPositions(positionStateFromTeam(currentTeam))
    } catch (caught) {
      setTarget(null)
      setWrapper(null)
      setTeam(null)
      setPositions({})
      setError(toMessage(caught))
    } finally {
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
      setStatus(`Formazione salvata sulla squadra corrente. La GitHub Action applicherà lo snapshot alla giornata corretta (Serie A ${saved.serieADay}ª).`)
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1040} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1">
            <H1>La mia formazione</H1>
            <Paragraph color="$color10">
              {league?.name ?? 'Lega'}{selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}
            </Paragraph>
          </YStack>
          <Button variant="outlined" disabled={loading || saving} onPress={() => { void loadFormation() }}>
            {loading ? <Spinner /> : 'Ricarica'}
          </Button>
        </XStack>

        {error ? <Card borderWidth={1} borderColor="$red8" padding="$4"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {status ? <Card borderWidth={1} borderColor="$green8" padding="$4"><Paragraph color="$green10">{status}</Paragraph></Card> : null}
        {loading && !team ? <Spinner size="large" /> : null}

        {wrapper && target ? (
          <Card borderWidth={1} borderColor="$borderColor" padding="$4">
            <YStack gap="$2">
              <XStack justifyContent="space-between" gap="$3" flexWrap="wrap">
                <YStack gap="$1">
                  <H2 size="$6">{wrapper.game.home} vs {wrapper.game.away}</H2>
                  <Text color="$color10">Giornata fanta {wrapper.fantasyDay} · Serie A {wrapper.serieADay}ª</Text>
                </YStack>
                <Text color={wrapper.canEdit ? '$green10' : '$yellow10'} fontWeight="700">
                  {wrapper.canEdit ? 'Turno futuro' : 'Giornata iniziata'}
                </Text>
              </XStack>
              <Paragraph size="$2" color="$color9">
                Modifichi sempre la Team corrente. Le TeamDay già congelate restano immutabili; il commit viene assegnato dall’Action alla giornata valida in base al suo timestamp.
              </Paragraph>
            </YStack>
          </Card>
        ) : null}

        {team ? (
          <>
            <Card borderWidth={1} borderColor={validation?.valid === false ? '$yellow8' : '$borderColor'} padding="$4">
              <YStack gap="$2">
                <H2 size="$6">{team.name}</H2>
                <Text color="$color10">Owner: {team.owner}</Text>
                <FormationSummary players={activePlayers} positions={positions} />
                {validation?.valid === false ? (
                  <Paragraph color="$yellow10">{validation.errors[0]}</Paragraph>
                ) : (
                  <Paragraph color="$green10">Formazione valida.</Paragraph>
                )}
              </YStack>
            </Card>

            {ROLE_ORDER.map(role => {
              const players = activePlayers.filter(player => player.role === role)
              if (players.length === 0) return null
              return (
                <YStack key={role} gap="$2">
                  <H3>{roleLabel(role)}</H3>
                  {players.map(player => (
                    <PlayerPositionRow
                      key={getPlayerKey(player.name)}
                      player={player}
                      value={positions[getPlayerKey(player.name)] ?? player.position}
                      disabled={saving}
                      onChange={position => setPositions(current => ({ ...current, [getPlayerKey(player.name)]: position }))}
                    />
                  ))}
                </YStack>
              )
            })}

            <Button
              theme="accent"
              size="$5"
              disabled={saving || validation?.valid !== true}
              onPress={() => { void saveFormation() }}
            >
              {saving ? <Spinner /> : 'Salva formazione'}
            </Button>
          </>
        ) : null}
      </YStack>
    </ScrollView>
  )
}

function PlayerPositionRow({
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
  return (
    <Card borderWidth={1} borderColor="$borderColor" padding="$3">
      <YStack gap="$2">
        <XStack justifyContent="space-between" alignItems="center" gap="$3">
          <YStack flex={1} minWidth={0}>
            <Text fontWeight="800" numberOfLines={1}>{player.name}</Text>
            <Text color="$color10" fontSize="$2" numberOfLines={1}>{player.team.name}</Text>
          </YStack>
          <Text color="$color10" fontSize="$2">{player.price}</Text>
        </XStack>
        <XStack gap="$2" flexWrap="wrap">
          {options.map(option => (
            <Button
              key={option.position}
              size="$2"
              variant="outlined"
              disabled={disabled}
              backgroundColor={value === option.position ? '$color4' : 'transparent'}
              borderColor={value === option.position ? '$blue8' : '$borderColor'}
              onPress={() => onChange(option.position)}
            >
              {option.label}
            </Button>
          ))}
        </XStack>
      </YStack>
    </Card>
  )
}

function FormationSummary({ players, positions }: { players: Player[]; positions: PositionState }) {
  const values = players.map(player => positions[getPlayerKey(player.name)] ?? player.position)
  const starters = values.filter(position => position >= FantaSoccerRole.GoalKeeper && position <= FantaSoccerRole.Forward).length
  const bench = values.filter(position => position >= FantaSoccerRole.BackupGoalKeeper && position <= FantaSoccerRole.SecondBackupForward).length
  const tribune = values.filter(position => position === FantaSoccerRole.Tribune).length
  return <Text color="$color10">Titolari {starters} · Panchina {bench} · Tribuna {tribune}</Text>
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

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Errore imprevisto durante la gestione della formazione.'
}
