import React, { useState, type ReactNode } from 'react'
import { Image } from 'react-native'
import {
  Bell,
  BookOpen,
  Calendar,
  ChevronDown,
  DollarSign,
  FileText,
  Gavel,
  HelpCircle,
  Home,
  Menu,
  Moon,
  Package,
  PlayCircle,
  Settings,
  Star,
  Sun,
  TrendingUp,
  Trophy,
  UserCheck,
  UserCog,
  Users,
  X,
  Zap,
} from '@tamagui/lucide-icons-2'
import {
  Button,
  Paragraph,
  ScrollView,
  Separator,
  Sheet,
  Text,
  XStack,
  YStack,
  useMedia,
} from 'tamagui'
import { formatSeasonFromYear, type Group, type UserOfAGroup } from '@fantazone/domain'
import {
  getGroupNavigationSections,
  getLeagueYears,
  type GroupNavigationSelection,
  type GroupProductRoute,
} from '../services/groupNavigation'
import { APP_VERSION } from '../config/version'

type ThemeName = 'light' | 'dark'

type Props = {
  group: Group
  member: UserOfAGroup
  identityEmail: string
  route: GroupProductRoute
  selection: GroupNavigationSelection
  children: ReactNode
  theme: ThemeName
  onToggleTheme: () => void
  onRouteChange: (route: GroupProductRoute) => void
  onLeagueChange: (leagueId: string) => void
  onYearChange: (year: number) => void
  onChangeGroup: () => void | Promise<void>
  onExploreArchitecture: () => void
}

const ROUTE_ICONS: Record<GroupProductRoute, typeof Home> = {
  home: Home,
  ranking: Trophy,
  calendar: Calendar,
  live: Zap,
  formation: Users,
  teams: Users,
  players: UserCheck,
  market: DollarSign,
  'market-trades': TrendingUp,
  'hall-of-fame': Star,
  rules: BookOpen,
  info: HelpCircle,
  settings: Settings,
  'push-notifications': Bell,
  'patch-notes': FileText,
  auction: Gavel,
  'group-users-admin': UserCog,
  'group-baskets-admin': Package,
  'group-league-admin': Trophy,
  logs: PlayCircle,
  'serie-a-admin': Calendar,
}

