import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DefaultLeagueSetting,
  FantaSoccerRole,
  IdentityRole,
  LeagueType,
  PlayerInTeamStatus,
  Role,
  getPlayerKey,
  type AuthenticatedGroupSession,
  type Group,
  type Player,
  type Team,
} from '../../src/domain/src/index'
import type { GitHubRealCalendarRepository, GitHubTeamRepository } from '../../src/github/src/index'
import { GroupFormationWriter } from '../../src/app/services/groupFormationWriter'
import type { GroupGameComposer } from '../../src/app/services/groupGameComposer'

const OWNER = 'owner@example.com'
const NOW = new Date('2026-09-11T19:00:00.000Z')

function group(liveFormationChanges = 0): Group {
  return {
    id: 'amici',
    name: 'Amici',
    users: [{ username: 'Owner', email: OWNER, role: IdentityRole.Participant }],
    leagues: [{
      id: 'league-a',
      name: 'Campionato',
      isMain: true,
      type: LeagueType.League,
      basketsId: ['main'],
      years: [{
        year: 2026,
        type: LeagueType.League,
        settings: { ...DefaultLeagueSetting, liveFormationChanges },
      }],
    }],
    baskets: [{
      id: 'main',
      name: 'Principale',
      years: [{ year: 2026, teams: [{ name: 'Owner Team', owner: OWNER, additionalOwners: [] }] }],
    }],
  }
}

function session(value: Group): AuthenticatedGroupSession {
  return {
    group: value,
    member: value.users[0],
    identity: { provider: 'microsoft', subject: OWNER, email: OWNER },
  }
}

function wrapper(options: { live: boolean; canEdit: boolean }) {
  return {
    leagueId: 'league-a',
    season: 2026,
    fantasyDay: 3,
    serieADay: 3,
    game: {
      id: 'game-1', number: 1, home: 'Owner Team', homeOwner: OWNER,
      away: 'Away', awayOwner: 'away@example.com', result: null,
    },
    teams: [{
      side: 'home', name: 'Owner Team', owner: OWNER, additionalOwners: [], players: [],
      formationChanges: 0, lastUpdate: null, source: 'day',
    }],
    canEdit: options.canEdit,
    nextSerieADay: 4,
    editabilitySource: options.live ? 'live-formation-window' : 'serie-a-context',
    isLiveFormationWindow: options.live,
    liveFormationDeadline: options.live ? '2026-09-11T22:00:00.000Z' : null,
    liveFormationChangesAllowed: options.live ? 2 : 0,
    allowLiveModuleChange: false,
    requiresScoreCalculation: false,
  }
}

function makeWriter(options: { live: boolean; canEdit: boolean; liveFormationChanges?: number }) {
  const currentGroup = group(options.liveFormationChanges ?? 0)
  const currentTeam = team()
  let seasonWrites = 0
  let dayWrites = 0
  let writtenTeam: Team | null = null

  const games = {
    getGame: async () => wrapper(options),
  } as unknown as GroupGameComposer

  const teams = {
    getTeamSnapshot: async () => ({ value: currentTeam, sha: 'season-sha' }),
    getTeamDaySnapshot: async () => {
      throw new Error('offline replay must never read the live TeamDay')
    },
    writeTeam: async (_basket: string, _season: number, _owner: string, value: Team) => {
      seasonWrites += 1
      writtenTeam = value
      return 'season-new'
    },
    writeTeamDay: async () => {
      dayWrites += 1
      return 'day-new'
    },
  } as unknown as GitHubTeamRepository

  const realCalendars = {
    getCalendar: async () => {
      throw new Error('offline replay must not use the old fixture as a timing authorization gate')
    },
  } as unknown as GitHubRealCalendarRepository

  const writer = new GroupFormationWriter(
    async () => currentGroup,
    games,
    teams,
    realCalendars,
    () => NOW,
  )

  return {
    writer,
    currentGroup,
    get seasonWrites() { return seasonWrites },
    get dayWrites() { return dayWrites },
    get writtenTeam() { return writtenTeam },
  }
}

const swap = [
  { playerKey: getPlayerKey('Forward starter 1'), position: FantaSoccerRole.Tribune },
  { playerKey: getPlayerKey('Forward tribune'), position: FantaSoccerRole.Forward },
]

