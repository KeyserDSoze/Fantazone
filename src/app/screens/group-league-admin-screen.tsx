import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, H1, H2, Input, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui'
import {
  LeagueType,
  MarketType,
  cloneLeagueSetting,
  formatSeasonFromYear,
  type AuthenticatedGroupSession,
  type Group,
  type LeagueSetting,
} from '@fantazone/domain'
import type { GroupNavigationSelection } from '../services/groupNavigation'
import {
  copyLeagueYearFromPrevious,
  createGroupLeague,
  deleteGroupLeague,
  dispatchGroupRecalculation,
  initializeLeagueCalendarAndRank,
  initializeLeagueYearDefaults,
  saveAnnualLeagueSettings,
  setAnnualLeagueType,
  setMainGroupLeague,
  toggleLeagueBasket,
} from '../services/groupLeagueAdminService'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  selection: GroupNavigationSelection
}

type NumericSettingKey =
  | 'startingMoney'
  | 'delayedDay'
  | 'cancelledDay'
  | 'pointForFirstGoal'
  | 'pointForNextGoal'
  | 'pointForOwnGoal'
  | 'differencePointForOwnGoal'
  | 'pointInHome'
  | 'pointForVictory'
  | 'pointForDraw'
  | 'pointForDefeat'
  | 'pointForStrongDefense'
  | 'pointForStrongDefense4'
  | 'pointForStrongDefense5'
  | 'pointForCleanSheet'
  | 'pointForGoodPeople'
  | 'moneyForGoal'
  | 'moneyForSufferedGoal'

const numericFields: Array<[NumericSettingKey, string]> = [
  ['startingMoney', 'Budget iniziale'],
  ['delayedDay', 'Ritardo calendario'],
  ['cancelledDay', 'Giornate annullate iniziali'],
  ['pointForFirstGoal', 'Soglia primo gol'],
  ['pointForNextGoal', 'Punti per gol successivo'],
  ['pointForOwnGoal', 'Punti autogol'],
  ['differencePointForOwnGoal', 'Differenza autogol'],
  ['pointInHome', 'Bonus casa'],
  ['pointForVictory', 'Punti vittoria'],
  ['pointForDraw', 'Punti pareggio'],
  ['pointForDefeat', 'Punti sconfitta'],
  ['pointForStrongDefense', 'Bonus difesa'],
  ['pointForStrongDefense4', 'Bonus difesa 4'],
  ['pointForStrongDefense5', 'Bonus difesa 5'],
  ['pointForCleanSheet', 'Bonus clean sheet'],
  ['pointForGoodPeople', 'Bonus fair play'],
  ['moneyForGoal', 'Premio per gol'],
  ['moneyForSufferedGoal', 'Premio/malus gol subito'],
]

const leagueTypes: Array<[LeagueType, string]> = [
  [LeagueType.League, 'Campionato'],
  [LeagueType.Cup, 'Coppa'],
  [LeagueType.NewCup, 'NewCup'],
  [LeagueType.SuperLeague, 'Super League'],
  [LeagueType.FutsalLeague, 'Futsal'],
]

