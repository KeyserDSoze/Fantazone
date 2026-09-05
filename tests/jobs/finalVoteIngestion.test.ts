import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  Behaviour,
  Role,
  type RealCalendar,
  type RealPlayers,
} from '../../src/domain/src/index'
import {
  realCalendarDocumentPath,
  realPlayersDocumentPath,
  serieAVoteDocumentPath,
} from '../../src/github/src/index'
import {
  DEFAULT_FANTACALCIO_FINAL_VOTES_BASE_URL,
  buildOfficialVotesUrl,
  ingestFinalVotes,
  parseOfficialVotesHtml,
} from '../../src/jobs/src/officialVoteIngestion'

const YEAR = 15
const NOW = new Date('2026-09-05T12:00:00Z')

const completeHtml = `
<ul class="teams">
  <a class="team-name" content="roma"></a>
  <tbody>
    <div class="player-item">
      <span>Mario Rossi</span>
      <span class="role" data-value="a"></span>
      <td></td>
      <td><span data-value="6,5">6,5</span></td>
      <td>
        <span data-value="1"></span>
        <span data-value="0"></span>
        <span data-value="0"></span>
        <span data-value="0"></span>
        <span data-value="0"></span>
        <span data-value="0"></span>
        <span data-value="1"></span>
        <span data-value="1"></span>
      </td>
    </div>
  </tbody>
  <a class="team-name" content="milan"></a>
  <tbody>
    <div class="player-item yellow-card">
      <span>Luca Bianchi</span>
      <span class="role" data-value="d"></span>
      <td></td>
      <td><span data-value="55">55</span></td>
    </div>
  </tbody>
</ul>`

test('builds the legacy Fantacalcio season label in final-vote URLs', () => {
  assert.equal(
    buildOfficialVotesUrl(DEFAULT_FANTACALCIO_FINAL_VOTES_BASE_URL, 15, 3),
    'https://www.fantacalcio.it/voti-fantacalcio-serie-a/2026-27/3',
  )
})

test('parses official vote HTML, bonuses and legacy card-without-vote fallback', () => {
  const players = parseOfficialVotesHtml(completeHtml)
  assert.equal(players.length, 2)

  const forward = players.find(player => player.name === 'Mario Rossi')!
  assert.equal(forward.team.name, 'Roma')
  assert.equal(forward.role, Role.Forward)
  assert.equal(forward.vote?.value, 6.5)
  assert.equal(forward.vote?.goal, 1)
  assert.equal(forward.vote?.assist, 1)
  assert.equal(forward.vote?.manOfTheMatch, true)
  assert.equal(forward.vote?.isFinal, true)
  assert.equal(forward.vote?.hasVote, true)

  const defender = players.find(player => player.name === 'Luca Bianchi')!
  assert.equal(defender.role, Role.Defensor)
  assert.equal(defender.vote?.status, Behaviour.YellowCard)
  assert.equal(defender.vote?.hasVote, true)
  assert.equal(defender.vote?.value, 6)
})

test('returns no players for missing teams markup and tolerates missing bonus cells', () => {
  assert.deepEqual(parseOfficialVotesHtml('<html>missing expected block</html>'), [])
  const html = `
    <ul class="teams">
      <a class="team-name" content="roma"></a>
      <tbody>
        <div class="player-item">
          <span>Mario Rossi</span>
          <span class="role" data-value="a"></span>
          <td></td><td><span data-value="6,5">6,5</span></td>
        </div>
      </tbody>
    </ul>`
  const player = assertSingle(parseOfficialVotesHtml(html))
  assert.equal(player.vote?.goal, 0)
  assert.equal(player.vote?.assist, 0)
  assert.equal(player.vote?.manOfTheMatch, false)
})

