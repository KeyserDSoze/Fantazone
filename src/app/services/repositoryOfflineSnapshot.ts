import { gunzipSync, strFromU8, unzipSync } from 'fflate'
import type { GroupConnection } from './groupSessionRuntime'
import { repositoryPersistentCache } from './repositoryPersistentCache'

export type OfflineSnapshotResult = {
  documents: number
  bytes: number
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

/**
 * Materializes every JSON document from the selected group branch into the same
 * durable cache used by GitHubJsonStore. The group repository is downloaded once
 * as a ZIP archive instead of issuing one Contents API request per file. After the
 * group is stored, only the compressed Serie A season packs referenced by that
 * group are hydrated from fanta.plus.
 */
export async function hydrateRepositoryOfflineSnapshot(
  connection: GroupConnection,
  onProgress?: (detail: string) => void,
): Promise<OfflineSnapshotResult> {
  const owner = connection.repository.owner.login
  const repo = connection.repository.name
  const ref = connection.repository.default_branch
  onProgress?.('Scaricamento di una copia compatta del gruppo…')

  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(ref)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${connection.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!response.ok) throw new Error(`Impossibile preparare la copia offline del gruppo (HTTP ${response.status}).`)

  const archive = new Uint8Array(await response.arrayBuffer())
  onProgress?.('Preparazione dei dati del gruppo per l’uso senza rete…')
  const files = unzipSync(archive)
  const entries: Array<{ path: string; value: unknown; bytes: number }> = []

  for (const [archivePath, bytes] of Object.entries(files)) {
    if (archivePath.endsWith('/')) continue
    const slash = archivePath.indexOf('/')
    const path = slash >= 0 ? archivePath.slice(slash + 1) : archivePath
    if (!path || !path.toLowerCase().endsWith('.json')) continue
    try {
      entries.push({ path, value: JSON.parse(strFromU8(bytes)), bytes: bytes.byteLength })
    } catch {
      // Non-canonical malformed JSON must not poison the offline repository cache.
    }
  }

  const prefix = repositoryCachePrefix(owner, repo)
  await repositoryPersistentCache.deleteByPrefix(prefix)
  let storedBytes = 0
  for (let index = 0; index < entries.length; index += 32) {
    const chunk = entries.slice(index, index + 32)
    await Promise.all(chunk.map(async entry => {
      await repositoryPersistentCache.set(
        `${prefix}${entry.path}@${ref}`,
        { value: entry.value, sha: '' },
      )
      storedBytes += entry.bytes
    }))
  }

  const seasonIds = groupSeasonIds(entries.find(entry => entry.path === 'config/group.json')?.value)
  if (seasonIds.length > 0) {
    await hydratePlatformSeasonPacks(seasonIds, onProgress)
  }

  onProgress?.(`${entries.length} documenti del gruppo disponibili offline.`)
  return { documents: entries.length, bytes: storedBytes }
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
