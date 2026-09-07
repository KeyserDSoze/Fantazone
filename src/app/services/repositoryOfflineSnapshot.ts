import { strFromU8, unzipSync } from 'fflate'
import type { GroupConnection } from './groupSessionRuntime'
import { repositoryPersistentCache } from './repositoryPersistentCache'

export type OfflineSnapshotResult = {
  documents: number
  bytes: number
}

/**
 * Materializes every JSON document from the selected group branch into the same
 * durable cache used by GitHubJsonStore. The repository is downloaded once as a
 * ZIP archive instead of issuing one Contents API request per file.
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
  onProgress?.('Preparazione dei dati locali per l’uso senza rete…')
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

  onProgress?.(`${entries.length} documenti del gruppo disponibili offline.`)
  return { documents: entries.length, bytes: storedBytes }
}

function repositoryCachePrefix(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}/`
}
