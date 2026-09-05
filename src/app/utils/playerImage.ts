import { getPlayerKey } from '@fantazone/domain'

export const PLAYER_IMAGE_BASE_URL = 'https://fanta.plus/images/players'
export const DEFAULT_PLAYER_IMAGE_KEY = 'default'

export type PlayerImageUrls = {
  src: string
  fallback: string
}

export function buildPlayerImageKeyFromName(name?: string | null): string {
  return getPlayerKey(name) || DEFAULT_PLAYER_IMAGE_KEY
}

export function buildPlayerImageUrl(key: string): string {
  const normalizedKey = key.trim().toLowerCase() || DEFAULT_PLAYER_IMAGE_KEY
  return `${PLAYER_IMAGE_BASE_URL}/${normalizedKey}.webp`
}

export function getPlayerImageUrlFromName(name?: string | null): PlayerImageUrls {
  return {
    src: buildPlayerImageUrl(buildPlayerImageKeyFromName(name)),
    fallback: buildPlayerImageUrl(DEFAULT_PLAYER_IMAGE_KEY),
  }
}
