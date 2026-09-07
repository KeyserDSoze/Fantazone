import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { Role, type RealPlayers } from '../../src/domain/src/index'
import { realPlayersDocumentPath } from '../../src/github/src/index'
import {
  DEFAULT_PLAYER_IMAGES_API_BASE_URL,
  DEFAULT_PLAYER_IMAGES_MEDIA_BASE_URL,
  PLAYER_IMAGES_PUBLIC_ROOT,
  ingestPlayerImages,
  isWebp,
  playerImagePublicPath,
} from '../../src/jobs/src/playerImagesIngestion'

const SEASON = 15
const players: RealPlayers = {
  year: SEASON,
  players: [
    { name: 'Previous Image Player', team: { name: 'Roma', abbreviation: 'rom' }, role: Role.Forward, isActive: true, visible: true },
    { name: 'Current Image Player', team: { name: 'Milan', abbreviation: 'mil' }, role: Role.Defensor, isActive: true, visible: true },
  ],
}

const WEBP = Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 1, 2, 3])

function seasons() {
  return {
    seasons: [
      { seasonId: 'current-season', seasonName: '2026/2027' },
      { seasonId: 'previous-season', seasonName: '2025/2026' },
    ],
  }
}

function currentPageOne() {
  return {
    pagination: { totalPages: 2, currentPage: 1, isLastPage: false },
    players: [{
      shortName: 'Previous Image Player', displayName: 'Previous Image Player', role: 4,
      team: { shortName: 'Roma', officialName: 'Roma', acronymName: 'ROM' }, imagery: {},
    }],
  }
}

function currentPageTwo() {
  return {
    pagination: { totalPages: 2, currentPage: 2, isLastPage: true },
    players: [{
      shortName: 'Current Image Player', displayName: 'Current Image Player', role: 2,
      team: { shortName: 'Milan', officialName: 'Milan', acronymName: 'MIL' },
      imagery: { playerImage_home_middle: 'playerImages/current.webp' },
    }],
  }
}

function previousPage() {
  return {
    pagination: { totalPages: 1, currentPage: 1, isLastPage: true },
    players: [{
      shortName: 'Previous Image Player', displayName: 'Previous Image Player', role: 4,
      team: { shortName: 'Roma', officialName: 'Roma', acronymName: 'ROM' },
      imagery: { playerImage_home_middle: 'playerImages/previous.webp' },
    }],
  }
}

test('downloads current images and falls back to previous season catalog', async () => {
  const root = await fixtureRoot()
  const requestedJson: string[] = []
  const requestedImages: string[] = []
  const result = await ingestPlayerImages({
    season: SEASON,
    repoRoot: root,
    delayMs: 0,
    retryDelayMs: 0,
    fetchJson: async url => {
      requestedJson.push(url)
      if (url.includes('/competitions/')) return seasons()
      if (url.includes('current-season') && url.includes('page=1')) return currentPageOne()
      if (url.includes('current-season') && url.includes('page=2')) return currentPageTwo()
      if (url.includes('previous-season')) return previousPage()
      throw new Error(`unexpected ${url}`)
    },
    fetchBinary: async url => {
      requestedImages.push(url)
      return WEBP
    },
  })

  assert.equal(result.skipped, false)
  assert.equal(result.written, 2)
  assert.equal(result.failed, 0)
  assert.equal(result.previousCatalogUnavailable, false)
  assert.equal(requestedJson.some(url => url.includes('page=2')), true)
  assert.equal(requestedImages.length, 2)
  assert.equal(isWebp(await readFile(join(root, PLAYER_IMAGES_PUBLIC_ROOT, 'previousimageplayer.webp'))), true)
  assert.equal(isWebp(await readFile(join(root, PLAYER_IMAGES_PUBLIC_ROOT, 'currentimageplayer.webp'))), true)
})

test('retries a transient catalog-page failure', async () => {
  const root = await fixtureRoot()
  let pageTwoAttempts = 0
  const result = await ingestPlayerImages({
    season: SEASON,
    repoRoot: root,
    delayMs: 0,
    retryAttempts: 2,
    retryDelayMs: 0,
    fetchJson: async url => {
      if (url.includes('/competitions/')) return seasons()
      if (url.includes('current-season') && url.includes('page=1')) return currentPageOne()
      if (url.includes('current-season') && url.includes('page=2')) {
        pageTwoAttempts += 1
        if (pageTwoAttempts === 1) throw new Error('temporary provider failure')
        return currentPageTwo()
      }
      if (url.includes('previous-season')) return previousPage()
      throw new Error(`unexpected ${url}`)
    },
    fetchBinary: async () => WEBP,
  })

  assert.equal(pageTwoAttempts, 2)
  assert.equal(result.skipped, false)
  assert.equal(result.written, 2)
})

