import React, { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Save, Trophy } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
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
  type OpeningCompetitionStandings,
  type Player,
  type Team,
} from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import {
  getOpeningCompetitionTeam,
  prepareOpeningCompetition,
  saveOpeningCompetitionTeam,
} from '../services/groupOpeningCompetitionService'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  selection: GroupNavigationSelection
}

type PositionState = Record<string, FantaSoccerRole>

export function GroupOpeningCompetitionScreen({ runtime, session, selection }: Props) {
  const [standings, setStandings] = useState<OpeningCompetitionStandings | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [positions, setPositions] = useState<PositionState>({})
  const [day, setDay] = useState(1)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null
  const annual = selection.year != null ? league?.years.find(item => item.year === selection.year) ?? null : null
  const days = annual?.settings.openingCompetition?.serieADays ?? 0

  async function load(targetDay = day) {
    if (!selection.leagueId || selection.year == null) return
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      const data = await prepareOpeningCompetition(runtime, selection.leagueId, selection.year)
      setStandings(data)
      const actualDay = Math.min(Math.max(1, targetDay), data.serieADays)
      setDay(actualDay)
      const resolved = await getOpeningCompetitionTeam(runtime, session, selection.leagueId, selection.year, actualDay)
      setTeam(resolved.team)
      setPositions(stateFromTeam(resolved.team))
    } catch (caught) {
      setError(message(caught))
      setStandings(null)
      setTeam(null)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load(1) }, [runtime, session.identity.email, selection.leagueId, selection.year])

  const activePlayers = useMemo(() => team?.players.filter(player => player.status === PlayerInTeamStatus.Active) ?? [], [team])
  const preview = useMemo(() => team ? applyFormationPositions(team, updates(activePlayers, positions)) : null, [team, activePlayers, positions])
  const validation = useMemo(() => preview ? validateFormation(preview) : null, [preview])

  async function save() {
    if (!selection.leagueId || selection.year == null || !team || !preview) return
    const checked = validateFormation(preview)
    if (!checked.valid) { setError(checked.errors[0] ?? 'Formazione non valida.'); return }
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const saved = await saveOpeningCompetitionTeam(runtime, session, selection.leagueId, selection.year, day, updates(activePlayers, positions))
      setTeam(saved)
      setPositions(stateFromTeam(saved))
      setStandings(await prepareOpeningCompetition(runtime, selection.leagueId, selection.year))
      setStatus(`Formazione iniziale della giornata ${day} salvata e classifica ricalcolata.`)
    } catch (caught) { setError(message(caught)) }
    finally { setSaving(false) }
  }

  async function selectDay(nextDay: number) {
    setDay(nextDay)
    await load(nextDay)
  }

  return (
    <AppScreen maxWidth={1180}>
      <PageIntro
        eyebrow="Nuova stagione"
        title="Campionato iniziale"
        description={`${league?.name ?? 'Lega'}${selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}. Rose della stagione precedente, voti della nuova stagione e premi separati.`}
        action={<Button variant="outlined" borderRadius="$4" icon={loading ? undefined : RefreshCw} disabled={loading || saving} onPress={() => { void load() }}>{loading ? <Spinner /> : 'Aggiorna'}</Button>}
      />

      {error ? <Surface accent="red" padding="$3"><Paragraph color="$red11">{error}</Paragraph></Surface> : null}
      {status ? <Surface accent="green" padding="$3"><Paragraph color="$green11">{status}</Paragraph></Surface> : null}

      {standings ? (
        <Surface accent="yellow" padding="$5">
          <YStack gap="$4">
            <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
              <XStack gap="$2" alignItems="center"><Trophy color="$yellow10" /><Text color="$color12" fontSize="$6" fontWeight="900">Classifica iniziale</Text></XStack>
              <StatusPill tone="yellow">{standings.serieADays} giornate</StatusPill>
            </XStack>
            <YStack gap="$2">
              {standings.teams.map((entry, index) => {
                const position = standings.teams.filter(candidate => candidate.score > entry.score).length + 1
                return (
                  <XStack key={entry.owner} padding="$3" borderWidth={1} borderColor="$color5" borderRadius="$4" alignItems="center" gap="$3" flexWrap="wrap">
                    <Text width={34} color="$color10" fontWeight="900">{position}°</Text>
                    <YStack flex={1} minWidth={180}><Text color="$color12" fontWeight="900">{entry.name || entry.owner}</Text><Text color="$color8" fontSize="$2">{entry.owner}</Text></YStack>
                    <Text color="$color12" fontWeight="900">{entry.score.toFixed(2)} pt</Text>
                    <StatusPill tone={entry.prize > 0 ? 'green' : 'neutral'}>{entry.prize > 0 ? `+${entry.prize} crediti` : 'Nessun premio'}</StatusPill>
                  </XStack>
                )
              })}
            </YStack>
          </YStack>
        </Surface>
      ) : null}

      {team ? (
        <>
          <Surface accent="blue" padding="$5">
            <YStack gap="$4">
              <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
                <YStack gap="$1"><Text color="$color12" fontSize="$6" fontWeight="900">Formazione iniziale · {team.name}</Text><Paragraph color="$color9">Ogni giornata ha il proprio snapshot. Se non salvi, resta valida la rosa/formazione iniziale di fallback.</Paragraph></YStack>
                <StatusPill tone={validation?.valid === false ? 'yellow' : 'green'}>{validation?.valid === false ? 'Da sistemare' : 'Valida'}</StatusPill>
              </XStack>
              <XStack gap="$2" flexWrap="wrap">
                {Array.from({ length: standings?.serieADays ?? days }, (_, index) => index + 1).map(value => (
                  <Button key={value} size="$3" borderRadius="$10" backgroundColor={day === value ? '$blue4' : '$color3'} borderColor={day === value ? '$blue7' : '$color5'} disabled={loading || saving} onPress={() => { void selectDay(value) }}>
                    Giornata {value}
                  </Button>
                ))}
              </XStack>
              {validation?.valid === false ? <Paragraph color="$yellow11">{validation.errors[0]}</Paragraph> : null}
            </YStack>
          </Surface>

          {ROLE_ORDER.map(role => {
            const players = activePlayers.filter(player => player.role === role)
            if (!players.length) return null
            return (
              <Surface key={role} padding="$4">
                <YStack gap="$3">
                  <Text color="$color12" fontSize="$5" fontWeight="900">{roleLabel(role)}</Text>
                  {players.map(player => (
                    <YStack key={getPlayerKey(player.name)} gap="$2" padding="$3" borderWidth={1} borderColor="$color5" borderRadius="$4">
                      <XStack justifyContent="space-between" alignItems="center" gap="$2" flexWrap="wrap">
                        <YStack flex={1} minWidth={190}><Text color="$color12" fontWeight="900">{player.name}</Text><Text color="$color8" fontSize="$2">{slotLabel(positions[getPlayerKey(player.name)] ?? player.position)}</Text></YStack>
                        <XStack gap="$1.5" flexWrap="wrap">
                          {allowedPositions(player).map(position => (
                            <Button key={position} size="$2.5" borderRadius="$10" backgroundColor={(positions[getPlayerKey(player.name)] ?? player.position) === position ? '$blue4' : '$color3'} borderColor={(positions[getPlayerKey(player.name)] ?? player.position) === position ? '$blue7' : '$color5'} onPress={() => setPositions(current => ({ ...current, [getPlayerKey(player.name)]: position }))}>
                              <Text fontSize="$2">{shortSlotLabel(position)}</Text>
                            </Button>
                          ))}
                        </XStack>
                      </XStack>
                    </YStack>
                  ))}
                </YStack>
              </Surface>
            )
          })}

          <PrimaryAction disabled={saving || validation?.valid === false} icon={saving ? <Spinner /> : <Save size="$1" color="white" />} onPress={() => { void save() }}>
            {saving ? 'Salvataggio…' : `Salva giornata ${day}`}
          </PrimaryAction>
        </>
      ) : null}
    </AppScreen>
  )
}