test('final-vote ingestion writes canonical official JSON and reports completeness against played teams', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-final-votes-'))
  const calendar = calendarWithGame(false)
  await writeJson(join(root, realCalendarDocumentPath(YEAR)), calendar)
  let requestedUrl = ''

  const result = await ingestFinalVotes({
    repoRoot: root,
    season: YEAR,
    day: 1,
    now: NOW,
    fetchText: async url => {
      requestedUrl = url
      return completeHtml
    },
  })

  assert.equal(requestedUrl, 'https://www.fantacalcio.it/voti-fantacalcio-serie-a/2026-27/1')
  assert.equal(result.expectedPlayedTeams, 2)
  assert.equal(result.parsedPlayedTeams, 2)
  assert.equal(result.complete, true)
  assert.equal(result.syntheticDelayedPlayers, 0)
  assert.equal(result.votes.players[0].team.abbreviation, 'rom')

  const persisted = JSON.parse(await readFile(join(root, serieAVoteDocumentPath('official', YEAR, 1)), 'utf8'))
  assert.equal(persisted.year, YEAR)
  assert.equal(persisted.serieADay, 1)
  assert.equal(persisted.players.length, 2)
  assert.equal(persisted.players[0].vote.isFinal, true)
  assert.equal('p' in persisted, false)
})

test('partial source is persisted but marked incomplete so callers can retry without rebuilding stats', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-final-partial-'))
  await writeJson(join(root, realCalendarDocumentPath(YEAR)), calendarWithGame(false))
  const oneTeamHtml = completeHtml.slice(0, completeHtml.indexOf('<a class="team-name" content="milan"')) + '</ul>'

  const result = await ingestFinalVotes({
    repoRoot: root,
    season: YEAR,
    day: 1,
    now: NOW,
    fetchText: async () => oneTeamHtml,
  })

  assert.equal(result.votes.players.length, 1)
  assert.equal(result.expectedPlayedTeams, 2)
  assert.equal(result.parsedPlayedTeams, 1)
  assert.equal(result.complete, false)
})

test('delayed games receive legacy default-six votes from complete RealPlayers without counting as played teams', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-final-delayed-'))
  await writeJson(join(root, realCalendarDocumentPath(YEAR)), calendarWithGame(true))
  const masterPlayers: RealPlayers = {
    year: YEAR,
    players: [
      {
        name: 'Delayed Roma',
        team: { name: 'Roma', abbreviation: 'rom' },
        role: Role.Midfielder,
        isActive: true,
        visible: true,
      },
      {
        name: 'Delayed Milan',
        team: { name: 'Milan', abbreviation: 'mil' },
        role: Role.GoalKeeper,
        isActive: true,
        visible: false,
      },
    ],
  }
  await writeJson(join(root, realPlayersDocumentPath(YEAR)), masterPlayers)

  const result = await ingestFinalVotes({
    repoRoot: root,
    season: YEAR,
    day: 1,
    now: NOW,
    fetchText: async () => '<ul class="teams"></ul>',
  })

  assert.equal(result.expectedPlayedTeams, 0)
  assert.equal(result.parsedPlayedTeams, 0)
  assert.equal(result.complete, true)
  assert.equal(result.syntheticDelayedPlayers, 2)
  assert.equal(result.votes.players.length, 2)
  for (const player of result.votes.players) {
    assert.equal(player.vote?.value, 6)
    assert.equal(player.vote?.hasVote, true)
    assert.equal(player.vote?.isFinal, true)
    assert.equal(player.vote?.isIn, false)
    assert.ok(player.team.name)
  }
  assert.equal(result.votes.players.find(player => player.name === 'Delayed Milan')?.visible, false)
})

test('without explicit day the ingestion mirrors FinalVotesJob and uses the latest concluded/live day', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fantazone-final-auto-day-'))
  await writeJson(join(root, realCalendarDocumentPath(YEAR)), calendarWithGame(false))
  const result = await ingestFinalVotes({
    repoRoot: root,
    season: YEAR,
    now: NOW,
    fetchText: async () => completeHtml,
  })
  assert.equal(result.votes.serieADay, 1)
})

function calendarWithGame(delayed: boolean): RealCalendar {
  return {
    year: YEAR,
    days: [{
      year: YEAR,
      serieADay: 1,
      games: [{
        home: { name: 'Roma', abbreviation: 'rom' },
        away: { name: 'Milan', abbreviation: 'mil' },
        date: '2026-08-22T18:45:00Z',
        homeGoals: delayed ? null : 1,
        awayGoals: delayed ? null : 0,
        delayed,
      }],
    }],
  }
}

function assertSingle<T>(values: T[]): T {
  assert.equal(values.length, 1)
  return values[0]
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
