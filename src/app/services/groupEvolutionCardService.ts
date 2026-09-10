import {
  GroupHelper,
  createEvolutionCardCommitment,
  getEvolutionCardCatalog,
  isEvolutionCardSelectionLocked,
  revealEvolutionCardCommitment,
  resolveFantazoneEvolutionSettings,
  shouldRevealEvolutionCards,
  type AuthenticatedGroupSession,
  type EvolutionCardCommitment,
  type LeagueSetting,
  type RealDay,
} from '@fantazone/domain'
import {
  RepositoryWriteConflictError,
  type EvolutionCardsDocument,
} from '@fantazone/github'
import {
  createEvolutionCardNonce,
  deleteEvolutionCardSecret,
  readEvolutionCardSecret,
  saveEvolutionCardSecret,
  type EvolutionLocalCardSecret,
} from './evolutionCardSecretStore'
import type { GroupSessionRuntime } from './groupSessionRuntime'

const WRITE_ATTEMPTS = 4

export interface CommitEvolutionCardsInput {
  session: AuthenticatedGroupSession
  leagueId: string
  season: number
  serieADay: number
  owner: string
  cardIds: string[]
}

export interface EvolutionCardCommitResult {
  commitment: EvolutionCardCommitment
  secret: EvolutionLocalCardSecret
}

export class GroupEvolutionCardService {
  constructor(
    private readonly runtime: GroupSessionRuntime,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async commitCards(input: CommitEvolutionCardsInput): Promise<EvolutionCardCommitResult> {
    const { settings, day, owner } = await this.authorize(input)
    const evolution = resolveFantazoneEvolutionSettings(settings)
    if (!evolution.enabled || !evolution.coachCards.enabled) throw new Error('Le carte Fantazone Evolution non sono abilitate in questa lega.')
    if (isEvolutionCardSelectionLocked(day, settings, this.now())) {
      throw new Error('La scelta delle carte è già bloccata per questa giornata.')
    }

    const cardIds = [...new Set(input.cardIds.map(value => value.trim()).filter(Boolean))]
    if (cardIds.length === 0) throw new Error('Seleziona almeno una carta.')
    if (cardIds.length > evolution.coachCards.cardsPerMatch) {
      throw new Error(`Puoi schierare al massimo ${evolution.coachCards.cardsPerMatch} carte per partita.`)
    }
    const available = new Set(getEvolutionCardCatalog(settings).map(card => card.id))
    const unknown = cardIds.find(card => !available.has(card))
    if (unknown) throw new Error(`Carta Evolution non disponibile: ${unknown}.`)

    const now = this.now()
    const nonce = createEvolutionCardNonce()
    const lockAt = cardLockAt(day, evolution.coachCards.lockMinutesBeforeFirstKickoff)
    const revealAt = firstKickoff(day)
    const commitment = createEvolutionCardCommitment({
      leagueId: input.leagueId,
      year: input.season,
      serieADay: input.serieADay,
      owner,
      cardIds,
      nonce,
      committedAt: now.toISOString(),
      lockedAt: lockAt?.toISOString() ?? null,
      revealAt: revealAt?.toISOString() ?? null,
    })
    const secret: EvolutionLocalCardSecret = {
      leagueId: input.leagueId,
      year: input.season,
      serieADay: input.serieADay,
      owner,
      cardIds,
      nonce,
      committedAt: now.toISOString(),
    }

    await this.updateCardsDocument(input.leagueId, input.season, input.serieADay, owner, commitment)
    // Persist the plaintext only after the public commitment succeeds. If this local write
    // fails, no forged reveal can be manufactured from the repository alone.
    await saveEvolutionCardSecret(this.runtime.connection.repository.full_name, secret)
    return { commitment, secret }
  }

  async revealCards(input: Omit<CommitEvolutionCardsInput, 'cardIds'>): Promise<EvolutionCardCommitment> {
    const { settings, day, owner } = await this.authorize({ ...input, cardIds: [] })
    const evolution = resolveFantazoneEvolutionSettings(settings)
    if (!evolution.enabled || !evolution.coachCards.enabled) throw new Error('Le carte Fantazone Evolution non sono abilitate in questa lega.')
    const canReveal = !evolution.coachCards.revealAtFirstKickoff || shouldRevealEvolutionCards(day, settings, this.now())
    if (!canReveal) throw new Error('Le carte restano sigillate fino al calcio d’inizio della giornata.')

    const secret = await readEvolutionCardSecret(
      this.runtime.connection.repository.full_name,
      input.leagueId,
      input.season,
      input.serieADay,
      owner,
    )
    if (!secret) throw new Error('Il segreto locale della carta non è disponibile su questo dispositivo.')

    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const snapshot = await this.runtime.evolutionRepository.getCardsSnapshot(
        input.leagueId,
        input.season,
        input.serieADay,
        { refresh: true },
      )
      const sealed = snapshot?.value.commitments[normalize(owner)]
      if (!snapshot || !sealed) throw new Error('Commitment delle carte Evolution non trovato.')
      if (sealed.reveal) {
        await deleteEvolutionCardSecret(this.runtime.connection.repository.full_name, input.leagueId, input.season, input.serieADay, owner)
        return sealed
      }

      const revealed = revealEvolutionCardCommitment(sealed, {
        leagueId: input.leagueId,
        year: input.season,
        serieADay: input.serieADay,
        owner,
        cardIds: secret.cardIds,
        nonce: secret.nonce,
        revealedAt: this.now().toISOString(),
      })
      const document: EvolutionCardsDocument = {
        ...snapshot.value,
        commitments: { ...snapshot.value.commitments, [normalize(owner)]: revealed },
      }
      try {
        await this.runtime.evolutionRepository.writeCards(
          input.leagueId,
          input.season,
          input.serieADay,
          document,
          `feat: reveal Fantazone Evolution cards ${normalize(owner)} day ${input.serieADay}`,
          { expectedSha: snapshot.sha },
        )
        await deleteEvolutionCardSecret(this.runtime.connection.repository.full_name, input.leagueId, input.season, input.serieADay, owner)
        return revealed
      } catch (error) {
        if (!(error instanceof RepositoryWriteConflictError) || attempt === WRITE_ATTEMPTS - 1) throw error
      }
    }
    throw new Error('Impossibile pubblicare il reveal delle carte Evolution.')
  }

