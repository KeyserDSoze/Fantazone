import type { AuthenticatedGroupSession, FormationPositionUpdate } from '@fantazone/domain'
import { repositoryPersistentCache } from './repositoryPersistentCache'
import { isNetworkFailure } from './networkStatus'
import type { GroupSessionRuntime } from './groupSessionRuntime'

const OUTBOX_PREFIX = '__offline__/formation-outbox.v1/'
const LOCAL_SHA = 'local-v1'

export type PendingFormationMutation = {
  id: string
  repository: string
  identityEmail: string
  leagueId: string
  season: number
  gameId: string
  owner: string
  positions: FormationPositionUpdate[]
  queuedAt: string
}

export async function enqueueFormationMutation(
  repository: string,
  input: Omit<PendingFormationMutation, 'id' | 'repository' | 'queuedAt'>,
): Promise<PendingFormationMutation> {
  const items = await listFormationMutations(repository)
  const next: PendingFormationMutation = {
    ...input,
    id: newId(),
    repository,
    queuedAt: new Date().toISOString(),
    positions: input.positions.map(position => ({ ...position })),
  }
  // A newer formation for the same team/fixture supersedes an older unsent one.
  const retained = items.filter(item => !sameTarget(item, next))
  retained.push(next)
  await save(repository, retained)
  return next
}

export async function listFormationMutations(repository: string): Promise<PendingFormationMutation[]> {
  const entry = await repositoryPersistentCache.get(key(repository))
  if (!entry || !Array.isArray(entry.value)) return []
  return entry.value.filter(isPendingFormationMutation).map(item => ({ ...item, positions: item.positions.map(position => ({ ...position })) }))
}

export async function countPendingMutations(repository: string): Promise<number> {
  return (await listFormationMutations(repository)).length
}

export async function removeFormationMutation(repository: string, id: string): Promise<void> {
  const items = await listFormationMutations(repository)
  await save(repository, items.filter(item => item.id !== id))
}

export async function flushFormationOutbox(
  runtime: GroupSessionRuntime,
  session: AuthenticatedGroupSession,
): Promise<{ synced: number; remaining: number }> {
  const repository = runtime.connection.repository.full_name
  const items = await listFormationMutations(repository)
  let synced = 0

  for (const item of items) {
    if (normalizeEmail(item.identityEmail) !== normalizeEmail(session.identity.email)) continue
    try {
      await runtime.formationWriter.saveGameFormation({
        session,
        leagueId: item.leagueId,
        season: item.season,
        gameId: item.gameId,
        owner: item.owner,
        positions: item.positions,
        offlineReplay: true,
      })
      await removeFormationMutation(repository, item.id)
      synced += 1
    } catch (error) {
      if (isNetworkFailure(error)) break
      throw error
    }
  }

  return { synced, remaining: await countPendingMutations(repository) }
}

async function save(repository: string, items: PendingFormationMutation[]): Promise<void> {
  const storageKey = key(repository)
  if (items.length === 0) {
    await repositoryPersistentCache.delete(storageKey)
    return
  }
  await repositoryPersistentCache.set(storageKey, { value: items, sha: LOCAL_SHA })
}

function key(repository: string): string {
  return `${OUTBOX_PREFIX}${repository.trim().toLowerCase()}`
}

function sameTarget(a: PendingFormationMutation, b: PendingFormationMutation): boolean {
  return normalizeEmail(a.identityEmail) === normalizeEmail(b.identityEmail) &&
    a.leagueId === b.leagueId &&
    a.season === b.season &&
    a.gameId === b.gameId &&
    normalizeEmail(a.owner) === normalizeEmail(b.owner)
}

function isPendingFormationMutation(value: unknown): value is PendingFormationMutation {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PendingFormationMutation>
  return typeof item.id === 'string' && typeof item.repository === 'string' &&
    typeof item.identityEmail === 'string' && typeof item.leagueId === 'string' &&
    typeof item.season === 'number' && typeof item.gameId === 'string' &&
    typeof item.owner === 'string' && Array.isArray(item.positions) && typeof item.queuedAt === 'string'
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
