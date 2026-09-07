import {
  getLegacyPlayerKey, mapLegacyCalendarCompatible, mapLegacyChances, mapLegacyGroup, mapLegacyHallOfFame, mapLegacyRank,
  mapLegacyRealCalendar, mapLegacyRealPlayers, mapLegacyRealTeams, mapLegacySeasonTeam,
  mapLegacyStats, mapLegacyTeam, mapLegacyVotes, prettyJson,
} from './legacy-mappers.mjs'

const WRITABLE_CONTAINERS = new Set([
  'group', 'calendar', 'rank', 'dailyrank', 'team', 'dailyteams', 'halloffame',
  'realcalendar', 'realteamwrapper', 'realplayerswrapper', 'official', 'live', 'statplayerswrapper', 'chancedrealplayerwrapper',
])

export const RETIRED_OR_UNSUPPORTED_CONTAINERS = new Set([
  'settings', 'livegroup', 'marketwrapper', 'playedgame', 'teamwithai', 'appidentity', 'randomizedplayers',
  'notification', 'pushnotificationsent', 'pushnotification', 'auction', 'cards', 'news', 'images', 'logos', 'cardimages', 'logs', 'realrank',
])

export function shouldDownloadContainer(name) { return WRITABLE_CONTAINERS.has(name.toLowerCase()) }

function norm(value) { return String(value ?? '').trim().toLowerCase() }
function pathSegment(value) { return encodeURIComponent(String(value).trim()) }
function repoBaseName(repo) { return repo.includes('/') ? repo.slice(repo.lastIndexOf('/') + 1) : repo }
function groupHintFromRepository(repo) { return repoBaseName(repo).replace(/^fantazone[._-]?/i, '') }
function slug(value) { return norm(value).replace(/[^a-z0-9]/g, '') }
function asArray(value) { return Array.isArray(value) ? value : [] }

