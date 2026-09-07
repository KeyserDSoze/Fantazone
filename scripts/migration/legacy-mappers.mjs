function requiredObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value
}

function asArray(value) { return Array.isArray(value) ? value : [] }
function num(value, fallback = 0) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
function bool(value, fallback = false) { return typeof value === 'boolean' ? value : fallback }
function str(value, fallback = '') { return typeof value === 'string' ? value : fallback }
function nullableString(value) { return typeof value === 'string' ? value : null }

export function unwrapRystemEntity(text, context = 'blob') {
  let root
  try { root = JSON.parse(text) } catch (error) { throw new Error(`Invalid JSON in ${context}: ${error.message}`) }
  requiredObject(root, `Rystem entity in ${context}`)
  const hasCompact = Object.prototype.hasOwnProperty.call(root, 'k') || Object.prototype.hasOwnProperty.call(root, 'v')
  const hasLong = Object.prototype.hasOwnProperty.call(root, 'Key') || Object.prototype.hasOwnProperty.call(root, 'Value')
  if (!hasCompact && !hasLong) return { key: null, value: root, enveloped: false }
  const key = Object.prototype.hasOwnProperty.call(root, 'k') ? root.k : root.Key
  const value = Object.prototype.hasOwnProperty.call(root, 'v') ? root.v : root.Value
  if (value === undefined) throw new Error(`Rystem entity in ${context} has no value`)
  return { key, value, enveloped: true }
}

export function mapLegacyRealTeam(raw) {
  requiredObject(raw, 'legacy RealTeam')
  return { name: str(raw.n), abbreviation: str(raw.a) }
}

export function mapLegacyRealPlayer(raw) {
  requiredObject(raw, 'legacy RealPlayer')
  return {
    name: str(raw.n),
    team: mapLegacyRealTeam(raw.t),
    role: num(raw.r, -1),
    isActive: bool(raw.a),
    visible: raw.vh === undefined ? true : bool(raw.vh, true),
  }
}

export function getLegacyPlayerKey(name) {
  return str(name).toLowerCase().replace(/[^a-z]/g, '')
}

export function mapLegacyPlayer(raw) {
  return {
    ...mapLegacyRealPlayer(raw),
    price: num(raw.p),
    revenue: num(raw.rv),
    status: num(raw.s),
    position: num(raw.k, -2),
  }
}

export function mapLegacyTeam(raw) {
  requiredObject(raw, 'legacy Team')
  return {
    name: str(raw.n),
    owner: str(raw.o),
    additionalOwners: asArray(raw.a).map(value => str(value)).filter(Boolean),
    players: asArray(raw.p).map(mapLegacyPlayer),
    moneyFromRank: num(raw.m),
    lastUpdate: nullableString(raw.d),
  }
}

export function mapLegacySeasonTeam(raw) {
  const team = mapLegacyTeam(raw)
  return {
    version: 3,
    name: team.name,
    owner: team.owner,
    additionalOwners: team.additionalOwners,
    players: team.players.map(player => {
      const playerKey = getLegacyPlayerKey(player.name)
      if (!playerKey) throw new Error(`Player '${player.name}' does not produce a valid legacy player key`)
      return {
        playerKey,
        price: player.price,
        revenue: player.revenue,
        status: player.status,
        position: player.position,
      }
    }),
    moneyFromRank: team.moneyFromRank,
    lastUpdate: team.lastUpdate,
  }
}

function mapVoteSettings(raw) {
  requiredObject(raw, 'legacy vote settings')
  return {
    goal: num(raw.g), penalty: num(raw.p), sufferedGoal: num(raw.s), stoppedPenalty: num(raw.d),
    wrongedPenalty: num(raw.w), ownGoal: num(raw.o), assist: num(raw.a), yellowCard: num(raw.y),
    redCard: num(raw.r), injury: num(raw.j), manOfTheMatch: num(raw.m),
  }
}