  async revealOwnCardsIfDue(input: Omit<CommitEvolutionCardsInput, 'cardIds'>): Promise<EvolutionCardCommitment | null> {
    const secret = await readEvolutionCardSecret(
      this.runtime.connection.repository.full_name,
      input.leagueId,
      input.season,
      input.serieADay,
      input.owner,
    )
    if (!secret) return null
    const { settings, day } = await this.authorize({ ...input, cardIds: [] })
    const evolution = resolveFantazoneEvolutionSettings(settings)
    if (evolution.coachCards.revealAtFirstKickoff && !shouldRevealEvolutionCards(day, settings, this.now())) return null
    return this.revealCards(input)
  }

  private async updateCardsDocument(
    leagueId: string,
    season: number,
    serieADay: number,
    owner: string,
    commitment: EvolutionCardCommitment,
  ): Promise<void> {
    const ownerKey = normalize(owner)
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const snapshot = await this.runtime.evolutionRepository.getCardsSnapshot(leagueId, season, serieADay, { refresh: true })
      const document: EvolutionCardsDocument = snapshot
        ? { ...snapshot.value, commitments: { ...snapshot.value.commitments, [ownerKey]: commitment } }
        : { version: 2, leagueId, year: season, serieADay, commitments: { [ownerKey]: commitment } }
      try {
        await this.runtime.evolutionRepository.writeCards(
          leagueId,
          season,
          serieADay,
          document,
          `feat: seal Fantazone Evolution cards ${ownerKey} day ${serieADay}`,
          snapshot ? { expectedSha: snapshot.sha } : { createOnly: true },
        )
        return
      } catch (error) {
        if (!(error instanceof RepositoryWriteConflictError) || attempt === WRITE_ATTEMPTS - 1) throw error
      }
    }
  }

  private async authorize(input: CommitEvolutionCardsInput): Promise<{ settings: LeagueSetting; day: RealDay; owner: string }> {
    const group = await this.runtime.refreshGroup()
    const league = group.leagues.find(item => item.id === input.leagueId)
    const annual = league?.years.find(item => item.year === input.season)
    if (!league || !annual) throw new Error('Lega/stagione non disponibile per le carte Evolution.')

    const ownerEntry = findTeam(group, input.season, input.owner)
    if (!ownerEntry) throw new Error('Squadra non trovata per le carte Evolution.')
    if (!GroupHelper.isOwner(ownerEntry, input.session.identity.email)) {
      throw new Error('Puoi scegliere le carte solo per una squadra di cui sei owner o co-owner.')
    }

    const realCalendar = await this.runtime.realCalendarRepository.getCalendar(input.season, { refresh: true })
    const day = realCalendar?.days.find(item => item.serieADay === input.serieADay)
    if (!day) throw new Error(`Giornata Serie A ${input.serieADay} non disponibile.`)
    return { settings: annual.settings, day, owner: ownerEntry.owner }
  }
}

function findTeam(group: GroupSessionRuntime['group'], season: number, owner: string) {
  const target = normalize(owner)
  for (const basket of group.baskets) {
    const team = basket.years.find(item => item.year === season)?.teams.find(item => normalize(item.owner) === target)
    if (team) return team
  }
  return null
}

function firstKickoff(day: RealDay): Date | null {
  const values = day.games
    .filter(game => !game.delayed && game.date)
    .map(game => Date.parse(game.date!))
    .filter(Number.isFinite)
  return values.length ? new Date(Math.min(...values)) : null
}

function cardLockAt(day: RealDay, minutesBefore: number): Date | null {
  const first = firstKickoff(day)
  return first ? new Date(first.getTime() - Math.max(0, minutesBefore) * 60_000) : null
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}