export function GroupLeagueAdminScreen({ runtime, session, selection }: Props) {
  const year = selection.year
  const [group, setGroup] = useState<Group>(runtime.group)
  const [leagueId, setLeagueId] = useState<string | null>(selection.leagueId ?? runtime.group.leagues[0]?.id ?? null)
  const [newLeagueName, setNewLeagueName] = useState('')
  const [draft, setDraft] = useState<LeagueSetting | null>(null)
  const [day, setDay] = useState('38')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const league = group.leagues.find(item => item.id === leagueId) ?? null
  const annual = year != null ? league?.years.find(item => item.year === year) ?? null : null

  useEffect(() => {
    void refresh()
  }, [runtime])

  useEffect(() => {
    if (selection.leagueId && group.leagues.some(item => item.id === selection.leagueId)) setLeagueId(selection.leagueId)
  }, [selection.leagueId, group])

  useEffect(() => {
    setDraft(annual ? cloneLeagueSetting(annual.settings) : null)
  }, [leagueId, year, annual?.year, annual?.settings])

  async function refresh() {
    setLoading(true); setError(null)
    try {
      const fresh = await runtime.refreshGroup()
      setGroup(fresh)
      setLeagueId(current => fresh.leagues.some(item => item.id === current) ? current : (fresh.leagues[0]?.id ?? null))
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function perform(operation: () => Promise<Group>, success: string) {
    setLoading(true); setError(null); setStatus(null)
    try { setGroup(await operation()); setStatus(success) }
    catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function createLeague() {
    if (year == null) return
    setLoading(true); setError(null); setStatus(null)
    try {
      const result = await createGroupLeague(runtime, session.member, { name: newLeagueName, year })
      setGroup(result.group); setLeagueId(result.league.id); setNewLeagueName('')
      setStatus(`Lega “${result.league.name}” creata.`)
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function initializeCalendar() {
    if (!league || year == null) return
    setLoading(true); setError(null); setStatus(null)
    try {
      const result = await initializeLeagueCalendarAndRank(runtime, session.member, league.id, year)
      setGroup(result.group)
      setStatus(
        result.createdCalendar || result.createdRank
          ? `Inizializzazione completata: ${result.teamCount} squadre; Calendar ${result.createdCalendar ? 'creato' : 'già presente'}, Rank ${result.createdRank ? 'creato/riparato' : 'già presente'}.`
          : 'Calendar e Rank erano già presenti e coerenti: nessun file riscritto.',
      )
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function recalculate(specificDay?: number) {
    if (year == null) return
    setLoading(true); setError(null); setStatus(null)
    try {
      await dispatchGroupRecalculation(runtime, session.member, { season: year, ...(specificDay != null ? { day: specificDay } : {}) })
      setStatus(specificDay == null
        ? `Ricalcolo completo ${formatSeasonFromYear(year)} avviato nel repository del gruppo.`
        : `Ricalcolo della giornata Serie A ${specificDay} avviato nel repository del gruppo.`)
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  const currentType = annual?.type ?? league?.type ?? LeagueType.Null
  const settingsDirty = useMemo(
    () => Boolean(draft && annual && JSON.stringify(draft) !== JSON.stringify(annual.settings)),
    [draft, annual],
  )

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={1080} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1">
            <H1>Leghe e calcoli</H1>
            <Paragraph color="$color10">Configurazione SuperAdmin{year != null ? ` · ${formatSeasonFromYear(year)}` : ''}. Calendar e Rank materializzati non vengono mai sovrascritti implicitamente.</Paragraph>
          </YStack>
          <Button variant="outlined" disabled={loading} onPress={() => { void refresh() }}>Aggiorna</Button>
        </XStack>

        {error ? <Card borderWidth={1} borderColor="$red8" padding="$3"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {status ? <Card borderWidth={1} borderColor="$green8" padding="$3"><Paragraph color="$green10">{status}</Paragraph></Card> : null}

        <Card borderWidth={1} borderColor="$borderColor" padding="$4">
          <YStack gap="$3">
            <H2 size="$6">Seleziona o crea una lega</H2>
            <XStack gap="$2" flexWrap="wrap">
              {group.leagues.map(item => (
                <Button key={item.id} size="$3" variant="outlined" backgroundColor={item.id === leagueId ? '$color4' : 'transparent'} borderColor={item.id === leagueId ? '$blue8' : '$borderColor'} onPress={() => setLeagueId(item.id)}>
                  {item.isMain ? '★ ' : ''}{item.name}
                </Button>
              ))}
            </XStack>
            <XStack gap="$2" flexWrap="wrap">
              <Input flex={1} minWidth={260} value={newLeagueName} onChangeText={setNewLeagueName} placeholder="Nuova lega" />
              <Button disabled={loading || year == null || !newLeagueName.trim()} onPress={() => { void createLeague() }}>Crea lega</Button>
            </XStack>
          </YStack>
        </Card>

        {league ? (
          <Card borderWidth={1} borderColor="$blue8" padding="$4">
            <YStack gap="$3">
              <XStack justifyContent="space-between" gap="$3" alignItems="flex-start" flexWrap="wrap">
                <YStack flex={1} minWidth={240}>
                  <H2 size="$6">{league.name}</H2>
                  <Paragraph color="$color10">{league.isMain ? 'Lega principale' : 'Lega secondaria'} · {league.basketsId.length} basket collegati</Paragraph>
                </YStack>
                {!league.isMain ? <Button variant="outlined" disabled={loading} onPress={() => { void perform(() => setMainGroupLeague(runtime, session.member, league.id), `${league.name} è ora la lega principale.`) }}>Imposta principale</Button> : null}
                <Button variant="outlined" borderColor="$red8" color="$red10" disabled={loading} onPress={() => { void perform(() => deleteGroupLeague(runtime, session.member, league.id), `${league.name} eliminata.`) }}>Elimina lega</Button>
              </XStack>
            </YStack>
          </Card>
        ) : null}

        {league ? (
          <Card borderWidth={1} borderColor="$purple8" padding="$4">
            <YStack gap="$3">
              <H2 size="$6">Basket partecipanti</H2>
              <Paragraph color="$color10">Il collegamento è globale alla lega e viene bloccato quando una qualunque stagione ha già Calendar o Rank.</Paragraph>
              <XStack gap="$2" flexWrap="wrap">
                {group.baskets.map(basket => {
                  const linked = league.basketsId.includes(basket.id)
                  return <Button key={basket.id} size="$3" variant="outlined" backgroundColor={linked ? '$purple4' : 'transparent'} borderColor={linked ? '$purple8' : '$borderColor'} disabled={loading} onPress={() => { void perform(() => toggleLeagueBasket(runtime, session.member, league.id, basket.id), `${basket.name}: ${linked ? 'rimosso dalla' : 'aggiunto alla'} lega.`) }}>{linked ? '✓ ' : ''}{basket.name}</Button>
                })}
              </XStack>
              {group.baskets.length === 0 ? <Paragraph color="$color10">Crea prima almeno un basket.</Paragraph> : null}
            </YStack>
          </Card>
        ) : null}

        {league && year != null && !annual ? (
          <Card borderWidth={1} borderColor="$orange8" padding="$4">
            <YStack gap="$3">
              <H2 size="$6">Stagione non configurata</H2>
              <Paragraph color="$color10">Crea le impostazioni di {formatSeasonFromYear(year)} dai default oppure copia l’ultima stagione precedente.</Paragraph>
              <XStack gap="$2" flexWrap="wrap">
                <Button disabled={loading} onPress={() => { void perform(() => initializeLeagueYearDefaults(runtime, session.member, league.id, year), 'Stagione inizializzata con i valori di default.') }}>Usa default</Button>
                <Button variant="outlined" disabled={loading} onPress={() => { void perform(() => copyLeagueYearFromPrevious(runtime, session.member, league.id, year), 'Impostazioni copiate dalla stagione precedente.') }}>Copia stagione precedente</Button>
              </XStack>
            </YStack>
          </Card>
        ) : null}

        {league && annual && draft && year != null ? (
          <>
            <Card borderWidth={1} borderColor="$borderColor" padding="$4">
              <YStack gap="$3">
                <H2 size="$6">Tipo · {formatSeasonFromYear(year)}</H2>
                <XStack gap="$2" flexWrap="wrap">
                  {leagueTypes.map(([type, label]) => (
                    <Button key={type} size="$3" variant="outlined" backgroundColor={currentType === type ? '$color4' : 'transparent'} borderColor={currentType === type ? '$blue8' : '$borderColor'} disabled={loading || currentType === type} onPress={() => { void perform(() => setAnnualLeagueType(runtime, session.member, league.id, year, type), `Tipo stagione aggiornato a ${label}.`) }}>{label}</Button>
                  ))}
                </XStack>
              </YStack>
            </Card>

            <Card borderWidth={1} borderColor="$borderColor" padding="$4">
              <YStack gap="$3">
                <XStack justifyContent="space-between" alignItems="center" gap="$2" flexWrap="wrap">
                  <H2 size="$6">Regole di punteggio</H2>
                  <Button disabled={loading || !settingsDirty} onPress={() => { void perform(() => saveAnnualLeagueSettings(runtime, session.member, league.id, year, draft), 'Impostazioni della lega salvate.'); }}>Salva impostazioni</Button>
                </XStack>
                <XStack gap="$3" flexWrap="wrap">
                  {numericFields.map(([key, label]) => (
                    <YStack key={key} width={220} gap="$1">
                      <Text fontSize="$2" color="$color10">{label}</Text>
                      <Input value={String(draft[key])} keyboardType="numeric" onChangeText={value => {
                        const parsed = Number(value.replace(',', '.'))
                        if (Number.isFinite(parsed)) setDraft(current => current ? { ...current, [key]: parsed } : current)
                      }} />
                    </YStack>
                  ))}
                </XStack>
                <YStack gap="$2">
                  <Text fontWeight="700">Mercato</Text>
                  <XStack gap="$2" flexWrap="wrap">
                    {([[MarketType.WithVote, 'Con voto'], [MarketType.WithoutVote, 'Senza voto'], [MarketType.Denied, 'Disabilitato']] as const).map(([value, label]) => (
                      <Button key={value} size="$3" variant="outlined" backgroundColor={draft.market === value ? '$color4' : 'transparent'} onPress={() => setDraft(current => current ? { ...current, market: value } : current)}>{label}</Button>
                    ))}
                  </XStack>
                </YStack>
                <XStack gap="$2" flexWrap="wrap">
                  <Button size="$3" variant="outlined" backgroundColor={draft.randomAuction ? '$color4' : 'transparent'} onPress={() => setDraft(current => current ? { ...current, randomAuction: !current.randomAuction } : current)}>Asta random {draft.randomAuction ? '✓' : ''}</Button>
                  <Button size="$3" variant="outlined" backgroundColor={draft.rankWithValuePoints ? '$color4' : 'transparent'} onPress={() => setDraft(current => current ? { ...current, rankWithValuePoints: !current.rankWithValuePoints } : current)}>Classifica con fantapunti {draft.rankWithValuePoints ? '✓' : ''}</Button>
                </XStack>
                <Paragraph color="$color9">La matrice bonus/malus voto resta nel documento settings e non viene alterata da questi campi.</Paragraph>
              </YStack>
            </Card>

            <Card borderWidth={1} borderColor="$green8" padding="$4">
              <YStack gap="$3">
                <H2 size="$6">Calendar, Rank e ricalcoli</H2>
                <Paragraph color="$color10">La creazione iniziale scrive Calendar e Rank canonici. I ricalcoli successivi partono dal workflow GitHub del gruppo e usano i voti ufficiali globali.</Paragraph>
                <XStack gap="$2" flexWrap="wrap">
                  <Button disabled={loading || settingsDirty} onPress={() => { void initializeCalendar() }}>Crea / ripara Calendar e Rank</Button>
                  <Button variant="outlined" disabled={loading || settingsDirty} onPress={() => { void recalculate() }}>Ricalcola stagione</Button>
                </XStack>
                <XStack gap="$2" flexWrap="wrap">
                  <Input width={140} value={day} onChangeText={setDay} keyboardType="numeric" placeholder="Giornata 1-38" />
                  <Button variant="outlined" disabled={loading || settingsDirty || !validDay(day)} onPress={() => { void recalculate(Number(day)) }}>Ricalcola giornata Serie A</Button>
                </XStack>
                {settingsDirty ? <Paragraph color="$orange10">Salva prima le modifiche alle impostazioni.</Paragraph> : null}
              </YStack>
            </Card>
          </>
        ) : null}
      </YStack>
    </ScrollView>
  )
}

function validDay(value: string): boolean { const day = Number(value); return Number.isInteger(day) && day >= 1 && day <= 38 }
function message(error: unknown): string { return error instanceof Error ? error.message : 'Operazione non riuscita.' }