export function GroupProductShell({
  group,
  member,
  identityEmail,
  route,
  selection,
  children,
  theme,
  onToggleTheme,
  onRouteChange,
  onLeagueChange,
  onYearChange,
  onChangeGroup,
  onExploreArchitecture,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showContextSelector, setShowContextSelector] = useState(false)
  const media = useMedia()
  const isDesktop = media.gtMd ?? false
  const sections = getGroupNavigationSections(member)
  const selectedLeague = group.leagues.find(league => league.id === selection.leagueId) ?? null
  const years = selection.leagueId ? getLeagueYears(group, selection.leagueId) : []
  const hasContextSelector = group.leagues.length > 1 || years.length > 1

  function navigate(nextRoute: GroupProductRoute) {
    onRouteChange(nextRoute)
    setMenuOpen(false)
  }

  const contextPanel = (
    <YStack
      backgroundColor="$color3"
      borderWidth={1}
      borderColor="$color5"
      padding="$3"
      borderRadius="$5"
      gap="$2"
    >
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <YStack flex={1} gap="$1">
          <Text fontSize="$2" color="$color9" fontWeight="800" textTransform="uppercase" letterSpacing={0.8}>
            Contesto attivo
          </Text>
          <Text fontSize="$4" color="$color12" fontWeight="800" numberOfLines={1}>
            {selectedLeague?.name || selectedLeague?.id || 'Lega'}
          </Text>
          {selection.year != null ? (
            <Text fontSize="$2" color="$color10">{formatSeasonFromYear(selection.year)}</Text>
          ) : null}
        </YStack>
        {hasContextSelector ? (
          <Button
            circular
            size="$2.5"
            chromeless
            accessibilityLabel="Cambia lega o stagione"
            onPress={() => setShowContextSelector(current => !current)}
          >
            <ChevronDown size="$1" color="$color10" />
          </Button>
        ) : null}
      </XStack>

      {showContextSelector ? (
        <YStack gap="$3" paddingTop="$2">
          {group.leagues.length > 1 ? (
            <YStack gap="$1.5">
              <Text fontSize="$2" fontWeight="800" color="$color10">Lega</Text>
              {group.leagues.map(league => (
                <Button
                  key={league.id}
                  size="$2.5"
                  justifyContent="flex-start"
                  backgroundColor={selection.leagueId === league.id ? '$blue4' : 'transparent'}
                  borderColor={selection.leagueId === league.id ? '$blue7' : 'transparent'}
                  onPress={() => onLeagueChange(league.id)}
                >
                  <Text fontSize="$2" color={selection.leagueId === league.id ? '$blue11' : '$color11'} fontWeight="700">
                    {league.name || league.id}{league.isMain ? ' · principale' : ''}
                  </Text>
                </Button>
              ))}
            </YStack>
          ) : null}

          {years.length > 1 ? (
            <YStack gap="$1.5">
              <Text fontSize="$2" fontWeight="800" color="$color10">Stagione</Text>
              <XStack gap="$1.5" flexWrap="wrap">
                {years.map(year => (
                  <Button
                    key={year}
                    size="$2.5"
                    borderColor={selection.year === year ? '$blue7' : '$color5'}
                    backgroundColor={selection.year === year ? '$blue3' : '$color2'}
                    onPress={() => onYearChange(year)}
                  >
                    <Text fontSize="$2" color={selection.year === year ? '$blue11' : '$color10'} fontWeight="700">
                      {formatSeasonFromYear(year)}
                    </Text>
                  </Button>
                ))}
              </XStack>
            </YStack>
          ) : null}
        </YStack>
      ) : null}
    </YStack>
  )

  const navigation = (
    <YStack gap="$5">
      {sections.map(section => (
        <YStack key={section.title} gap="$1.5">
          <Text
            fontSize="$1"
            fontWeight="900"
            color="$color8"
            textTransform="uppercase"
            letterSpacing={1.1}
            paddingHorizontal="$2"
          >
            {section.title}
          </Text>
          {section.items.map(item => {
            const Icon = ROUTE_ICONS[item.route]
            const active = route === item.route
            return (
              <Button
                key={item.route}
                minHeight={44}
                justifyContent="flex-start"
                borderRadius="$4"
                paddingHorizontal="$3"
                backgroundColor={active ? '$blue4' : 'transparent'}
                borderColor={active ? '$blue6' : 'transparent'}
                onPress={() => navigate(item.route)}
                hoverStyle={{ backgroundColor: active ? '$blue4' : '$color3' }}
                pressStyle={{ scale: 0.99 }}
              >
                <XStack gap="$2.5" alignItems="center" flex={1}>
                  <Icon size="$1" color={active ? '$blue11' : '$color10'} />
                  <Text fontSize="$3" fontWeight={active ? '800' : '600'} color={active ? '$blue11' : '$color11'}>
                    {item.label}
                  </Text>
                </XStack>
              </Button>
            )
          })}
        </YStack>
      ))}
    </YStack>
  )

  if (isDesktop) {
    return (
      <XStack flex={1} backgroundColor="$background">
        <YStack
          width={292}
          borderRightWidth={1}
          borderRightColor="$color5"
          backgroundColor="$color2"
          padding="$4"
          gap="$4"
        >
          <XStack alignItems="center" gap="$3" paddingHorizontal="$1" paddingVertical="$2">
            <Image
              source={require('../assets/icon.png')}
              accessibilityLabel="Fantazone"
              style={{ width: 42, height: 42, borderRadius: 12 }}
            />
            <YStack flex={1}>
              <Text fontSize="$5" color="$color12" fontWeight="900" letterSpacing={0.2}>Fantazone</Text>
              <Text fontSize="$2" color="$color9">{group.name}</Text>
            </YStack>
          </XStack>

          {contextPanel}

          <ScrollView flex={1} showsVerticalScrollIndicator={false}>
            {navigation}
          </ScrollView>

          <Separator />
          <YStack gap="$1.5">
            <Button chromeless justifyContent="flex-start" icon={theme === 'dark' ? Sun : Moon} onPress={onToggleTheme}>
              Tema {theme === 'dark' ? 'chiaro' : 'scuro'}
            </Button>
            <Button chromeless justifyContent="flex-start" icon={Users} onPress={() => { void onChangeGroup() }}>
              Cambia gruppo
            </Button>
            <Button chromeless justifyContent="flex-start" icon={HelpCircle} onPress={onExploreArchitecture}>
              Come funziona
            </Button>
            <Button chromeless justifyContent="flex-start" icon={FileText} onPress={() => navigate('patch-notes')}>
              <Text fontSize="$2" color="$color9">v{APP_VERSION} · Patch notes</Text>
            </Button>
          </YStack>
        </YStack>

        <YStack flex={1} minWidth={0}>
          <XStack
            minHeight={68}
            alignItems="center"
            justifyContent="space-between"
            paddingHorizontal="$6"
            borderBottomWidth={1}
            borderBottomColor="$color4"
            backgroundColor="$background"
          >
            <YStack gap="$0.5">
              <Text color="$color9" fontSize="$2">{identityEmail}</Text>
              <Text color="$color12" fontWeight="800" fontSize="$4">Ciao {member.username}</Text>
            </YStack>
            <XStack alignItems="center" gap="$2">
              <YStack width={8} height={8} borderRadius="$10" backgroundColor="$green9" />
              <Text color="$color9" fontSize="$2" fontWeight="700">Offline-first</Text>
            </XStack>
          </XStack>
          <YStack flex={1} minHeight={0}>{children}</YStack>
        </YStack>
      </XStack>
    )
  }

  return (
    <YStack flex={1} backgroundColor="$background">
      <XStack
        width="100%"
        minHeight={64}
        justifyContent="space-between"
        alignItems="center"
        paddingHorizontal="$4"
        paddingVertical="$2.5"
        backgroundColor="$background"
        borderBottomWidth={1}
        borderBottomColor="$color4"
      >
        <XStack alignItems="center" gap="$2.5" flex={1}>
          <Image
            source={require('../assets/icon.png')}
            accessibilityLabel="Fantazone"
            style={{ width: 38, height: 38, borderRadius: 11 }}
          />
          <YStack flex={1} minWidth={0}>
            <Text fontSize="$4" fontWeight="900" color="$color12" numberOfLines={1}>{group.name}</Text>
            <Text fontSize="$2" color="$color9" numberOfLines={1}>
              {selectedLeague?.name || selectedLeague?.id || 'Fantazone'}{selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}
            </Text>
          </YStack>
        </XStack>
        <Button
          size="$4"
          circular
          backgroundColor="$color3"
          borderColor="$color5"
          accessibilityLabel="Apri menu"
          onPress={() => setMenuOpen(true)}
          hoverStyle={{ backgroundColor: '$color4' }}
          pressStyle={{ scale: 0.96 }}
        >
          <Menu size="$1.5" color="$color12" />
        </Button>
      </XStack>

      <YStack flex={1}>{children}</YStack>

      <Sheet
        modal
        open={menuOpen}
        onOpenChange={setMenuOpen}
        snapPointsMode="percent"
        snapPoints={[92]}
        moveOnKeyboardChange={false}
        dismissOnSnapToBottom
      >
        <Sheet.Overlay
          backgroundColor="rgba(0, 0, 0, 0.55)"
          transition="lazy"
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <Sheet.Handle backgroundColor="$color7" />
        <Sheet.Frame backgroundColor="$background" borderTopLeftRadius="$7" borderTopRightRadius="$7" overflow="hidden">
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 50 }}
          >
            <YStack width="100%" maxWidth={720} alignSelf="center" padding="$4" gap="$4">
              <XStack justifyContent="space-between" alignItems="center" gap="$3">
                <YStack flex={1} gap="$1">
                  <Text fontSize="$7" fontWeight="900" color="$color12" numberOfLines={1}>Ciao {member.username}</Text>
                  <Text fontSize="$2" color="$color9" numberOfLines={1}>{identityEmail}</Text>
                </YStack>
                <Button circular size="$3" chromeless accessibilityLabel="Chiudi menu" onPress={() => setMenuOpen(false)}>
                  <X size="$1" color="$color11" />
                </Button>
              </XStack>

              {contextPanel}
              <Separator />

              {sections.map(section => (
                <YStack key={section.title} gap="$2.5">
                  <Text fontSize="$5" fontWeight="900" color="$color12">{section.title}</Text>
                  {section.items.map(item => {
                    const Icon = ROUTE_ICONS[item.route]
                    const active = route === item.route
                    return (
                      <Button
                        key={item.route}
                        minHeight={68}
                        justifyContent="flex-start"
                        paddingHorizontal="$3"
                        paddingVertical="$3"
                        borderRadius="$5"
                        backgroundColor={active ? '$blue3' : '$color2'}
                        borderColor={active ? '$blue7' : '$color5'}
                        onPress={() => navigate(item.route)}
                      >
                        <XStack gap="$3" alignItems="center" flex={1}>
                          <YStack
                            width={40}
                            height={40}
                            alignItems="center"
                            justifyContent="center"
                            borderRadius="$4"
                            backgroundColor={active ? '$blue4' : '$color3'}
                          >
                            <Icon size="$1.1" color={active ? '$blue11' : '$color10'} />
                          </YStack>
                          <YStack flex={1} alignItems="flex-start">
                            <Text fontSize="$4" fontWeight="800" color="$color12">{item.label}</Text>
                            <Paragraph size="$2" color="$color9" textAlign="left">{item.description}</Paragraph>
                          </YStack>
                        </XStack>
                      </Button>
                    )
                  })}
                </YStack>
              ))}

              <Separator />
              <YStack gap="$2">
                <Text fontSize="$5" fontWeight="900" color="$color12">Account e app</Text>
                <Button variant="outlined" justifyContent="flex-start" icon={theme === 'dark' ? Sun : Moon} onPress={onToggleTheme}>
                  Tema {theme === 'dark' ? 'chiaro' : 'scuro'}
                </Button>
                <Button variant="outlined" justifyContent="flex-start" icon={Users} onPress={() => { setMenuOpen(false); void onChangeGroup() }}>
                  Cambia gruppo
                </Button>
                <Button variant="outlined" justifyContent="flex-start" icon={HelpCircle} onPress={() => { setMenuOpen(false); onExploreArchitecture() }}>
                  Come funziona Fantazone
                </Button>
                <Button chromeless alignSelf="center" icon={FileText} onPress={() => navigate('patch-notes')}>
                  <Text fontSize="$2" color="$color9">Fantazone v{APP_VERSION} · Patch notes</Text>
                </Button>
              </YStack>
            </YStack>
          </ScrollView>
        </Sheet.Frame>
      </Sheet>
    </YStack>
  )
}
