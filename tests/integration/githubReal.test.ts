import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  FantaSoccerRole,
  IdentityRole,
  LeagueType,
  MarketStatus,
  PlayerInTeamStatus,
  Role,
  encodeSeasonTeamDocument,
  getPlayerKey,
  processMarketCommand,
  type Calendar,
  type Group,
  type MarketCommand,
  type Rank,
  type SeasonTeamDocument,
  type Team,
} from '../../src/domain/src/index'
import {
  GROUP_DOCUMENT_PATH,
  GROUP_RECALCULATION_WORKFLOW_PATH,
  GROUP_REPOSITORY_METADATA_PATH,
  GitHubApiError,
  GitHubCalendarRepository,
  GitHubClient,
  GitHubGroupRepository,
  GitHubJsonStore,
  GitHubMarketRepository,
  GitHubRankRepository,
  GitHubTeamRepository,
  REPOSITORY_MANIFEST_PATH,
  RepositoryRevisionContentClient,
  RepositoryWriteConflictError,
  dayTeamDocumentPath,
  ensureGroupInitialized,
  marketCommandDocumentPath,
  marketDocumentPath,
  seasonTeamDocumentPath,
  type GitHubRepo,
  type GroupRepositoryTarget,
  type RepositoryRevisionManifest,
} from '../../src/github/src/index'

const token = requiredEnv('FANTAZONE_TEST_PAT')
const repository = process.env.FANTAZONE_TEST_REPOSITORY?.trim() || 'KeyserDSoze/Fantazone.Test'
const [owner, repo, extra] = repository.split('/')
if (!owner || !repo || extra) throw new Error('FANTAZONE_TEST_REPOSITORY must be owner/repo')

const TEST_MARKER_PATH = '.fantazone-test.json'
const TEST_MARKER_CONTENT = `${JSON.stringify({
  version: 2,
  repository: 'KeyserDSoze/Fantazone.Test',
  purpose: 'Disposable real GitHub integration target for Fantazone',
  policy: 'Every real integration run resets main to this marker, creates a complete synthetic league from scratch, and leaves the final state inspectable in Git history.',
}, null, 2)}\n`

const season = 2026
const leagueId = 'integration-league'
const basketId = 'integration-basket'
const owners = [
  'alpha@fantazone.test',
  'beta@fantazone.test',
  'gamma@fantazone.test',
  'delta@fantazone.test',
] as const

const canaryLocation = { owner, repo, path: 'integration/github-json-store-canary.json' }

