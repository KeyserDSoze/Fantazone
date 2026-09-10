import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  LeagueType,
  type Group,
  type Team,
} from '../../src/domain/src/index'
import { RepositoryWriteConflictError } from '../../src/github/src/index'
import { prepareOpeningCompetition } from '../../src/app/services/groupOpeningCompetitionService'
import type { GroupSessionRuntime } from '../../src/app/services/groupSessionRuntime'

const OWNER = 'owner@example.com'

function enabledGroup(withPreviousMember = false): Group {
  return {
    id: 'amici',
    name: 'Amici',
    users: [],
    leagues: [{
      id: 'league-a',
      name: 'Campionato',
      isMain: true,
      type: LeagueType.League,
      basketsId: withPreviousMember ? ['main'] : [],
      years: [{
        year: 2026,
        type: LeagueType.League,
        settings: {
          ...DefaultLeagueSetting,
          openingCompetition: {
            enabled: true,
            serieADays: 1,
            prizes: [{ position: 1, credits: 50 }],
          },
        },
      }],
    }],
    baskets: withPreviousMember ? [{
      id: 'main',
      name: 'Principale',
      years: [{
        year: 2025,
        teams: [{ name: 'Owner Team', owner: OWNER, additionalOwners: [] }],
      }],
    }] : [],
  }
}

function emptyTeam(): Team {
  return {
    name: 'Owner Team',
    owner: OWNER,
    additionalOwners: [],
    players: [],
    moneyFromRank: 0,
    openingCompetitionPrize: 0,
    formationChanges: 0,
    lastUpdate: null,
  }
}

function conflict(path: string) {
  return new RepositoryWriteConflictError({
    owner: 'KeyserDSoze',
    repo: 'Fantazone.Amici',
    path,
    ref: 'main',
  }, 409)
}

test('recomputes opening standings from fresh state after an optimistic standings race', async () => {
  const group = enabledGroup(false)
  let refreshes = 0
  let votesReads = 0
  let standingsWrites = 0

  const runtime = {
    refreshGroup: async () => {
      refreshes += 1
      return group
    },
    officialVoteRepository: {
      getVotes: async () => {
        votesReads += 1
        return null
      },
    },
    openingCompetitionRepository: {
      getStandingsSnapshot: async () => null,
      writeStandings: async () => {
        standingsWrites += 1
        if (standingsWrites === 1) throw conflict('data/groups/seasons/2026/opening/league-a/standings.json')
        return 'standings-sha'
      },
    },
  } as unknown as GroupSessionRuntime

  const result = await prepareOpeningCompetition(runtime, 'league-a', 2026)

  assert.equal(result.year, 2026)
  assert.deepEqual(result.teams, [])
  assert.equal(standingsWrites, 2)
  assert.equal(refreshes, 2)
  assert.equal(votesReads, 2)
})

test('a concurrent create-only roster snapshot converges when the winning snapshot appears on reread', async () => {
  const group = enabledGroup(true)
  const source = emptyTeam()
  let snapshotReads = 0
  let snapshotWrites = 0
  let snapshotExists = false
  let standingsWrites = 0

  const runtime = {
    refreshGroup: async () => group,
    teamRepository: {
      getTeam: async () => source,
    },
    officialVoteRepository: {
      getVotes: async () => null,
    },
    openingCompetitionRepository: {
      getTeamSnapshot: async () => {
        snapshotReads += 1
        return snapshotExists ? { value: source, sha: 'winner-sha', fromCache: false } : null
      },
      writeTeam: async () => {
        snapshotWrites += 1
        snapshotExists = true
        throw conflict('data/groups/seasons/2026/opening/league-a/teams/main/owner@example.com.json')
      },
      getTeamDay: async () => null,
      getTeam: async () => source,
      getStandingsSnapshot: async () => null,
      writeStandings: async () => {
        standingsWrites += 1
        return 'standings-sha'
      },
    },
  } as unknown as GroupSessionRuntime

  const result = await prepareOpeningCompetition(runtime, 'league-a', 2026)

  assert.equal(snapshotWrites, 1)
  assert.equal(snapshotReads, 2)
  assert.equal(standingsWrites, 1)
  assert.deepEqual(result.teams, [{ owner: OWNER, name: 'Owner Team', score: 0, prize: 50 }])
})