const ROLE_ORDER = [Role.GoalKeeper, Role.Defensor, Role.Midfielder, Role.Forward] as const

function stateFromTeam(team: Team): PositionState {
  return Object.fromEntries(team.players.filter(player => player.status === PlayerInTeamStatus.Active).map(player => [getPlayerKey(player.name), player.position])) as PositionState
}

function updates(players: Player[], positions: PositionState): FormationPositionUpdate[] {
  return players.map(player => ({ playerKey: getPlayerKey(player.name), position: positions[getPlayerKey(player.name)] ?? player.position }))
}

function allowedPositions(player: Player): FantaSoccerRole[] {
  switch (player.role) {
    case Role.GoalKeeper: return [FantaSoccerRole.GoalKeeper, FantaSoccerRole.BackupGoalKeeper, FantaSoccerRole.Tribune]
    case Role.Defensor: return [FantaSoccerRole.Defensor, FantaSoccerRole.FirstBackupDefensor, FantaSoccerRole.SecondBackupDefensor, FantaSoccerRole.Tribune]
    case Role.Midfielder: return [FantaSoccerRole.Midfielder, FantaSoccerRole.FirstBackupMidfielder, FantaSoccerRole.SecondBackupMidfielder, FantaSoccerRole.Tribune]
    case Role.Forward: return [FantaSoccerRole.Forward, FantaSoccerRole.FirstBackupForward, FantaSoccerRole.SecondBackupForward, FantaSoccerRole.Tribune]
    default: return [FantaSoccerRole.Tribune]
  }
}

function roleLabel(role: Role): string {
  return role === Role.GoalKeeper ? 'Portieri' : role === Role.Defensor ? 'Difensori' : role === Role.Midfielder ? 'Centrocampisti' : 'Attaccanti'
}

function slotLabel(position: FantaSoccerRole): string {
  const labels: Partial<Record<FantaSoccerRole, string>> = {
    [FantaSoccerRole.GoalKeeper]: 'Titolare', [FantaSoccerRole.Defensor]: 'Titolare', [FantaSoccerRole.Midfielder]: 'Titolare', [FantaSoccerRole.Forward]: 'Titolare',
    [FantaSoccerRole.BackupGoalKeeper]: 'Riserva', [FantaSoccerRole.FirstBackupDefensor]: 'Prima riserva', [FantaSoccerRole.SecondBackupDefensor]: 'Seconda riserva',
    [FantaSoccerRole.FirstBackupMidfielder]: 'Prima riserva', [FantaSoccerRole.SecondBackupMidfielder]: 'Seconda riserva', [FantaSoccerRole.FirstBackupForward]: 'Prima riserva', [FantaSoccerRole.SecondBackupForward]: 'Seconda riserva',
    [FantaSoccerRole.Tribune]: 'Tribuna',
  }
  return labels[position] ?? 'Non schierato'
}

function shortSlotLabel(position: FantaSoccerRole): string {
  if (position <= FantaSoccerRole.Forward) return 'Titolare'
  if (position === FantaSoccerRole.Tribune) return 'Tribuna'
  if ([FantaSoccerRole.BackupGoalKeeper, FantaSoccerRole.FirstBackupDefensor, FantaSoccerRole.FirstBackupMidfielder, FantaSoccerRole.FirstBackupForward].includes(position)) return '1ª ris.'
  return '2ª ris.'
}

function message(error: unknown): string { return error instanceof Error ? error.message : 'Operazione non riuscita.' }
