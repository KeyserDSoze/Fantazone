function norm(value) { return String(value ?? '').trim().toLowerCase() }
function asArray(value) { return Array.isArray(value) ? value : [] }
function isObject(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
function hasOwn(value, key) { return isObject(value) && Object.prototype.hasOwnProperty.call(value, key) }
function playerName(value) { return typeof value?.n === 'string' ? value.n.trim() : '' }
function playerKey(value) { return playerName(value).toLowerCase().replace(/[^a-z]/g, '') }
function hasConcreteLegacyRole(value) { return Number.isInteger(value) && value >= 0 && value <= 3 }

function teamIdentity(key) {
  if (!isObject(key)) return null
  const group = norm(key.g ?? key.group)
  const year = Number(key.y ?? key.year)
  const basket = norm(key.b ?? key.basket)
  const owner = norm(key.e ?? key.email ?? key.owner)
  if (!group || !Number.isFinite(year) || !basket || !owner) return null
  return `${group}|${year}|${basket}|${owner}`
}

function teamOwnerIdentity(key) {
  if (!isObject(key)) return null
  const group = norm(key.g ?? key.group)
  const year = Number(key.y ?? key.year)
  const owner = norm(key.e ?? key.email ?? key.owner)
  if (!group || !Number.isFinite(year) || !owner) return null
  return `${group}|${year}|${owner}`
}

function candidateScore(source, candidate) {
  if (!isObject(source) || !isObject(candidate) || !playerKey(candidate)) return null
  let score = 0

  // Acquisition price survives even when old cleanup code has blanked the player's Serie A
  // identity, so it remains strong evidence.
  if (hasOwn(source, 'p') && source.p != null) {
    if (source.p !== candidate.p) return null
    score += 4
  }

  // Role -1 is Role.Undefined in the legacy model. Historical season-Team rows can end up with
  // name/team blank and r=-1 after a player leaves Serie A; that sentinel is missing metadata,
  // not evidence that the historical candidate must also have role -1.
  if (hasConcreteLegacyRole(source.r)) {
    if (source.r !== candidate.r) return null
    score += 4
  }

  // RealTeam is strong evidence only when the broken row still has actual team metadata.
  if (isObject(source.t)) {
    const sourceName = norm(source.t.n)
    const sourceAbbreviation = norm(source.t.a)
    if (sourceName || sourceAbbreviation) {
      if (!isObject(candidate.t)) return null
      if (sourceName) {
        if (sourceName !== norm(candidate.t.n)) return null
        score += 4
      }
      if (sourceAbbreviation) {
        if (sourceAbbreviation !== norm(candidate.t.a)) return null
        score += 2
      }
    }
  }

  // These properties may legitimately change between Team snapshots. Equal values increase
  // confidence, but a mismatch does not reject an otherwise strong historical candidate.
  const mutable = [
    ['rv', 1], // revenue
    ['s', 1],  // status
    ['k', 2],  // formation position
    ['a', 1],  // active flag
    ['vh', 1], // visibility
  ]
  for (const [field, weight] of mutable) {
    if (hasOwn(source, field) && source[field] != null && source[field] === candidate[field]) score += weight
  }

  return score
}

function describeBrokenPlayer(player) {
  if (!isObject(player)) return String(player)
  const fields = ['t', 'r', 'a', 'vh', 'p', 'rv', 's', 'k']
  const summary = {}
  for (const field of fields) if (hasOwn(player, field)) summary[field] = player[field]
  return JSON.stringify(summary)
}

function addPlayerSnapshot(index, identity, player) {
  if (!identity) return
  const keyName = playerKey(player)
  if (!keyName) return
  let bucket = index.get(identity)
  if (!bucket) { bucket = new Map(); index.set(identity, bucket) }
  let snapshots = bucket.get(keyName)
  if (!snapshots) { snapshots = []; bucket.set(keyName, snapshots) }
  snapshots.push(player)
}

function registerMirroredSeasonTeams(records, selectedGroupId, mirrors) {
  // Some old groups contain the exact same season Team under two basket ids, while TeamDay history
  // exists only under one of them. Cross-basket recovery is allowed only when the raw season-Team
  // payloads are exactly identical for the same group/year/owner; this proves they are aliases of
  // the same historical team rather than two unrelated teams owned by the same person.
  const byOwnerAndPayload = new Map()
  for (const record of records) {
    if (String(record?.container ?? '').toLowerCase() !== 'team') continue
    const key = record?.key
    if (!isObject(key) || norm(key.g ?? key.group) !== norm(selectedGroupId)) continue
    const identity = teamIdentity(key)
    const ownerIdentity = teamOwnerIdentity(key)
    if (!identity || !ownerIdentity) continue
    const payload = JSON.stringify(record.value ?? null)
    const signature = `${ownerIdentity}|${payload}`
    let identities = byOwnerAndPayload.get(signature)
    if (!identities) { identities = new Set(); byOwnerAndPayload.set(signature, identities) }
    identities.add(identity)
  }

  for (const identities of byOwnerAndPayload.values()) {
    if (identities.size < 2) continue
    const all = [...identities]
    for (const identity of all) {
      let aliases = mirrors.get(identity)
      if (!aliases) { aliases = new Set(); mirrors.set(identity, aliases) }
      for (const candidate of all) if (candidate !== identity) aliases.add(candidate)
    }
  }
}

/**
 * Build historical candidates from both season Teams and immutable TeamDay snapshots.
 * Only rows with a real player name are indexed. The primary key is group/year/basket/owner.
 * A secondary mirror map is populated only for exact duplicate season-Team payloads.
 */
export function buildHistoricalTeamPlayerIndex(records, selectedGroupId) {
  const index = new Map()
  const mirrors = new Map()
  for (const record of records) {
    const container = String(record?.container ?? '').toLowerCase()
    if (container !== 'team' && container !== 'dailyteams') continue
    const key = record?.key
    if (!isObject(key) || norm(key.g ?? key.group) !== norm(selectedGroupId)) continue
    const identity = teamIdentity(key)
    if (!identity) continue
    for (const player of asArray(record?.value?.p)) addPlayerSnapshot(index, identity, player)
  }
  registerMirroredSeasonTeams(records, selectedGroupId, mirrors)
  // Keep the public shape Map-compatible for the recovery caller/tests while carrying the proven
  // alias relation alongside it.
  index.mirrors = mirrors
  return index
}

function mergedCandidateBucket(identity, index) {
  const identities = [identity, ...(index?.mirrors?.get(identity) ?? [])]
  const merged = new Map()
  for (const currentIdentity of identities) {
    const bucket = index.get(currentIdentity)
    if (!bucket) continue
    for (const [nameKey, snapshots] of bucket) {
      let target = merged.get(nameKey)
      if (!target) { target = []; merged.set(nameKey, target) }
      target.push(...snapshots)
    }
  }
  return merged
}

function chooseHistoricalPlayer(source, key, index) {
  const identity = teamIdentity(key)
  const bucket = identity ? mergedCandidateBucket(identity, index) : null
  if (!bucket?.size) {
    const mirrorCount = identity ? (index?.mirrors?.get(identity)?.size ?? 0) : 0
    throw new Error(`Cannot recover unnamed legacy Team player: no historical Team/TeamDay candidates for ${identity ?? 'invalid team key'}${mirrorCount ? ` (including ${mirrorCount} proven mirrored basket)` : ''}; metadata=${describeBrokenPlayer(source)}`)
  }

  const scored = []
  for (const [nameKey, snapshots] of bucket) {
    let best = null
    for (const candidate of snapshots) {
      const score = candidateScore(source, candidate)
      if (score == null) continue
      if (!best || score > best.score) best = { score, candidate }
    }
    if (best) scored.push({ nameKey, ...best })
  }

  if (!scored.length) {
    throw new Error(`Cannot recover unnamed legacy Team player: no metadata-compatible historical candidate; metadata=${describeBrokenPlayer(source)}`)
  }

  scored.sort((a, b) => b.score - a.score || a.nameKey.localeCompare(b.nameKey))
  const bestScore = scored[0].score
  const best = scored.filter(item => item.score === bestScore)
  // Require substantial evidence. price+concrete-role, price+status+position+another matching
  // property, team+role, or equivalent combinations qualify. This permits legacy rows whose
  // identity was blanked to Role.Undefined while still failing closed on price-only guesses.
  if (bestScore < 8) {
    throw new Error(`Cannot recover unnamed legacy Team player safely: best historical score ${bestScore} is too weak; candidates=${best.slice(0, 5).map(x => x.nameKey).join(',')}; metadata=${describeBrokenPlayer(source)}`)
  }
  if (best.length !== 1) {
    throw new Error(`Cannot recover unnamed legacy Team player safely: ${best.length} historical candidates tie at score ${bestScore} (${best.slice(0, 5).map(x => x.nameKey).join(',')}); metadata=${describeBrokenPlayer(source)}`)
  }
  return best[0].candidate
}

/**
 * Repair only season-Team players whose legacy name is empty. A historical candidate must be
 * uniquely supported by the same group/year/basket/owner history, or by a basket whose season
 * Team is proven to be an exact duplicate of the target season Team.
 */
export function recoverUnnamedSeasonTeamPlayers(rawTeam, key, index) {
  if (!isObject(rawTeam)) return rawTeam
  return {
    ...rawTeam,
    p: asArray(rawTeam.p).map(player => {
      if (!isObject(player) || playerKey(player)) return player
      const historical = chooseHistoricalPlayer(player, key, index)
      return {
        ...historical,
        ...player,
        n: historical.n,
        t: isObject(player.t) ? player.t : historical.t,
        r: hasOwn(player, 'r') ? player.r : historical.r,
        a: hasOwn(player, 'a') ? player.a : historical.a,
        vh: hasOwn(player, 'vh') ? player.vh : historical.vh,
      }
    }),
  }
}
