function norm(value) { return String(value ?? '').trim().toLowerCase() }
function asArray(value) { return Array.isArray(value) ? value : [] }
function isObject(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
function hasOwn(value, key) { return isObject(value) && Object.prototype.hasOwnProperty.call(value, key) }
function playerName(value) { return typeof value?.n === 'string' ? value.n.trim() : '' }
function playerKey(value) { return playerName(value).toLowerCase().replace(/[^a-z]/g, '') }

function teamIdentity(key) {
  if (!isObject(key)) return null
  const group = norm(key.g ?? key.group)
  const year = Number(key.y ?? key.year)
  const basket = norm(key.b ?? key.basket)
  const owner = norm(key.e ?? key.email ?? key.owner)
  if (!group || !Number.isFinite(year) || !basket || !owner) return null
  return `${group}|${year}|${basket}|${owner}`
}

function candidateScore(source, candidate) {
  if (!isObject(source) || !isObject(candidate) || !playerKey(candidate)) return null
  let score = 0

  const strongNumeric = [
    ['p', 4],   // acquisition price
    ['r', 4],   // Serie A role
  ]
  for (const [field, weight] of strongNumeric) {
    if (!hasOwn(source, field) || source[field] == null) continue
    if (source[field] !== candidate[field]) return null
    score += weight
  }

  // RealTeam is strong evidence when the broken row still has it.
  if (isObject(source.t)) {
    if (!isObject(candidate.t)) return null
    const sourceName = norm(source.t.n)
    const sourceAbbreviation = norm(source.t.a)
    if (sourceName) {
      if (sourceName !== norm(candidate.t.n)) return null
      score += 4
    }
    if (sourceAbbreviation) {
      if (sourceAbbreviation !== norm(candidate.t.a)) return null
      score += 2
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

/**
 * Build historical candidates from both season Teams and immutable TeamDay snapshots.
 * Only rows with a real player name are indexed. The key is group/year/basket/owner.
 */
export function buildHistoricalTeamPlayerIndex(records, selectedGroupId) {
  const index = new Map()
  for (const record of records) {
    const container = String(record?.container ?? '').toLowerCase()
    if (container !== 'team' && container !== 'dailyteams') continue
    const key = record?.key
    if (!isObject(key) || norm(key.g ?? key.group) !== norm(selectedGroupId)) continue
    const identity = teamIdentity(key)
    if (!identity) continue

    let bucket = index.get(identity)
    if (!bucket) { bucket = new Map(); index.set(identity, bucket) }

    for (const player of asArray(record?.value?.p)) {
      const keyName = playerKey(player)
      if (!keyName) continue
      let snapshots = bucket.get(keyName)
      if (!snapshots) { snapshots = []; bucket.set(keyName, snapshots) }
      snapshots.push(player)
    }
  }
  return index
}

function chooseHistoricalPlayer(source, key, index) {
  const identity = teamIdentity(key)
  const bucket = identity ? index.get(identity) : null
  if (!bucket?.size) {
    throw new Error(`Cannot recover unnamed legacy Team player: no historical Team/TeamDay candidates for ${identity ?? 'invalid team key'}; metadata=${describeBrokenPlayer(source)}`)
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
  // Require substantial evidence. price+role, team+role, or equivalent combinations qualify.
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
 * uniquely supported by the same group/year/basket/owner Team/TeamDay history.
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