function mapLeagueRound(raw) {
  requiredObject(raw, 'legacy league round')
  return {
    name: raw.n == null ? null : str(raw.n),
    type: num(raw.t),
    fromStart: bool(raw.f),
    fromRankingStartTeam: raw.s == null ? null : num(raw.s),
    fromRankingEndTeam: raw.e == null ? null : num(raw.e),
  }
}

function mapLeagueTypeNumbers(raw) {
  requiredObject(raw, 'legacy league type numbers')
  return {
    maxPlayersInTeam: num(raw.t),
    maxGoalKeepersInTeam: num(raw.g),
    maxDefendersInTeam: num(raw.d),
    maxMidfieldersInTeam: num(raw.m),
    maxForwardsInTeam: num(raw.f),
    maxGoalKeepersInBench: num(raw.mg),
    maxDefendersInBench: num(raw.md),
    maxMidfieldersInBench: num(raw.mb),
    maxForwardsInBench: num(raw.fb),
  }
}

function mapLeagueTypeSettings(raw) {
  if (raw == null) return null
  requiredObject(raw, 'legacy league type settings')
  return {
    calendarType: num(raw.t),
    rounds: asArray(raw.r).map(mapLeagueRound),
    numbers: mapLeagueTypeNumbers(raw.n),
    fromPreviousYear: raw.fpy == null ? null : {
      leaguesId: asArray(raw.fpy.l).map(value => str(value)),
      maxTeamsPerLeague: num(raw.fpy.m),
      roundType: num(raw.fpy.t),
    },
    cardTrainer: { maxCardsPerType: requiredObject(raw.ct?.c ?? {}, 'legacy card trainer settings') },
  }
}

function mapLeagueSetting(raw) {
  requiredObject(raw, 'legacy league setting')
  const votes = {}
  for (const [role, value] of Object.entries(requiredObject(raw.v ?? {}, 'legacy vote dictionary'))) votes[role] = mapVoteSettings(value)
  return {
    votes,
    formation: num(raw.frm),
    typeSettings: mapLeagueTypeSettings(raw.lt),
    startingMoney: num(raw.s), delayedDay: num(raw.d), cancelledDay: num(raw.c),
    pointForFirstGoal: num(raw.g), pointForNextGoal: num(raw.t), pointForOwnGoal: num(raw.o),
    differencePointForOwnGoal: num(raw.f), pointInHome: num(raw.p), pointForVictory: num(raw.a),
    pointForDefeat: num(raw.b), pointForDraw: num(raw.h), pointForStrongDefense: num(raw['3']),
    pointForStrongDefense4: num(raw['4']), pointForStrongDefense5: num(raw['5']),
    pointForGoodPeople: num(raw.gp), pointForCleanSheet: num(raw.l), moneyForGoal: num(raw.m),
    moneyForSufferedGoal: num(raw.n), randomAuction: bool(raw.q), rankWithValuePoints: bool(raw.vp), market: num(raw.mk),
  }
}

export function mapLegacyGroup(raw) {
  requiredObject(raw, 'legacy Group')
  return {
    id: str(raw.i),
    name: str(raw.n),
    leagues: asArray(raw.l).map(league => ({
      id: str(league.i), name: str(league.n), isMain: bool(league.m), type: num(league.t),
      years: asArray(league.y).map(year => ({ year: num(year.y), type: num(year.t), settings: mapLeagueSetting(year.s) })),
      basketsId: asArray(league.b).map(value => str(value)),
    })),
    users: asArray(raw.u).map(user => ({ username: str(user.u), email: str(user.e), role: num(user.r) })),
    baskets: asArray(raw.b).map(basket => ({
      id: str(basket.i), name: str(basket.n),
      years: asArray(basket.y).map(year => ({
        year: num(year.y),
        teams: asArray(year.t).map(team => ({ name: str(team.n), owner: str(team.o), additionalOwners: asArray(team.a).map(value => str(value)) })),
      })),
    })),
  }
}