test('an offline formation queued before kickoff rolls into the season Team when its original fixture is now historical', async () => {
  const fixture = makeWriter({ live: false, canEdit: false })

  const saved = await fixture.writer.saveGameFormation({
    session: session(fixture.currentGroup),
    leagueId: 'league-a',
    season: 2026,
    gameId: 'game-1',
    owner: OWNER,
    positions: swap,
    offlineReplay: true,
  })

  assert.equal(saved.source, 'season')
  assert.equal(fixture.seasonWrites, 1)
  assert.equal(fixture.dayWrites, 0)
  assert.equal(fixture.writtenTeam?.players.find(player => player.name === 'Forward starter 1')?.position, FantaSoccerRole.Tribune)
  assert.equal(fixture.writtenTeam?.players.find(player => player.name === 'Forward tribune')?.position, FantaSoccerRole.Forward)
})

test('an offline replay never consumes live changes or mutates TeamDay even if the original fixture is inside the live-change window', async () => {
  const fixture = makeWriter({ live: true, canEdit: true, liveFormationChanges: 2 })

  const saved = await fixture.writer.saveGameFormation({
    session: session(fixture.currentGroup),
    leagueId: 'league-a',
    season: 2026,
    gameId: 'game-1',
    owner: OWNER,
    positions: swap,
    offlineReplay: true,
  })

  assert.equal(saved.source, 'season')
  assert.equal(fixture.seasonWrites, 1)
  assert.equal(fixture.dayWrites, 0)
  assert.equal(fixture.writtenTeam?.formationChanges ?? 0, 0)
})

function team(): Team {
  const players: Player[] = [
    player('Goalkeeper starter', Role.GoalKeeper, FantaSoccerRole.GoalKeeper),
    player('Defender starter 1', Role.Defensor, FantaSoccerRole.Defensor),
    player('Defender starter 2', Role.Defensor, FantaSoccerRole.Defensor),
    player('Defender starter 3', Role.Defensor, FantaSoccerRole.Defensor),
    player('Defender starter 4', Role.Defensor, FantaSoccerRole.Defensor),
    player('Midfielder starter 1', Role.Midfielder, FantaSoccerRole.Midfielder),
    player('Midfielder starter 2', Role.Midfielder, FantaSoccerRole.Midfielder),
    player('Midfielder starter 3', Role.Midfielder, FantaSoccerRole.Midfielder),
    player('Forward starter 1', Role.Forward, FantaSoccerRole.Forward),
    player('Forward starter 2', Role.Forward, FantaSoccerRole.Forward),
    player('Forward starter 3', Role.Forward, FantaSoccerRole.Forward),
    player('Goalkeeper backup', Role.GoalKeeper, FantaSoccerRole.BackupGoalKeeper),
    player('Defender backup 1', Role.Defensor, FantaSoccerRole.FirstBackupDefensor),
    player('Defender backup 2', Role.Defensor, FantaSoccerRole.SecondBackupDefensor),
    player('Midfielder backup 1', Role.Midfielder, FantaSoccerRole.FirstBackupMidfielder),
    player('Midfielder backup 2', Role.Midfielder, FantaSoccerRole.SecondBackupMidfielder),
    player('Forward backup 1', Role.Forward, FantaSoccerRole.FirstBackupForward),
    player('Forward backup 2', Role.Forward, FantaSoccerRole.SecondBackupForward),
    player('Forward tribune', Role.Forward, FantaSoccerRole.Tribune),
    player('Tribune 2', Role.GoalKeeper, FantaSoccerRole.Tribune),
    player('Tribune 3', Role.Defensor, FantaSoccerRole.Tribune),
    player('Tribune 4', Role.Defensor, FantaSoccerRole.Tribune),
    player('Tribune 5', Role.Midfielder, FantaSoccerRole.Tribune),
    player('Tribune 6', Role.Midfielder, FantaSoccerRole.Tribune),
    player('Tribune 7', Role.Forward, FantaSoccerRole.Tribune),
  ]
  return {
    name: 'Owner Team', owner: OWNER, additionalOwners: [], players,
    moneyFromRank: 0, openingCompetitionPrize: 0, formationChanges: 0, lastUpdate: null,
  }
}

function player(name: string, role: Role, position: FantaSoccerRole): Player {
  return {
    name,
    team: { name: 'Roma', abbreviation: 'ROM' },
    role,
    isActive: true,
    visible: true,
    price: 1,
    revenue: 0,
    status: PlayerInTeamStatus.Active,
    position,
  }
}
