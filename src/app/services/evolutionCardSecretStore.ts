import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'

const PREFIX = 'fantazone.evolution-card-secret.v1:'

export interface EvolutionLocalCardSecret {
  leagueId: string
  year: number
  serieADay: number
  owner: string
  cardIds: string[]
  nonce: string
  committedAt: string
}

export async function saveEvolutionCardSecret(repository: string, secret: EvolutionLocalCardSecret): Promise<void> {
  const key = storageKey(repository, secret.leagueId, secret.year, secret.serieADay, secret.owner)
  const value = JSON.stringify(secret)
  if (Platform.OS === 'web' && globalThis.localStorage) {
    globalThis.localStorage.setItem(key, value)
    return
  }
  await AsyncStorage.setItem(key, value)
}

export async function readEvolutionCardSecret(
  repository: string,
  leagueId: string,
  year: number,
  serieADay: number,
  owner: string,
): Promise<EvolutionLocalCardSecret | null> {
  const key = storageKey(repository, leagueId, year, serieADay, owner)
  const raw = Platform.OS === 'web' && globalThis.localStorage
    ? globalThis.localStorage.getItem(key)
    : await AsyncStorage.getItem(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<EvolutionLocalCardSecret>
    if (
      parsed.leagueId !== leagueId ||
      parsed.year !== year ||
      parsed.serieADay !== serieADay ||
      normalize(parsed.owner) !== normalize(owner) ||
      !Array.isArray(parsed.cardIds) ||
      !parsed.cardIds.every(value => typeof value === 'string') ||
      typeof parsed.nonce !== 'string' || parsed.nonce.length < 16 ||
      typeof parsed.committedAt !== 'string'
    ) return null
    return parsed as EvolutionLocalCardSecret
  } catch {
    return null
  }
}

export async function deleteEvolutionCardSecret(
  repository: string,
  leagueId: string,
  year: number,
  serieADay: number,
  owner: string,
): Promise<void> {
  const key = storageKey(repository, leagueId, year, serieADay, owner)
  if (Platform.OS === 'web' && globalThis.localStorage) {
    globalThis.localStorage.removeItem(key)
    return
  }
  await AsyncStorage.removeItem(key)
}

export function createEvolutionCardNonce(): string {
  const cryptoObject = (globalThis as { crypto?: { getRandomValues?: (values: Uint8Array) => Uint8Array } }).crypto
  if (!cryptoObject?.getRandomValues) {
    throw new Error('Questo dispositivo non espone un generatore casuale sicuro: impossibile sigillare le carte Evolution.')
  }
  const bytes = new Uint8Array(24)
  cryptoObject.getRandomValues(bytes)
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

function storageKey(repository: string, leagueId: string, year: number, day: number, owner: string): string {
  return `${PREFIX}${repository.trim().toLowerCase()}:${encodeURIComponent(leagueId)}:${year}:${day}:${encodeURIComponent(normalize(owner))}`
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}
