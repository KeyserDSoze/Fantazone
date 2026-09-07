import {
  mapLegacyCalendar, mapLegacyChances, mapLegacyGroup, mapLegacyHallOfFame, mapLegacyRank,
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

export function buildMigrationPlan(records, options) {
  const group = resolveGroup(records, options.groupRepository, options.groupId)
  const groupFiles = new Map(), platformFiles = new Map(), skipped = []
  const selectedGroupId = group.id

  addFile(groupFiles, { path: 'config/group.json', content: prettyJson(group), source: `group:${group.id}` })

  for (const record of records) {
    const c = record.container.toLowerCase()
    try {
      if (c === 'group') continue
      if (c === 'calendar') {
        const k = keyObject(record, 'Calendar'); if (!belongsToGroup(k, selectedGroupId)) continue
        addFile(groupFiles, { path: `data/groups/seasons/${k.y}/leagues/${pathSegment(k.l)}/calendar.json`, content: prettyJson(mapLegacyCalendar(record.value)), source: `${c}/${record.blobName}` })
      } else if (c === 'rank') {
        const k = keyObject(record, 'Rank'); if (!belongsToGroup(k, selectedGroupId)) continue
        addFile(groupFiles, { path: `data/groups/seasons/${k.y}/leagues/${pathSegment(k.l)}/ranking.json`, content: prettyJson(mapLegacyRank(record.value)), source: `${c}/${record.blobName}` })
      } else if (c === 'dailyrank') {
        const k = keyObject(record, 'Daily Rank'); if (!belongsToGroup(k, selectedGroupId)) continue
        addFile(groupFiles, { path: `data/groups/seasons/${k.y}/leagues/${pathSegment(k.l)}/days/${k.d}/ranking.json`, content: prettyJson(mapLegacyRank(record.value)), source: `${c}/${record.blobName}` })
      } else if (c === 'team') {
        const k = keyObject(record, 'Team'); if (!belongsToGroup(k, selectedGroupId)) continue
        addFile(groupFiles, { path: `data/groups/seasons/${k.y}/teams/${pathSegment(k.b)}/${String(k.e).trim()}.json`, content: prettyJson(mapLegacySeasonTeam(record.value)), source: `${c}/${record.blobName}` })
      } else if (c === 'dailyteams') {
        const k = keyObject(record, 'TeamDay'); if (!belongsToGroup(k, selectedGroupId)) continue
        addFile(groupFiles, { path: `data/groups/seasons/${k.y}/days/${k.d}/teams/${pathSegment(k.b)}/${String(k.e).trim()}.json`, content: prettyJson(mapLegacyTeam(record.value)), source: `${c}/${record.blobName}` })
      } else if (c === 'halloffame') {
        const k = keyObject(record, 'HallOfFame'); if (!belongsToGroup(k, selectedGroupId)) continue
        addFile(groupFiles, { path: `data/groups/leagues/${pathSegment(k.l)}/hall-of-fame.json`, content: prettyJson(mapLegacyHallOfFame(record.value)), source: `${c}/${record.blobName}` })
      } else if (c === 'realcalendar') {
        const y = keyNumber(record, 'RealCalendar')
        addFile(platformFiles, { path: `data/serie-a/calendars/${y}.json`, content: prettyJson(mapLegacyRealCalendar(record.value)), source: `${c}/${record.blobName}` })
      } else if (c === 'realteamwrapper') {
        const y = keyNumber(record, 'RealTeamWrapper')
        addFile(platformFiles, { path: `data/serie-a/teams/${y}.json`, content: prettyJson(mapLegacyRealTeams(record.value, y)), source: `${c}/${record.blobName}` })
      } else if (c === 'realplayerswrapper') {
        const y = keyNumber(record, 'RealPlayersWrapper')
        addFile(platformFiles, { path: `data/serie-a/players/${y}.json`, content: prettyJson(mapLegacyRealPlayers(record.value, y)), source: `${c}/${record.blobName}` })
      } else if (c === 'official' || c === 'live') {
        const k = keyObject(record, 'Serie A votes')
        addFile(platformFiles, { path: `data/serie-a/votes/${c}/${k.y}/${k.d}.json`, content: prettyJson(mapLegacyVotes(record.value, k.y, k.d)), source: `${c}/${record.blobName}` })
      } else if (c === 'statplayerswrapper') {
        const y = keyNumber(record, 'StatPlayersWrapper')
        addFile(platformFiles, { path: `data/serie-a/stats/${y}.json`, content: prettyJson(mapLegacyStats(record.value, y)), source: `${c}/${record.blobName}` })
      } else if (c === 'chancedrealplayerwrapper') {
        const k = keyObject(record, 'ChancedRealPlayerWrapper')
        addFile(platformFiles, { path: `data/serie-a/chances/${k.y}/${k.d}.json`, content: prettyJson(mapLegacyChances(record.value, k.y, k.d)), source: `${c}/${record.blobName}` })
      } else {
        skipped.push({ container: c, blobName: record.blobName, reason: RETIRED_OR_UNSUPPORTED_CONTAINERS.has(c) ? 'retired-or-not-canonical' : 'unknown-container' })
      }
    } catch (error) {
      throw new Error(`Cannot migrate ${record.container}/${record.blobName}: ${error.message}`)
    }
  }

  return {
    group,
    groupFiles: [...groupFiles.values()].sort((a, b) => a.path.localeCompare(b.path)),
    platformFiles: [...platformFiles.values()].sort((a, b) => a.path.localeCompare(b.path)),
    skipped,
  }
}
