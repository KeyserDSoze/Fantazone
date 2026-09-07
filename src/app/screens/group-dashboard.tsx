import React, { useEffect, useMemo, useState } from 'react'
import { Linking, Platform, Share } from 'react-native'
import { Button, Card, H1, H2, Input, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import { createInviteFragment } from '@fantazone/github'
import {
  GroupHelper,
  IdentityRole,
  RealCalendarHelper,
  formatSeasonFromYear,
  type AuthenticatedGroupSession,
  type RealDay,
} from '@fantazone/domain'
import { publicWebUrl } from '../config/publicOrigin'
import {
  findNavigationItem,
  getDefaultGroupSelection,
  normalizeGroupSelection,
  type GroupNavigationSelection,
  type GroupProductRoute,
} from '../services/groupNavigation'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'
import { AuctionScreen } from './auction-screen'
import { GroupProductShell } from './group-product-shell'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
  onLogout: () => void | Promise<void>
  onDisconnect: () => void | Promise<void>
  onExploreArchitecture: () => void
}

export function GroupDashboardScreen({
  runtime,
  session,
  onLogout,
  onDisconnect,
  onExploreArchitecture,
}: Props) {
  void onLogout
  const [route, setRoute] = useState<GroupProductRoute>('home')
  const [selection, setSelection] = useState<GroupNavigationSelection>(() => getDefaultGroupSelection(runtime.group))
  const group = runtime.group

  useEffect(() => {
    setSelection(current => normalizeGroupSelection(group, current))
  }, [group])

  if (route === 'auction') {
    return <AuctionScreen runtime={runtime} session={session} onBack={() => setRoute('home')} />
  }

  function selectLeague(leagueId: string) {
    setSelection(current => normalizeGroupSelection(group, { leagueId, year: current.year }))
  }

  return (
    <GroupProductShell
      group={group}
      member={session.member}
      identityEmail={session.identity.email}
      route={route}
      selection={selection}
      onRouteChange={setRoute}
      onLeagueChange={selectLeague}
      onYearChange={year => setSelection(current => ({ ...current, year }))}
      onChangeGroup={onDisconnect}
      onExploreArchitecture={onExploreArchitecture}
    >
      {route === 'home' ? (
        <GroupHome runtime={runtime} selection={selection} onNavigate={setRoute} />
      ) : route === 'settings' ? (
        <GroupSettings runtime={runtime} session={session} />
      ) : (
        <PendingProductScreen route={route} onHome={() => setRoute('home')} />
      )}
    </GroupProductShell>
  )
}