test('keeps the current catalog when previous-season fallback is unavailable', async () => {
  const root = await fixtureRoot()
  const result = await ingestPlayerImages({
    season: SEASON,
    repoRoot: root,
    delayMs: 0,
    retryAttempts: 1,
    retryDelayMs: 0,
    fetchJson: async url => {
      if (url.includes('/competitions/')) return seasons()
      if (url.includes('current-season') && url.includes('page=1')) return currentPageOne()
      if (url.includes('current-season') && url.includes('page=2')) return currentPageTwo()
      if (url.includes('previous-season')) throw new Error('previous season unavailable')
      throw new Error(`unexpected ${url}`)
    },
    fetchBinary: async () => WEBP,
  })

  assert.equal(result.skipped, false)
  assert.equal(result.previousCatalogUnavailable, true)
  assert.equal(result.written, 1)
  assert.equal(result.unmatched, 1)
  assert.equal(isWebp(await readFile(join(root, PLAYER_IMAGES_PUBLIC_ROOT, 'currentimageplayer.webp'))), true)
})

test('does not redownload an existing static image', async () => {
  const root = await fixtureRoot()
  const currentPath = join(root, PLAYER_IMAGES_PUBLIC_ROOT, 'currentimageplayer.webp')
  await writeBinary(currentPath, WEBP)
  let currentDownloads = 0

  const result = await ingestPlayerImages({
    season: SEASON,
    repoRoot: root,
    delayMs: 0,
    retryDelayMs: 0,
    fetchJson: fakeCatalogFetch,
    fetchBinary: async url => {
      if (url.includes('current.webp')) currentDownloads += 1
      return WEBP
    },
  })

  assert.equal(result.existing, 1)
  assert.equal(currentDownloads, 0)
})

test('continues when one image download fails and rejects non-WebP bytes', async () => {
  const root = await fixtureRoot()
  const result = await ingestPlayerImages({
    season: SEASON,
    repoRoot: root,
    delayMs: 0,
    retryAttempts: 1,
    retryDelayMs: 0,
    fetchJson: fakeCatalogFetch,
    fetchBinary: async url => {
      if (url.includes('previous.webp')) throw new Error('provider failed')
      return Uint8Array.from([1, 2, 3])
    },
  })
  assert.equal(result.written, 0)
  assert.equal(result.failed, 2)
})

test('missing or unavailable catalog does not modify existing static images', async () => {
  const root = await fixtureRoot()
  const existingPath = join(root, PLAYER_IMAGES_PUBLIC_ROOT, 'currentimageplayer.webp')
  await writeBinary(existingPath, WEBP)
  const before = await readFile(existingPath)

  const result = await ingestPlayerImages({
    season: SEASON,
    repoRoot: root,
    retryAttempts: 1,
    retryDelayMs: 0,
    fetchJson: async () => { throw new Error('offline') },
    fetchBinary: async () => { throw new Error('must not run') },
  })
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'season-catalog-unavailable')
  assert.deepEqual(await readFile(existingPath), before)
})

test('builds public canonical WebP URL from the exact legacy ASCII-only player key', () => {
  assert.equal(playerImagePublicPath("Nicolò D'Ambrosio"), '/images/players/nicoldambrosio.webp')
  assert.equal(isWebp(WEBP), true)
  assert.equal(DEFAULT_PLAYER_IMAGES_API_BASE_URL, 'https://api-sdp.legaseriea.it/v1/serie-a/football/')
  assert.equal(DEFAULT_PLAYER_IMAGES_MEDIA_BASE_URL, 'https://media-sdp.legaseriea.it/')
})

async function fakeCatalogFetch(url: string): Promise<unknown> {
  if (url.includes('/competitions/')) return seasons()
  if (url.includes('current-season') && url.includes('page=1')) return currentPageOne()
  if (url.includes('current-season') && url.includes('page=2')) return currentPageTwo()
  if (url.includes('previous-season')) return previousPage()
  throw new Error(`unexpected ${url}`)
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-images-'))
  await writeJson(join(root, realPlayersDocumentPath(SEASON)), players)
  return root
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeBinary(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}