test('real Fantazone group lifecycle is reproducible, conflict-safe and atomically publishable', async t => {
  const client = new GitHubClient(token)
  const identity = await client.validateToken()
  assert.ok(identity.login)

  const metadata = await getIntegrationRepository(client)
  const branch = metadata.default_branch || 'main'
  const run = process.env.GITHUB_RUN_ID?.trim() || `local-${Date.now()}`
  await resetIntegrationRepository(token, owner, repo, branch, run)

  const target: GroupRepositoryTarget = { owner, repo, ref: branch }

  await t.test('starts clean and bootstraps the managed group runtime', async () => {
    assert.equal((await client.getContent(owner, repo, TEST_MARKER_PATH, branch)).content, TEST_MARKER_CONTENT)
    assert.equal(await client.tryGetContent(owner, repo, GROUP_DOCUMENT_PATH, branch), null)

    try {
      const result = await ensureGroupInitialized(client, metadata, 'Fantazone Integration League', {
        initialAdmin: { email: 'integration.admin@fantazone.test', username: 'Integration Admin' },
      })
      for (const path of [
        'manifest.json',
        GROUP_DOCUMENT_PATH,
        GROUP_RECALCULATION_WORKFLOW_PATH,
        GROUP_REPOSITORY_METADATA_PATH,
      ]) {
        assert.ok(result.createdFiles.includes(path), `${path} must be created from the clean tree`)
        assert.ok(await client.tryGetContent(owner, repo, path, branch), `${path} must exist after bootstrap`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes(GROUP_RECALCULATION_WORKFLOW_PATH)) {
        throw new Error(
          'FANTAZONE_TEST_PAT cannot install the managed Fantazone workflow. Grant the test token ' +
          'repository Workflows: Read and write in addition to Contents: Read and write.',
          { cause: error },
        )
      }
      throw error
    }
  })

  const revisionClient = new RepositoryRevisionContentClient(client, target)
  const store = new GitHubJsonStore(revisionClient)
  const groupRepository = new GitHubGroupRepository(store, target)
  const calendarRepository = new GitHubCalendarRepository(store, target)
  const rankRepository = new GitHubRankRepository(store, target)
  const teamRepository = new GitHubTeamRepository(store, target)
  const marketRepository = new GitHubMarketRepository(store, target)
  const group = createIntegrationGroup()
  const teams = createIntegrationTeams()

  await t.test('creates the league and publishes two-phase manifest revisions for canonical writes', async () => {
    const before = await readJsonFile<RepositoryRevisionManifest>(client, REPOSITORY_MANIFEST_PATH, branch)
    await groupRepository.writeGroup(group, `test: create integration league ${run}`)
    const after = await readJsonFile<RepositoryRevisionManifest>(client, REPOSITORY_MANIFEST_PATH, branch)

    assert.equal(after.revision, before.revision + 2)
    assert.equal(after.updating, false)
    assert.equal(revisionClient.lastRevision, after.revision)
    assert.deepEqual(await groupRepository.getGroup({ refresh: true }), group)
    assert.equal((await groupRepository.getLeagues()).length, 1)
    assert.equal((await groupRepository.getBaskets()).length, 1)
    assert.deepEqual(await groupRepository.getAvailableYears(), [season])
    assert.equal((await groupRepository.findUserByEmail('ALPHA@FANTAZONE.TEST'))?.username, 'Alpha')
  })

  await t.test('uses real GitHub ETags to reuse unchanged JSON on refresh', async () => {
    const etagStore = new GitHubJsonStore(client)
    const location = { ...target, path: GROUP_DOCUMENT_PATH }
    const first = await etagStore.readJson<Group>(location, { refresh: true })
    const second = await etagStore.readJson<Group>(location, { refresh: true })
    assert.equal(first.fromCache, false)
    assert.equal(second.fromCache, true)
    assert.equal(second.sha, first.sha)
    assert.deepEqual(second.value, first.value)
  })

  await t.test('persists normalized season teams and immutable create-only TeamDay snapshots', async () => {
    await teamRepository.writeTeam(basketId, season, owners[0], teams.get(owners[0])!, `test: seed Alpha ${run}`)
    await teamRepository.writeTeam(basketId, season, owners[1], teams.get(owners[1])!, `test: seed Beta ${run}`)

    const alpha = await readJsonFile<SeasonTeamDocument>(client, seasonTeamDocumentPath(basketId, season, owners[0]), branch)
    assert.equal(alpha.version, 3)
    assert.equal(alpha.owner, owners[0])
    assert.equal(alpha.players[0].playerKey, getPlayerKey('Alpha Forward'))
    assert.equal('team' in alpha.players[0], false)

    const daySnapshot = teams.get(owners[0])!
    await teamRepository.writeTeamDay(
      basketId,
      season,
      1,
      owners[0],
      daySnapshot,
      `test: freeze TeamDay ${run}`,
      { createOnly: true },
    )
    assert.deepEqual(await teamRepository.getTeamDay(basketId, season, 1, owners[0], { refresh: true }), daySnapshot)

    const freshTeamRepository = new GitHubTeamRepository(new GitHubJsonStore(client), target)
    await assert.rejects(
      freshTeamRepository.writeTeamDay(
        basketId,
        season,
        1,
        owners[0],
        { ...daySnapshot, name: 'Illegal overwrite' },
        `test: reject TeamDay overwrite ${run}`,
        { createOnly: true },
      ),
      error => error instanceof RepositoryWriteConflictError && error.status === 409,
    )
    assert.ok(await client.tryGetContent(owner, repo, dayTeamDocumentPath(basketId, season, 1, owners[0]), branch))
  })

  await t.test('writes and queries calendar plus season/day ranking through production repositories', async () => {
    const calendar = createIntegrationCalendar()
    const rank = createIntegrationRank()
    await calendarRepository.writeCalendar(leagueId, season, calendar, `test: seed calendar ${run}`)
    await rankRepository.writeRank(leagueId, season, rank, `test: seed ranking ${run}`)
    await rankRepository.writeDailyRank(leagueId, season, 1, rank, `test: seed daily ranking ${run}`)

    assert.deepEqual(await calendarRepository.getRoundKeys(leagueId, season), ['@'])
    assert.equal((await calendarRepository.getAllGames(leagueId, season)).length, 2)
    assert.equal((await calendarRepository.getPendingGames(leagueId, season)).length, 2)
    assert.equal((await calendarRepository.getGamesForTeam(leagueId, season, 'Alpha FC')).length, 1)
    assert.equal(await rankRepository.getCurrentSerieADay(leagueId, season), 1)
    assert.equal(await rankRepository.getRoundTeamCount(leagueId, season, '@'), 4)
    assert.equal(await rankRepository.getTeamPosition(leagueId, season, '@', owners[0]), 1)
    assert.equal((await rankRepository.getDailyRank(leagueId, season, 1, { refresh: true }))?.serieADay, 1)
  })

  await t.test('enforces create-only and optimistic SHA concurrency against the real repository', async () => {
    const writer = new GitHubJsonStore(client)
    const contender = new GitHubJsonStore(client)
    const baseline = await writer.writeJson(
      canaryLocation,
      { version: 2, run, phase: 'baseline' },
      `test: integration baseline ${run}`,
      { createOnly: true },
    )

    const duplicateWriter = new GitHubJsonStore(client)
    await assert.rejects(
      duplicateWriter.writeJson(
        canaryLocation,
        { version: 2, run, phase: 'duplicate-create' },
        `test: reject duplicate create ${run}`,
        { createOnly: true },
      ),
      error => error instanceof RepositoryWriteConflictError && error.status === 409,
    )

    const stale = await contender.readJson<{ version: number; run: string; phase: string }>(canaryLocation, { refresh: true })
    assert.equal(stale.sha, baseline.sha)
    const winner = await writer.writeJson(
      canaryLocation,
      { version: 2, run, phase: 'winner' },
      `test: integration winner ${run}`,
      { expectedSha: stale.sha },
    )
    await assert.rejects(
      contender.writeJson(
        canaryLocation,
        { version: 2, run, phase: 'stale-writer' },
        `test: stale integration writer ${run}`,
        { expectedSha: stale.sha },
      ),
      error => error instanceof RepositoryWriteConflictError && (error.status === 409 || error.status === 422),
    )
    const canonical = await writer.readJson<{ phase: string }>(canaryLocation, { refresh: true })
    assert.equal(canonical.sha, winner.sha)
    assert.equal(canonical.value.phase, 'winner')
  })

  await t.test('publishes market plus both changed teams as one CAS-protected Git transaction', async () => {
    const createCommand: MarketCommand = {
      version: 1,
      id: `market-${run}`,
      kind: 'create',
      leagueId,
      season,
      actor: owners[0],
      requestedAt: new Date().toISOString(),
      status: 'pending',
      create: {
        buyer: owners[0],
        seller: owners[1],
        buyerPlayerKeys: [getPlayerKey('Alpha Forward')],
        sellerPlayerKeys: [getPlayerKey('Beta Forward')],
        moneyFromBuyer: 0,
        moneyFromSeller: 0,
      },
    }

    const submittedCreateSha = await marketRepository.submitCommand(createCommand)
    const duplicateMarketRepository = new GitHubMarketRepository(new GitHubJsonStore(client), target)
    await assert.rejects(
      duplicateMarketRepository.submitCommand(createCommand),
      error => error instanceof RepositoryWriteConflictError && error.status === 409,
    )

    const created = processMarketCommand({
      group,
      leagueId,
      season,
      command: createCommand,
      market: { markets: [] },
      teams: new Map([
        [owners[0], { basketId, team: teams.get(owners[0])! }],
        [owners[1], { basketId, team: teams.get(owners[1])! }],
      ]),
      now: new Date(),
      currentSeason: season,
    })
    assert.equal(created.command.status, 'applied')
    assert.equal(created.market.markets[0].status, MarketStatus.Pending)
    assert.deepEqual(created.changedTeams, [])

    await store.writeJson(
      { ...target, path: marketDocumentPath(leagueId, season) },
      created.market,
      `test: persist pending market ${run}`,
      { createOnly: true },
    )
    await store.writeJson(
      { ...target, path: marketCommandDocumentPath(leagueId, season, createCommand.id) },
      created.command,
      `test: mark create command applied ${run}`,
      { expectedSha: submittedCreateSha },
    )

    const approvalCommand: MarketCommand = {
      version: 1,
      id: `approve-${run}`,
      kind: 'approve',
      leagueId,
      season,
      actor: owners[2],
      requestedAt: new Date().toISOString(),
      status: 'pending',
      marketId: createCommand.id,
    }
    await marketRepository.submitCommand(approvalCommand)

    const approved = processMarketCommand({
      group,
      leagueId,
      season,
      command: approvalCommand,
      market: created.market,
      teams: created.teams,
      now: new Date(),
      currentSeason: season,
    })
    assert.equal(approved.command.status, 'applied')
    assert.equal(approved.market.markets[0].status, MarketStatus.Approved)
    assert.deepEqual(new Set(approved.changedTeams), new Set([owners[0], owners[1]]))
    assert.equal(approved.teams.get(owners[0])?.team.players[0].name, 'Beta Forward')
    assert.equal(approved.teams.get(owners[1])?.team.players[0].name, 'Alpha Forward')

    const staleHead = await getBranchHead(token, owner, repo, branch)
    const staleManifest = await readJsonFile<RepositoryRevisionManifest>(client, REPOSITORY_MANIFEST_PATH, staleHead)
    await store.writeJson(
      { ...target, path: 'integration/transaction-race.json' },
      { version: 1, run, phase: 'branch-advanced' },
      `test: advance branch before stale transaction ${run}`,
      { createOnly: true },
    )

    await assert.rejects(
      commitFilesAtomically(
        token,
        owner,
        repo,
        branch,
        staleHead,
        marketTransactionFiles(approved, staleManifest),
        `test: stale atomic market transaction ${run}`,
      ),
      error => error instanceof GitHubApiError && (error.status === 409 || error.status === 422),
    )

    assert.equal(
      (await readJsonFile<{ markets: Array<{ status: MarketStatus }> }>(client, marketDocumentPath(leagueId, season), branch)).markets[0].status,
      MarketStatus.Pending,
    )
    assert.equal(
      (await readJsonFile<MarketCommand>(client, marketCommandDocumentPath(leagueId, season, approvalCommand.id), branch)).status,
      'pending',
    )
    assert.equal(
      (await readJsonFile<SeasonTeamDocument>(client, seasonTeamDocumentPath(basketId, season, owners[0]), branch)).players[0].playerKey,
      getPlayerKey('Alpha Forward'),
    )

    const currentHead = await getBranchHead(token, owner, repo, branch)
    const currentManifest = await readJsonFile<RepositoryRevisionManifest>(client, REPOSITORY_MANIFEST_PATH, currentHead)
    const transactionFiles = marketTransactionFiles(approved, currentManifest)
    const transaction = await commitFilesAtomically(
      token,
      owner,
      repo,
      branch,
      currentHead,
      transactionFiles,
      `test: atomic market transaction ${run}`,
    )

    assert.equal(transaction.parent, currentHead)
    assert.equal(await getBranchHead(token, owner, repo, branch), transaction.sha)
    assert.equal(
      (await readJsonFile<{ markets: Array<{ status: MarketStatus }> }>(client, marketDocumentPath(leagueId, season), transaction.sha)).markets[0].status,
      MarketStatus.Approved,
    )
    assert.equal(
      (await readJsonFile<SeasonTeamDocument>(client, seasonTeamDocumentPath(basketId, season, owners[0]), transaction.sha)).players[0].playerKey,
      getPlayerKey('Beta Forward'),
    )
    assert.equal(
      (await readJsonFile<SeasonTeamDocument>(client, seasonTeamDocumentPath(basketId, season, owners[1]), transaction.sha)).players[0].playerKey,
      getPlayerKey('Alpha Forward'),
    )
    assert.equal(
      (await readJsonFile<MarketCommand>(client, marketCommandDocumentPath(leagueId, season, approvalCommand.id), transaction.sha)).status,
      'applied',
    )
    const manifestAfter = await readJsonFile<RepositoryRevisionManifest>(client, REPOSITORY_MANIFEST_PATH, transaction.sha)
    assert.equal(manifestAfter.revision, currentManifest.revision + 1)
    assert.equal(manifestAfter.updating, false)

    const commit = await integrationRequest<{ tree: { sha: string }; parents: Array<{ sha: string }> }>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${transaction.sha}`,
    )
    assert.equal(commit.parents[0].sha, currentHead)
    const tree = await integrationRequest<{ tree: Array<{ path: string }> }>(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${commit.tree.sha}?recursive=1`,
    )
    const paths = new Set(tree.tree.map(entry => entry.path))
    for (const path of Object.keys(transactionFiles)) assert.ok(paths.has(path), `${path} must be in the transaction tree`)
  })
})

