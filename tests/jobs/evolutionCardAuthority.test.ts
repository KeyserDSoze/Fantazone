import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  DefaultLeagueSetting,
  createDefaultFantazoneEvolutionSettings,
  createEvolutionCardCommitment,
  getEvolutionCardCatalog,
  revealEvolutionCardCommitment,
  type LeagueSetting,
  type RealDay,
} from '../../src/domain/src/index'
import type { EvolutionCardsDocument } from '../../src/github/src/index'
import { getAuthoritativeEvolutionCardIds } from '../../src/jobs/src/evolutionCardAuthority'

const execFileAsync = promisify(execFile)
const PATH = 'data/evolution/cards.json'
const LEAGUE = 'league-a'
const YEAR = 15
const DAY = 4
const OWNER = 'owner@example.com'
const KICKOFF = '2026-09-12T16:00:00.000Z'

const settings = evolutionSettings()
const cardId = getEvolutionCardCatalog(settings)[0].id
const realDay: RealDay = {
  year: YEAR,
  serieADay: DAY,
  games: [{
    home: { name: 'Roma', abbreviation: 'ROM' },
    away: { name: 'Milan', abbreviation: 'MIL' },
    date: KICKOFF,
    homeGoals: null,
    awayGoals: null,
    delayed: false,
  }],
}

test('authoritative timing accepts a commitment before kickoff and reveal inside grace', async () => {
  const root = await repository()
  await writeCards(root, sealedDocument())
  await commit(root, 'seal', '2026-09-12T15:55:00.000Z')
  const revealed = revealedDocument('2099-01-01T00:00:00.000Z')
  await writeCards(root, revealed)
  await commit(root, 'reveal', '2026-09-12T16:00:30.000Z')

  assert.deepEqual(await authorize(root, revealed), [cardId])
})

test('backdating revealedAt cannot rescue a reveal committed to Git after the grace window', async () => {
  const root = await repository()
  await writeCards(root, sealedDocument())
  await commit(root, 'seal', '2026-09-12T15:55:00.000Z')
  const revealed = revealedDocument('2026-09-12T16:00:01.000Z')
  await writeCards(root, revealed)
  await commit(root, 'late reveal with forged JSON time', '2026-09-12T16:10:00.000Z')

  assert.equal(await authorize(root, revealed), null)
})

test('backdating committedAt cannot rescue a commitment first published after kickoff', async () => {
  const root = await repository()
  const revealed = revealedDocument('2026-09-12T16:00:01.000Z')
  await writeCards(root, revealed)
  await commit(root, 'late seal and reveal with forged JSON times', '2026-09-12T16:00:30.000Z')

  assert.equal(await authorize(root, revealed), null)
})

async function authorize(root: string, cards: EvolutionCardsDocument) {
  return getAuthoritativeEvolutionCardIds({
    groupRepoRoot: root,
    relativePath: PATH,
    cards,
    owner: OWNER,
    leagueId: LEAGUE,
    year: YEAR,
    serieADay: DAY,
    settings,
    deck: null,
    consumedCardIds: [],
    realDay,
  })
}

function evolutionSettings(): LeagueSetting {
  const evolution = createDefaultFantazoneEvolutionSettings()
  evolution.enabled = true
  evolution.coachCards.enabled = true
  evolution.coachCards.cardsInSeasonDeck = 0
  evolution.coachCards.cardsPerMatch = 1
  evolution.coachCards.lockMinutesBeforeFirstKickoff = 0
  evolution.coachCards.revealGraceSecondsAfterFirstKickoff = 120
  return { ...DefaultLeagueSetting, votes: { ...DefaultLeagueSetting.votes }, evolution }
}

function sealedDocument(): EvolutionCardsDocument {
  return {
    version: 2,
    leagueId: LEAGUE,
    year: YEAR,
    serieADay: DAY,
    commitments: { [OWNER]: commitment() },
  }
}

function revealedDocument(revealedAt: string): EvolutionCardsDocument {
  const sealed = commitment()
  return {
    version: 2,
    leagueId: LEAGUE,
    year: YEAR,
    serieADay: DAY,
    commitments: {
      [OWNER]: revealEvolutionCardCommitment(sealed, {
        leagueId: LEAGUE,
        year: YEAR,
        serieADay: DAY,
        owner: OWNER,
        cardIds: [cardId],
        nonce: nonce(),
        revealedAt,
      }),
    },
  }
}

function commitment() {
  return createEvolutionCardCommitment({
    leagueId: LEAGUE,
    year: YEAR,
    serieADay: DAY,
    owner: OWNER,
    cardIds: [cardId],
    nonce: nonce(),
    committedAt: '1999-01-01T00:00:00.000Z',
  })
}

function nonce(): string {
  return '0123456789abcdef0123456789abcdef'
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-card-authority-'))
  await execFileAsync('git', ['-C', root, 'init', '-b', 'main'])
  await execFileAsync('git', ['-C', root, 'config', 'user.name', 'Fantazone test'])
  await execFileAsync('git', ['-C', root, 'config', 'user.email', 'test@fantazone.local'])
  return root
}

async function writeCards(root: string, cards: EvolutionCardsDocument): Promise<void> {
  const path = join(root, PATH)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(cards, null, 2)}\n`, 'utf8')
}

async function commit(root: string, message: string, date: string): Promise<void> {
  await execFileAsync('git', ['-C', root, 'add', '-A'])
  await execFileAsync('git', ['-C', root, 'commit', '-m', message], {
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  })
}