function GroupHome({
  runtime,
  selection,
  onNavigate,
}: {
  runtime: GroupSessionRuntime
  selection: GroupNavigationSelection
  onNavigate: (route: GroupProductRoute) => void
}) {
  const [day, setDay] = useState<RealDay | null>(null)
  const [isLive, setIsLive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const year = selection.year
  const league = runtime.group.leagues.find(item => item.id === selection.leagueId) ?? null

  async function loadSerieADay() {
    if (year == null) {
      setDay(null)
      setIsLive(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const calendar = await runtime.realCalendarRepository.getCalendar(year, { refresh: true })
      if (!calendar) {
        setDay(null)
        setIsLive(false)
        return
      }
      const context = RealCalendarHelper.context(calendar, new Date())
      setDay(context.liveDay ?? context.nextDay ?? context.lastDay)
      setIsLive(context.isLive)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossibile caricare la giornata di Serie A.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSerieADay()
  }, [runtime, year])

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={980} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <YStack gap="$1" paddingTop="$2">
          <H1>{runtime.group.name}</H1>
          <Paragraph color="$color10">
            {league?.name ?? 'Lega'}{year != null ? ` · ${formatSeasonFromYear(year)}` : ''}
          </Paragraph>
        </YStack>

        <Card borderWidth={1} borderColor={isLive ? '$red8' : '$borderColor'} padding="$4">
          <YStack gap="$3">
            <XStack justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
              <YStack gap="$1">
                <H2 size="$6">{isLive ? 'Serie A · Live' : 'Serie A'}</H2>
                <Paragraph color="$color10">
                  {day ? `${day.serieADay}ª giornata` : 'Nessuna giornata disponibile'}
                </Paragraph>
              </YStack>
              <Button size="$3" variant="outlined" disabled={loading} onPress={() => { void loadSerieADay() }}>
                {loading ? <Spinner /> : 'Aggiorna'}
              </Button>
            </XStack>

            {error ? <Paragraph color="$red10">{error}</Paragraph> : null}
            {!error && loading && !day ? <Spinner size="large" /> : null}
            {!error && day ? (
              <YStack gap="$2">
                {day.games.map((game, index) => {
                  const hasScore = game.homeGoals != null && game.awayGoals != null
                  return (
                    <XStack
                      key={`${game.home.name}-${game.away.name}-${index}`}
                      padding="$3"
                      gap="$2"
                      alignItems="center"
                      justifyContent="space-between"
                      borderRadius="$3"
                      backgroundColor="$color2"
                    >
                      <Text flex={1} textAlign="right" fontWeight="700">{game.home.name}</Text>
                      <Text minWidth={56} textAlign="center" fontWeight="800">
                        {hasScore ? `${game.homeGoals} - ${game.awayGoals}` : 'vs'}
                      </Text>
                      <Text flex={1} fontWeight="700">{game.away.name}</Text>
                    </XStack>
                  )
                })}
              </YStack>
            ) : null}
          </YStack>
        </Card>

        <XStack gap="$3" flexWrap="wrap">
          <HomeAction title="La mia formazione" description="Prepara la squadra per il prossimo turno." onPress={() => onNavigate('formation')} />
          <HomeAction title="Classifica" description="Controlla la posizione nella tua lega." onPress={() => onNavigate('ranking')} />
          <HomeAction title="Calendario" description="Apri giornate, risultati e prossimi incontri." onPress={() => onNavigate('calendar')} />
          <HomeAction title="Live" description="Segui risultati e voti durante la giornata." onPress={() => onNavigate('live')} />
        </XStack>
      </YStack>
    </ScrollView>
  )
}

function HomeAction({ title, description, onPress }: { title: string; description: string; onPress: () => void }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={320}>
      <YStack gap="$2">
        <H2 size="$5">{title}</H2>
        <Paragraph color="$color10">{description}</Paragraph>
        <Button alignSelf="flex-start" variant="outlined" onPress={onPress}>Apri</Button>
      </YStack>
    </Card>
  )
}