function createIntegrationGroup(): Group {
  return {
    id: 'integration-league',
    name: 'Fantazone Integration League',
    users: owners.map((email, index) => ({
      username: ['Alpha', 'Beta', 'Gamma', 'Delta'][index],
      email,
      role: index === 0
        ? IdentityRole.Participant | IdentityRole.Admin | IdentityRole.SuperAdmin
        : IdentityRole.Participant,
    })),
    baskets: [{
      id: basketId,
      name: 'Integration Basket',
      years: [{
        year: season,
        teams: owners.map((email, index) => ({
          name: ['Alpha FC', 'Beta FC', 'Gamma FC', 'Delta FC'][index],
          owner: email,
          additionalOwners: [],
        })),
      }],
    }],
    leagues: [{
      id: leagueId,
      name: 'Integration Championship',
      isMain: true,
      type: LeagueType.League,
      basketsId: [basketId],
      years: [{
        year: season,
        type: LeagueType.League,
        settings: { ...DefaultLeagueSetting, votes: { ...DefaultLeagueSetting.votes } },
      }],
    }],
  }
}

function createIntegrationTeams(): Map<string, Team> {
  const updatedAt = new Date().toISOString()
  return new Map<string, Team>([
    [owners[0], createTeam('Alpha FC', owners[0], 'Alpha Forward', 'Alpha Serie A', 'alf', 100, updatedAt)],
    [owners[1], createTeam('Beta FC', owners[1], 'Beta Forward', 'Beta Serie A', 'bet', 120, updatedAt)],
    [owners[2], createTeam('Gamma FC', owners[2], 'Gamma Forward', 'Gamma Serie A', 'gam', 80, updatedAt)],
    [owners[3], createTeam('Delta FC', owners[3], 'Delta Forward', 'Delta Serie A', 'del', 90, updatedAt)],
  ])
}

