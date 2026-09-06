import {
  consumeAuctionEventSequence,
  type AuctionCheckpoint,
  type AuctionCommand,
  type AuctionEvent,
} from '@fantazone/domain'
import {
  GroupAuctionHostSession,
  type GroupAuctionDispatchResult,
} from './groupAuctionHostSession'

export type AuctionRealtimeCommandResultMessage = {
  version: 1
  type: 'command-result'
  commandId: string
  status: GroupAuctionDispatchResult['status']
  message: string | null
  sequence: number | null
}

export type AuctionRealtimeMessage =
  | { version: 1; type: 'command'; command: AuctionCommand }
  | AuctionRealtimeCommandResultMessage
  | { version: 1; type: 'event'; event: AuctionEvent }
  | { version: 1; type: 'checkpoint-request'; nextSequence: number }
  | { version: 1; type: 'checkpoint'; checkpoint: AuctionCheckpoint }

export interface AuctionRealtimeTextPeer {
  readonly peerId: string
  readonly email: string
  sendText(text: string): void
  close?(): void
}

export type AuctionRealtimePeerCallbacks = {
  onEvent?: (event: AuctionEvent) => void
  onCheckpoint?: (checkpoint: AuctionCheckpoint) => void
  onCommandResult?: (result: AuctionRealtimeCommandResultMessage) => void
  onSequenceGap?: (gap: { expectedSequence: number; receivedSequence: number }) => void
}

/**
 * Authoritative host-side DataChannel controller. It binds a signaling peer id to
 * one email and refuses command.actor spoofing before the domain reducer is called.
 */
export class GroupAuctionRealtimeHostController {
  private readonly peers = new Map<string, AuctionRealtimeTextPeer>()

  constructor(
    private readonly session: GroupAuctionHostSession,
    private readonly hostEmail: string,
  ) {}

  attachPeer(peer: AuctionRealtimeTextPeer): void {
    const peerId = required(peer.peerId, 'Peer id')
    const email = normalizeEmail(peer.email)
    if (!email.includes('@')) throw new Error('Peer email is not valid')
    const existing = this.peers.get(peerId)
    if (existing && normalizeEmail(existing.email) !== email) {
      throw new Error('Peer id is already attached to another identity')
    }
    this.peers.set(peerId, peer)
  }

  detachPeer(peerId: string): void {
    this.peers.delete(peerId)
  }

  close(): void {
    for (const peer of this.peers.values()) peer.close?.()
    this.peers.clear()
  }

  async dispatchHostCommand(command: AuctionCommand, at = new Date()): Promise<GroupAuctionDispatchResult> {
    if (normalizeEmail(command.actor) !== normalizeEmail(this.hostEmail)) {
      throw new Error('Host command actor does not match the host identity')
    }
    return this.dispatch(command, null, at)
  }

  async receivePeerText(peerId: string, text: string, at = new Date()): Promise<GroupAuctionDispatchResult | null> {
    const peer = this.peers.get(peerId)
    if (!peer) throw new Error(`Unknown auction realtime peer '${peerId}'`)
    const message = decodeAuctionRealtimeMessage(text)

    if (message.type === 'checkpoint-request') {
      peer.sendText(encodeAuctionRealtimeMessage({
        version: 1,
        type: 'checkpoint',
        checkpoint: this.session.checkpoint,
      }))
      return null
    }

    if (message.type !== 'command') throw new Error(`Peer cannot send '${message.type}' messages to the host`)
    if (message.command.auctionId !== this.session.checkpoint.id) {
      this.sendRejected(peer, message.command.commandId, 'Auction id does not match the active host session')
      return null
    }
    if (normalizeEmail(message.command.actor) !== normalizeEmail(peer.email)) {
      this.sendRejected(peer, message.command.commandId, 'Command actor does not match the connected peer identity')
      return null
    }
    return this.dispatch(message.command, peer, at)
  }

  private async dispatch(
    command: AuctionCommand,
    origin: AuctionRealtimeTextPeer | null,
    at: Date,
  ): Promise<GroupAuctionDispatchResult> {
    const result = this.session.dispatch(command, at)
    const resultMessage: AuctionRealtimeCommandResultMessage = {
      version: 1,
      type: 'command-result',
      commandId: command.commandId,
      status: result.status,
      message: result.message,
      sequence: result.event?.sequence ?? null,
    }
    origin?.sendText(encodeAuctionRealtimeMessage(resultMessage))

    if (result.event) {
      const eventText = encodeAuctionRealtimeMessage({ version: 1, type: 'event', event: result.event })
      for (const peer of this.peers.values()) peer.sendText(eventText)
    }

    // Realtime delivery happens first; durable boundaries are then checkpointed.
    // BID_ACCEPTED returns without touching GitHub.
    await this.session.persistDurableResult(result)
    return result
  }

  private sendRejected(peer: AuctionRealtimeTextPeer, commandId: string, message: string): void {
    peer.sendText(encodeAuctionRealtimeMessage({
      version: 1,
      type: 'command-result',
      commandId,
      status: 'rejected',
      message,
      sequence: null,
    }))
  }
}

/** Participant-side sequence/idempotency controller for one DataChannel. */
export class GroupAuctionRealtimePeerController {
  private nextSequence: number

