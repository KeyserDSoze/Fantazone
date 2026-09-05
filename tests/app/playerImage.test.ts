import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PLAYER_IMAGE_KEY,
  PLAYER_IMAGE_BASE_URL,
  buildPlayerImageKeyFromName,
  getPlayerImageUrlFromName,
} from '../../src/app/utils/playerImage'

test('frontend player image helper keeps exact legacy player-key semantics', () => {
  assert.equal(buildPlayerImageKeyFromName("Nicolò D'Ambrosio"), 'nicoldambrosio')
  assert.equal(PLAYER_IMAGE_BASE_URL, 'https://fanta.plus/images/players')
  assert.deepEqual(getPlayerImageUrlFromName("Nicolò D'Ambrosio"), {
    src: 'https://fanta.plus/images/players/nicoldambrosio.webp',
    fallback: 'https://fanta.plus/images/players/default.webp',
  })
})

test('frontend player image helper falls back to the tracked default asset', () => {
  assert.equal(buildPlayerImageKeyFromName(undefined), DEFAULT_PLAYER_IMAGE_KEY)
  assert.deepEqual(getPlayerImageUrlFromName(null), {
    src: 'https://fanta.plus/images/players/default.webp',
    fallback: 'https://fanta.plus/images/players/default.webp',
  })
})