function createTeam(
  name: string,
  ownerEmail: string,
  playerName: string,
  realTeamName: string,
  abbreviation: string,
  price: number,
  lastUpdate: string,
): Team {
  return {
    name,
    owner: ownerEmail,
    additionalOwners: [],
    players: [{
      name: playerName,
      team: { name: realTeamName, abbreviation },
      role: Role.Forward,
      isActive: true,
      visible: true,
      price,
      revenue: 0,
      status: PlayerInTeamStatus.Active,
      position: FantaSoccerRole.Forward,
    }],
    moneyFromRank: 0,
    lastUpdate,
  }
}

function createIntegrationCalendar(): Calendar {
  return {
    year: season,
    rounds: {
      '@': [{
        serieADay: 1,
        number: 1,
        games: [
          { id: 'game-1', number: 1, home: 'Alpha FC', homeOwner: owners[0], away: 'Beta FC', awayOwner: owners[1], result: null },
          { id: 'game-2', number: 2, home: 'Gamma FC', homeOwner: owners[2], away: 'Delta FC', awayOwner: owners[3], result: null },
        ],
      }],
    },
  }
}

function createIntegrationRank(): Rank {
  return {
    serieADay: 1,
    rounds: {
      '@': owners.map((email, index) => ({
        name: ['Alpha FC', 'Beta FC', 'Gamma FC', 'Delta FC'][index],
        owner: email,
        point: 4 - index,
        victories: index === 0 ? 1 : 0,
        draws: index === 1 ? 1 : 0,
        defeats: index > 1 ? 1 : 0,
        goal: index === 0 ? 2 : 0,
        sufferedGoal: index > 1 ? 1 : 0,
        valuePoint: 70 - index,
        sufferedValuePoint: 60 + index,
        plusMoney: 0,
        money: 1000,
        valueAssets: 1000 - index,
      })),
    },
  }
}