function keyObject(record, label) {
  if (!record.key || typeof record.key !== 'object' || Array.isArray(record.key)) throw new Error(`${label} requires a structured Rystem key (${record.container}/${record.blobName})`)
  return record.key
}
function keyNumber(record, label) {
  const value = typeof record.key === 'number' ? record.key : Number(record.key)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} requires a positive numeric Rystem key (${record.container}/${record.blobName})`)
  return value
}
function addFile(map, file) {
  const existing = map.get(file.path)
  if (existing) throw new Error(`Multiple legacy blobs map to '${file.path}': ${existing.source} and ${file.source}`)
  map.set(file.path, file)
}
function plannedFile(target, path, content, source) {
  return { kind: 'file', target, file: { path, content, source } }
}
function skippedRecord(reason) { return { kind: 'skip', reason } }

export function resolveGroup(records, groupRepository, explicitGroupId) {
  const groups = records.filter(record => record.container === 'group').map(record => ({ record, group: mapLegacyGroup(record.value) }))
  if (!groups.length) throw new Error("No legacy 'group' blob was found")
  if (explicitGroupId) {
    const selected = groups.find(item => norm(item.group.id) === norm(explicitGroupId))
    if (!selected) throw new Error(`Legacy group '${explicitGroupId}' was not found`)
    return selected.group
  }
  const hint = groupHintFromRepository(groupRepository)
  const matches = groups.filter(item => slug(item.group.id) === slug(hint) || slug(item.group.name) === slug(hint))
  if (matches.length === 1) return matches[0].group
  if (groups.length === 1) return groups[0].group
  throw new Error(`Cannot select a single legacy group for repository '${groupRepository}'. Use -GroupId. Candidates: ${groups.map(x => `${x.group.id} (${x.group.name})`).join(', ')}`)
}

function belongsToGroup(key, groupId) { return norm(key.g ?? key.group) === norm(groupId) }

function buildMasterPlayersByYear(records) {
  const byYear = new Map()
  for (const record of records) {
    if (record.container.toLowerCase() !== 'realplayerswrapper') continue
    const year = keyNumber(record, 'RealPlayersWrapper')
    const players = new Map()
    for (const player of asArray(record.value?.p)) {
      const key = getLegacyPlayerKey(player?.n)
      if (!key) continue
      if (!players.has(key)) players.set(key, player)
    }
    byYear.set(year, players)
  }
  return byYear
}

/** Build stable context once, then individual records can be planned/staged independently. */
export function createMigrationContext(records, options) {
  const group = resolveGroup(records, options.groupRepository, options.groupId)
  return {
    group,
    selectedGroupId: group.id,
    masterPlayersByYear: buildMasterPlayersByYear(records),
  }
}

function enrichLegacyVotesFromMaster(raw, year, context) {
  const masters = context.masterPlayersByYear.get(Number(year))
  if (!masters || !raw || typeof raw !== 'object' || Array.isArray(raw)) return raw

  return {
    ...raw,
    p: asArray(raw.p).map(player => {
      if (!player || typeof player !== 'object' || Array.isArray(player) || player.t != null) return player
      const master = masters.get(getLegacyPlayerKey(player.n))
      if (!master?.t) return player
      // Historical live providers sometimes persisted only name + vote and left RealPlayer.Team null.
      // In that case use the same-season RealPlayers master for immutable player metadata while
      // preserving the historical vote payload itself.
      return {
        ...player,
        t: master.t,
        r: master.r ?? player.r,
        a: master.a ?? player.a,
        vh: player.vh ?? master.vh,
      }
    }),
  }
}

/** Plan exactly one cached Azure record. This is the resumable migration unit. */
export function planMigrationRecord(record, context) {
  const c = record.container.toLowerCase()
  try {
    if (c === 'group') {
      const group = mapLegacyGroup(record.value)
      if (norm(group.id) !== norm(context.selectedGroupId)) return skippedRecord('other-group')
      return plannedFile('group', 'config/group.json', prettyJson(group), `group:${group.id}`)
    }
    if (c === 'calendar') {
      const k = keyObject(record, 'Calendar'); if (!belongsToGroup(k, context.selectedGroupId)) return skippedRecord('other-group')
      return plannedFile('group', `data/groups/seasons/${k.y}/leagues/${pathSegment(k.l)}/calendar.json`, prettyJson(mapLegacyCalendarCompatible(record.value)), `${c}/${record.blobName}`)
    }
    if (c === 'rank') {
      const k = keyObject(record, 'Rank'); if (!belongsToGroup(k, context.selectedGroupId)) return skippedRecord('other-group')
      return plannedFile('group', `data/groups/seasons/${k.y}/leagues/${pathSegment(k.l)}/ranking.json`, prettyJson(mapLegacyRank(record.value)), `${c}/${record.blobName}`)
    }
    if (c === 'dailyrank') {
      const k = keyObject(record, 'Daily Rank'); if (!belongsToGroup(k, context.selectedGroupId)) return skippedRecord('other-group')
      return plannedFile('group', `data/groups/seasons/${k.y}/leagues/${pathSegment(k.l)}/days/${k.d}/ranking.json`, prettyJson(mapLegacyRank(record.value)), `${c}/${record.blobName}`)
    }
    if (c === 'team') {
      const k = keyObject(record, 'Team'); if (!belongsToGroup(k, context.selectedGroupId)) return skippedRecord('other-group')
      return plannedFile('group', `data/groups/seasons/${k.y}/teams/${pathSegment(k.b)}/${String(k.e).trim()}.json`, prettyJson(mapLegacySeasonTeam(record.value)), `${c}/${record.blobName}`)
    }
    if (c === 'dailyteams') {
      const k = keyObject(record, 'TeamDay'); if (!belongsToGroup(k, context.selectedGroupId)) return skippedRecord('other-group')
      return plannedFile('group', `data/groups/seasons/${k.y}/days/${k.d}/teams/${pathSegment(k.b)}/${String(k.e).trim()}.json`, prettyJson(mapLegacyTeam(record.value)), `${c}/${record.blobName}`)
    }
    if (c === 'halloffame') {
      const k = keyObject(record, 'HallOfFame'); if (!belongsToGroup(k, context.selectedGroupId)) return skippedRecord('other-group')
      return plannedFile('group', `data/groups/leagues/${pathSegment(k.l)}/hall-of-fame.json`, prettyJson(mapLegacyHallOfFame(record.value)), `${c}/${record.blobName}`)
    }
    if (c === 'realcalendar') {
      const y = keyNumber(record, 'RealCalendar')
      return plannedFile('platform', `data/serie-a/calendars/${y}.json`, prettyJson(mapLegacyRealCalendar(record.value)), `${c}/${record.blobName}`)
    }
    if (c === 'realteamwrapper') {
      const y = keyNumber(record, 'RealTeamWrapper')
      return plannedFile('platform', `data/serie-a/teams/${y}.json`, prettyJson(mapLegacyRealTeams(record.value, y)), `${c}/${record.blobName}`)
    }
    if (c === 'realplayerswrapper') {
      const y = keyNumber(record, 'RealPlayersWrapper')
      return plannedFile('platform', `data/serie-a/players/${y}.json`, prettyJson(mapLegacyRealPlayers(record.value, y)), `${c}/${record.blobName}`)
    }
    if (c === 'official' || c === 'live') {
      const k = keyObject(record, 'Serie A votes')
      const enriched = enrichLegacyVotesFromMaster(record.value, k.y, context)
      return plannedFile('platform', `data/serie-a/votes/${c}/${k.y}/${k.d}.json`, prettyJson(mapLegacyVotes(enriched, k.y, k.d)), `${c}/${record.blobName}`)
    }
    if (c === 'statplayerswrapper') {
      const y = keyNumber(record, 'StatPlayersWrapper')
      return plannedFile('platform', `data/serie-a/stats/${y}.json`, prettyJson(mapLegacyStats(record.value, y)), `${c}/${record.blobName}`)
    }
    if (c === 'chancedrealplayerwrapper') {
      const k = keyObject(record, 'ChancedRealPlayerWrapper')
      return plannedFile('platform', `data/serie-a/chances/${k.y}/${k.d}.json`, prettyJson(mapLegacyChances(record.value, k.y, k.d)), `${c}/${record.blobName}`)
    }
    return skippedRecord(RETIRED_OR_UNSUPPORTED_CONTAINERS.has(c) ? 'retired-or-not-canonical' : 'unknown-container')
  } catch (error) {
    throw new Error(`Cannot migrate ${record.container}/${record.blobName}: ${error.message}`)
  }
}

export function buildMigrationPlan(records, options) {
  const context = createMigrationContext(records, options)
  const groupFiles = new Map(), platformFiles = new Map(), skipped = []

  for (const record of records) {
    const result = planMigrationRecord(record, context)
    if (result.kind === 'skip') {
      if (result.reason !== 'other-group') skipped.push({ container: record.container.toLowerCase(), blobName: record.blobName, reason: result.reason })
      continue
    }
    addFile(result.target === 'group' ? groupFiles : platformFiles, result.file)
  }

  return {
    group: context.group,
    groupFiles: [...groupFiles.values()].sort((a, b) => a.path.localeCompare(b.path)),
    platformFiles: [...platformFiles.values()].sort((a, b) => a.path.localeCompare(b.path)),
    skipped,
  }
}
