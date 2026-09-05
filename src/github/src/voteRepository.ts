import { Behaviour, Role, type Vote, type VotedRealPlayer, type VotedRealPlayers } from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonSnapshot,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { PlatformRepositoryTarget } from './repositoryTarget'
import { decodeRealPlayer } from './realPlayerRepository'

export type SerieAVoteKind = 'live' | 'official'

export function serieAVoteDocumentPath(kind: SerieAVoteKind, year: number, serieADay: number): string {
  assertSeason(year)
  assertDay(serieADay)
  return `data/serie-a/votes/${kind}/${year}/${serieADay}.json`
}

export class GitHubSerieAVoteRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: PlatformRepositoryTarget,
    private readonly kind: SerieAVoteKind,
  ) {}

  async getVotes(
    year: number,
    serieADay: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<VotedRealPlayers | null> {
    return (await this.getVotesSnapshot(year, serieADay, options))?.value ?? null
  }

  async getVotesSnapshot(
    year: number,
    serieADay: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<VotedRealPlayers> | null> {
    const snapshot = await this.store.tryReadJson<unknown>(this.location(year, serieADay), options)
    if (!snapshot) return null
    return { ...snapshot, value: decodeVotedRealPlayers(snapshot.value, year, serieADay) }
  }

  async writeVotes(
    value: VotedRealPlayers,
    message = `chore: update ${this.kind} Serie A votes ${value.year}/${value.serieADay}`,
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    const decoded = decodeVotedRealPlayers(value, value.year, value.serieADay)
    const snapshot = await this.store.writeJson(this.location(value.year, value.serieADay), decoded, message, options)
    return snapshot.sha
  }

  private location(year: number, serieADay: number) {
    return { ...this.repository, path: serieAVoteDocumentPath(this.kind, year, serieADay) }
  }
}

export function decodeVotedRealPlayers(
  value: unknown,
  expectedYear?: number,
  expectedSerieADay?: number,
): VotedRealPlayers {
  if (!value || typeof value !== 'object') throw invalidVotes(expectedYear, expectedSerieADay)
  const document = value as Partial<VotedRealPlayers>
  const year = document.year
  const serieADay = document.serieADay
  if (
    typeof year !== 'number' || !Number.isInteger(year) ||
    typeof serieADay !== 'number' || !Number.isInteger(serieADay) ||
    !Array.isArray(document.players)
  ) {
    throw invalidVotes(expectedYear, expectedSerieADay)
  }
  if (expectedYear != null && year !== expectedYear) {
    throw new Error(`Serie A votes year mismatch: expected ${expectedYear}, found ${year}`)
  }
  if (expectedSerieADay != null && serieADay !== expectedSerieADay) {
    throw new Error(`Serie A votes day mismatch: expected ${expectedSerieADay}, found ${serieADay}`)
  }
  assertDay(serieADay)
  return { year, serieADay, players: document.players.map((player, index) => decodeVotedRealPlayer(player, index)) }
}

export function decodeVotedRealPlayer(value: unknown, index = -1): VotedRealPlayer {
  if (!value || typeof value !== 'object') throw new Error(`Invalid voted player${suffix(index)}`)
  const base = decodeRealPlayer(value, index)
  const voteValue = (value as Partial<VotedRealPlayer>).vote
  return { ...base, vote: voteValue == null ? null : decodeVote(voteValue, index) }
}

export function decodeVote(value: unknown, index = -1): Vote {
  if (!value || typeof value !== 'object') throw new Error(`Invalid vote${suffix(index)}`)
  const vote = value as Partial<Vote>
  if (
    typeof vote.role !== 'number' || !isRole(vote.role) ||
    !finite(vote.value) || typeof vote.isFinal !== 'boolean' ||
    !integer(vote.goal) || !integer(vote.penalty) || !integer(vote.assist) ||
    !integer(vote.stoppedPenalty) || !integer(vote.sufferedGoal) ||
    !integer(vote.wrongedPenalty) || !integer(vote.ownGoal) ||
    typeof vote.status !== 'number' || !isBehaviour(vote.status) ||
    typeof vote.manOfTheMatch !== 'boolean' || typeof vote.hasVote !== 'boolean' ||
    typeof vote.isOut !== 'boolean' || typeof vote.isIn !== 'boolean' || typeof vote.injured !== 'boolean'
  ) {
    throw new Error(`Invalid vote${suffix(index)}`)
  }
  return {
    role: vote.role,
    value: vote.value,
    isFinal: vote.isFinal,
    goal: vote.goal,
    penalty: vote.penalty,
    assist: vote.assist,
    stoppedPenalty: vote.stoppedPenalty,
    sufferedGoal: vote.sufferedGoal,
    wrongedPenalty: vote.wrongedPenalty,
    ownGoal: vote.ownGoal,
    status: vote.status,
    manOfTheMatch: vote.manOfTheMatch,
    hasVote: vote.hasVote,
    isOut: vote.isOut,
    isIn: vote.isIn,
    injured: vote.injured,
  }
}

function isRole(value: number): value is Role {
  return Number.isInteger(value) && value >= Role.Undefined && value <= Role.Forward
}

function isBehaviour(value: number): value is Behaviour {
  return Number.isInteger(value) && value >= Behaviour.Nothing && value <= Behaviour.RedCard
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function suffix(index: number): string {
  return index >= 0 ? ` at index ${index}` : ''
}

function invalidVotes(year?: number, day?: number): Error {
  const key = year != null || day != null ? ` for ${year ?? '?'}/${day ?? '?'}` : ''
  return new Error(`Unsupported Serie A vote JSON schema${key}. Fantazone requires readable schema v2.`)
}

function assertSeason(year: number): void {
  if (!Number.isInteger(year) || year < 1) throw new Error('Season id must be a positive integer')
}

function assertDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 38) throw new Error('Serie A day must be between 1 and 38')
}
