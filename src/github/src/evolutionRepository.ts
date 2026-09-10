import type {
  EvolutionCardCommitment,
  EvolutionPlayerSeasonState,
  EvolutionRuleTrace,
  EvolutionSeasonSkillDocument,
} from '@fantazone/domain'
import {
  GitHubJsonStore,
  type RepositoryJsonReadOptions,
  type RepositoryJsonSnapshot,
  type RepositoryJsonWriteOptions,
} from './repositoryStore'
import type { GroupRepositoryTarget } from './repositoryTarget'

export interface EvolutionPlayerStateDocument {
  version: 1
  leagueId: string
  year: number
  owner: string
  updatedThroughDay: number
  players: EvolutionPlayerSeasonState[]
}

/**
 * Card choices stay sealed in the shared repository until reveal. A commitment never
 * contains card ids; the optional reveal is cryptographically verified by consumers.
 */
export interface EvolutionCardsDocument {
  version: 2
  leagueId: string
  year: number
  serieADay: number
  commitments: Record<string, EvolutionCardCommitment>
}

export interface EvolutionTraceDocument {
  version: 1
  leagueId: string
  year: number
  serieADay: number
  gameId: string
  calculatedAt: string
  trace: EvolutionRuleTrace[]
}

export class GitHubEvolutionRepository {
  constructor(
    private readonly store: GitHubJsonStore,
    private readonly repository: GroupRepositoryTarget,
  ) {}

