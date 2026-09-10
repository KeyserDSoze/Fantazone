import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  getAuthorizedEvolutionCardIds,
  getVerifiedEvolutionCardIds,
  resolveFantazoneEvolutionSettings,
  type EvolutionSeasonCoachDeckDocument,
  type LeagueSetting,
  type RealDay,
} from '@fantazone/domain'
import type { EvolutionCardsDocument } from '@fantazone/github'

const execFileAsync = promisify(execFile)

export interface EvolutionCardGitAuthority {
  commitmentFirstSeenAt: number | null
  revealFirstSeenAt: number | null
}

export async function getAuthoritativeEvolutionCardIds(input: {
  groupRepoRoot: string
  relativePath: string
  cards: EvolutionCardsDocument | null | undefined
  owner: string
  leagueId: string
  year: number
  serieADay: number
  settings: LeagueSetting
  deck: EvolutionSeasonCoachDeckDocument | null
  consumedCardIds: readonly string[]
  realDay: RealDay | null | undefined
}): Promise<string[] | null> {
  const sealed = input.cards?.commitments?.[normalize(input.owner)]
  if (!sealed?.reveal || !input.realDay) return null

  const firstKickoff = firstKickoffTime(input.realDay)
  if (firstKickoff == null) return null
  const evolution = resolveFantazoneEvolutionSettings(input.settings)
  const lockAt = firstKickoff - Math.max(0, evolution.coachCards.lockMinutesBeforeFirstKickoff) * 60_000
  const revealDeadline = firstKickoff + Math.max(0, evolution.coachCards.revealGraceSecondsAfterFirstKickoff) * 1_000
  const authority = await readEvolutionCardGitAuthority({
    groupRepoRoot: input.groupRepoRoot,
    relativePath: input.relativePath,
    cards: input.cards!,
    owner: input.owner,
    leagueId: input.leagueId,
    year: input.year,
    serieADay: input.serieADay,
  })

  if (authority.commitmentFirstSeenAt == null || authority.commitmentFirstSeenAt > lockAt) return null
  if (authority.revealFirstSeenAt == null || authority.revealFirstSeenAt > revealDeadline) return null

  return getAuthorizedEvolutionCardIds({
    sealed,
    leagueId: input.leagueId,
    year: input.year,
    serieADay: input.serieADay,
    owner: input.owner,
    settings: input.settings,
    deck: input.deck,
    consumedCardIds: input.consumedCardIds,
  })
}

export async function readEvolutionCardGitAuthority(input: {
  groupRepoRoot: string
  relativePath: string
  cards: EvolutionCardsDocument
  owner: string
  leagueId: string
  year: number
  serieADay: number
}): Promise<EvolutionCardGitAuthority> {
  const current = input.cards.commitments?.[normalize(input.owner)]
  if (!current) return emptyAuthority()

  let history: string
  try {
    const result = await execFileAsync(
      'git',
      ['-C', input.groupRepoRoot, 'log', '--reverse', '--format=%H%x09%cI', '--', input.relativePath],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    )
    history = result.stdout
  } catch {
    return emptyAuthority()
  }

  let commitmentFirstSeenAt: number | null = null
  let revealFirstSeenAt: number | null = null
  for (const line of history.split(/\r?\n/).filter(Boolean)) {
    const separator = line.indexOf('\t')
    if (separator <= 0) continue
    const sha = line.slice(0, separator)
    const committedAt = Date.parse(line.slice(separator + 1))
    if (!Number.isFinite(committedAt)) continue

    let document: EvolutionCardsDocument | null = null
    try {
      const result = await execFileAsync(
        'git',
        ['-C', input.groupRepoRoot, 'show', `${sha}:${input.relativePath}`],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      )
      document = JSON.parse(result.stdout) as EvolutionCardsDocument
    } catch {
      continue
    }

    const candidate = document?.commitments?.[normalize(input.owner)]
    if (!candidate || candidate.commitment !== current.commitment) continue
    if (commitmentFirstSeenAt == null) commitmentFirstSeenAt = committedAt

    if (revealFirstSeenAt == null && candidate.reveal) {
      const verified = getVerifiedEvolutionCardIds(candidate, {
        leagueId: input.leagueId,
        year: input.year,
        serieADay: input.serieADay,
        owner: input.owner,
      })
      if (verified) revealFirstSeenAt = committedAt
    }

    if (commitmentFirstSeenAt != null && revealFirstSeenAt != null) break
  }

  return { commitmentFirstSeenAt, revealFirstSeenAt }
}

function firstKickoffTime(day: RealDay): number | null {
  const values = day.games
    .filter(game => !game.delayed && Boolean(game.date))
    .map(game => Date.parse(game.date!))
    .filter(Number.isFinite)
  return values.length ? Math.min(...values) : null
}

function emptyAuthority(): EvolutionCardGitAuthority {
  return { commitmentFirstSeenAt: null, revealFirstSeenAt: null }
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}
