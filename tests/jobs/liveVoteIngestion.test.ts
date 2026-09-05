import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  Behaviour,
  Role,
  createEmptyVote,
  type RealCalendar,
  type VotedRealPlayers,
} from '../../src/domain/src/index'
import {
  realCalendarDocumentPath,
  serieAVoteDocumentPath,
} from '../../src/github/src/index'
import {
  DEFAULT_FANTACALCIO_SIGNED_URI_URL,
  buildLiveVoteResourceUri,
  decodeLiveVoteProtobuf,
  fetchLiveVotesFromProvider,
  ingestLiveVotes,
  mapLiveSourceGames,
  mergeLiveVoteDocuments,
  parseSignedUri,
  type LiveVoteHttpClient,
  type LiveVoteHttpRequest,
} from '../../src/jobs/src/liveVoteIngestion'

const YEAR = 15
const DAY = 1
const LIVE_NOW = new Date('2026-09-05T12:00:00Z')
const LIVE_DATE = '2026-09-05T11:00:00Z'

const protobufFixture = liveMessage([
  game({
    teamHome: 'Roma',
    teamAway: 'Milan',
    playersHome: [
      player({ name: 'mario rossi', position: 'A', vote: 7, events: [3, 3, 5, 1, 15, 26] }),
      player({ name: 'ignored', position: 'ALL', vote: 8, events: [] }),
    ],
    playersAway: [
      player({ name: 'luca bianchi', position: 'P', vote: 55, events: [4, 7, 14, 2] }),
    ],
  }),
])

test('decodes legacy live protobuf fields and maps vote events exactly', () => {
  const games = decodeLiveVoteProtobuf(protobufFixture)
  assert.equal(games.length, 1)
  const players = mapLiveSourceGames(games)
  assert.equal(players.length, 2)

  const forward = players.find(value => value.name === 'Mario rossi')!
  assert.equal(forward.team.name, 'Roma')
  assert.equal(forward.role, Role.Forward)
  assert.equal(forward.vote?.value, 7)
  assert.equal(forward.vote?.goal, 2)
  assert.equal(forward.vote?.assist, 1)
  assert.equal(forward.vote?.status, Behaviour.YellowCard)
  assert.equal(forward.vote?.isIn, true)
  assert.equal(forward.vote?.manOfTheMatch, true)
  assert.equal(forward.vote?.isFinal, false)

  const goalkeeper = players.find(value => value.name === 'Luca bianchi')!
  assert.equal(goalkeeper.role, Role.GoalKeeper)
  assert.equal(goalkeeper.vote?.hasVote, false)
  assert.equal(goalkeeper.vote?.value, 0)
  assert.equal(goalkeeper.vote?.sufferedGoal, 1)
  assert.equal(goalkeeper.vote?.stoppedPenalty, 1)
  assert.equal(goalkeeper.vote?.isOut, true)
  assert.equal(goalkeeper.vote?.status, Behaviour.RedCard)
})

test('requests SignedUri with the legacy resource season id and downloads the protobuf payload', async () => {
  const requests: LiveVoteHttpRequest[] = []
  const client: LiveVoteHttpClient = async request => {
    requests.push(request)
    if (request.method === 'POST') {
      return {
        status: 200,
        text: '{"request":{"resources":[{"signedUri":"https://cdn.test/live.dat"}],"errors":[]}}',
      }
    }
    return { status: 200, bytes: protobufFixture }
  }

  const players = await fetchLiveVotesFromProvider({ season: YEAR, serieADay: DAY, httpClient: client })
  assert.equal(players.length, 2)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].url, DEFAULT_FANTACALCIO_SIGNED_URI_URL)
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].headers.Origin, 'https://www.fantacalcio.it')
  assert.equal(requests[0].headers.Referer, 'https://www.fantacalcio.it/live-serie-a')
  assert.match(requests[0].headers['User-Agent'], /Mozilla/)
  assert.equal(
    JSON.parse(requests[0].body ?? '{}').resourcesUri[0],
    'https://api.fantacalcio.it/v1/st/21/matches/live/1.dat',
  )
  assert.equal(requests[1].url, 'https://cdn.test/live.dat')
})

test('Not Found or missing signedUri returns no live players and avoids the binary request', async () => {
  let requests = 0
  const notFound: LiveVoteHttpClient = async () => {
    requests += 1
    return { status: 200, text: '{"errors":[{"statusDescription":"Not Found"}]}' }
  }
  assert.deepEqual(await fetchLiveVotesFromProvider({ season: YEAR, serieADay: DAY, httpClient: notFound }), [])
  assert.equal(requests, 1)

  requests = 0
  const missing: LiveVoteHttpClient = async () => {
    requests += 1
    return { status: 200, text: '{"resources":[]}' }
  }
  assert.deepEqual(await fetchLiveVotesFromProvider({ season: YEAR, serieADay: DAY, httpClient: missing }), [])
  assert.equal(requests, 1)
  assert.equal(parseSignedUri('{"resources":[]}'), null)
})

