import { gunzipSync, strFromU8 } from 'fflate'
import type { GroupConnection } from './groupSessionRuntime'
import { repositoryPersistentCache } from './repositoryPersistentCache'

export type OfflineSnapshotResult = {
  documents: number
  bytes: number
}

type GroupOfflinePack = {
  version: 1
  generatedAt: string
  sourceCommit: string
  files: Record<string, {
    sha: string
    value: unknown
    bytes: number
  }>
}

type PlatformPackIndex = {
  version: 1
  packs: Record<string, {
    url: string
    hash: string
    files: number
    bytes: number
  }>
}

type PlatformPack = {
  version: 1
  season: number
  files: Record<string, unknown>
}

type PlatformPackCacheMetadata = {
  hash: string
  paths: string[]
}

const PLATFORM_OWNER = 'KeyserDSoze'
const PLATFORM_REPO = 'Fantazone'
const PLATFORM_REF = 'main'
const PLATFORM_PACK_INDEX = '/offline/serie-a/index.json'
const PLATFORM_PACK_METADATA_PREFIX = '__offline__/serie-a-pack.v1/'
const GROUP_OFFLINE_PACK_PATH = '.fantazone/offline/group-snapshot.json.gz'
const CACHE_WRITE_BATCH_SIZE = 32

/**
 * Hydrates the durable repository cache from one compressed snapshot committed by
 * the group GitHub Action. This is intentionally not a browser-side git clone:
 * private repository archives redirect to codeload.github.com, which cannot be
 * fetched cross-origin from fanta.plus. The Contents API raw media type streams the
 * single private pack directly from api.github.com and therefore costs one API read
 * instead of one request per JSON blob.
 *
 * Offline hydration is an optimization. A missing/stale pack, rate limit or local
 * storage failure must never prevent an otherwise valid online group from opening.
 */
export async function hydrateRepositoryOfflineSnapshot(
  connection: GroupConnection,
  onProgress?: (detail: string) => void,
): Promise<OfflineSnapshotResult> {
  try {
    return await hydrateRepositoryOfflineSnapshotInternal(connection, onProgress)
  } catch (error) {
    console.warn('Fantazone offline snapshot refresh skipped', error)
    onProgress?.('Gruppo aperto. La copia offline verrà aggiornata automaticamente più tardi.')
    return { documents: 0, bytes: 0 }
  }
}

async function hydrateRepositoryOfflineSnapshotInternal(
  connection: GroupConnection,
  onProgress?: (detail: string) => void,
): Promise<OfflineSnapshotResult> {
  const owner = connection.repository.owner.login
  const repo = connection.repository.name
  const ref = connection.repository.default_branch
  const prefix = repositoryCachePrefix(owner, repo)

  onProgress?.('Scaricamento della copia compatta del gruppo…')
  const pack = await fetchGroupOfflinePack(connection)
  if (!pack) {
    onProgress?.('Copia offline in preparazione; il gruppo resta disponibile online.')
    return { documents: 0, bytes: 0 }
  }

  const entries = Object.entries(pack.files)
    .filter((entry): entry is [string, { sha: string; value: unknown; bytes: number }] => isValidGroupPackEntry(entry[0], entry[1]))
    .sort(([left], [right]) => left.localeCompare(right))

  for (let index = 0; index < entries.length; index += CACHE_WRITE_BATCH_SIZE) {
    const chunk = entries.slice(index, index + CACHE_WRITE_BATCH_SIZE)
    await Promise.all(chunk.map(([path, entry]) => repositoryPersistentCache.set(
      `${prefix}${path}@${ref}`,
      { value: entry.value, sha: entry.sha },
    )))
  }

  const preserveKeys = entries.map(([path]) => `${prefix}${path}@${ref}`)
  await repositoryPersistentCache.deleteByPrefix(prefix, preserveKeys)

  const group = pack.files['config/group.json']?.value
  const seasonIds = groupSeasonIds(group)
  if (seasonIds.length > 0) {
    await hydratePlatformSeasonPacks(seasonIds, onProgress)
  }

  const storedBytes = entries.reduce((sum, [, entry]) => sum + entry.bytes, 0)
  onProgress?.(`${entries.length} documenti del gruppo disponibili offline.`)
  return { documents: entries.length, bytes: storedBytes }
}

