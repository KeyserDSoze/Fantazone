import React, { useState, type ReactNode } from 'react'
import { Image } from 'react-native'
import {
  Bell,
  BookOpen,
  Calendar,
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
import { Button, Paragraph, ScrollView, Separator, Sheet, Text, XStack, YStack, useMedia } from 'tamagui'
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
  const sections = getGroupNavigationSections(member)
  const selectedLeague = group.leagues.find(league => league.id === selection.leagueId) ?? null
  const years = selection.leagueId ? getLeagueYears(group, selection.leagueId) : []
  const media = useMedia()
  const isWideLayout = media.gtMd ?? false
  const isDesktop = !media.sm
  const contentWidth = isWideLayout ? '100%' : 640
  const horizontalPadding = isWideLayout ? '$6' : '$4'
  const hasContextSelector = group.leagues.length > 1 || years.length > 1

  function navigate(nextRoute: GroupProductRoute) {
    onRouteChange(nextRoute)
    setMenuOpen(false)
  }

  return (
    <YStack flex={1} backgroundColor="$background">
      <YStack width="100%" alignItems="center">
        <XStack
          width="100%"
          maxWidth={contentWidth}
          minHeight={64}
          alignSelf="center"
          justifyContent="space-between"
          alignItems="center"
          paddingHorizontal={horizontalPadding}
          paddingVertical="$3"
          backgroundColor="$color2"
          borderBottomWidth="$0.5"
          borderBottomColor="$color5"
          borderRadius={isWideLayout ? '$0' : '$4'}
        >
          <Image
            source={require('../assets/icon.png')}
            accessibilityLabel="Fantazone"
            style={{ width: 40, height: 40, borderRadius: 10 }}
          />
          <Button
            size="$4"
            circular
            backgroundColor="transparent"
            borderColor="transparent"
            accessibilityLabel="Apri menu"
            onPress={() => setMenuOpen(true)}
            hoverStyle={{ backgroundColor: '$color3' }}
            pressStyle={{ backgroundColor: '$color4' }}
          >
            <Menu size="$1.5" color="$color12" />
          </Button>
        </XStack>
      </YStack>

      <YStack flex={1}>{children}</YStack>

      <Sheet
        modal
        open={menuOpen}
        onOpenChange={setMenuOpen}
        snapPointsMode={isDesktop ? 'fit' : 'percent'}
        snapPoints={isDesktop ? undefined : [90]}
        moveOnKeyboardChange={false}
        dismissOnSnapToBottom={!isDesktop}
        disableDrag={isDesktop}
      >
        <Sheet.Overlay
          backgroundColor="rgba(0, 0, 0, 0.5)"
          transition="lazy"
          enterStyle={{ opacity: 0 }}
          exitStyle={{ opacity: 0 }}
        />
        <Sheet.Handle backgroundColor="$color8" />
        <Sheet.Frame
          backgroundColor="$background"
          borderTopLeftRadius={isDesktop ? 0 : '$6'}
          borderTopRightRadius={isDesktop ? 0 : '$6'}
          padding="$0"
          width="100%"
          alignSelf="center"
          height={isDesktop ? '100vh' : '90vh'}
          overflow="hidden"
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces
            alwaysBounceVertical={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 50 }}
            style={{ flex: 1 }}
          >
            <YStack width="100%" maxWidth={760} alignSelf="center" padding="$4" gap="$4">
              <XStack justifyContent="space-between" alignItems="center" marginBottom="$2" gap="$3">
                <Text flex={1} fontSize="$8" fontWeight="bold" color="$blue10" numberOfLines={1}>
                  Ciao {member.username}
                </Text>
                <Button
                  size="$3"
                  circular
                  backgroundColor="transparent"
                  borderColor="transparent"
                  accessibilityLabel="Chiudi menu"
                  onPress={() => setMenuOpen(false)}
                >
                  <X size="$1" color="$color11" />
                </Button>
              </XStack>

              <YStack backgroundColor="$color2" padding="$3" borderRadius="$4" gap="$2">
                <Text fontSize="$3" color="$color10">{identityEmail}</Text>
                <Text fontSize="$3" color="$blue10" fontWeight="700">📊 {group.name}</Text>
                {selectedLeague ? (
                  <Text fontSize="$2" color="$color11">
                    🏆 {selectedLeague.name || selectedLeague.id}
                    {selection.year != null ? ` · ${formatSeasonFromYear(selection.year)}` : ''}
                  </Text>
                ) : null}

                {hasContextSelector ? (
                  <Button
                    size="$2"
                    variant="outlined"
                    marginTop="$2"
                    onPress={() => setShowContextSelector(current => !current)}
                  >
                    {showContextSelector ? '← Nascondi' : '⚙️ Cambia lega / stagione'}
                  </Button>
                ) : null}

                {showContextSelector ? (
                  <YStack gap="$3" marginTop="$2" padding="$2" backgroundColor="$color3" borderRadius="$3">
                    {group.leagues.length > 1 ? (
                      <YStack gap="$1">
                        <Text fontSize="$2" fontWeight="bold" color="$color12">Leghe</Text>
                        {group.leagues.map(league => (
                          <Button
                            key={league.id}
                            size="$2"
                            variant="outlined"
                            borderColor={selection.leagueId === league.id ? '$blue8' : 'transparent'}
                            backgroundColor={selection.leagueId === league.id ? '$blue2' : 'transparent'}
                            justifyContent="flex-start"
                            onPress={() => onLeagueChange(league.id)}
                          >
                            <Text fontSize="$2" color={selection.leagueId === league.id ? '$blue11' : '$color11'}>
                              🏆 {league.name || league.id}{league.isMain ? ' · principale' : ''}
                            </Text>
                          </Button>
                        ))}
                      </YStack>
                    ) : null}

                    {years.length > 1 ? (
                      <YStack gap="$1">
                        <Text fontSize="$2" fontWeight="bold" color="$color12">Stagioni</Text>
                        <XStack gap="$1" flexWrap="wrap">
                          {years.map(year => (
                            <Button
                              key={year}
                              size="$2"
                              variant="outlined"
                              borderColor={selection.year === year ? '$orange8' : 'transparent'}
                              backgroundColor="transparent"
                              onPress={() => onYearChange(year)}
                            >
                              <Text fontSize="$2" color={selection.year === year ? '$orange10' : '$color11'}>
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

              <Separator />

              {sections.map(section => (
                <YStack key={section.title} gap="$2" marginBottom="$2">
                  <Text fontSize="$6" fontWeight="bold" color="$color12" marginBottom="$1">
                    {section.title}
                  </Text>
                  {section.items.map(item => {
                    const Icon = ROUTE_ICONS[item.route]
                    return (
                      <Button
                        key={item.route}
                        variant="outlined"
                        minHeight={64}
                        justifyContent="flex-start"
                        paddingHorizontal="$4"
                        paddingVertical="$3"
                        borderRadius="$4"
                        backgroundColor={route === item.route ? '$color3' : 'transparent'}
                        borderColor={route === item.route ? '$blue8' : '$borderColor'}
                        onPress={() => navigate(item.route)}
                        hoverStyle={{ backgroundColor: '$color3' }}
                        pressStyle={{ backgroundColor: '$color4' }}
                      >
                        <XStack gap="$3" alignItems="center" flex={1}>
                          <Icon size="$1" color="$color11" />
                          <YStack flex={1} alignItems="flex-start">
                            <Text fontSize="$4" fontWeight="500" color="$color12">{item.label}</Text>
                            <Paragraph size="$2" color="$color10" opacity={0.8} textAlign="left">
                              {item.description}
                            </Paragraph>
                          </YStack>
                        </XStack>
                      </Button>
                    )
                  })}
                </YStack>
              ))}

              <Separator />

              <YStack gap="$3" marginBottom="$4">
                <Text fontSize="$6" fontWeight="bold" color="$color12">Impostazioni</Text>

                <Button
                  variant="outlined"
                  justifyContent="flex-start"
                  icon={theme === 'dark' ? Sun : Moon}
                  onPress={onToggleTheme}
                >
                  Tema {theme === 'dark' ? 'chiaro' : 'scuro'}
                </Button>

                <Button
                  variant="outlined"
                  justifyContent="flex-start"
                  icon={HelpCircle}
                  onPress={() => {
                    setMenuOpen(false)
                    onExploreArchitecture()
                  }}
                >
                  Come funziona Fantazone
                </Button>

                <Button
                  variant="outlined"
                  justifyContent="flex-start"
                  icon={Users}
                  onPress={() => {
                    setMenuOpen(false)
                    void onChangeGroup()
                  }}
                >
                  Cambia gruppo
                </Button>

                <Button
                  chromeless
                  size="$2"
                  alignSelf="center"
                  icon={FileText}
                  onPress={() => navigate('patch-notes')}
                >
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
