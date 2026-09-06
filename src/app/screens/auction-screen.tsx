import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, H1, H2, Input, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  AuctionKind,
  AuctionStatus,
  AuctionType,
  GroupHelper,
  IdentityRole,
  Role,
  createAuctionSignalingRoom,
  formatSeasonFromYear,
  getCurrentSeasonYear,
  getPlayerKey,
  isAuctionSignalingRoomExpired,
  type AuctionCheckpoint,
  type AuctionCommand,
  type AuctionEvent,
  type AuthenticatedGroupSession,
  type Player,
} from '@fantazone/domain'
import {
  BrowserAuctionHostConnectionCoordinator,
  BrowserAuctionParticipantConnectionCoordinator,
} from '../services/auctionBrowserConnection'
import { remainingAuctionSeconds } from '../services/auctionCountdown'
import { GroupAuctionRealtimeHostController } from '../services/auctionRealtimeSession'
import { createAuctionPlatformNegotiatorFactory } from '../services/auctionRtcPlatform'
import type { GroupAuctionHostSession } from '../services/groupAuctionHostSession'
import { GroupAuctionSetupService } from '../services/groupAuctionSetup'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  onBack: () => void
}

type ConnectionMode = 'none' | 'host' | 'participant'

type AuctionLiveView = {
  status: AuctionStatus
  sequence: number
  currentRole: Role
  secondsPerAuction: number
  biddingStartedAt: string | null
  playerName: string | null
  playerTeam: string | null
  price: number
  ownerEmail: string | null
  ownerName: string | null
}

const ROLE_LABELS: Record<Role.GoalKeeper | Role.Defensor | Role.Midfielder | Role.Forward, string> = {
  [Role.GoalKeeper]: 'Portieri',
  [Role.Defensor]: 'Difensori',
  [Role.Midfielder]: 'Centrocampisti',
  [Role.Forward]: 'Attaccanti',
}

const TIMER_PRESETS = [5, 10, 15, 20, 30] as const