function marketTransactionFiles(
  result: ReturnType<typeof processMarketCommand>,
  manifest: RepositoryRevisionManifest,
): Record<string, string> {
  const alpha = result.teams.get(owners[0])
  const beta = result.teams.get(owners[1])
  if (!alpha || !beta) throw new Error('Market transaction did not return both changed teams')
  return {
    [marketDocumentPath(leagueId, season)]: serializeJson(result.market),
    [seasonTeamDocumentPath(alpha.basketId, season, owners[0])]: serializeJson(encodeSeasonTeamDocument(alpha.team)),
    [seasonTeamDocumentPath(beta.basketId, season, owners[1])]: serializeJson(encodeSeasonTeamDocument(beta.team)),
    [marketCommandDocumentPath(leagueId, season, result.command.id)]: serializeJson(result.command),
    [REPOSITORY_MANIFEST_PATH]: serializeJson({
      ...manifest,
      revision: manifest.revision + 1,
      updatedAt: new Date().toISOString(),
      updating: false,
    }),
  }
}

async function getIntegrationRepository(client: GitHubClient): Promise<GitHubRepo> {
  try {
    const metadata = await client.getRepository(owner, repo)
    assert.equal(metadata.full_name.toLowerCase(), repository.toLowerCase())
    assert.equal(metadata.permissions?.push, true, `${repository} must grant push permission to the integration PAT`)
    return metadata
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new Error(
        `Integration repository ${repository} does not exist or is not visible to FANTAZONE_TEST_PAT. ` +
        'Create the dedicated repository and scope the fine-grained PAT to Contents: Read and write.',
      )
    }
    throw error
  }
}