function mapPoint(raw) {
  requiredObject(raw, 'legacy point')
  return { value: num(raw.v), defensiveBonus: bool(raw.d), goodPeople: bool(raw.g), ownGoal: bool(raw.o) }
}
function mapGameResult(raw) {
  if (raw == null) return null
  requiredObject(raw, 'legacy game result')
  return { home: mapPoint(raw.h), away: mapPoint(raw.a), isCancelled: bool(raw.i), homeGoals: num(raw.g), awayGoals: num(raw.l) }
}
export function mapLegacyCalendarGame(raw) {
  requiredObject(raw, 'legacy calendar game')
  return { id: str(raw.i), number: num(raw.n), home: str(raw.h), homeOwner: str(raw.o), away: str(raw.a), awayOwner: str(raw.u), result: mapGameResult(raw.r) }
}
export function mapLegacyCalendar(raw) {
  requiredObject(raw, 'legacy Calendar')
  const rounds = {}
  for (const [round, days] of Object.entries(requiredObject(raw.r ?? {}, 'legacy calendar rounds'))) {
    rounds[round] = asArray(days).map(day => ({ serieADay: num(day.a), number: num(day.n), games: asArray(day.g).map(mapLegacyCalendarGame) }))
  }
  return { year: num(raw.y), rounds }
}

export function mapLegacyRankedTeam(raw) {
  requiredObject(raw, 'legacy RankedTeam')
  const plusMoney = num(raw.z), money = num(raw.m)
  return {
    name: str(raw.n), owner: str(raw.o), point: num(raw.p), victories: num(raw.v), draws: num(raw.d), defeats: num(raw.e),
    goal: num(raw.g), sufferedGoal: num(raw.s), valuePoint: num(raw.x), sufferedValuePoint: num(raw.w), plusMoney, money,
    valueAssets: money + plusMoney,
  }
}
export function mapLegacyRank(raw) {
  requiredObject(raw, 'legacy Rank')
  const rounds = {}
  for (const [round, teams] of Object.entries(requiredObject(raw.r ?? {}, 'legacy rank rounds'))) rounds[round] = asArray(teams).map(mapLegacyRankedTeam)
  return { serieADay: num(raw.d), rounds }
}

export function mapLegacyRealCalendar(raw) {
  requiredObject(raw, 'legacy RealCalendar')
  return {
    year: num(raw.y),
    days: asArray(raw.d).map(day => ({
      year: num(day.y), serieADay: num(day.a),
      games: asArray(day.g).map(game => ({
        home: mapLegacyRealTeam(game.h), away: mapLegacyRealTeam(game.a),
        date: typeof game.d === 'string' ? game.d : null,
        homeGoals: game.g == null ? null : num(game.g), awayGoals: game.y == null ? null : num(game.y), delayed: bool(game.e),
      })),
    })),
  }
}

export function mapLegacyRealTeams(raw, year) {
  requiredObject(raw, 'legacy RealTeamWrapper')
  return { year: num(year), teams: asArray(raw.t).map(mapLegacyRealTeam) }
}
export function mapLegacyRealPlayers(raw, year) {
  requiredObject(raw, 'legacy RealPlayersWrapper')
  return { year: num(year), players: asArray(raw.p).map(mapLegacyRealPlayer) }
}

function mapLegacyVote(raw) {
  if (raw == null) return null
  requiredObject(raw, 'legacy Vote')
  return {
    role: num(raw.r, -1), value: num(raw.v), isFinal: bool(raw.i), goal: num(raw.g), penalty: num(raw.p), assist: num(raw.a),
    stoppedPenalty: num(raw.s), sufferedGoal: num(raw.d), wrongedPenalty: num(raw.w), ownGoal: num(raw.o), status: num(raw.t),
    manOfTheMatch: bool(raw.c), hasVote: bool(raw.h), isOut: bool(raw.u), isIn: bool(raw.n), injured: bool(raw.j),
  }
}
export function mapLegacyVotes(raw, year, serieADay) {
  requiredObject(raw, 'legacy VotedRealPlayerWrapper')
  return {
    year: num(year), serieADay: num(serieADay),
    players: asArray(raw.p).map(player => ({ ...mapLegacyRealPlayer(player), vote: mapLegacyVote(player.v) })),
  }
}

