import { getPlayerKey, type RealPlayers } from './realPlayer'
import { PlayerInTeamStatus, type Team } from './team'

export type TeamPlayerTransferSyncResult = {
  team: Team
  changedPlayerKeys: string[]
}

/**
 * Mirrors legacy AllPlayersAndAllTeamsJob propagation into fantasy rosters.
 * Only active fantasy players inherit the current canonical Serie A team.
 * Historical/sold roster entries and every other fantasy-player field are preserved.
 */
export function syncTeamPlayerTransfers(team: Team, master: RealPlayers): TeamPlayerTransferSyncResult {
  const byKey = new Map(master.players.map(player => [getPlayerKey(player.name), player] as const))
  const changedPlayerKeys: string[] = []
  let changed = false

  const players = team.players.map(player => {
    if (player.status !== PlayerInTeamStatus.Active) return player
    const key = getPlayerKey(player.name)
    const canonical = byKey.get(key)
    if (!canonical || normalizeTeam(canonical.team.name) === normalizeTeam(player.team?.name)) return player

    changed = true
    changedPlayerKeys.push(key)
    return {
      ...player,
      team: { ...canonical.team },
    }
  })

  return {
    team: changed ? { ...team, players } : team,
    changedPlayerKeys,
  }
}

function normalizeTeam(value?: string | null): string {
  return value?.trim().toLocaleLowerCase('it-IT') ?? ''
}
