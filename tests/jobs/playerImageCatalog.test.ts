import assert from 'node:assert/strict'
import test from 'node:test'
import { Role, type RealPlayer } from '../../src/domain/src/index'
import {
  decodeSdpPlayersPage,
  decodeSdpSeasons,
  findSdpImagePath,
  fullSeasonLabel,
  normalizePlayerImageName,
  selectSdpImagePath,
  type SdpPlayer,
} from '../../src/jobs/src/playerImageCatalog'

const player: RealPlayer = {
  name: "Nicolò Barella",
  team: { name: 'Inter', abbreviation: 'int' },
  role: Role.Midfielder,
  isActive: true,
  visible: true,
}

function sdp(overrides: Partial<SdpPlayer> = {}): SdpPlayer {
  return {
    role: 3,
    mediaFirstName: 'Nicolo',
    mediaLastName: 'Barella',
    shortName: 'Nicolò Barella',
    displayName: 'Nicolò Barella',
    team: { shortName: 'Inter', officialName: 'Internazionale', acronymName: 'INT' },
    imagery: { playerImage_home_middle: 'playerImages/barella.webp' },
    ...overrides,
  }
}

test('formats legacy full season label used by SDP catalog', () => {
  assert.equal(fullSeasonLabel(15), '2026/2027')
})

test('decodes season and paginated player responses defensively', () => {
  assert.deepEqual(decodeSdpSeasons({ seasons: [{ seasonId: 's1', seasonName: '2026/2027' }, { broken: true }] }), [
    { seasonId: 's1', seasonName: '2026/2027' },
  ])
  const page = decodeSdpPlayersPage({
    pagination: { totalPages: 2, isLastPage: false },
    players: [{ role: 3, shortName: 'Barella', imagery: { x: 'a.webp' } }],
  })
  assert.deepEqual(page.pagination, { totalPages: 2, isLastPage: false })
  assert.equal(page.players.length, 1)
})

test('prefers middle imagery then celeb then first available', () => {
  assert.equal(selectSdpImagePath(sdp({ imagery: {
    fallback: 'fallback.webp',
    playerImage_home_celeb: 'celeb.webp',
    playerImage_home_middle: 'middle.webp',
  } })), 'middle.webp')
  assert.equal(selectSdpImagePath(sdp({ imagery: { fallback: 'fallback.webp', playerImage_home_celeb: 'celeb.webp' } })), 'celeb.webp')
  assert.equal(selectSdpImagePath(sdp({ imagery: { fallback: 'fallback.webp' } })), 'fallback.webp')
})

test('matches normalized name role and team first', () => {
  const wrongTeam = sdp({ team: { shortName: 'Milan', officialName: 'Milan', acronymName: 'MIL' }, imagery: { x_middle: 'wrong.webp' } })
  const correct = sdp({ imagery: { x_middle: 'correct.webp' } })
  assert.equal(findSdpImagePath(player, [wrongTeam, correct]), 'correct.webp')
})

test('falls back to name plus role when historic season team differs', () => {
  const previousSeason = sdp({ team: { shortName: 'Cagliari', officialName: 'Cagliari', acronymName: 'CAG' }, imagery: { x_middle: 'previous.webp' } })
  assert.equal(findSdpImagePath(player, [previousSeason]), 'previous.webp')
})

test('does not match same normalized name with incompatible role', () => {
  const goalkeeper = sdp({ role: 1, imagery: { x_middle: 'keeper.webp' } })
  assert.equal(findSdpImagePath(player, [goalkeeper]), null)
})

test('normalizes accents apostrophes entities and whitespace like legacy', () => {
  assert.equal(normalizePlayerImageName("  Nicolò D&#39;Àmbrosio  "), 'nicolo dambrosio')
})
