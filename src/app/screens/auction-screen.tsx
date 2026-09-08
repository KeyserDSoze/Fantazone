import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Gavel, RefreshCw, Wifi } from '@tamagui/lucide-icons-2'
import { Image } from 'react-native'
import { Button, Input, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
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
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
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
import { getPlayerImageUrlFromName } from '../utils/playerImage'

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

  useEffect(() => { setSubstitutedPlayerKey(null) }, [view?.currentRole, checkpoint?.kind])
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
          onSequenceGap: gap => setLastMessage(`Risincronizzazione: atteso #${gap.expectedSequence}, ricevuto #${gap.receivedSequence}.`),
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
      <AppScreen maxWidth={980}>
        <PageIntro
          eyebrow="Realtime"
          title="Asta"
          description={`Nessuna lega principale configurata per la stagione ${formatSeasonFromYear(season)}.`}
          action={<Button variant="outlined" borderRadius="$4" icon={ArrowLeft} onPress={onBack}>Torna al gruppo</Button>}
        />
        <Surface accent="yellow" padding="$5"><Paragraph color="$color10">Configura prima una lega principale per la stagione corrente.</Paragraph></Surface>
      </AppScreen>
    )
  }

  const selectedLeague = leagues.find(league => league.id === leagueId) ?? leagues[0]
  const connectionTone = mode === 'none' ? 'neutral' : realtimeReady ? 'green' : 'yellow'

  return (
    <AppScreen maxWidth={1220}>
      <PageIntro
        eyebrow="Realtime auction"
        title={`Asta · ${formatSeasonFromYear(season)}`}
        description={`${selectedLeague?.name ?? 'Lega'} · sessione WebRTC peer-to-peer con checkpoint GitHub durabili.`}
        action={(
          <XStack gap="$2" flexWrap="wrap">
            <Button variant="outlined" borderRadius="$4" icon={RefreshCw} onPress={() => { void refreshActiveAuction() }} disabled={loading || mode !== 'none'}>Aggiorna</Button>
            <Button variant="outlined" borderRadius="$4" icon={ArrowLeft} onPress={onBack}>Gruppo</Button>
          </XStack>
        )}
      />

      <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
        <XStack alignItems="center" gap="$2">
          <Wifi size="$1" color={realtimeReady ? '$green10' : '$color8'} />
          <StatusPill tone={connectionTone}>{connectionLabel}</StatusPill>
        </XStack>
        {checkpoint ? <StatusPill tone={checkpoint.status === AuctionStatus.Finished ? 'neutral' : checkpoint.status === AuctionStatus.Paused ? 'yellow' : 'blue'}>Sessione #{checkpoint.sequence}</StatusPill> : null}
      </XStack>

      {leagues.length > 1 ? (
        <Surface padding="$3">
          <XStack gap="$2" flexWrap="wrap" alignItems="center">
            <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Lega</Text>
            {leagues.map(league => (
              <Button
                key={league.id}
                size="$3"
                borderRadius="$10"
                disabled={mode !== 'none'}
                backgroundColor={league.id === leagueId ? '$blue4' : '$color3'}
                borderColor={league.id === leagueId ? '$blue7' : '$color5'}
                onPress={() => setLeagueId(league.id)}
              >
                <Text color={league.id === leagueId ? '$blue11' : '$color10'} fontWeight="800">{league.name}</Text>
              </Button>
            ))}
          </XStack>
        </Surface>
      ) : null}

      {error ? <Surface accent="red" padding="$3"><Paragraph color="$red11">{error}</Paragraph></Surface> : null}
      {lastMessage ? <Surface accent="blue" padding="$3"><Paragraph color="$blue11">{lastMessage}</Paragraph></Surface> : null}
      {loading && !checkpoint ? <YStack minHeight={180} alignItems="center" justifyContent="center"><Spinner size="large" /></YStack> : null}

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
          <AuctionStateHero
            checkpoint={checkpoint}
            view={view ?? liveViewFromCheckpoint(checkpoint)}
            remainingSeconds={remainingSeconds}
          />

          {mode === 'none' ? (
            <Surface accent="blue" padding="$5">
              <YStack gap="$4">
                <YStack gap="$1">
                  <Text color="$color12" fontSize="$6" fontWeight="900">Entra nella sessione</Text>
                  <Paragraph color="$color10">Partecipa come bidder oppure, se sei Admin, riattiva il ruolo host autoritativo.</Paragraph>
                </YStack>
                <XStack gap="$2" flexWrap="wrap">
                  <PrimaryAction onPress={() => { void joinAuction() }}>Partecipa all’asta</PrimaryAction>
                  {canHost ? <Button variant="outlined" borderRadius="$4" onPress={() => { void resumeHost() }}>Ospita / riprendi come Admin</Button> : null}
                </XStack>
              </YStack>
            </Surface>
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
            <HostControls checkpoint={checkpoint} actor={session.identity.email} onCommand={hostCommand} onArchive={archiveAuction} />
          ) : null}
        </>
      )}
    </AppScreen>
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
    <Surface accent="purple" padding="$6">
      <YStack gap="$5">
        <XStack alignItems="center" gap="$3">
          <YStack width={52} height={52} borderRadius="$5" backgroundColor="$purple4" alignItems="center" justifyContent="center">
            <Gavel size="$1.5" color="$purple10" />
          </YStack>
          <YStack flex={1} gap="$1">
            <Text color="$color12" fontSize="$7" fontWeight="900">Nessuna asta attiva</Text>
            <Paragraph color="$color10">I partecipanti vedranno automaticamente la sessione non appena un Admin la crea.</Paragraph>
          </YStack>
        </XStack>

        {props.canHost ? (
          <>
            <YStack gap="$2">
              <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Ordine giocatori</Text>
              <XStack gap="$2" flexWrap="wrap">
                {([
                  [AuctionType.Normal, 'Normale'],
                  [AuctionType.RandomByLetter, 'Lettera casuale'],
                  [AuctionType.RandomList, 'Lista casuale'],
                ] as const).map(([value, label]) => (
                  <ChoiceButton key={value} active={props.auctionType === value} label={label} onPress={() => props.onType(value)} tone="purple" />
                ))}
              </XStack>
            </YStack>
            <YStack gap="$2">
              <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Tipo asta</Text>
              <XStack gap="$2" flexWrap="wrap">
                <ChoiceButton active={props.auctionKind === AuctionKind.Starting} label="Iniziale" onPress={() => props.onKind(AuctionKind.Starting)} />
                <ChoiceButton active={props.auctionKind === AuctionKind.Repairing} label="Riparazione" onPress={() => props.onKind(AuctionKind.Repairing)} />
              </XStack>
            </YStack>
            <PrimaryAction disabled={props.loading} onPress={props.onCreate} icon={<Gavel size="$1" color="white" />}>Crea e ospita asta</PrimaryAction>
          </>
        ) : (
          <Paragraph color="$color9">Solo Admin e SuperAdmin possono creare una nuova sessione.</Paragraph>
        )}
      </YStack>
    </Surface>
  )
}

