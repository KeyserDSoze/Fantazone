import { gunzipSync, strFromU8 } from 'fflate'
import { GitHubClient, type GitHubTreeEntry } from '@fantazone/github'
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

type SnapshotEntry = {
  path: string
  value: unknown
  bytes: number
  sha: string
}

type JsonBlobDescriptor = GitHubTreeEntry & {
  type: 'blob'
}

const PLATFORM_OWNER = 'KeyserDSoze'
const PLATFORM_REPO = 'Fantazone'
const PLATFORM_REF = 'main'
const PLATFORM_PACK_INDEX = '/offline/serie-a/index.json'
const PLATFORM_PACK_METADATA_PREFIX = '__offline__/serie-a-pack.v1/'
const SNAPSHOT_BATCH_SIZE = 16

/**
 * Materializes every JSON document from the selected group branch into the same
 * durable cache used by GitHubJsonStore. Browser clients deliberately stay on
 * api.github.com: GitHub's archive endpoint redirects private repositories to
 * codeload.github.com, whose signed download does not allow cross-origin browser
 * requests from fanta.plus. A recursive Git tree gives us all JSON blob SHAs in one
 * request; only changed blobs are then fetched and decoded through the Git Data API.
 */
export async function hydrateRepositoryOfflineSnapshot(
  connection: GroupConnection,
  onProgress?: (detail: string) => void,
): Promise<OfflineSnapshotResult> {
  const owner = connection.repository.owner.login
  const repo = connection.repository.name
  const ref = connection.repository.default_branch
  const client = new GitHubClient(connection.token)
  const prefix = repositoryCachePrefix(owner, repo)

  onProgress?.('Indicizzazione dei dati del gruppo per la copia offline…')
  const blobs = await listJsonBlobs(client, owner, repo, ref, onProgress)
  const entries: SnapshotEntry[] = []
  const preserveKeys = blobs.map(blob => `${prefix}${blob.path}@${ref}`)
  let totalBytes = 0

  for (let index = 0; index < blobs.length; index += SNAPSHOT_BATCH_SIZE) {
    const chunk = blobs.slice(index, index + SNAPSHOT_BATCH_SIZE)
    const loaded = await Promise.all(chunk.map(async descriptor => {
      totalBytes += descriptor.size ?? 0
      const key = `${prefix}${descriptor.path}@${ref}`
      const cached = await repositoryPersistentCache.get(key)
      if (cached?.sha === descriptor.sha) {
        return {
          path: descriptor.path,
          value: cached.value,
          bytes: descriptor.size ?? 0,
          sha: descriptor.sha,
        } satisfies SnapshotEntry
      }

      const blob = await client.getBlob(owner, repo, descriptor.sha)
      try {
        return {
          path: descriptor.path,
          value: JSON.parse(blob.content),
          bytes: blob.size,
          sha: blob.sha,
        } satisfies SnapshotEntry
      } catch {
        // Non-canonical malformed JSON must not poison the offline repository cache.
        return null
      }
    }))

    for (const entry of loaded) {
      if (!entry) continue
      entries.push(entry)
      await repositoryPersistentCache.set(
        `${prefix}${entry.path}@${ref}`,
        { value: entry.value, sha: entry.sha },
      )
    }

    if (blobs.length > SNAPSHOT_BATCH_SIZE) {
      onProgress?.(`Preparazione copia offline ${Math.min(index + chunk.length, blobs.length)}/${blobs.length}…`)
    }
  }

  // Remove JSON documents deleted from the branch while preserving every current SHA-backed entry.
  await repositoryPersistentCache.deleteByPrefix(prefix, preserveKeys)

  const seasonIds = groupSeasonIds(entries.find(entry => entry.path === 'config/group.json')?.value)
  if (seasonIds.length > 0) {
    await hydratePlatformSeasonPacks(seasonIds, onProgress)
  }

  onProgress?.(`${entries.length} documenti del gruppo disponibili offline.`)
  return { documents: entries.length, bytes: totalBytes }
}

async function listJsonBlobs(
  client: GitHubClient,
  owner: string,
  repo: string,
  ref: string,
  onProgress?: (detail: string) => void,
): Promise<JsonBlobDescriptor[]> {
  const recursive = await client.getTree(owner, repo, ref, true)
  if (!recursive.truncated) return recursive.tree.filter(isJsonBlob)

  // GitHub truncates very large recursive trees. Fall back to walking subtrees so
  // large migrated repositories still get a complete offline index.
  onProgress?.('Repository molto grande: scansione completa delle cartelle…')
  const root = await client.getTree(owner, repo, ref, false)
  const blobs: JsonBlobDescriptor[] = []
  const queue: Array<{ prefix: string; sha: string }> = []

  for (const entry of root.tree) {
    if (entry.type === 'tree') queue.push({ prefix: entry.path, sha: entry.sha })
    else if (isJsonBlob(entry)) blobs.push(entry)
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    const tree = await client.getTree(owner, repo, current.sha, false)
    for (const entry of tree.tree) {
      const path = `${current.prefix}/${entry.path}`
      if (entry.type === 'tree') {
        queue.push({ prefix: path, sha: entry.sha })
      } else if (entry.type === 'blob' && path.toLowerCase().endsWith('.json')) {
        blobs.push({ ...entry, path, type: 'blob' })
      }
    }
  }

  return blobs
}

function isJsonBlob(entry: GitHubTreeEntry): entry is JsonBlobDescriptor {
  return entry.type === 'blob' && entry.path.toLowerCase().endsWith('.json')
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
