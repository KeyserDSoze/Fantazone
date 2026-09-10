import React, { useEffect, useMemo, useState } from 'react'
import { Calculator, Plus, RefreshCw, Star, Trash2 } from '@tamagui/lucide-icons-2'
import { Button, Input, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  DefaultOpeningCompetitionSettings,
  LeagueType,
  MarketType,
  cloneLeagueSetting,
  formatSeasonFromYear,
  resolveFantazoneEvolutionSettings,
  type AuthenticatedGroupSession,
  type Group,
  type LeagueSetting,
} from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import { FantazoneEvolutionSettingsPanel } from '../components/FantazoneEvolutionSettingsPanel'
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
  | 'liveFormationChanges'

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
  ['liveFormationChanges', 'Modifiche a giornata iniziata'],
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

  useEffect(() => { void refresh() }, [runtime])
  useEffect(() => {
    if (selection.leagueId && group.leagues.some(item => item.id === selection.leagueId)) setLeagueId(selection.leagueId)
  }, [selection.leagueId, group])
  useEffect(() => { setDraft(annual ? withSeasonDefaults(annual.settings) : null) }, [leagueId, year, annual?.year, annual?.settings])

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const fresh = await runtime.refreshGroup()
      setGroup(fresh)
      setLeagueId(current => fresh.leagues.some(item => item.id === current) ? current : (fresh.leagues[0]?.id ?? null))
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function perform(operation: () => Promise<Group>, success: string) {
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      setGroup(await operation())
      setStatus(success)
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function createLeague() {
    if (year == null) return
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      const result = await createGroupLeague(runtime, session.member, { name: newLeagueName, year })
      setGroup(result.group)
      setLeagueId(result.league.id)
      setNewLeagueName('')
      setStatus(`Lega “${result.league.name}” creata.`)
    } catch (caught) { setError(message(caught)) }
    finally { setLoading(false) }
  }

  async function initializeCalendar() {
    if (!league || year == null) return
    setLoading(true)
    setError(null)
    setStatus(null)
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
    setLoading(true)
    setError(null)
    setStatus(null)
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
    () => Boolean(draft && annual && JSON.stringify(draft) !== JSON.stringify(withSeasonDefaults(annual.settings))),
    [draft, annual],
  )

  return (
    <AppScreen maxWidth={1240}>
      <PageIntro
        eyebrow="SuperAdmin"
        title="Leghe e calcoli"
        description={`Configura struttura e regole${year != null ? ` per ${formatSeasonFromYear(year)}` : ''}. Calendar e Rank materializzati non vengono sovrascritti implicitamente.`}
        action={(
          <Button variant="outlined" borderRadius="$4" icon={loading ? undefined : RefreshCw} disabled={loading} onPress={() => { void refresh() }}>
            {loading ? <Spinner /> : 'Aggiorna'}
          </Button>
        )}
      />

      {error ? <Surface accent="red" padding="$3"><Paragraph color="$red11">{error}</Paragraph></Surface> : null}
      {status ? <Surface accent="green" padding="$3"><Paragraph color="$green11">{status}</Paragraph></Surface> : null}

      <Surface padding="$5">
        <YStack gap="$4">
          <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
            <YStack gap="$1">
              <Text color="$color12" fontSize="$6" fontWeight="900">Seleziona la lega</Text>
              <Paragraph color="$color10">La lega scelta determina basket, stagione, regole e operazioni di ricalcolo.</Paragraph>
            </YStack>
            <StatusPill tone="blue">{group.leagues.length} leghe</StatusPill>
          </XStack>

          <XStack gap="$2" flexWrap="wrap">
            {group.leagues.map(item => (
              <Button key={item.id} size="$3" borderRadius="$10" backgroundColor={item.id === leagueId ? '$blue4' : '$color3'} borderColor={item.id === leagueId ? '$blue7' : '$color5'} onPress={() => setLeagueId(item.id)}>
                <Text color={item.id === leagueId ? '$blue11' : '$color10'} fontWeight="800">{item.isMain ? '★ ' : ''}{item.name}</Text>
              </Button>
            ))}
          </XStack>

          <XStack gap="$3" alignItems="flex-end" flexWrap="wrap">
            <YStack flex={1} minWidth={260} gap="$1.5">
              <Text color="$color9" fontSize="$2" fontWeight="800">NUOVA LEGA</Text>
              <Input value={newLeagueName} onChangeText={setNewLeagueName} placeholder="Nome della lega" />
            </YStack>
            <PrimaryAction disabled={loading || year == null || !newLeagueName.trim()} onPress={() => { void createLeague() }} icon={<Plus size="$1" color="white" />}>
              Crea lega
            </PrimaryAction>
          </XStack>
        </YStack>
      </Surface>

      {league ? (
        <Surface accent="blue" padding="$5">
          <YStack gap="$4">
            <XStack justifyContent="space-between" alignItems="flex-start" gap="$4" flexWrap="wrap">
              <YStack flex={1} minWidth={260} gap="$2">
                <XStack alignItems="center" gap="$2" flexWrap="wrap">
                  <Text color="$color12" fontSize="$7" fontWeight="900">{league.name}</Text>
                  <StatusPill tone={league.isMain ? 'green' : 'neutral'}>{league.isMain ? 'Principale' : 'Secondaria'}</StatusPill>
                </XStack>
                <Paragraph color="$color10">{league.basketsId.length} basket collegati · {league.years.length} stagioni configurate</Paragraph>
              </YStack>
              <XStack gap="$2" flexWrap="wrap">
                {!league.isMain ? (
                  <Button variant="outlined" borderRadius="$4" icon={Star} disabled={loading} onPress={() => { void perform(() => setMainGroupLeague(runtime, session.member, league.id), `${league.name} è ora la lega principale.`) }}>
                    Imposta principale
                  </Button>
                ) : null}
                <Button variant="outlined" borderRadius="$4" icon={Trash2} borderColor="$red7" color="$red10" disabled={loading} onPress={() => { void perform(() => deleteGroupLeague(runtime, session.member, league.id), `${league.name} eliminata.`) }}>
                  Elimina lega
                </Button>
              </XStack>
            </XStack>
          </YStack>
        </Surface>
      ) : null}

      {league ? (
        <Surface accent="purple" padding="$5">
          <YStack gap="$4">
            <YStack gap="$1">
              <Text color="$color12" fontSize="$6" fontWeight="900">Basket partecipanti</Text>
              <Paragraph color="$color10">Il collegamento è globale alla lega e viene bloccato quando una stagione ha già Calendar o Rank.</Paragraph>
            </YStack>
            <XStack gap="$2" flexWrap="wrap">
              {group.baskets.map(basket => {
                const linked = league.basketsId.includes(basket.id)
                return (
                  <Button key={basket.id} size="$3" borderRadius="$10" backgroundColor={linked ? '$purple4' : '$color3'} borderColor={linked ? '$purple7' : '$color5'} disabled={loading} onPress={() => { void perform(() => toggleLeagueBasket(runtime, session.member, league.id, basket.id), `${basket.name}: ${linked ? 'rimosso dalla' : 'aggiunto alla'} lega.`) }}>
                    <Text color={linked ? '$purple11' : '$color10'} fontWeight="800">{linked ? '✓ ' : ''}{basket.name}</Text>
                  </Button>
                )
              })}
              {group.baskets.length === 0 ? <Paragraph color="$color9">Crea prima almeno un basket.</Paragraph> : null}
            </XStack>
          </YStack>
        </Surface>
      ) : null}

      {league && year != null && !annual ? (
        <Surface accent="yellow" padding="$5">
          <YStack gap="$4">
            <YStack gap="$1">
              <Text color="$color12" fontSize="$6" fontWeight="900">Stagione non configurata</Text>
              <Paragraph color="$color10">Inizializza {formatSeasonFromYear(year)} dai default oppure replica l’ultima stagione precedente.</Paragraph>
            </YStack>
            <XStack gap="$2" flexWrap="wrap">
              <PrimaryAction disabled={loading} onPress={() => { void perform(() => initializeLeagueYearDefaults(runtime, session.member, league.id, year), 'Stagione inizializzata con i valori di default.') }}>
                Usa default
              </PrimaryAction>
              <Button variant="outlined" borderRadius="$4" disabled={loading} onPress={() => { void perform(() => copyLeagueYearFromPrevious(runtime, session.member, league.id, year), 'Impostazioni copiate dalla stagione precedente.') }}>
                Copia stagione precedente
              </Button>
            </XStack>
          </YStack>
        </Surface>
      ) : null}

      {league && annual && draft && year != null ? (
        <>
          <Surface padding="$5">
            <YStack gap="$4">
              <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
                <YStack gap="$1">
                  <Text color="$color12" fontSize="$6" fontWeight="900">Formato · {formatSeasonFromYear(year)}</Text>
                  <Paragraph color="$color10">Tipo competitivo della stagione selezionata.</Paragraph>
                </YStack>
                <StatusPill tone="blue">{leagueTypeLabel(currentType)}</StatusPill>
              </XStack>
              <XStack gap="$2" flexWrap="wrap">
                {leagueTypes.map(([type, label]) => (
                  <Button key={type} size="$3" borderRadius="$10" backgroundColor={currentType === type ? '$blue4' : '$color3'} borderColor={currentType === type ? '$blue7' : '$color5'} disabled={loading || currentType === type} onPress={() => { void perform(() => setAnnualLeagueType(runtime, session.member, league.id, year, type), `Tipo stagione aggiornato a ${label}.`) }}>
                    <Text color={currentType === type ? '$blue11' : '$color10'} fontWeight="800">{label}</Text>
                  </Button>
                ))}
              </XStack>
            </YStack>
          </Surface>

          <Surface padding="$5">
            <YStack gap="$5">
              <XStack justifyContent="space-between" alignItems="flex-start" gap="$4" flexWrap="wrap">
                <YStack gap="$1">
                  <Text color="$color12" fontSize="$6" fontWeight="900">Regole di punteggio e formazione live</Text>
                  <Paragraph color="$color10">I parametri sono annuali. Le modifiche live vengono validate anche sul TeamDay canonico.</Paragraph>
                </YStack>
                <StatusPill tone={settingsDirty ? 'yellow' : 'green'}>{settingsDirty ? 'Modifiche da salvare' : 'Salvato'}</StatusPill>
              </XStack>

              <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
                {numericFields.map(([key, label]) => (
                  <YStack key={key} flexGrow={1} flexBasis={205} minWidth={180} maxWidth={280} gap="$1.5">
                    <Text color="$color9" fontSize="$2" fontWeight="800">{label}</Text>
                    <Input value={String(draft[key])} keyboardType="numeric" borderRadius="$4" onChangeText={value => {
                      const parsed = Number(value.replace(',', '.'))
                      if (Number.isFinite(parsed)) setDraft(current => current ? { ...current, [key]: parsed } : current)
                    }} />
                  </YStack>
                ))}
              </XStack>

              <YStack gap="$2">
                <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Mercato</Text>
                <XStack gap="$2" flexWrap="wrap">
                  {([[MarketType.WithVote, 'Con voto'], [MarketType.WithoutVote, 'Senza voto'], [MarketType.Denied, 'Disabilitato']] as const).map(([value, label]) => (
                    <Button key={value} size="$3" borderRadius="$10" backgroundColor={draft.market === value ? '$blue4' : '$color3'} borderColor={draft.market === value ? '$blue7' : '$color5'} onPress={() => setDraft(current => current ? { ...current, market: value } : current)}>
                      <Text color={draft.market === value ? '$blue11' : '$color10'} fontWeight="800">{label}</Text>
                    </Button>
                  ))}
                </XStack>
              </YStack>

              <XStack gap="$2" flexWrap="wrap">
                <ToggleButton active={draft.randomAuction} label="Asta random" onPress={() => setDraft(current => current ? { ...current, randomAuction: !current.randomAuction } : current)} />
                <ToggleButton active={draft.rankWithValuePoints} label="Classifica con fantapunti" onPress={() => setDraft(current => current ? { ...current, rankWithValuePoints: !current.rankWithValuePoints } : current)} />
                <ToggleButton active={draft.allowLiveModuleChange} label="Cambio modulo durante il live" onPress={() => setDraft(current => current ? { ...current, allowLiveModuleChange: !current.allowLiveModuleChange } : current)} />
              </XStack>

              <FantazoneEvolutionSettingsPanel
                settings={draft}
                onChange={evolution => setDraft(current => current ? { ...current, evolution } : current)}
              />

              {league.isMain ? (
                <Surface accent="yellow" padding="$4">
                  <YStack gap="$4">
                    <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
                      <YStack flex={1} gap="$1">
                        <Text color="$color12" fontSize="$5" fontWeight="900">Campionato iniziale</Text>
                        <Paragraph color="$color10">Usa le rose della stagione precedente e i voti della nuova stagione, senza toccare la rosa corrente.</Paragraph>
                      </YStack>
                      <ToggleButton active={draft.openingCompetition.enabled} label="Abilitato" onPress={() => setDraft(current => current ? { ...current, openingCompetition: { ...current.openingCompetition, enabled: !current.openingCompetition.enabled } } : current)} />
                    </XStack>
                    <YStack maxWidth={260} gap="$1.5">
                      <Text color="$color9" fontSize="$2" fontWeight="800">Giornate Serie A</Text>
                      <Input value={String(draft.openingCompetition.serieADays)} keyboardType="numeric" onChangeText={value => {
                        const parsed = Number(value)
                        if (Number.isInteger(parsed)) setDraft(current => current ? { ...current, openingCompetition: { ...current.openingCompetition, serieADays: parsed } } : current)
                      }} />
                    </YStack>
                    <YStack gap="$2">
                      <Text color="$color9" fontSize="$2" fontWeight="800">Premi per posizione</Text>
                      {draft.openingCompetition.prizes.map((prize, index) => (
                        <XStack key={`${prize.position}-${index}`} gap="$2" alignItems="center" flexWrap="wrap">
                          <Input width={120} value={String(prize.position)} keyboardType="numeric" placeholder="Posizione" onChangeText={value => updatePrize(index, 'position', value)} />
                          <Input width={150} value={String(prize.credits)} keyboardType="numeric" placeholder="Crediti" onChangeText={value => updatePrize(index, 'credits', value)} />
                          <Button size="$3" circular chromeless icon={Trash2} onPress={() => setDraft(current => current ? { ...current, openingCompetition: { ...current.openingCompetition, prizes: current.openingCompetition.prizes.filter((_, itemIndex) => itemIndex !== index) } } : current)} />
                        </XStack>
                      ))}
                      <Button size="$3" variant="outlined" alignSelf="flex-start" icon={Plus} onPress={() => setDraft(current => current ? { ...current, openingCompetition: { ...current.openingCompetition, prizes: [...current.openingCompetition.prizes, { position: current.openingCompetition.prizes.length + 1, credits: 0 }] } } : current)}>
                        Aggiungi premio
                      </Button>
                    </YStack>
                  </YStack>
                </Surface>
              ) : null}

              <PrimaryAction disabled={loading || !settingsDirty} onPress={() => { void perform(() => saveAnnualLeagueSettings(runtime, session.member, league.id, year, draft), 'Impostazioni della lega salvate.') }}>
                Salva impostazioni
              </PrimaryAction>
            </YStack>
          </Surface>

          <Surface accent="green" padding="$5">
            <YStack gap="$4">
              <XStack alignItems="center" gap="$2">
                <Calculator size="$1.2" color="$green10" />
                <YStack flex={1} gap="$1">
                  <Text color="$color12" fontSize="$6" fontWeight="900">Calendar, Rank e ricalcoli</Text>
                  <Paragraph color="$color10">La creazione iniziale scrive i documenti canonici. I ricalcoli partono invece dal workflow GitHub del gruppo.</Paragraph>
                </YStack>
              </XStack>
              <XStack gap="$2" flexWrap="wrap">
                <PrimaryAction disabled={loading || settingsDirty} onPress={() => { void initializeCalendar() }}>Crea / ripara Calendar e Rank</PrimaryAction>
                <Button variant="outlined" borderRadius="$4" disabled={loading || settingsDirty} onPress={() => { void recalculate() }}>Ricalcola stagione</Button>
              </XStack>
              <XStack gap="$2" flexWrap="wrap" alignItems="center">
                <Input width={150} value={day} onChangeText={setDay} keyboardType="numeric" placeholder="Giornata 1-38" />
                <Button variant="outlined" borderRadius="$4" disabled={loading || settingsDirty || !validDay(day)} onPress={() => { void recalculate(Number(day)) }}>Ricalcola giornata Serie A</Button>
              </XStack>
              {settingsDirty ? <Paragraph color="$yellow11">Salva prima le modifiche alle impostazioni.</Paragraph> : null}
            </YStack>
          </Surface>
        </>
      ) : null}
    </AppScreen>
  )

  function updatePrize(index: number, key: 'position' | 'credits', value: string) {
    const parsed = Number(value)
    if (!Number.isInteger(parsed)) return
    setDraft(current => current ? {
      ...current,
      openingCompetition: {
        ...current.openingCompetition,
        prizes: current.openingCompetition.prizes.map((prize, itemIndex) => itemIndex === index ? { ...prize, [key]: parsed } : prize),
      },
    } : current)
  }
}

function ToggleButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Button size="$3" borderRadius="$10" backgroundColor={active ? '$green4' : '$color3'} borderColor={active ? '$green7' : '$color5'} onPress={onPress}>
      <Text color={active ? '$green11' : '$color10'} fontWeight="800">{active ? '✓ ' : ''}{label}</Text>
    </Button>
  )
}

function withSeasonDefaults(settings: LeagueSetting): LeagueSetting {
  const cloned = cloneLeagueSetting(settings)
  return {
    ...cloned,
    liveFormationChanges: cloned.liveFormationChanges ?? 0,
    allowLiveModuleChange: cloned.allowLiveModuleChange ?? false,
    openingCompetition: cloned.openingCompetition ? {
      enabled: cloned.openingCompetition.enabled === true,
      serieADays: cloned.openingCompetition.serieADays ?? DefaultOpeningCompetitionSettings.serieADays,
      prizes: Array.isArray(cloned.openingCompetition.prizes)
        ? cloned.openingCompetition.prizes.map(prize => ({ ...prize }))
        : DefaultOpeningCompetitionSettings.prizes.map(prize => ({ ...prize })),
    } : {
      ...DefaultOpeningCompetitionSettings,
      prizes: DefaultOpeningCompetitionSettings.prizes.map(prize => ({ ...prize })),
    },
    evolution: resolveFantazoneEvolutionSettings(cloned),
  }
}

function leagueTypeLabel(type: LeagueType): string {
  return leagueTypes.find(([value]) => value === type)?.[1] ?? 'Non configurato'
}

function validDay(value: string): boolean { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 1 && parsed <= 38 }
function message(error: unknown): string { return error instanceof Error ? error.message : 'Operazione non riuscita.' }
