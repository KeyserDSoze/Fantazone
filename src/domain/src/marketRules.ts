export enum MarketStatus {
  Pending = 0,
  Approved = 1,
  Denied = 2,
  Cancelled = 3,
  NoMoney = 4,
  NoPlayers = 5,
  Expired = 6,
}

export interface MarketRulePlayer {
  price: number
}

export interface MarketRuleMarket {
  buyer: string
  seller: string
  buyerPlayers: MarketRulePlayer[]
  sellerPlayers: MarketRulePlayer[]
  moneyFromBuyer: number
  moneyFromSeller: number
  approvers: string[]
  deniers: string[]
  status: MarketStatus
  creationTime: Date
}

export const MarketStatusHelper = {
  asLabel: (status: MarketStatus): string => {
    switch (status) {
      case MarketStatus.Pending: return 'In attesa'
      case MarketStatus.Approved: return 'Approvato'
      case MarketStatus.Denied: return 'Rifiutato'
      case MarketStatus.Cancelled: return 'Annullato'
      case MarketStatus.NoMoney: return 'Fondi insufficienti'
      case MarketStatus.NoPlayers: return 'Giocatori non disponibili'
      case MarketStatus.Expired: return 'Scaduto'
      default: return 'Sconosciuto'
    }
  },
  isPending: (status: MarketStatus): boolean => status === MarketStatus.Pending,
  isCompleted: (status: MarketStatus): boolean =>
    status === MarketStatus.Approved ||
    status === MarketStatus.Denied ||
    status === MarketStatus.Cancelled ||
    status === MarketStatus.NoMoney ||
    status === MarketStatus.NoPlayers ||
    status === MarketStatus.Expired,
  isSuccessful: (status: MarketStatus): boolean => status === MarketStatus.Approved,
  canBeModified: (status: MarketStatus): boolean => status === MarketStatus.Pending,
}

export class MarketHelper {
  static getMarketsForUser<T extends MarketRuleMarket>(markets: T[], userEmail: string): T[] {
    const email = userEmail.toLowerCase()
    return markets.filter(market =>
      market.buyer.toLowerCase() === email || market.seller.toLowerCase() === email,
    )
  }

  static getPendingMarketsForApproval<T extends MarketRuleMarket>(markets: T[], userEmail: string): T[] {
    const email = userEmail.toLowerCase()
    return markets.filter(market =>
      MarketStatusHelper.isPending(market.status) &&
      market.buyer.toLowerCase() !== email &&
      market.seller.toLowerCase() !== email &&
      !market.approvers.some(approver => approver.toLowerCase() === email) &&
      !market.deniers.some(denier => denier.toLowerCase() === email),
    )
  }

  static hasUserVoted(market: MarketRuleMarket, userEmail: string): boolean {
    const email = userEmail.toLowerCase()
    return market.approvers.some(approver => approver.toLowerCase() === email) ||
      market.deniers.some(denier => denier.toLowerCase() === email)
  }

  static isUserInvolved(market: MarketRuleMarket, userEmail: string): boolean {
    const email = userEmail.toLowerCase()
    return market.buyer.toLowerCase() === email || market.seller.toLowerCase() === email
  }

  static getTotalValue(market: MarketRuleMarket): { buyerGives: number; sellerGives: number } {
    return {
      buyerGives: market.moneyFromBuyer + market.buyerPlayers.reduce((sum, player) => sum + player.price, 0),
      sellerGives: market.moneyFromSeller + market.sellerPlayers.reduce((sum, player) => sum + player.price, 0),
    }
  }

  static sortByNewest<T extends MarketRuleMarket>(markets: T[]): T[] {
    return [...markets].sort((first, second) => second.creationTime.getTime() - first.creationTime.getTime())
  }

  static sortByOldest<T extends MarketRuleMarket>(markets: T[]): T[] {
    return [...markets].sort((first, second) => first.creationTime.getTime() - second.creationTime.getTime())
  }

  static filterByStatus<T extends MarketRuleMarket>(markets: T[], status: MarketStatus): T[] {
    return markets.filter(market => market.status === status)
  }

  static getActiveMarkets<T extends MarketRuleMarket>(markets: T[]): T[] {
    return markets.filter(market => MarketStatusHelper.isPending(market.status))
  }

  static getCompletedMarkets<T extends MarketRuleMarket>(markets: T[]): T[] {
    return markets.filter(market => MarketStatusHelper.isCompleted(market.status))
  }

  static calculateQuorum(leagueSize: number): number {
    return Math.floor(leagueSize / 2) + 1
  }

  static hasReachedApprovalQuorum(market: MarketRuleMarket, leagueSize: number): boolean {
    return market.approvers.length >= this.calculateQuorum(leagueSize)
  }

  static hasReachedDenialQuorum(market: MarketRuleMarket, leagueSize: number): boolean {
    return market.deniers.length >= this.calculateQuorum(leagueSize)
  }

  static getUserVote(market: MarketRuleMarket, userEmail: string): 'approve' | 'deny' | null {
    const email = userEmail.toLowerCase()
    if (market.approvers.some(approver => approver.toLowerCase() === email)) return 'approve'
    if (market.deniers.some(denier => denier.toLowerCase() === email)) return 'deny'
    return null
  }
}