function mapStatGame(raw) {
  requiredObject(raw, 'legacy StatPlayerGame')
  return { serieADay: num(raw.d), vote: raw.v == null ? null : num(raw.v), positiveness: num(raw.p) }
}
function mapStatPlayer(raw) {
  const base = mapLegacyRealPlayer(raw)
  return {
    ...base, summatory: num(raw.z), fantaSummatory: num(raw.f), withVote: num(raw.v), withoutVote: num(raw.q), noPlayed: num(raw.np),
    withSpecial: num(raw.s), goals: num(raw.g), penalties: num(raw.p), assists: num(raw.u), stoppedPenalties: num(raw.j),
    sufferedGoals: num(raw.m), wrongedPenalties: num(raw.w), ownGoals: num(raw.o), yellowCards: num(raw.y), redCards: num(raw.d),
    enoughVotes: num(raw.e), manOfTheMatch: num(raw.c), injured: num(raw.ij), games: asArray(raw.lg).map(mapStatGame),
  }
}
export function mapLegacyStats(raw, year) {
  requiredObject(raw, 'legacy StatPlayersWrapper')
  const players = asArray(raw.p).map(mapStatPlayer)
  const untilSerieADay = players.flatMap(player => player.games).reduce((max, game) => Math.max(max, game.serieADay), 0)
  return { year: num(year), untilSerieADay, players }
}

function mapChance(raw) {
  requiredObject(raw, 'legacy Chance')
  return {
    fantagazzetta: bool(raw.f), gazzetta: bool(raw.g), mediaset: bool(raw.m), sky: bool(raw.s), status: num(raw.t),
    description: raw.d == null ? null : str(raw.d), lastGame: raw.l == null ? null : mapStatGame(raw.l), trend: num(raw.r, 2),
  }
}
export function mapLegacyChances(raw, year, serieADay) {
  requiredObject(raw, 'legacy ChancedRealPlayerWrapper')
  return { year: num(year), serieADay: num(serieADay), players: asArray(raw.p).map(player => ({ ...mapLegacyRealPlayer(player), chance: mapChance(player.c) })) }
}

function mapHallRankedTeam(raw) { return mapLegacyRankedTeam(raw) }
function mapRecordPlayer(raw) { return raw == null ? null : { player: mapLegacyPlayer(raw.p), points: num(raw.pts) } }
export function mapLegacyHallOfFame(raw) {
  requiredObject(raw, 'legacy HallOfFame')
  return {
    recordGame: raw.rg == null ? null : { game: mapLegacyCalendarGame(raw.rg.g), year: num(raw.rg.y) },
    recordPlayer: mapRecordPlayer(raw.rp),
    playerWithMostPointsInYear: raw.ppmy == null ? null : { player: mapLegacyPlayer(raw.ppmy.p), year: num(raw.ppmy.y), points: num(raw.ppmy.pts) },
    winningPlayers: asArray(raw.wp).map(item => ({ player: mapLegacyPlayer(item.p), wins: requiredObject(item.w ?? {}, 'legacy winning player wins') })),
    winningTeams: asArray(raw.wt).map(item => ({ owner: str(item.o), teamName: str(item.t), wins: requiredObject(item.w ?? {}, 'legacy winning team wins') })),
    allTimeRankings: asArray(raw.rts).map(mapHallRankedTeam),
  }
}

export function prettyJson(value) { return `${JSON.stringify(value, null, 2)}\n` }
