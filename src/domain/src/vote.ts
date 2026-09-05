import {
  DefaultLeagueSetting,
  DefaultVoteLeagueSetting,
  Role,
  type LeagueSetting,
  type VoteLeagueSetting,
} from './group'
import type { RealPlayer } from './realPlayer'

export enum Behaviour {
  Nothing = 0,
  YellowCard = 1,
  RedCard = 2,
}

/** Canonical readable vote contract shared by live/final ingestion, Game and statistics. */
export interface Vote {
  role: Role
  value: number
  isFinal: boolean
  goal: number
  penalty: number
  assist: number
  stoppedPenalty: number
  sufferedGoal: number
  wrongedPenalty: number
  ownGoal: number
  status: Behaviour
  manOfTheMatch: boolean
  hasVote: boolean
  isOut: boolean
  isIn: boolean
  injured: boolean
}

export interface VotedRealPlayer extends RealPlayer {
  vote: Vote | null
}

/** Self-describing readable vote document for one Serie A day. */
export interface VotedRealPlayers {
  year: number
  serieADay: number
  players: VotedRealPlayer[]
}

export interface VoteValue {
  value: number
  special: boolean
}

export const VoteHelper = {
  hasPositiveBonus(vote: Vote): boolean {
    return vote.goal > 0 || vote.penalty > 0 || vote.assist > 0 || vote.stoppedPenalty > 0
  },
  hasNegativeBonus(vote: Vote): boolean {
    return vote.ownGoal > 0 || vote.status > Behaviour.Nothing || vote.wrongedPenalty > 0 || vote.sufferedGoal > 0
  },
  hasBonus(vote: Vote): boolean {
    return this.hasPositiveBonus(vote) || this.hasNegativeBonus(vote)
  },
  hasDoneSomething(vote: Vote): boolean {
    return this.hasBonus(vote) || (vote.value > 0 && vote.role === Role.GoalKeeper)
  },
}

/** Pure port of TeamCalculator.FinalValue for one player/vote. */
export function calculateVoteValue(
  playerRole: Role,
  vote: Vote,
  settings: LeagueSetting = DefaultLeagueSetting,
): VoteValue {
  const voteSettings = resolveVoteSettings(settings, playerRole)
  let value = vote.value
  value += vote.goal * voteSettings.goal
  value += vote.penalty * voteSettings.penalty
  value += vote.sufferedGoal * voteSettings.sufferedGoal
  value += vote.stoppedPenalty * voteSettings.stoppedPenalty
  value += vote.wrongedPenalty * voteSettings.wrongedPenalty
  value += vote.ownGoal * voteSettings.ownGoal
  value += vote.assist * voteSettings.assist
  value += vote.injured ? voteSettings.injury : 0
  value += vote.manOfTheMatch ? voteSettings.manOfTheMatch : 0
  if (vote.status === Behaviour.YellowCard) value += voteSettings.yellowCard
  else if (vote.status === Behaviour.RedCard) value += voteSettings.redCard

  const special = vote.hasVote && playerRole === Role.GoalKeeper &&
    vote.sufferedGoal === 0 && settings.pointForCleanSheet > 0
  if (special) value += settings.pointForCleanSheet
  return { value, special }
}

export function createEmptyVote(role: Role): Vote {
  return {
    role,
    value: 0,
    isFinal: false,
    goal: 0,
    penalty: 0,
    assist: 0,
    stoppedPenalty: 0,
    sufferedGoal: 0,
    wrongedPenalty: 0,
    ownGoal: 0,
    status: Behaviour.Nothing,
    manOfTheMatch: false,
    hasVote: false,
    isOut: false,
    isIn: false,
    injured: false,
  }
}

function resolveVoteSettings(settings: LeagueSetting, role: Role): VoteLeagueSetting {
  return settings.votes[role] ?? settings.votes[Role.Undefined] ?? DefaultVoteLeagueSetting
}