async function readJsonFile<T>(client: GitHubClient, path: string, ref: string): Promise<T> {
  return JSON.parse((await client.getContent(owner, repo, path, ref)).content) as T
}

async function getBranchHead(
  accessToken: string,
  repositoryOwner: string,
  repositoryName: string,
  branch: string,
): Promise<string> {
  const ref = await integrationRequest<{ object: { sha: string } }>(
    accessToken,
    `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/git/ref/heads/${encodeURIComponent(branch)}`,
  )
  return ref.object.sha
}

type AtomicCommitResult = { sha: string; parent: string }

async function commitFilesAtomically(
  accessToken: string,
  repositoryOwner: string,
  repositoryName: string,
  branch: string,
  expectedHead: string,
  files: Record<string, string>,
  message: string,
): Promise<AtomicCommitResult> {
  const base = `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}`
  const parent = await integrationRequest<{ tree: { sha: string } }>(
    accessToken,
    `${base}/git/commits/${encodeURIComponent(expectedHead)}`,
  )
  const entries = await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const blob = await integrationRequest<{ sha: string }>(accessToken, `${base}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'utf-8' }),
    })
    return { path, mode: '100644', type: 'blob', sha: blob.sha }
  }))
  const tree = await integrationRequest<{ sha: string }>(accessToken, `${base}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: parent.tree.sha, tree: entries }),
  })
  const commit = await integrationRequest<{ sha: string }>(accessToken, `${base}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [expectedHead] }),
  })
  await integrationRequest(accessToken, `${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  })
  return { sha: commit.sha, parent: expectedHead }
}

async function resetIntegrationRepository(
  accessToken: string,
  repositoryOwner: string,
  repositoryName: string,
  branch: string,
  run: string,
): Promise<void> {
  const base = `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}`
  const ref = await integrationRequest<{ object: { sha: string } }>(
    accessToken,
    `${base}/git/ref/heads/${encodeURIComponent(branch)}`,
  )
  const blob = await integrationRequest<{ sha: string }>(accessToken, `${base}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: TEST_MARKER_CONTENT, encoding: 'utf-8' }),
  })
  const tree = await integrationRequest<{ sha: string }>(accessToken, `${base}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree: [{ path: TEST_MARKER_PATH, mode: '100644', type: 'blob', sha: blob.sha }] }),
  })
  const commit = await integrationRequest<{ sha: string }>(accessToken, `${base}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: `test: reset repository ${run}`, tree: tree.sha, parents: [ref.object.sha] }),
  })
  await integrationRequest(accessToken, `${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  })
}

async function integrationRequest<T = unknown>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  })
  if (!response.ok) throw new GitHubApiError(response.status, await response.text())
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for real GitHub integration tests`)
  return value
}