  async getSkills(
    leagueId: string,
    year: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<EvolutionSeasonSkillDocument | null> {
    return (await this.getSkillsSnapshot(leagueId, year, options))?.value ?? null
  }

  async getSkillsSnapshot(
    leagueId: string,
    year: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<EvolutionSeasonSkillDocument> | null> {
    return this.store.tryReadJson<EvolutionSeasonSkillDocument>(this.location(evolutionSkillsPath(leagueId, year)), options)
  }

  async writeSkills(
    leagueId: string,
    year: number,
    document: EvolutionSeasonSkillDocument,
    message = 'feat: update Evolution seasonal skills',
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    validateSeasonDocument(document, year)
    return (await this.store.writeJson(this.location(evolutionSkillsPath(leagueId, year)), document, message, options)).sha
  }

  async getCards(
    leagueId: string,
    year: number,
    serieADay: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<EvolutionCardsDocument | null> {
    return (await this.getCardsSnapshot(leagueId, year, serieADay, options))?.value ?? null
  }

  async getCardsSnapshot(
    leagueId: string,
    year: number,
    serieADay: number,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<EvolutionCardsDocument> | null> {
    return this.store.tryReadJson<EvolutionCardsDocument>(this.location(evolutionCardsPath(leagueId, year, serieADay)), options)
  }

  async writeCards(
    leagueId: string,
    year: number,
    serieADay: number,
    document: EvolutionCardsDocument,
    message = 'feat: update sealed Evolution match cards',
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    validateCardsDocument(document, leagueId, year, serieADay)
    return (await this.store.writeJson(this.location(evolutionCardsPath(leagueId, year, serieADay)), document, message, options)).sha
  }

  async getPlayerState(
    leagueId: string,
    year: number,
    owner: string,
    options: RepositoryJsonReadOptions = {},
  ): Promise<EvolutionPlayerStateDocument | null> {
    return (await this.getPlayerStateSnapshot(leagueId, year, owner, options))?.value ?? null
  }

  async getPlayerStateSnapshot(
    leagueId: string,
    year: number,
    owner: string,
    options: RepositoryJsonReadOptions = {},
  ): Promise<RepositoryJsonSnapshot<EvolutionPlayerStateDocument> | null> {
    return this.store.tryReadJson<EvolutionPlayerStateDocument>(this.location(evolutionPlayerStatePath(leagueId, year, owner)), options)
  }

  async writePlayerState(
    leagueId: string,
    year: number,
    owner: string,
    document: EvolutionPlayerStateDocument,
    message = 'feat: update Evolution morale and momentum',
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    validatePlayerStateDocument(document, leagueId, year, owner)
    return (await this.store.writeJson(this.location(evolutionPlayerStatePath(leagueId, year, owner)), document, message, options)).sha
  }

  async getTrace(
    leagueId: string,
    year: number,
    serieADay: number,
    gameId: string,
    options: RepositoryJsonReadOptions = {},
  ): Promise<EvolutionTraceDocument | null> {
    return (await this.store.tryReadJson<EvolutionTraceDocument>(
      this.location(evolutionTracePath(leagueId, year, serieADay, gameId)),
      options,
    ))?.value ?? null
  }

  async writeTrace(
    leagueId: string,
    year: number,
    serieADay: number,
    gameId: string,
    document: EvolutionTraceDocument,
    message = 'feat: update Evolution calculation trace',
    options: RepositoryJsonWriteOptions = {},
  ): Promise<string> {
    if (document.version !== 1 || document.leagueId !== leagueId || document.year !== year || document.serieADay !== serieADay || document.gameId !== gameId) {
      throw new Error('Evolution trace key does not match its document')
    }
    return (await this.store.writeJson(
      this.location(evolutionTracePath(leagueId, year, serieADay, gameId)),
      document,
      message,
      options,
    )).sha
  }

  private location(path: string) {
    return { ...this.repository, path }
  }
}

export function evolutionSkillsPath(leagueId: string, year: number): string {
  validateLeagueSeason(leagueId, year)
  return `data/groups/seasons/${year}/evolution/${encodeURIComponent(leagueId.trim())}/skills.json`
}

export function evolutionCardsPath(leagueId: string, year: number, serieADay: number): string {
  validateLeagueSeason(leagueId, year)
  validateDay(serieADay)
  return `data/groups/seasons/${year}/days/${serieADay}/evolution/${encodeURIComponent(leagueId.trim())}/cards.json`
}

export function evolutionPlayerStatePath(leagueId: string, year: number, owner: string): string {
  validateLeagueSeason(leagueId, year)
  validateOwner(owner)
  return `data/groups/seasons/${year}/evolution/${encodeURIComponent(leagueId.trim())}/state/${encodeURIComponent(owner.trim().toLowerCase())}.json`
}

export function evolutionTracePath(leagueId: string, year: number, serieADay: number, gameId: string): string {
  validateLeagueSeason(leagueId, year)
  validateDay(serieADay)
  if (!gameId.trim()) throw new Error('Game id is required')
  return `data/groups/seasons/${year}/days/${serieADay}/evolution/${encodeURIComponent(leagueId.trim())}/traces/${encodeURIComponent(gameId.trim())}.json`
}

function validateSeasonDocument(document: EvolutionSeasonSkillDocument, year: number): void {
  if (document.version !== 1 || document.year !== year || !document.seed.trim() || !Array.isArray(document.assignments)) {
    throw new Error('Invalid Evolution seasonal skill document')
  }
}

function validateCardsDocument(document: EvolutionCardsDocument, leagueId: string, year: number, serieADay: number): void {
  if (document.version !== 2 || document.leagueId !== leagueId || document.year !== year || document.serieADay !== serieADay || !document.commitments) {
    throw new Error('Evolution cards key does not match its document')
  }
  for (const [owner, commitment] of Object.entries(document.commitments)) {
    validateOwner(owner)
    if (!commitment || typeof commitment.commitment !== 'string' || !/^[a-f0-9]{64}$/i.test(commitment.commitment)) {
      throw new Error(`Invalid Evolution card commitment for ${owner}`)
    }
    if (!Number.isFinite(Date.parse(commitment.committedAt))) throw new Error(`Invalid Evolution committedAt for ${owner}`)
    if (commitment.reveal && (!Array.isArray(commitment.reveal.cardIds) || typeof commitment.reveal.nonce !== 'string')) {
      throw new Error(`Invalid Evolution card reveal for ${owner}`)
    }
  }
}

function validatePlayerStateDocument(document: EvolutionPlayerStateDocument, leagueId: string, year: number, owner: string): void {
  if (document.version !== 1 || document.leagueId !== leagueId || document.year !== year || normalizeOwner(document.owner) !== normalizeOwner(owner) || !Array.isArray(document.players)) {
    throw new Error('Evolution player-state key does not match its document')
  }
  if (!Number.isInteger(document.updatedThroughDay) || document.updatedThroughDay < 0 || document.updatedThroughDay > 38) {
    throw new Error('Evolution player-state updatedThroughDay must be between 0 and 38')
  }
}

function validateLeagueSeason(leagueId: string, year: number): void {
  if (!leagueId.trim()) throw new Error('League id is required')
  if (!Number.isInteger(year) || year < 1) throw new Error('Season must be a positive integer')
}

function validateDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 38) throw new Error('Serie A day must be between 1 and 38')
}

function validateOwner(owner: string): void {
  if (!owner.trim()) throw new Error('Owner is required')
  if (owner.includes('/') || owner.includes('\\')) throw new Error('Owner cannot contain path separators')
}

function normalizeOwner(owner: string): string {
  return owner.trim().toLowerCase()
}
