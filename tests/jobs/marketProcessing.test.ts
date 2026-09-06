import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  FantaSoccerRole,
  IdentityRole,
  LeagueType,
  MarketStatus,
  MarketType,
  PlayerInTeamStatus,
  Role,
  type Group,
  type MarketCommand,
  type MarketWrapper,
  type Player,
  type Team,
} from '../../src/domain/src/index'
import {
  GROUP_DOCUMENT_PATH,
  marketCommandDocumentPath,
  marketDocumentPath,
  seasonTeamDocumentPath,
} from '../../src/github/src/index'
import { processGroupMarket } from '../../src/jobs/src/marketProcessing'

const SEASON = 15
const BUYER = 'buyer@example.com'
const SELLER = 'seller@example.com'

 test('processes an append-only command using its Git commit time and writes canonical teams/state/result', async () => {
  const root = await fixture(MarketType.WithoutVote)
  const command = createCommand()
  const commandPath = marketCommandDocumentPath('league', SEASON, command.id)
  await writeJson(join(root, commandPath), command)
  git(root, 'add', commandPath)
  commit(root, 'market command', '2026-09-06T10:00:00Z')

  const result = await processGroupMarket({ groupRepoRoot: root, season: SEASON, now: new Date('2026-09-06T12:00:00Z') })

  assert.equal(result.deferred, false)
  assert.equal(result.processedCommands, 1)
  assert.equal(result.appliedCommands, 1)
  assert.equal(result.changedTeams, 2)
  const processed = await readJson<MarketCommand>(join(root, commandPath))
  assert.equal(processed.status, 'applied')
  assert.equal(processed.result?.marketStatus, MarketStatus.Approved)
  assert.equal(processed.result?.processedAt, '2026-09-06T10:00:00.000Z')
  const state = await readJson<MarketWrapper>(join(root, marketDocumentPath('league', SEASON)))
  assert.equal(state.markets[0].creationTime, '2026-09-06T10:00:00.000Z')
  assert.equal(state.markets[0].status, MarketStatus.Approved)
  assert.equal((await readJson<Team>(join(root, seasonTeamDocumentPath('main', SEASON, BUYER)))).players[0].name, 'Seller Forward')
  assert.equal((await readJson<Team>(join(root, seasonTeamDocumentPath('main', SEASON, SELLER)))).players[0].name, 'Buyer Forward')
})

test('defers while RepositoryRevision is updating and preserves the pending command', async () => {
  const root = await fixture(MarketType.WithoutVote)
  const command = createCommand()
  const commandPath = marketCommandDocumentPath('league', SEASON, command.id)
  await writeJson(join(root, commandPath), command)
  await writeJson(join(root, 'manifest.json'), { schemaVersion: 2, revision: 2, updating: true })

  const result = await processGroupMarket({ groupRepoRoot: root, season: SEASON })

  assert.equal(result.deferred, true)
  assert.equal((await readJson<MarketCommand>(join(root, commandPath))).status, 'pending')
  await assert.rejects(readFile(join(root, marketDocumentPath('league', SEASON)), 'utf8'), /ENOENT/)
})

test('daily processing expires old pending markets without requiring a new command', async () => {
  const root = await fixture(MarketType.WithVote)
  const state: MarketWrapper = {
    markets: [{
      id: 'old', buyer: BUYER, seller: SELLER,
      buyerPlayers: [player('Buyer Forward', 10, FantaSoccerRole.Forward)],
      sellerPlayers: [player('Seller Forward', 20, FantaSoccerRole.FirstBackupForward)],
      moneyFromBuyer: 0, moneyFromSeller: 0,
      approvers: [BUYER, SELLER], deniers: [], status: MarketStatus.Pending,
      creationTime: '2026-08-20T12:00:00Z',
    }],
  }
  await writeJson(join(root, marketDocumentPath('league', SEASON)), state)

  const result = await processGroupMarket({ groupRepoRoot: root, season: SEASON, now: new Date('2026-09-06T12:00:00Z') })

  assert.equal(result.expiredMarkets, 1)
  assert.equal((await readJson<MarketWrapper>(join(root, marketDocumentPath('league', SEASON)))).markets[0].status, MarketStatus.Expired)
})

async function fixture(market: MarketType): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-market-'))
  git(root, 'init', '-b', 'main')
  git(root, 'config', 'user.name', 'Fantazone Test')
  git(root, 'config', 'user.email', 'fantazone-test@example.com')
  await writeJson(join(root, 'manifest.json'), { schemaVersion: 2, revision: 1, updating: false })
  await writeJson(join(root, GROUP_DOCUMENT_PATH), group(market))
  await writeJson(join(root, seasonTeamDocumentPath('main', SEASON, BUYER)), team(BUYER, player('Buyer Forward', 10, FantaSoccerRole.Forward)))
  await writeJson(join(root, seasonTeamDocumentPath('main', SEASON, SELLER)), team(SELLER, player('Seller Forward', 20, FantaSoccerRole.FirstBackupForward)))
  git(root, 'add', '.')
  commit(root, 'initialize', '2026-09-01T12:00:00Z')
  return root
}

function group(market: MarketType): Group {
  return {
    id: 'g', name: 'Group',
    users: [BUYER, SELLER].map(email => ({ username: email, email, role: IdentityRole.Participant })),
    baskets: [{ id: 'main', name: 'Main', years: [{ year: SEASON, teams: [BUYER, SELLER].map(email => ({ name: email, owner: email, additionalOwners: [] })) }] }],
    leagues: [{
      id: 'league', name: 'League', isMain: true, type: LeagueType.League, basketsId: ['main'],
      years: [{ year: SEASON, type: LeagueType.League, settings: { ...DefaultLeagueSetting, market } }],
    }],
  }
}

function createCommand(): MarketCommand {
  return {
    version: 1, id: 'command-1', kind: 'create', leagueId: 'league', season: SEASON,
    actor: BUYER, requestedAt: '1999-01-01T00:00:00Z', status: 'pending',
    create: { buyer: BUYER, seller: SELLER, buyerPlayerKeys: ['buyerforward'], sellerPlayerKeys: ['sellerforward'], moneyFromBuyer: 0, moneyFromSeller: 0 },
  }
}

function team(owner: string, onlyPlayer: Player): Team {
  return { name: owner, owner, additionalOwners: [], players: [onlyPlayer], moneyFromRank: 0, lastUpdate: null }
}

function player(name: string, price: number, position: FantaSoccerRole): Player {
  return { name, team: { name: 'Roma', abbreviation: 'ROM' }, role: Role.Forward, isActive: true, visible: true, price, revenue: price, status: PlayerInTeamStatus.Active, position }
}

function commit(root: string, message: string, at: string): void {
  execFileSync('git', ['commit', '-m', message], { cwd: root, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } })
}
function git(root: string, ...args: string[]): string { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim() }
async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T }
async function writeJson(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