export function AuctionScreen({ runtime, session, onBack }: Props) {
  const season = getCurrentSeasonYear()
  const group = runtime.group
  const leagues = useMemo(
    () => group.leagues.filter(league => league.isMain && league.years.some(year => year.year === season)),
    [group, season],
  )
  const [leagueId, setLeagueId] = useState(leagues[0]?.id ?? '')
  const [checkpoint, setCheckpoint] = useState<AuctionCheckpoint | null>(null)
  const [pointerSha, setPointerSha] = useState<string | null>(null)
  const [view, setView] = useState<AuctionLiveView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<ConnectionMode>('none')
  const [realtimeReady, setRealtimeReady] = useState(false)
  const [connectionLabel, setConnectionLabel] = useState('Non connesso')
  const [auctionType, setAuctionType] = useState<AuctionType>(AuctionType.Normal)
  const [auctionKind, setAuctionKind] = useState<AuctionKind>(AuctionKind.Starting)
  const [bidText, setBidText] = useState('1')
  const [myPlayers, setMyPlayers] = useState<Player[]>([])
  const [substitutedPlayerKey, setSubstitutedPlayerKey] = useState<string | null>(null)
  const [lastMessage, setLastMessage] = useState<string | null>(null)
  const [clockNow, setClockNow] = useState(() => Date.now())

  const hostConnection = useRef<BrowserAuctionHostConnectionCoordinator | null>(null)
  const participantConnection = useRef<BrowserAuctionParticipantConnectionCoordinator | null>(null)
  const realtimeHost = useRef<GroupAuctionRealtimeHostController | null>(null)
  const peerId = useRef(createEphemeralId('peer'))
  const setup = useMemo(() => new GroupAuctionSetupService(runtime), [runtime])
  const canHost = useMemo(() =>
    GroupHelper.hasRole(session.member, IdentityRole.Admin) ||
    GroupHelper.hasRole(session.member, IdentityRole.SuperAdmin), [session.member])

  useEffect(() => {
    void refreshActiveAuction()
    return () => closeRealtime(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, runtime])

  useEffect(() => {
    setSubstitutedPlayerKey(null)
  }, [view?.currentRole, checkpoint?.kind])

  useEffect(() => {
    if (!view?.playerName) return
    setBidText(String(Math.max(1, view.price + 1)))
  }, [view?.playerName, view?.price])

  useEffect(() => {
    if (!view?.biddingStartedAt) return
    setClockNow(Date.now())
    const timer = setInterval(() => setClockNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [view?.biddingStartedAt, view?.secondsPerAuction])

  const remainingSeconds = view
    ? remainingAuctionSeconds(view.biddingStartedAt, view.secondsPerAuction, new Date(clockNow))
    : null

  async function refreshActiveAuction() {
    if (!leagueId || mode !== 'none') return
    setLoading(true)
    setError(null)
    try {
      const active = await runtime.auctionDiscovery.getActiveAuction(leagueId, season, { refresh: true })
      const nextCheckpoint = active?.checkpoint.value ?? null
      setCheckpoint(nextCheckpoint)
      setPointerSha(active?.pointer.sha ?? null)
      setView(nextCheckpoint ? liveViewFromCheckpoint(nextCheckpoint) : null)
      await loadMyTeam(nextCheckpoint)
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  async function loadMyTeam(active: AuctionCheckpoint | null) {
    const selectedSeason = active?.leagueKey.year ?? season
    const basketId = GroupHelper.getBasketId(group, session.identity.email, selectedSeason)
    if (!basketId) {
      setMyPlayers([])
      return
    }
    const team = await runtime.teamRepository.getTeam(
      basketId,
      selectedSeason,
      session.identity.email,
      { refresh: true },
    )
    setMyPlayers(team?.players ?? [])
  }

  async function createAuction() {
    if (!leagueId || !canHost) return
    closeRealtime()
    setLoading(true)
    setError(null)
    setLastMessage(null)
    try {
      const created = await setup.createAuction({
        leagueId,
        season,
        creator: session.identity.email,
        type: auctionType,
        kind: auctionKind,
      })
      const nextCheckpoint = created.session.checkpoint
      setCheckpoint(nextCheckpoint)
      setView(liveViewFromCheckpoint(nextCheckpoint))
      const active = await runtime.auctionDiscovery.getActiveAuction(leagueId, season, { refresh: true })
      setPointerSha(active?.pointer.sha ?? null)
      await startHosting(created.session)
      await loadMyTeam(nextCheckpoint)
    } catch (caught) {
      closeRealtime()
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  async function resumeHost() {
    if (!checkpoint || !canHost) return
    closeRealtime()
    setLoading(true)
    setError(null)
    setLastMessage(null)
    try {
      const resumed = await setup.resumeAuction(checkpoint)
      const nextCheckpoint = resumed.session.checkpoint
      setCheckpoint(nextCheckpoint)
      setView(liveViewFromCheckpoint(nextCheckpoint))
      await startHosting(resumed.session)
    } catch (caught) {
      closeRealtime()
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  async function startHosting(authoritative: GroupAuctionHostSession) {
    const auction = authoritative.checkpoint
    let room = await runtime.auctionSignalingRepository.getRoom(auction.id)
    if (!room || isAuctionSignalingRoomExpired(room.value)) {
      room = {
        value: createAuctionSignalingRoom({
          auctionId: auction.id,
          sessionId: createEphemeralId('session'),
          hostPeerId: createEphemeralId('host'),
          hostEmail: session.identity.email,
        }),
        sha: '',
        fromCache: false,
      }
    } else if (room.value.hostEmail.toLowerCase() !== session.identity.email.toLowerCase()) {
      throw new Error(`La stanza è già ospitata da ${room.value.hostEmail}.`)
    }

    const realtime = new GroupAuctionRealtimeHostController(authoritative, session.identity.email)
    const coordinator = new BrowserAuctionHostConnectionCoordinator({
      repository: runtime.auctionSignalingRepository,
      room: room.value,
      realtime,
      negotiatorFactory: createAuctionPlatformNegotiatorFactory(),
      callbacks: {
        onOpen: () => setConnectionLabel('Host · peer connesso'),
        onClose: () => setConnectionLabel('Host · peer disconnesso'),
        onConnectionState: (_peer, state) => setConnectionLabel(`Host · ${state}`),
        onError: value => setError(value.message),
      },
    })
    realtimeHost.current = realtime
    hostConnection.current = coordinator
    setMode('host')
    setRealtimeReady(true)
    setConnectionLabel('Host · ricerca partecipanti')
    await coordinator.start()
  }

  async function joinAuction() {
    if (!checkpoint) return
    closeRealtime()
    setLoading(true)
    setError(null)
    setLastMessage(null)
    try {
      const room = await runtime.auctionSignalingRepository.getRoom(checkpoint.id)
      if (!room || isAuctionSignalingRoomExpired(room.value)) {
        throw new Error('L’host non ha ancora aperto una stanza WebRTC per questa asta.')
      }
      const coordinator = new BrowserAuctionParticipantConnectionCoordinator({
        repository: runtime.auctionSignalingRepository,
        room: room.value,
        peer: { peerId: peerId.current, email: session.identity.email },
        auctionId: checkpoint.id,
        checkpoint,
        negotiatorFactory: createAuctionPlatformNegotiatorFactory(),
        realtimeCallbacks: {
          onCheckpoint: value => {
            setCheckpoint(value)
            setView(liveViewFromCheckpoint(value))
          },
          onEvent: event => setView(current => applyAuctionEvent(current, event)),
          onCommandResult: result => setLastMessage(result.message ?? result.status),
          onSequenceGap: gap => setLastMessage(
            `Risincronizzazione: atteso #${gap.expectedSequence}, ricevuto #${gap.receivedSequence}.`,
          ),
        },
        callbacks: {
          onOpen: () => {
            setMode('participant')
            setRealtimeReady(true)
            setConnectionLabel('Partecipante · connesso')
          },
          onClose: () => {
            setRealtimeReady(false)
            setConnectionLabel('Partecipante · riconnessione…')
          },
          onConnectionState: (_peer, state) => {
            if (state !== 'connected') setRealtimeReady(false)
            setConnectionLabel(`Partecipante · ${state}`)
          },
          onError: value => setError(value.message),
        },
      })
      participantConnection.current = coordinator
      setMode('participant')
      setRealtimeReady(false)
      setConnectionLabel('Partecipante · connessione…')
      await coordinator.start()
      await loadMyTeam(checkpoint)
    } catch (caught) {
      closeRealtime()
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  async function hostCommand(command: AuctionCommand) {
    const controller = realtimeHost.current
    if (!controller) throw new Error('Sessione host non attiva.')
    setError(null)
    try {
      const result = await controller.dispatchHostCommand(command)
      setCheckpoint(result.checkpoint)
      setView(liveViewFromCheckpoint(result.checkpoint))
      setLastMessage(result.message ?? result.status)
    } catch (caught) {
      setError(toMessage(caught))
    }
  }

  async function archiveAuction() {
    if (!checkpoint || checkpoint.status !== AuctionStatus.Finished || !canHost) return
    setLoading(true)
    setError(null)
    try {
      const cleared = await runtime.auctionDiscovery.clearActiveAuction(
        checkpoint.leagueKey.league,
        checkpoint.leagueKey.year,
        pointerSha ? { expectedPointerSha: pointerSha } : {},
      )
      setPointerSha(cleared.sha)
      closeRealtime()
      setCheckpoint(null)
      setView(null)
      setLastMessage('Asta archiviata. Ora puoi crearne una nuova per questa lega.')
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  function sendBid() {
    if (!checkpoint || !view?.playerName) return
    if (mode === 'participant' && !realtimeReady) {
      setError('La connessione realtime non è ancora pronta.')
      return
    }
    const amount = Number.parseInt(bidText, 10)
    if (!Number.isInteger(amount) || amount < 1) {
      setError('Inserisci un’offerta intera positiva.')
      return
    }
    const command = makeCommand(checkpoint.id, session.identity.email, {
      type: 'PLACE_BID',
      amount,
      ...(substitutedPlayerKey ? { substitutedPlayerKey } : {}),
    })
    if (mode === 'host') {
      void hostCommand(command)
      return
    }
    try {
      participantConnection.current?.sendCommand(command)
    } catch (caught) {
      setError(toMessage(caught))
    }
  }

  function closeRealtime(updateUi = true) {
    hostConnection.current?.close()
    participantConnection.current?.close()
    hostConnection.current = null
    participantConnection.current = null
    realtimeHost.current = null
    if (updateUi) {
      setMode('none')
      setRealtimeReady(false)
      setConnectionLabel('Non connesso')
    }
  }

  const substitutionCandidates = useMemo(() => {
    if (checkpoint?.kind !== AuctionKind.Repairing || !view || view.currentRole === Role.Undefined) return []
    return myPlayers.filter(player => player.status === 0 && player.role === view.currentRole)
  }, [checkpoint?.kind, myPlayers, view?.currentRole])

  if (!leagues.length) {
    return (
      <YStack flex={1} padding="$5" gap="$4" maxWidth={980} width="100%" alignSelf="center">
        <Button alignSelf="flex-start" onPress={onBack}>← Gruppo</Button>
        <H1>Asta</H1>
        <Paragraph>Nessuna lega principale configurata per la stagione {formatSeasonFromYear(season)}.</Paragraph>
      </YStack>
    )
  }

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={980} alignSelf="center" padding="$5" gap="$4">
        <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
          <YStack gap="$1">
            <H1>Asta · {formatSeasonFromYear(season)}</H1>
            <Text color="$color10">{connectionLabel}</Text>
          </YStack>
          <XStack gap="$2">
            <Button onPress={refreshActiveAuction} disabled={loading || mode !== 'none'}>Aggiorna</Button>
            <Button onPress={onBack}>← Gruppo</Button>
          </XStack>
        </XStack>

        {leagues.length > 1 ? (
          <Card borderWidth={1} borderColor="$borderColor" padding="$3">
            <XStack gap="$2" flexWrap="wrap">
              {leagues.map(league => (
                <Button
                  key={league.id}
                  disabled={mode !== 'none'}
                  theme={league.id === leagueId ? 'accent' : undefined}
                  onPress={() => setLeagueId(league.id)}
                >
                  {league.name}
                </Button>
              ))}
            </XStack>
          </Card>
        ) : null}

        {error ? <Card borderWidth={1} borderColor="$red8" padding="$3"><Paragraph>{error}</Paragraph></Card> : null}
        {lastMessage ? <Paragraph size="$2" color="$color10">{lastMessage}</Paragraph> : null}
        {loading ? <Spinner size="large" /> : null}

        {!checkpoint ? (
          <CreateAuctionCard
            canHost={canHost}
            loading={loading}
            auctionType={auctionType}
            auctionKind={auctionKind}
            onType={setAuctionType}
            onKind={setAuctionKind}
            onCreate={createAuction}
          />
        ) : (
          <>
            <AuctionStateCard
              checkpoint={checkpoint}
              view={view ?? liveViewFromCheckpoint(checkpoint)}
              remainingSeconds={remainingSeconds}
            />

            {mode === 'none' ? (
              <Card borderWidth={1} borderColor="$borderColor" padding="$4">
                <YStack gap="$3">
                  <H2 size="$6">Entra nell’asta</H2>
                  <XStack gap="$2" flexWrap="wrap">
                    <Button theme="accent" onPress={joinAuction}>Partecipa</Button>
                    {canHost ? <Button onPress={resumeHost}>Ospita / riprendi come Admin</Button> : null}
                  </XStack>
                </YStack>
              </Card>
            ) : null}

            {view?.playerName && view.status !== AuctionStatus.Finished && mode !== 'none' ? (
              <BidCard
                bidText={bidText}
                onBidText={setBidText}
                onBid={sendBid}
                disabled={mode === 'participant' && !realtimeReady}
                repairing={checkpoint.kind === AuctionKind.Repairing}
                substitutionCandidates={substitutionCandidates}
                substitutedPlayerKey={substitutedPlayerKey}
                onSubstitution={setSubstitutedPlayerKey}
              />
            ) : null}

            {mode === 'host' && canHost ? (
              <HostControls
                checkpoint={checkpoint}
                actor={session.identity.email}
                onCommand={hostCommand}
                onArchive={archiveAuction}
              />
            ) : null}
          </>
        )}
      </YStack>
    </ScrollView>
  )
}

function CreateAuctionCard(props: {
  canHost: boolean
  loading: boolean
  auctionType: AuctionType
  auctionKind: AuctionKind
  onType: (value: AuctionType) => void
  onKind: (value: AuctionKind) => void
  onCreate: () => void
}) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" padding="$4">
      <YStack gap="$3">
        <H2 size="$6">Nessuna asta attiva</H2>
        <Paragraph>I partecipanti vedranno automaticamente l’asta quando un Admin la crea per questa lega.</Paragraph>
        {props.canHost ? (
          <>
            <Text fontWeight="700">Tipo ordinamento</Text>
            <XStack gap="$2" flexWrap="wrap">
              {([
                [AuctionType.Normal, 'Normale'],
                [AuctionType.RandomByLetter, 'Lettera casuale'],
                [AuctionType.RandomList, 'Lista casuale'],
              ] as const).map(([value, label]) => (
                <Button key={value} theme={props.auctionType === value ? 'accent' : undefined} onPress={() => props.onType(value)}>
                  {label}
                </Button>
              ))}
            </XStack>
            <Text fontWeight="700">Tipo asta</Text>
            <XStack gap="$2" flexWrap="wrap">
              <Button theme={props.auctionKind === AuctionKind.Starting ? 'accent' : undefined} onPress={() => props.onKind(AuctionKind.Starting)}>Iniziale</Button>
              <Button theme={props.auctionKind === AuctionKind.Repairing ? 'accent' : undefined} onPress={() => props.onKind(AuctionKind.Repairing)}>Riparazione</Button>
            </XStack>
            <Button theme="accent" disabled={props.loading} onPress={props.onCreate}>Crea e ospita asta</Button>
          </>
        ) : null}
      </YStack>
    </Card>
  )
}

function AuctionStateCard({ checkpoint, view, remainingSeconds }: {
  checkpoint: AuctionCheckpoint
  view: AuctionLiveView
  remainingSeconds: number | null
}) {
  const timerLabel = view.biddingStartedAt === null
    ? `${view.secondsPerAuction}s · parte alla prima offerta`
    : remainingSeconds === 0
      ? 'tempo scaduto · host in chiusura'
      : `${remainingSeconds ?? view.secondsPerAuction}s rimanenti`
  return (
    <Card borderWidth={1} borderColor="$blue8" padding="$4">
      <YStack gap="$2">
        <XStack justifyContent="space-between" gap="$3" flexWrap="wrap">
          <H2 size="$6">{view.playerName ?? 'In attesa del prossimo giocatore'}</H2>
          <Text fontWeight="700">#{view.sequence}</Text>
        </XStack>
        {view.playerTeam ? <Text color="$color10">{view.playerTeam}</Text> : null}
        <Text>Ruolo: {roleLabel(view.currentRole)}</Text>
        <Text>Prezzo: {view.price}</Text>
        <Text>Offerta migliore: {view.ownerName ?? view.ownerEmail ?? '—'}</Text>
        <Text>Timer: {timerLabel}</Text>
        <Text>Stato: {statusLabel(view.status)}</Text>
        <Text fontSize="$2" color="$color9">
          Asta {checkpoint.kind === AuctionKind.Starting ? 'iniziale' : 'di riparazione'} · {checkpoint.type === AuctionType.Normal ? 'ordine normale' : checkpoint.type === AuctionType.RandomByLetter ? 'lettera casuale' : 'lista casuale'}
        </Text>
      </YStack>
    </Card>
  )
}

function BidCard(props: {
  bidText: string
  onBidText: (value: string) => void
  onBid: () => void
  disabled: boolean
  repairing: boolean
  substitutionCandidates: Player[]
  substitutedPlayerKey: string | null
  onSubstitution: (key: string | null) => void
}) {
  return (
    <Card borderWidth={1} borderColor="$green8" padding="$4">
      <YStack gap="$3">
        <H2 size="$6">Fai un’offerta</H2>
        <XStack gap="$2" alignItems="center" flexWrap="wrap">
          <Input width={140} keyboardType="number-pad" value={props.bidText} onChangeText={props.onBidText} />
          <Button theme="accent" disabled={props.disabled} onPress={props.onBid}>Offri</Button>
        </XStack>
        {props.repairing ? (
          <YStack gap="$2">
            <Text fontWeight="700">Giocatore da sostituire (opzionale)</Text>
            {props.substitutionCandidates.length ? (
              <XStack gap="$2" flexWrap="wrap">
                <Button size="$3" theme={props.substitutedPlayerKey === null ? 'accent' : undefined} onPress={() => props.onSubstitution(null)}>Nessuno</Button>
                {props.substitutionCandidates.map(player => {
                  const key = getPlayerKey(player.name)
                  return (
                    <Button key={key} size="$3" theme={props.substitutedPlayerKey === key ? 'accent' : undefined} onPress={() => props.onSubstitution(key)}>
                      {player.name}
                    </Button>
                  )
                })}
              </XStack>
            ) : <Paragraph size="$2">Non hai giocatori attivi di questo ruolo da sostituire.</Paragraph>}
          </YStack>
        ) : null}
      </YStack>
    </Card>
  )
}

function HostControls({ checkpoint, actor, onCommand, onArchive }: {
  checkpoint: AuctionCheckpoint
  actor: string
  onCommand: (command: AuctionCommand) => Promise<void>
  onArchive: () => Promise<void>
}) {
  return (
    <Card borderWidth={1} borderColor="$yellow8" padding="$4">
      <YStack gap="$3">
        <H2 size="$6">Controlli host</H2>
        {checkpoint.status !== AuctionStatus.Finished ? (
          <>
            <YStack gap="$2">
              <Text fontWeight="700">Timer</Text>
              <XStack gap="$2" flexWrap="wrap">
                {TIMER_PRESETS.map(seconds => (
                  <Button
                    key={seconds}
                    size="$3"
                    theme={checkpoint.secondsPerAuction === seconds ? 'accent' : undefined}
                    onPress={() => onCommand(makeCommand(checkpoint.id, actor, { type: 'SET_TIMER', seconds }))}
                  >
                    {seconds}s
                  </Button>
                ))}
              </XStack>
            </YStack>
            <XStack gap="$2" flexWrap="wrap">
              {auctionRoles().map(role => (
                <Button key={role} onPress={() => onCommand(makeCommand(checkpoint.id, actor, { type: 'SHOW_PLAYER', role }))}>
                  Prossimo {ROLE_LABELS[role]}
                </Button>
              ))}
            </XStack>
          </>
        ) : null}
        <XStack gap="$2" flexWrap="wrap">
          {checkpoint.status !== AuctionStatus.Finished ? (
            <>
              <Button onPress={() => onCommand(makeCommand(checkpoint.id, actor, { type: 'ASSIGN_CURRENT' }))}>Assegna</Button>
              <Button onPress={() => onCommand(makeCommand(checkpoint.id, actor, { type: 'CLOSE_CURRENT' }))}>Chiudi giocatore</Button>
              {checkpoint.status === AuctionStatus.Paused ? (
                <Button onPress={() => onCommand(makeCommand(checkpoint.id, actor, { type: 'RESUME' }))}>Riprendi</Button>
              ) : (
                <Button onPress={() => onCommand(makeCommand(checkpoint.id, actor, { type: 'PAUSE' }))}>Pausa</Button>
              )}
              <Button theme="red" onPress={() => onCommand(makeCommand(checkpoint.id, actor, { type: 'FINISH' }))}>Termina asta</Button>
            </>
          ) : (
            <>
              <Button onPress={() => onCommand(makeCommand(checkpoint.id, actor, { type: 'REOPEN' }))}>Riapri</Button>
              <Button theme="red" onPress={onArchive}>Archivia e libera la lega</Button>
            </>
          )}
        </XStack>
      </YStack>
    </Card>
  )
}

function liveViewFromCheckpoint(checkpoint: AuctionCheckpoint): AuctionLiveView {
  const ownerEmail = checkpoint.current?.owner ?? null
  return {
    status: checkpoint.status,
    sequence: checkpoint.sequence,
    currentRole: checkpoint.current?.player.role ?? checkpoint.currentRole,
    secondsPerAuction: checkpoint.secondsPerAuction,
    biddingStartedAt: checkpoint.current?.biddingStartedAt ?? null,
    playerName: checkpoint.current?.player.name ?? null,
    playerTeam: checkpoint.current?.player.team.name ?? null,
    price: checkpoint.current?.price ?? 0,
    ownerEmail,
    ownerName: checkpoint.participants.find(item => item.owner.toLowerCase() === ownerEmail?.toLowerCase())?.teamName ?? null,
  }
}

function applyAuctionEvent(current: AuctionLiveView | null, event: AuctionEvent): AuctionLiveView {
  const base = current ?? {
    status: AuctionStatus.Paused,
    sequence: 0,
    currentRole: Role.GoalKeeper,
    secondsPerAuction: 10,
    biddingStartedAt: null,
    playerName: null,
    playerTeam: null,
    price: 0,
    ownerEmail: null,
    ownerName: null,
  }
  const next = { ...base, sequence: event.sequence }
  switch (event.type) {
    case 'PLAYER_SHOWN':
      return {
        ...next,
        status: AuctionStatus.InProgress,
        currentRole: Number(event.data.role) as Role,
        biddingStartedAt: null,
        playerName: String(event.data.playerName ?? ''),
        playerTeam: null,
        price: 0,
        ownerEmail: null,
        ownerName: null,
      }
    case 'BID_ACCEPTED':
      return {
        ...next,
        biddingStartedAt: event.hostTime,
        price: Number(event.data.amount ?? next.price),
        ownerEmail: String(event.data.bidderEmail ?? '') || null,
        ownerName: String(event.data.bidderName ?? '') || null,
      }
    case 'PLAYER_ASSIGNED':
    case 'CURRENT_CLOSED':
      return {
        ...next,
        biddingStartedAt: null,
        playerName: null,
        playerTeam: null,
        price: 0,
        ownerEmail: null,
        ownerName: null,
      }
    case 'ROLE_CHANGED':
      return { ...next, currentRole: Number(event.data.role) as Role }
    case 'TIMER_CHANGED':
      return { ...next, secondsPerAuction: Number(event.data.seconds ?? next.secondsPerAuction) }
    case 'STATUS_CHANGED':
      return { ...next, status: Number(event.data.status) as AuctionStatus }
    default:
      return next
  }
}

function makeCommand<T extends Omit<AuctionCommand, 'version' | 'commandId' | 'auctionId' | 'actor' | 'clientTime'>>(
  auctionId: string,
  actor: string,
  value: T,
): AuctionCommand {
  return {
    version: 1,
    commandId: createEphemeralId('cmd'),
    auctionId,
    actor,
    clientTime: Date.now(),
    ...value,
  } as AuctionCommand
}

function createEphemeralId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function auctionRoles(): Array<Role.GoalKeeper | Role.Defensor | Role.Midfielder | Role.Forward> {
  return [Role.GoalKeeper, Role.Defensor, Role.Midfielder, Role.Forward]
}

function roleLabel(role: Role): string {
  return ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? 'Non definito'
}

function statusLabel(status: AuctionStatus): string {
  switch (status) {
    case AuctionStatus.NotStarted: return 'Non iniziata'
    case AuctionStatus.Paused: return 'In pausa'
    case AuctionStatus.InProgress: return 'In corso'
    case AuctionStatus.Finished: return 'Terminata'
    default: return 'Sconosciuto'
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
