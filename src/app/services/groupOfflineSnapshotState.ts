export type GroupOfflineSnapshotState = {
  version: 1
  revision: number
  documents: number
  bytes: number
}

export function decodeGroupOfflineSnapshotState(value: unknown): GroupOfflineSnapshotState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<GroupOfflineSnapshotState>
  if (candidate.version !== 1) return null
  if (!Number.isInteger(candidate.revision) || Number(candidate.revision) < 0) return null
  if (!Number.isInteger(candidate.documents) || Number(candidate.documents) < 0) return null
  if (typeof candidate.bytes !== 'number' || !Number.isFinite(candidate.bytes) || candidate.bytes < 0) return null
  return {
    version: 1,
    revision: Number(candidate.revision),
    documents: Number(candidate.documents),
    bytes: candidate.bytes,
  }
}

export function shouldRefreshGroupOfflineSnapshot(
  state: GroupOfflineSnapshotState | null,
  remoteRevision: number,
): boolean {
  return state?.revision !== remoteRevision
}
