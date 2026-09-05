import {
  ChanceType,
  defaultChance,
  normalizeRealTeam,
  type ChanceObservation,
} from '@fantazone/domain'

export function parseFantagazzettaProbableLineups(html: string): ChanceObservation[] {
  if (!html.trim()) return []
  const players: ChanceObservation[] = []
  const lists = html.split('<ul class="player-list starters">').slice(1)
  for (const list of lists) {
    for (const item of list.split('<li class="player-item').slice(1, 12)) {
      const nameMatch = item.match(/<span>([^<]*)<\/span>/i)
      const teamMatch = item.match(/href="https:\/\/www\.fantacalcio\.it\/serie-a\/squadre\/([^/"?]+)\//i)
      const name = htmlDecode(nameMatch?.[1] ?? '').trim()
      const teamName = teamMatch?.[1]?.trim() ?? ''
      if (!name || !teamName) continue
      players.push({
        name,
        team: normalizeRealTeam({ name: teamName, abbreviation: '' }),
        chance: { ...defaultChance(), fantagazzetta: true },
      })
    }
  }
  return players
}

export function parseGazzettaProbableLineups(html: string): ChanceObservation[] {
  if (!html.trim()) return []
  const players: ChanceObservation[] = []
  const matches = html.split('class="bck-box-match-details').slice(1)
  for (const rawMatch of matches) {
    const match = rawMatch.split('class="go-above-container')[0] ?? ''
    const lists = match.split('<ul')
    if (lists.length < 3) continue
    const teams = lists[0].split('https://www.gazzetta.it/calcio/squadre/')
    if (teams.length < 3) continue
    addPlayers(lists[1], teams[1].split('/')[0])
    addPlayers(lists[2], teams[2].split('/')[0])
  }
  return players

  function addPlayers(fragment: string, teamValue: string): void {
    const teamName = teamValue.trim()
    if (!teamName) return
    const team = normalizeRealTeam({ name: teamName, abbreviation: '' })
    for (const match of fragment.matchAll(/<span class="lineup-team__name">([^<]*)<\/span>/gi)) {
      const name = htmlDecode(match[1] ?? '').trim().toLocaleLowerCase('it-IT')
      if (!name) continue
      players.push({
        name,
        team,
        chance: { ...defaultChance(), gazzetta: true },
      })
    }
  }
}

export function parseFantacalcioInjuries(html: string): ChanceObservation[] {
  if (!html.trim()) return []
  const players: ChanceObservation[] = []
  for (const teamFragment of html.split('<div id="team-').slice(1, 21)) {
    const teamMatch = teamFragment.match(/<span class="team-name">([^<]*)<\/span>/i)
    const teamName = htmlDecode(teamMatch?.[1] ?? '').trim()
    if (!teamName) continue
    const team = normalizeRealTeam({ name: teamName, abbreviation: '' })
    const headers = teamFragment.split('<header>').slice(1)
    for (let index = 0; index < headers.length; index += 1) {
      const status = index + 1
      if (status > ChanceType.Maybe) break
      for (const possiblePlayer of headers[index].split('<strong class="item-name">').slice(1)) {
        const name = htmlDecode(possiblePlayer.split('<')[0] ?? '').trim().toLocaleLowerCase('it-IT')
        if (!name) continue
        const descriptionExpression = index === 0
          ? /<p>([^<]*)<\/p>/i
          : /<p class="item-description">([^<]*)<\/p>/i
        const description = htmlDecode(possiblePlayer.match(descriptionExpression)?.[1] ?? '').trim()
        if (!description) continue
        players.push({
          name,
          team,
          chance: {
            ...defaultChance(),
            status: status as ChanceType,
            description,
          },
        })
      }
    }
  }
  return players
}

function htmlDecode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&apos;|&#39;|&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
}