function AuctionStateHero({ checkpoint, view, remainingSeconds }: {
  checkpoint: AuctionCheckpoint
  view: AuctionLiveView
  remainingSeconds: number | null
}) {
  const timerValue = view.biddingStartedAt === null ? view.secondsPerAuction : remainingSeconds ?? view.secondsPerAuction
  const urgent = view.biddingStartedAt !== null && timerValue <= 3
  const playerImage = getPlayerImageUrlFromName(view.playerName)
  const statusTone = view.status === AuctionStatus.Finished ? 'neutral' : view.status === AuctionStatus.Paused ? 'yellow' : 'green'

  return (
    <Surface accent={urgent ? 'red' : 'blue'} padding="$6">
      <XStack gap="$5" alignItems="stretch" flexWrap="wrap">
        <YStack flexGrow={1} flexBasis={520} minWidth={280} gap="$4">
          <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
            <XStack gap="$2" flexWrap="wrap">
              <StatusPill tone={statusTone}>{statusLabel(view.status)}</StatusPill>
              <StatusPill tone="purple">{checkpoint.kind === AuctionKind.Starting ? 'Asta iniziale' : 'Riparazione'}</StatusPill>
              <StatusPill tone="blue">{roleLabel(view.currentRole)}</StatusPill>
            </XStack>
            <Text color="$color8" fontSize="$2" fontWeight="800">EVENTO #{view.sequence}</Text>
          </XStack>

          {view.playerName ? (
            <XStack gap="$4" alignItems="center">
              <Image
                source={{ uri: playerImage.src }}
                accessibilityLabel={view.playerName}
                style={{ width: 112, height: 112, borderRadius: 24, resizeMode: 'cover' }}
              />
              <YStack flex={1} minWidth={0} gap="$1">
                <Text color="$color12" fontSize="$9" lineHeight="$9" fontWeight="900" numberOfLines={2}>{view.playerName}</Text>
                <Text color="$color9" fontSize="$4">{view.playerTeam ?? 'Squadra Serie A'}</Text>
              </YStack>
            </XStack>
          ) : (
            <YStack minHeight={112} justifyContent="center" gap="$2">
              <Text color="$color12" fontSize="$7" fontWeight="900">In attesa del prossimo giocatore</Text>
              <Paragraph color="$color10">L’host può estrarre il prossimo giocatore dai controlli della sessione.</Paragraph>
            </YStack>
          )}

          <XStack gap="$3" flexWrap="wrap">
            <AuctionMetric label="Offerta" value={view.playerName ? String(view.price) : '—'} emphasized />
            <AuctionMetric label="Leader" value={view.ownerName ?? view.ownerEmail ?? '—'} />
            <AuctionMetric label="Timer base" value={`${view.secondsPerAuction}s`} />
          </XStack>
        </YStack>

        <YStack
          width={210}
          minHeight={210}
          alignItems="center"
          justifyContent="center"
          borderRadius="$6"
          backgroundColor={urgent ? '$red4' : view.biddingStartedAt ? '$blue4' : '$color3'}
          borderWidth={1}
          borderColor={urgent ? '$red7' : view.biddingStartedAt ? '$blue7' : '$color5'}
          gap="$1"
        >
          <Text color={urgent ? '$red11' : '$color9'} fontSize="$2" fontWeight="900" textTransform="uppercase">{view.biddingStartedAt ? 'Tempo rimasto' : 'Timer'}</Text>
          <Text color="$color12" fontSize={72} lineHeight={78} fontWeight="900">{timerValue}</Text>
          <Text color="$color9" fontWeight="800">secondi</Text>
          {view.biddingStartedAt === null ? <Text color="$color8" fontSize="$1">parte alla prima offerta</Text> : timerValue === 0 ? <Text color="$red11" fontSize="$1" fontWeight="900">HOST IN CHIUSURA</Text> : null}
        </YStack>
      </XStack>
    </Surface>
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
  function add(value: number) {
    const current = Number.parseInt(props.bidText, 10)
    props.onBidText(String((Number.isInteger(current) ? current : 0) + value))
  }

  return (
    <Surface accent="green" padding="$5">
      <YStack gap="$4">
        <YStack gap="$1">
          <Text color="$color12" fontSize="$6" fontWeight="900">Fai un’offerta</Text>
          <Paragraph color="$color10">L’offerta passa in realtime all’host; il checkpoint durabile viene scritto solo sui boundary previsti.</Paragraph>
        </YStack>
        <XStack gap="$2" alignItems="center" flexWrap="wrap">
          <Input width={160} size="$5" borderRadius="$4" keyboardType="number-pad" value={props.bidText} onChangeText={props.onBidText} />
          <Button size="$4" borderRadius="$10" variant="outlined" onPress={() => add(1)}>+1</Button>
          <Button size="$4" borderRadius="$10" variant="outlined" onPress={() => add(5)}>+5</Button>
          <Button size="$4" borderRadius="$10" variant="outlined" onPress={() => add(10)}>+10</Button>
          <PrimaryAction disabled={props.disabled} onPress={props.onBid} icon={<Gavel size="$1" color="white" />}>Offri</PrimaryAction>
        </XStack>

        {props.repairing ? (
          <YStack gap="$2">
            <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Giocatore da sostituire · opzionale</Text>
            {props.substitutionCandidates.length ? (
              <XStack gap="$2" flexWrap="wrap">
                <ChoiceButton active={props.substitutedPlayerKey === null} label="Nessuno" onPress={() => props.onSubstitution(null)} />
                {props.substitutionCandidates.map(player => {
                  const key = getPlayerKey(player.name)
                  return <ChoiceButton key={key} active={props.substitutedPlayerKey === key} label={player.name} onPress={() => props.onSubstitution(key)} tone="yellow" />
                })}
              </XStack>
            ) : <Paragraph color="$color9">Non hai giocatori attivi di questo ruolo da sostituire.</Paragraph>}
          </YStack>
        ) : null}
      </YStack>
    </Surface>
  )
}

function HostControls({ checkpoint, actor, onCommand, onArchive }: {
  checkpoint: AuctionCheckpoint
  actor: string
  onCommand: (command: AuctionCommand) => Promise<void>
  onArchive: () => Promise<void>
}) {
  const finished = checkpoint.status === AuctionStatus.Finished
  return (
    <Surface accent="yellow" padding="$5">
      <YStack gap="$5">
        <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
          <YStack gap="$1">
            <Text color="$color12" fontSize="$6" fontWeight="900">Console host</Text>
            <Paragraph color="$color10">Comandi autoritativi della sessione. Le assegnazioni e i cambi di stato vengono checkpointati su GitHub.</Paragraph>
          </YStack>
          <StatusPill tone="yellow">Admin host</StatusPill>
        </XStack>

        {!finished ? (
          <>
            <YStack gap="$2">
              <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Timer per giocatore</Text>
              <XStack gap="$2" flexWrap="wrap">
                {TIMER_PRESETS.map(seconds => (
                  <ChoiceButton
                    key={seconds}
                    active={checkpoint.secondsPerAuction === seconds}
                    label={`${seconds}s`}
                    onPress={() => { void onCommand(makeCommand(checkpoint.id, actor, { type: 'SET_TIMER', seconds })) }}
                    tone="yellow"
                  />
                ))}
              </XStack>
            </YStack>

            <YStack gap="$2">
              <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Estrai prossimo ruolo</Text>
              <XStack gap="$2" flexWrap="wrap">
                {auctionRoles().map(role => (
                  <Button key={role} borderRadius="$4" variant="outlined" onPress={() => { void onCommand(makeCommand(checkpoint.id, actor, { type: 'SHOW_PLAYER', role })) }}>
                    {ROLE_LABELS[role]}
                  </Button>
                ))}
              </XStack>
            </YStack>
          </>
        ) : null}

        <XStack gap="$2" flexWrap="wrap">
          {!finished ? (
            <>
              <Button borderRadius="$4" onPress={() => { void onCommand(makeCommand(checkpoint.id, actor, { type: 'ASSIGN_CURRENT' })) }}>Assegna giocatore</Button>
              <Button variant="outlined" borderRadius="$4" onPress={() => { void onCommand(makeCommand(checkpoint.id, actor, { type: 'CLOSE_CURRENT' })) }}>Chiudi senza assegnare</Button>
              {checkpoint.status === AuctionStatus.Paused ? (
                <Button variant="outlined" borderRadius="$4" onPress={() => { void onCommand(makeCommand(checkpoint.id, actor, { type: 'RESUME' })) }}>Riprendi</Button>
              ) : (
                <Button variant="outlined" borderRadius="$4" onPress={() => { void onCommand(makeCommand(checkpoint.id, actor, { type: 'PAUSE' })) }}>Pausa</Button>
              )}
              <Button borderRadius="$4" backgroundColor="$red9" borderColor="$red9" color="white" onPress={() => { void onCommand(makeCommand(checkpoint.id, actor, { type: 'FINISH' })) }}>Termina asta</Button>
            </>
          ) : (
            <>
              <Button variant="outlined" borderRadius="$4" onPress={() => { void onCommand(makeCommand(checkpoint.id, actor, { type: 'REOPEN' })) }}>Riapri asta</Button>
              <Button borderRadius="$4" backgroundColor="$red9" borderColor="$red9" color="white" onPress={() => { void onArchive() }}>Archivia e libera la lega</Button>
            </>
          )}
        </XStack>
      </YStack>
    </Surface>
  )
}

function ChoiceButton({ active, label, onPress, tone = 'blue' }: { active: boolean; label: string; onPress: () => void; tone?: 'blue' | 'purple' | 'yellow' }) {
  const background = !active ? '$color3' : tone === 'purple' ? '$purple4' : tone === 'yellow' ? '$yellow4' : '$blue4'
  const border = !active ? '$color5' : tone === 'purple' ? '$purple7' : tone === 'yellow' ? '$yellow7' : '$blue7'
  const color = !active ? '$color10' : tone === 'purple' ? '$purple11' : tone === 'yellow' ? '$yellow11' : '$blue11'
  return (
    <Button size="$3" borderRadius="$10" backgroundColor={background} borderColor={border} onPress={onPress}>
      <Text color={color} fontWeight="800">{active ? '✓ ' : ''}{label}</Text>
    </Button>
  )
}

function AuctionMetric({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <YStack flexGrow={1} flexBasis={150} minWidth={130} padding="$3" borderRadius="$4" backgroundColor={emphasized ? '$blue4' : '$color3'} borderWidth={1} borderColor={emphasized ? '$blue6' : '$color5'} gap="$1">
      <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">{label}</Text>
      <Text color="$color12" fontSize={emphasized ? '$7' : '$4'} fontWeight="900" numberOfLines={2}>{value}</Text>
    </YStack>
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
      return { ...next, biddingStartedAt: null, playerName: null, playerTeam: null, price: 0, ownerEmail: null, ownerName: null }
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

function createEphemeralId(prefix: string): string { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }
function auctionRoles(): Array<Role.GoalKeeper | Role.Defensor | Role.Midfielder | Role.Forward> { return [Role.GoalKeeper, Role.Defensor, Role.Midfielder, Role.Forward] }
function roleLabel(role: Role): string { return ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? 'Non definito' }
function statusLabel(status: AuctionStatus): string {
  switch (status) {
    case AuctionStatus.NotStarted: return 'Non iniziata'
    case AuctionStatus.Paused: return 'In pausa'
    case AuctionStatus.InProgress: return 'In corso'
    case AuctionStatus.Finished: return 'Terminata'
    default: return 'Sconosciuto'
  }
}
function toMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
