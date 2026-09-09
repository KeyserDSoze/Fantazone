import {
  GroupHelper,
  IdentityRole,
  getCurrentSeasonYear,
  type Group,
  type UserOfAGroup,
} from '@fantazone/domain'

export const GROUP_PRODUCT_ROUTES = [
  'home',
  'ranking',
  'calendar',
  'live',
  'formation',
  'teams',
  'players',
  'market',
  'market-trades',
  'hall-of-fame',
  'rules',
  'info',
  'settings',
  'push-notifications',
  'patch-notes',
  'auction',
  'share-group',
  'group-users-admin',
  'group-baskets-admin',
  'group-league-admin',
  'logs',
  'serie-a-admin',
] as const

export type GroupProductRoute = typeof GROUP_PRODUCT_ROUTES[number]

export type GroupNavigationItem = {
  route: GroupProductRoute
  label: string
  description: string
}

export type GroupNavigationSection = {
  title: string
  items: GroupNavigationItem[]
}

export type GroupNavigationSelection = {
  leagueId: string | null
  year: number | null
}

const BASE_SECTIONS: GroupNavigationSection[] = [
  {
    title: 'Main',
    items: [
      { route: 'home', label: 'Home', description: 'Giornata e riepilogo del gruppo' },
      { route: 'ranking', label: 'Classifica', description: 'Classifica della tua lega' },
      { route: 'calendar', label: 'Calendario', description: 'Calendario della lega' },
      { route: 'live', label: 'Live', description: 'Risultati e voti in tempo reale' },
    ],
  },
  {
    title: 'Lega',
    items: [
      { route: 'formation', label: 'La mia formazione', description: 'Gestisci la formazione del prossimo turno' },
      { route: 'teams', label: 'Le squadre', description: 'Tutte le rose della lega' },
    ],
  },
  {
    title: 'Giocatori',
    items: [
      { route: 'players', label: 'Tutti i giocatori', description: 'Statistiche complete dei giocatori di Serie A' },
    ],
  },
  {
    title: 'Mercato',
    items: [
      { route: 'market', label: 'Crea scambio', description: 'Proponi un nuovo scambio' },
      { route: 'market-trades', label: 'Scambi', description: 'Vota gli scambi attivi e consulta lo storico' },
    ],
  },
  {
    title: 'Altro',
    items: [
      { route: 'hall-of-fame', label: 'Hall of Fame', description: 'Vincitori e record di sempre' },
      { route: 'rules', label: 'Regolamento', description: 'Regole e impostazioni della lega' },
      { route: 'info', label: 'Guida', description: 'Guida a Fantazone' },
      { route: 'settings', label: 'Impostazioni', description: 'Account, gruppo e collegamento GitHub' },
      { route: 'push-notifications', label: 'Notifiche push', description: 'Gestisci le notifiche' },
      { route: 'patch-notes', label: 'Patch notes', description: 'Novità e aggiornamenti dell’app' },
    ],
  },
]

const ADMIN_SECTION: GroupNavigationSection = {
  title: 'Gestione gruppo',
  items: [
    { route: 'share-group', label: 'Condividi gruppo', description: 'Invita persone con un link cifrato e vincolato alla loro email Microsoft' },
    { route: 'auction', label: 'Asta', description: 'Crea, riprendi e gestisci l’asta realtime' },
  ],
}

const SUPER_ADMIN_SECTIONS: GroupNavigationSection[] = [
  {
    title: 'Gestione gruppo · SuperAdmin',
    items: [
      { route: 'group-users-admin', label: 'Utenti', description: 'Gestisci utenti e ruoli del gruppo' },
      { route: 'group-baskets-admin', label: 'Basket', description: 'Gestisci basket e squadre per stagione' },
      { route: 'group-league-admin', label: 'Leghe', description: 'Gestisci leghe, impostazioni e ricalcoli' },
    ],
  },
  {
    title: 'Piattaforma · SuperAdmin',
    items: [
      { route: 'logs', label: 'Log di piattaforma', description: 'Controlla job ed errori operativi' },
      { route: 'serie-a-admin', label: 'Gestione Serie A', description: 'Gestisci eccezioni del calendario Serie A' },
    ],
  },
]

export function getGroupNavigationSections(member: UserOfAGroup): GroupNavigationSection[] {
  const sections = BASE_SECTIONS.map(cloneSection)
  const isSuperAdmin = GroupHelper.hasRole(member, IdentityRole.SuperAdmin)
  const isAdmin = isSuperAdmin || GroupHelper.hasRole(member, IdentityRole.Admin)
  if (isAdmin) sections.push(cloneSection(ADMIN_SECTION))
  if (isSuperAdmin) sections.push(...SUPER_ADMIN_SECTIONS.map(cloneSection))
  return sections
}

export function getDefaultGroupSelection(group: Group, now = new Date()): GroupNavigationSelection {
  const preferredLeague = group.leagues.find(league => league.isMain && league.years.length > 0)
    ?? group.leagues.find(league => league.years.length > 0)
    ?? group.leagues[0]
    ?? null

  if (!preferredLeague) return { leagueId: null, year: GroupHelper.getAvailableYears(group)[0] ?? null }
  const years = getLeagueYears(group, preferredLeague.id)
  const currentSeason = getCurrentSeasonYear(now)
  return {
    leagueId: preferredLeague.id,
    year: years.includes(currentSeason) ? currentSeason : (years[0] ?? GroupHelper.getAvailableYears(group)[0] ?? null),
  }
}

export function normalizeGroupSelection(
  group: Group,
  selection: GroupNavigationSelection,
  now = new Date(),
): GroupNavigationSelection {
  const defaultSelection = getDefaultGroupSelection(group, now)
  const league = group.leagues.find(item => item.id === selection.leagueId)
  const leagueId = league?.id ?? defaultSelection.leagueId
  if (!leagueId) return { leagueId: null, year: defaultSelection.year }

  const years = getLeagueYears(group, leagueId)
  const year = selection.year != null && years.includes(selection.year)
    ? selection.year
    : (years.includes(defaultSelection.year ?? -1) ? defaultSelection.year : (years[0] ?? defaultSelection.year))
  return { leagueId, year: year ?? null }
}

export function getLeagueYears(group: Group, leagueId: string): number[] {
  const league = group.leagues.find(item => item.id === leagueId)
  if (!league) return []
  return [...new Set(league.years.map(item => item.year))].sort((a, b) => b - a)
}

export function isGroupProductRoute(value: string): value is GroupProductRoute {
  return (GROUP_PRODUCT_ROUTES as readonly string[]).includes(value)
}

export function findNavigationItem(route: GroupProductRoute): GroupNavigationItem | null {
  for (const section of [...BASE_SECTIONS, ADMIN_SECTION, ...SUPER_ADMIN_SECTIONS]) {
    const item = section.items.find(candidate => candidate.route === route)
    if (item) return { ...item }
  }
  return null
}

function cloneSection(section: GroupNavigationSection): GroupNavigationSection {
  return { title: section.title, items: section.items.map(item => ({ ...item })) }
}