function GroupSettings({ runtime, session }: { runtime: GroupSessionRuntime; session: AuthenticatedGroupSession }) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteUsername, setInviteUsername] = useState('')
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const group = runtime.group
  const connection = runtime.connection
  const canInvite = useMemo(() =>
    GroupHelper.hasRole(session.member, IdentityRole.Admin) ||
    GroupHelper.hasRole(session.member, IdentityRole.SuperAdmin), [session.member])

  async function inviteAndShare() {
    const email = inviteEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setShareStatus('Inserisci l’email con cui il partecipante farà login.')
      return
    }
    setSharing(true)
    setShareStatus(null)
    try {
      const invited = await runtime.inviteMember(session.member, { email, username: inviteUsername })
      const fragment = createInviteFragment({
        v: 3,
        group: connection.groupName,
        repository: connection.repository.full_name,
        email: invited.email,
        pat: connection.token,
      })
      const inviteUrl = publicWebUrl(`/${fragment}`)
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl)
        setShareStatus(`Utente ${invited.email} censito nel gruppo e invito copiato.`)
      } else {
        await Share.share({
          title: `Invito Fantazone · ${group.name}`,
          message: `Unisciti al gruppo Fantazone ${group.name} con ${invited.email}: ${inviteUrl}`,
        })
        setShareStatus(`Utente ${invited.email} censito nel gruppo e invito pronto.`)
      }
      setInviteEmail('')
      setInviteUsername('')
    } catch (caught) {
      setShareStatus(caught instanceof Error ? caught.message : 'Impossibile creare l’invito.')
    } finally {
      setSharing(false)
    }
  }

  const repositoryUrl = connection.repository.html_url ?? `https://github.com/${connection.repository.full_name}`

  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={980} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <YStack gap="$1" paddingTop="$2">
          <H1>Impostazioni</H1>
          <Paragraph color="$color10">Account, gruppo e collegamento zero-backend.</Paragraph>
        </YStack>

        <XStack gap="$3" flexWrap="wrap">
          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={360}>
            <YStack gap="$2">
              <H2 size="$6">Gruppo</H2>
              <Text fontWeight="700">{group.name}</Text>
              <Text color="$color10">{connection.repository.full_name}</Text>
              <Text color="$color10">Branch: {connection.repository.default_branch}</Text>
              <Button marginTop="$2" variant="outlined" onPress={() => Linking.openURL(repositoryUrl)}>Apri repository</Button>
            </YStack>
          </Card>

          <Card borderWidth={1} borderColor="$borderColor" padding="$4" flexGrow={1} flexBasis={360}>
            <YStack gap="$2">
              <H2 size="$6">Account</H2>
              <Text>{session.identity.displayName || session.member.username}</Text>
              <Text color="$color10">{session.identity.email}</Text>
              <Text color="$color10">Ruolo flags: {session.member.role}</Text>
              <Paragraph size="$2" color="$color9">La membership viene riletta dal repository quando il gruppo si sincronizza.</Paragraph>
            </YStack>
          </Card>
        </XStack>

        {canInvite ? (
          <Card borderWidth={1} borderColor="$blue8" padding="$4">
            <YStack gap="$3">
              <H2 size="$6">Invita nel gruppo</H2>
              <Paragraph>
                L’email viene salvata in <Text fontWeight="700">config/group.json</Text>; il link trasferisce la credenziale GitHub condivisa del gruppo e l’app la sincronizza nello spazio privato OneDrive dell’invitato.
              </Paragraph>
              <Card borderWidth={1} borderColor="$yellow8" padding="$3">
                <Paragraph size="$2">
                  Tratta il link come una password del gruppo: chi lo possiede può usare il PAT finché non viene ruotato.
                </Paragraph>
              </Card>
              <XStack gap="$3" flexWrap="wrap">
                <Input flex={1} minWidth={240} value={inviteEmail} onChangeText={setInviteEmail} autoCapitalize="none" autoCorrect={false} placeholder="email@esempio.it" />
                <Input flex={1} minWidth={200} value={inviteUsername} onChangeText={setInviteUsername} placeholder="Nome visualizzato (opzionale)" />
              </XStack>
              <Button theme="accent" disabled={sharing} onPress={inviteAndShare}>
                {sharing ? <Spinner /> : 'Censisci utente e copia invito'}
              </Button>
              <Paragraph size="$2" color="$color9">
                L’invitato accede con l’email Microsoft indicata. fanta.plus verifica il PAT condiviso e lo salva in OneDrive e sul dispositivo.
              </Paragraph>
              {shareStatus ? <Paragraph size="$2" color="$color10">{shareStatus}</Paragraph> : null}
            </YStack>
          </Card>
        ) : null}
      </YStack>
    </ScrollView>
  )
}

function PendingProductScreen({ route, onHome }: { route: GroupProductRoute; onHome: () => void }) {
  const item = findNavigationItem(route)
  return (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={760} alignSelf="center" padding="$4" paddingTop="$8" gap="$4">
        <H1>{item?.label ?? 'Fantazone'}</H1>
        <Card borderWidth={1} borderColor="$borderColor" padding="$4">
          <YStack gap="$3">
            <H2 size="$6">Sezione in migrazione</H2>
            <Paragraph color="$color10">
              La navigazione è già pronta; questa schermata verrà collegata ai servizi locali/GitHub nel prossimo blocco, senza ripristinare il vecchio backend.
            </Paragraph>
            <Button alignSelf="flex-start" onPress={onHome}>Torna alla Home</Button>
          </YStack>
        </Card>
      </YStack>
    </ScrollView>
  )
}
