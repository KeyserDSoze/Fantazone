import React, { useState, type ReactNode } from 'react'
import { Image } from 'react-native'
import { Menu, X } from '@tamagui/lucide-icons-2'
import { Button, Paragraph, ScrollView, Separator, Sheet, Text, XStack, YStack } from 'tamagui'
import { formatSeasonFromYear, type Group, type UserOfAGroup } from '@fantazone/domain'
import {
  findNavigationItem,
  getGroupNavigationSections,
  getLeagueYears,
  type GroupNavigationSelection,
  type GroupProductRoute,
} from '../services/groupNavigation'

type Props = {
  group: Group
  member: UserOfAGroup
  identityEmail: string
  route: GroupProductRoute
  selection: GroupNavigationSelection
  children: ReactNode
  onRouteChange: (route: GroupProductRoute) => void
  onLeagueChange: (leagueId: string) => void
  onYearChange: (year: number) => void
  onChangeGroup: () => void | Promise<void>
  onExploreArchitecture: () => void
}

export function GroupProductShell({
  group,
  member,
  identityEmail,
  route,
  selection,
  children,
  onRouteChange,
  onLeagueChange,
  onYearChange,
  onChangeGroup,
  onExploreArchitecture,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const sections = getGroupNavigationSections(member)
  const selectedLeague = group.leagues.find(league => league.id === selection.leagueId) ?? null
  const years = selection.leagueId ? getLeagueYears(group, selection.leagueId) : []
  const routeItem = findNavigationItem(route)
  const contextLabel = [
    selectedLeague?.name || null,
    selection.year != null ? formatSeasonFromYear(selection.year) : null,
  ].filter(Boolean).join(' · ')

  function navigate(nextRoute: GroupProductRoute) {
    onRouteChange(nextRoute)
    setMenuOpen(false)
  }

  return (
    <YStack flex={1} backgroundColor="$background">
      <XStack
        minHeight={68}
        paddingHorizontal="$4"
        paddingVertical="$3"
        alignItems="center"
        justifyContent="space-between"
        gap="$3"
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
        backgroundColor="$color2"
      >
        <XStack alignItems="center" gap="$3" flex={1} minWidth={0}>
          <Image
            source={require('../assets/icon.png')}
            accessibilityLabel="Fantazone"
            style={{ width: 42, height: 42, borderRadius: 10 }}
          />
          <YStack flex={1} minWidth={0}>
            <Text fontSize="$5" fontWeight="800" numberOfLines={1}>Fantazone · {group.name}</Text>
            <Text fontSize="$2" color="$color10" numberOfLines={1}>
              {routeItem?.label ?? 'Fantazone'}{contextLabel ? ` · ${contextLabel}` : ''}
            </Text>
          </YStack>
        </XStack>
        <Button
          size="$4"
          circular
          chromeless
          accessibilityLabel="Apri menu"
          onPress={() => setMenuOpen(true)}
          icon={Menu}
        />
      </XStack>

      <YStack flex={1}>{children}</YStack>

      <Sheet
        modal
        open={menuOpen}
        onOpenChange={setMenuOpen}
        snapPointsMode="percent"
        snapPoints={[92]}
        dismissOnSnapToBottom
      >
        <Sheet.Overlay backgroundColor="rgba(0, 0, 0, 0.55)" />
        <Sheet.Handle />
        <Sheet.Frame backgroundColor="$background" padding="$0">
          <ScrollView flex={1} contentContainerStyle={{ paddingBottom: 48 }}>
            <YStack width="100%" maxWidth={760} alignSelf="center" padding="$4" gap="$4">
              <XStack justifyContent="space-between" alignItems="flex-start" gap="$3">
                <YStack flex={1} gap="$1">
                  <Text fontSize="$7" fontWeight="800">Ciao {member.username}</Text>
                  <Text color="$color10">{identityEmail}</Text>
                  <Text color="$blue10" fontWeight="700">{group.name}</Text>
                </YStack>
                <Button circular chromeless accessibilityLabel="Chiudi menu" onPress={() => setMenuOpen(false)} icon={X} />
              </XStack>

              {group.leagues.length > 0 ? (
                <YStack gap="$2">
                  <Text fontWeight="800">Lega</Text>
                  <XStack gap="$2" flexWrap="wrap">
                    {group.leagues.map(league => (
                      <Button
                        key={league.id}
                        size="$3"
                        theme={selection.leagueId === league.id ? 'accent' : undefined}
                        variant="outlined"
                        onPress={() => onLeagueChange(league.id)}
                      >
                        {league.name || league.id}
                      </Button>
                    ))}
                  </XStack>
                </YStack>
              ) : null}

              {years.length > 0 ? (
                <YStack gap="$2">
                  <Text fontWeight="800">Stagione</Text>
                  <XStack gap="$2" flexWrap="wrap">
                    {years.map(year => (
                      <Button
                        key={year}
                        size="$3"
                        theme={selection.year === year ? 'accent' : undefined}
                        variant="outlined"
                        onPress={() => onYearChange(year)}
                      >
                        {formatSeasonFromYear(year)}
                      </Button>
                    ))}
                  </XStack>
                </YStack>
              ) : null}

              <Separator />

              {sections.map(section => (
                <YStack key={section.title} gap="$2">
                  <Text fontSize="$5" fontWeight="800">{section.title}</Text>
                  {section.items.map(item => (
                    <Button
                      key={item.route}
                      variant="outlined"
                      minHeight={58}
                      justifyContent="flex-start"
                      backgroundColor={route === item.route ? '$color3' : 'transparent'}
                      borderColor={route === item.route ? '$blue8' : '$borderColor'}
                      onPress={() => navigate(item.route)}
                    >
                      <YStack flex={1} alignItems="flex-start" gap="$1">
                        <Text fontWeight="700">{item.label}</Text>
                        <Paragraph size="$2" color="$color10" textAlign="left">{item.description}</Paragraph>
                      </YStack>
                    </Button>
                  ))}
                </YStack>
              ))}

              <Separator />

              <YStack gap="$2">
                <Button variant="outlined" onPress={() => { setMenuOpen(false); onExploreArchitecture() }}>
                  Come funziona Fantazone
                </Button>
                <Button variant="outlined" onPress={onChangeGroup}>Cambia gruppo</Button>
              </YStack>
            </YStack>
          </ScrollView>
        </Sheet.Frame>
      </Sheet>
    </YStack>
  )
}