  constructor(
    private readonly auctionId: string,
    private readonly peer: AuctionRealtimeTextPeer,
    private readonly callbacks: AuctionRealtimePeerCallbacks = {},
    checkpoint?: AuctionCheckpoint,
  ) {
    required(auctionId, 'Auction id')
    if (!normalizeEmail(peer.email).includes('@')) throw new Error('Peer email is not valid')
    this.nextSequence = checkpoint ? checkpoint.sequence + 1 : 1
  }

  get expectedSequence(): number {
    return this.nextSequence
  }

  sendCommand(command: AuctionCommand): void {
    if (command.auctionId !== this.auctionId) throw new Error('Command auction id does not match peer session')
    if (normalizeEmail(command.actor) !== normalizeEmail(this.peer.email)) {
      throw new Error('Command actor does not match peer identity')
    }
    this.peer.sendText(encodeAuctionRealtimeMessage({ version: 1, type: 'command', command }))
  }

  receiveText(text: string): void {
    const message = decodeAuctionRealtimeMessage(text)
    switch (message.type) {
      case 'event':
        this.consumeEvent(message.event)
        return
      case 'checkpoint':
        if (message.checkpoint.id !== this.auctionId) throw new Error('Checkpoint auction id does not match peer session')
        if (message.checkpoint.sequence + 1 >= this.nextSequence) {
          this.nextSequence = message.checkpoint.sequence + 1
          this.callbacks.onCheckpoint?.(cloneJson(message.checkpoint))
        }
        return
      case 'command-result':
        this.callbacks.onCommandResult?.({ ...message })
        return
      case 'command':
      case 'checkpoint-request':
        throw new Error(`Host cannot send '${message.type}' messages to a participant peer`)
    }
  }

  requestCheckpoint(): void {
    this.peer.sendText(encodeAuctionRealtimeMessage({
      version: 1,
      type: 'checkpoint-request',
      nextSequence: this.nextSequence,
    }))
  }

  private consumeEvent(event: AuctionEvent): void {
    if (event.auctionId !== this.auctionId) throw new Error('Event auction id does not match peer session')
    const cursor = consumeAuctionEventSequence(this.nextSequence, event)
    if (cursor.status === 'duplicate') return
    if (cursor.status === 'gap') {
      this.callbacks.onSequenceGap?.({
        expectedSequence: cursor.expectedSequence,
        receivedSequence: cursor.receivedSequence,
      })
      this.requestCheckpoint()
      return
    }
    this.nextSequence = cursor.nextSequence
    this.callbacks.onEvent?.(cloneJson(event))
  }
}

export function encodeAuctionRealtimeMessage(message: AuctionRealtimeMessage): string {
  validateAuctionRealtimeMessage(message)
  return JSON.stringify(message)
}

export function decodeAuctionRealtimeMessage(text: string): AuctionRealtimeMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error('Invalid auction realtime JSON message', { cause: error })
  }
  validateAuctionRealtimeMessage(parsed)
  return cloneJson(parsed)
}

function validateAuctionRealtimeMessage(value: unknown): asserts value is AuctionRealtimeMessage {
  if (!value || typeof value !== 'object') throw new Error('Auction realtime message must be an object')
  const message = value as Record<string, unknown>
  if (message.version !== 1 || typeof message.type !== 'string') throw new Error('Unsupported auction realtime message')

  switch (message.type) {
    case 'command': {
      const command = message.command as Partial<AuctionCommand> | undefined
      if (!command || typeof command !== 'object') throw new Error('Auction realtime command is missing')
      required(String(command.commandId ?? ''), 'Command id')
      required(String(command.auctionId ?? ''), 'Auction id')
      required(String(command.actor ?? ''), 'Command actor')
      if (typeof command.type !== 'string') throw new Error('Command type is required')
      return
    }
    case 'command-result':
      required(String(message.commandId ?? ''), 'Command id')
      if (!['accepted', 'rejected', 'duplicate'].includes(String(message.status))) throw new Error('Invalid command result status')
      if (message.message !== null && typeof message.message !== 'string') throw new Error('Invalid command result message')
      if (message.sequence !== null && (!Number.isInteger(message.sequence) || Number(message.sequence) < 1)) {
        throw new Error('Invalid command result sequence')
      }
      return
    case 'event': {
      const event = message.event as Partial<AuctionEvent> | undefined
      if (!event || typeof event !== 'object') throw new Error('Auction event is missing')
      required(String(event.auctionId ?? ''), 'Auction id')
      if (!Number.isInteger(event.sequence) || Number(event.sequence) < 1) throw new Error('Invalid auction event sequence')
      return
    }
    case 'checkpoint-request':
      if (!Number.isInteger(message.nextSequence) || Number(message.nextSequence) < 1) throw new Error('Invalid checkpoint request sequence')
      return
    case 'checkpoint': {
      const checkpoint = message.checkpoint as Partial<AuctionCheckpoint> | undefined
      if (!checkpoint || typeof checkpoint !== 'object') throw new Error('Auction checkpoint is missing')
      required(String(checkpoint.id ?? ''), 'Auction id')
      if (!Number.isInteger(checkpoint.sequence) || Number(checkpoint.sequence) < 0) throw new Error('Invalid checkpoint sequence')
      return
    }
    default:
      throw new Error(`Unsupported auction realtime message type '${message.type}'`)
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