test('live ingestion persists readable JSON and preserves stored player metadata while updating only Vote', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-live-votes-'))
  await writeJson(join(root, realCalendarDocumentPath(YEAR)), calendar(LIVE_DATE))
  const existing: VotedRealPlayers = {
    year: YEAR,
    serieADay: DAY,
    players: [{
      name: 'Mario rossi',
      team: { name: 'Roma', abbreviation: 'rom' },
      role: Role.Forward,
      isActive: true,
      visible: false,
      vote: { ...createEmptyVote(Role.Forward), value: 5, hasVote: true },
    }],
  }
  await writeJson(join(root, serieAVoteDocumentPath('live', YEAR, DAY)), existing)

  const requests: LiveVoteHttpRequest[] = []
  const client: LiveVoteHttpClient = async request => {
    requests.push(request)
    return request.method === 'POST'
      ? { status: 200, text: '{"request":{"signedUri":"https://cdn.test/live.dat"}}' }
      : { status: 200, bytes: protobufFixture }
  }

  const result = await ingestLiveVotes({
    repoRoot: root,
    season: YEAR,
    now: LIVE_NOW,
    httpClient: client,
  })

  assert.equal(result.skipped, false)
  assert.equal(result.written, true)
  assert.equal(result.incomingPlayers, 2)
  assert.equal(result.votes?.players.length, 2)
  const forward = result.votes?.players.find(value => value.name === 'Mario rossi')!
  assert.equal(forward.visible, false)
  assert.equal(forward.vote?.value, 7)
  assert.equal(forward.team.abbreviation, 'rom')
  assert.equal(result.votes?.players.find(value => value.name === 'Luca bianchi')?.team.abbreviation, 'mil')

  const persisted = JSON.parse(await readFile(join(root, serieAVoteDocumentPath('live', YEAR, DAY)), 'utf8'))
  assert.equal(persisted.players.length, 2)
  assert.equal(persisted.players[0].vote.isFinal, false)
  assert.equal('p' in persisted, false)
  assert.equal(requests.length, 2)
})

test('without explicit day live ingestion is a no-op when RealCalendar has no currently live game', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-live-skip-'))
  await writeJson(join(root, realCalendarDocumentPath(YEAR)), calendar('2026-08-22T18:45:00Z'))
  let requests = 0
  const result = await ingestLiveVotes({
    repoRoot: root,
    season: YEAR,
    now: LIVE_NOW,
    httpClient: async () => {
      requests += 1
      throw new Error('should not call provider')
    },
  })
  assert.equal(result.skipped, true)
  assert.equal(result.written, false)
  assert.equal(requests, 0)
})

test('mergeLiveVoteDocuments appends new players and updates only the vote of known legacy keys', () => {
  const existing: VotedRealPlayers = {
    year: YEAR,
    serieADay: DAY,
    players: [{
      name: 'Mario Rossi',
      team: { name: 'Roma', abbreviation: 'rom' },
      role: Role.Forward,
      isActive: true,
      visible: false,
      vote: { ...createEmptyVote(Role.Forward), value: 5, hasVote: true },
    }],
  }
  const incoming: VotedRealPlayers = {
    year: YEAR,
    serieADay: DAY,
    players: [
      {
        name: 'Mario rossi',
        team: { name: 'Other', abbreviation: 'oth' },
        role: Role.Forward,
        isActive: true,
        visible: true,
        vote: { ...createEmptyVote(Role.Forward), value: 7, hasVote: true },
      },
      {
        name: 'New Player',
        team: { name: 'Milan', abbreviation: 'mil' },
        role: Role.Midfielder,
        isActive: true,
        visible: true,
        vote: { ...createEmptyVote(Role.Midfielder), value: 6, hasVote: true },
      },
    ],
  }
  const merged = mergeLiveVoteDocuments(existing, incoming)
  assert.equal(merged.players.length, 2)
  const mario = merged.players.find(value => value.name === 'Mario Rossi')!
  assert.equal(mario.visible, false)
  assert.equal(mario.team.name, 'Roma')
  assert.equal(mario.vote?.value, 7)
})

test('buildLiveVoteResourceUri keeps the legacy internal-season plus six mapping', () => {
  assert.equal(
    buildLiveVoteResourceUri('https://api.fantacalcio.it/v1/st/', YEAR, 2),
    'https://api.fantacalcio.it/v1/st/21/matches/live/2.dat',
  )
})

function calendar(date: string): RealCalendar {
  return {
    year: YEAR,
    days: [{
      year: YEAR,
      serieADay: DAY,
      games: [{
        home: { name: 'Roma', abbreviation: 'rom' },
        away: { name: 'Milan', abbreviation: 'mil' },
        date,
        homeGoals: null,
        awayGoals: null,
        delayed: false,
      }],
    }],
  }
}

type SourcePlayer = { name: string; position: string; vote: number; events: number[] }
type SourceGame = { teamHome: string; teamAway: string; playersHome: Uint8Array[]; playersAway: Uint8Array[] }

function player(value: SourcePlayer): Uint8Array {
  return concat(
    stringField(2, value.name),
    stringField(3, value.position),
    doubleField(4, value.vote),
    packedVarintField(5, value.events),
  )
}

function game(value: SourceGame): Uint8Array {
  return concat(
    stringField(13, value.teamHome),
    stringField(14, value.teamAway),
    ...value.playersHome.map(value => messageField(15, value)),
    ...value.playersAway.map(value => messageField(16, value)),
  )
}

function liveMessage(games: Uint8Array[]): Uint8Array {
  return concat(...games.map(value => messageField(1, value)))
}

function messageField(field: number, bytes: Uint8Array): Uint8Array {
  return concat(tag(field, 2), varint(bytes.length), bytes)
}

function stringField(field: number, value: string): Uint8Array {
  return messageField(field, Buffer.from(value, 'utf8'))
}

function packedVarintField(field: number, values: number[]): Uint8Array {
  const packed = concat(...values.map(varint))
  return messageField(field, packed)
}

function doubleField(field: number, value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setFloat64(0, value, true)
  return concat(tag(field, 1), bytes)
}

function tag(field: number, wire: number): Uint8Array {
  return varint(field * 8 + wire)
}

function varint(value: number): Uint8Array {
  let current = BigInt(value)
  const bytes: number[] = []
  do {
    let byte = Number(current & 0x7fn)
    current >>= 7n
    if (current > 0n) byte |= 0x80
    bytes.push(byte)
  } while (current > 0n)
  return Uint8Array.from(bytes)
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