async function fetchGroupOfflinePack(connection: GroupConnection): Promise<GroupOfflinePack | null> {
  const owner = encodeURIComponent(connection.repository.owner.login)
  const repo = encodeURIComponent(connection.repository.name)
  const ref = encodeURIComponent(connection.repository.default_branch)
  const path = GROUP_OFFLINE_PACK_PATH.split('/').map(encodeURIComponent).join('/')
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`, {
    headers: {
      Accept: 'application/vnd.github.raw+json',
      Authorization: `Bearer ${connection.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  })

  if (response.status === 404) return null
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Copia offline del gruppo non disponibile (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`)
  }

  const compressed = new Uint8Array(await response.arrayBuffer())
  const decoded = JSON.parse(strFromU8(gunzipSync(compressed))) as GroupOfflinePack
  if (!isValidGroupOfflinePack(decoded)) throw new Error('Copia offline del gruppo non valida.')
  return decoded
}

function isValidGroupOfflinePack(value: unknown): value is GroupOfflinePack {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<GroupOfflinePack>
  if (candidate.version !== 1 || typeof candidate.generatedAt !== 'string' || typeof candidate.sourceCommit !== 'string') return false
  if (!candidate.files || typeof candidate.files !== 'object' || Array.isArray(candidate.files)) return false
  return Object.entries(candidate.files).every(([path, entry]) => isValidGroupPackEntry(path, entry))
}

function isValidGroupPackEntry(path: string, value: unknown): value is { sha: string; value: unknown; bytes: number } {
  if (!path || !path.toLowerCase().endsWith('.json') || !value || typeof value !== 'object') return false
  const candidate = value as { sha?: unknown; bytes?: unknown }
  return typeof candidate.sha === 'string' && candidate.sha.length > 0 &&
    typeof candidate.bytes === 'number' && Number.isFinite(candidate.bytes) && candidate.bytes >= 0 &&
    'value' in value
}

async function hydratePlatformSeasonPacks(
  seasons: readonly number[],
  onProgress?: (detail: string) => void,
): Promise<void> {
  onProgress?.('Controllo dei pacchetti Serie A necessari al gruppo…')
  const response = await fetch(PLATFORM_PACK_INDEX, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Pacchetti offline Serie A non disponibili (HTTP ${response.status}).`)
  const index = await response.json() as PlatformPackIndex
  if (index.version !== 1 || !index.packs || typeof index.packs !== 'object') {
    throw new Error('Indice dei pacchetti offline Serie A non valido.')
  }

  const unique = [...new Set(seasons)].sort((a, b) => a - b)
  for (let position = 0; position < unique.length; position += 1) {
    const season = unique[position]
    const descriptor = index.packs[String(season)]
    if (!descriptor) continue
    const metadataKey = `${PLATFORM_PACK_METADATA_PREFIX}${season}`
    const cachedMetadata = await repositoryPersistentCache.get(metadataKey)
    const previous = decodePackMetadata(cachedMetadata?.value)
    if (previous?.hash === descriptor.hash) continue

    onProgress?.(`Aggiornamento dati Serie A ${position + 1}/${unique.length}…`)
    const packResponse = await fetch(`${descriptor.url}?v=${encodeURIComponent(descriptor.hash)}`, { cache: 'no-store' })
    if (!packResponse.ok) throw new Error(`Pacchetto Serie A ${season} non disponibile (HTTP ${packResponse.status}).`)
    const decoded = JSON.parse(strFromU8(gunzipSync(new Uint8Array(await packResponse.arrayBuffer())))) as PlatformPack
    if (decoded.version !== 1 || decoded.season !== season || !decoded.files || typeof decoded.files !== 'object') {
      throw new Error(`Pacchetto Serie A ${season} non valido.`)
    }

    if (previous) {
      await Promise.all(previous.paths.map(path => repositoryPersistentCache.delete(platformCacheKey(path))))
    }
    const paths = Object.keys(decoded.files)
    for (let index = 0; index < paths.length; index += 32) {
      const chunk = paths.slice(index, index + 32)
      await Promise.all(chunk.map(path => repositoryPersistentCache.set(
        platformCacheKey(path),
        { value: decoded.files[path], sha: '' },
      )))
    }
    await repositoryPersistentCache.set(metadataKey, {
      value: { hash: descriptor.hash, paths } satisfies PlatformPackCacheMetadata,
      sha: 'local-v1',
    })
  }
}

function groupSeasonIds(value: unknown): number[] {
  if (!value || typeof value !== 'object') return []
  const group = value as { baskets?: unknown }
  if (!Array.isArray(group.baskets)) return []
  const years = group.baskets.flatMap(basket => {
    if (!basket || typeof basket !== 'object') return []
    const value = basket as { years?: unknown }
    if (!Array.isArray(value.years)) return []
    return value.years.flatMap(year => {
      if (!year || typeof year !== 'object') return []
      const candidate = (year as { year?: unknown }).year
      return typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0 ? [candidate] : []
    })
  })
  return [...new Set(years)]
}

function decodePackMetadata(value: unknown): PlatformPackCacheMetadata | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PlatformPackCacheMetadata>
  if (typeof candidate.hash !== 'string' || !Array.isArray(candidate.paths) ||
    candidate.paths.some(path => typeof path !== 'string')) return null
  return { hash: candidate.hash, paths: [...candidate.paths] }
}

function platformCacheKey(path: string): string {
  return `${repositoryCachePrefix(PLATFORM_OWNER, PLATFORM_REPO)}${path}@${PLATFORM_REF}`
}

function repositoryCachePrefix(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}/`
}
