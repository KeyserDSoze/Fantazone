import React, { type ReactNode } from 'react'
import { ArrowRight, Sparkles } from '@tamagui/lucide-icons-2'
import {
  Button,
  Card,
  H1,
  Paragraph,
  ScrollView,
  Text,
  XStack,
  YStack,
  useMedia,
} from 'tamagui'

export function AppScreen({
  children,
  maxWidth = 1280,
  padded = true,
}: {
  children: ReactNode
  maxWidth?: number
  padded?: boolean
}) {
  const media = useMedia()
  const horizontalPadding = media.sm ? '$3' : media.md ? '$4' : '$6'

  return (
    <ScrollView flex={1} showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack
        width="100%"
        maxWidth={maxWidth}
        alignSelf="center"
        paddingHorizontal={padded ? horizontalPadding : '$0'}
        paddingTop={padded ? '$4' : '$0'}
        paddingBottom={padded ? '$9' : '$0'}
        gap="$5"
      >
        {children}
      </YStack>
    </ScrollView>
  )
}

export function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <XStack gap="$4" alignItems="flex-end" justifyContent="space-between" flexWrap="wrap">
      <YStack gap="$2" flex={1} minWidth={240}>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <H1
          color="$color12"
          fontSize="$10"
          lineHeight="$10"
          letterSpacing={-0.8}
          maxWidth={820}
        >
          {title}
        </H1>
        {description ? (
          <Paragraph color="$color10" fontSize="$4" lineHeight="$6" maxWidth={760}>
            {description}
          </Paragraph>
        ) : null}
      </YStack>
      {action}
    </XStack>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <XStack alignItems="center" gap="$2">
      <YStack width={28} height={2} borderRadius="$10" backgroundColor="$blue9" />
      <Text
        color="$blue10"
        fontSize="$2"
        fontWeight="800"
        letterSpacing={1.2}
        textTransform="uppercase"
      >
        {children}
      </Text>
    </XStack>
  )
}

export function Surface({
  children,
  accent = 'neutral',
  padding = '$5',
}: {
  children: ReactNode
  accent?: 'neutral' | 'blue' | 'green' | 'yellow' | 'red' | 'purple'
  padding?: '$3' | '$4' | '$5' | '$6'
}) {
  const borderColor = accent === 'blue'
    ? '$blue6'
    : accent === 'green'
      ? '$green6'
      : accent === 'yellow'
        ? '$yellow6'
        : accent === 'red'
          ? '$red6'
          : accent === 'purple'
            ? '$purple6'
            : '$color5'
  const backgroundColor = accent === 'blue'
    ? '$blue2'
    : accent === 'green'
      ? '$green2'
      : accent === 'yellow'
        ? '$yellow2'
        : accent === 'red'
          ? '$red2'
          : accent === 'purple'
            ? '$purple2'
            : '$color2'

  return (
    <Card
      padding={padding}
      borderWidth={1}
      borderColor={borderColor}
      backgroundColor={backgroundColor}
      borderRadius="$6"
      elevation={2}
      overflow="hidden"
    >
      {children}
    </Card>
  )
}

export function FeatureCard({
  icon,
  title,
  description,
  meta,
  onPress,
}: {
  icon: ReactNode
  title: string
  description: string
  meta?: string
  onPress?: () => void
}) {
  return (
    <Card
      flexGrow={1}
      flexBasis={260}
      minWidth={230}
      padding="$4"
      borderWidth={1}
      borderColor="$color5"
      backgroundColor="$color2"
      borderRadius="$5"
      hoverStyle={{ y: -2, borderColor: '$blue7', backgroundColor: '$color3' }}
      pressStyle={{ scale: 0.985 }}
      onPress={onPress}
    >
      <YStack gap="$4" minHeight={170}>
        <XStack justifyContent="space-between" alignItems="center">
          <YStack
            width={44}
            height={44}
            borderRadius="$4"
            alignItems="center"
            justifyContent="center"
            backgroundColor="$blue3"
            borderWidth={1}
            borderColor="$blue5"
          >
            {icon}
          </YStack>
          {meta ? (
            <Text color="$color9" fontSize="$2" fontWeight="700">
              {meta}
            </Text>
          ) : null}
        </XStack>
        <YStack gap="$2" flex={1}>
          <Text color="$color12" fontSize="$6" fontWeight="800">
            {title}
          </Text>
          <Paragraph color="$color10" lineHeight="$5">
            {description}
          </Paragraph>
        </YStack>
        {onPress ? (
          <XStack alignItems="center" gap="$2">
            <Text color="$blue10" fontWeight="800" fontSize="$3">Apri</Text>
            <ArrowRight size="$0.9" color="$blue10" />
          </XStack>
        ) : null}
      </YStack>
    </Card>
  )
}

export function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'blue' | 'green' | 'yellow' | 'red'
}) {
  const color = tone === 'blue'
    ? '$blue10'
    : tone === 'green'
      ? '$green10'
      : tone === 'yellow'
        ? '$yellow10'
        : tone === 'red'
          ? '$red10'
          : '$color10'
  const backgroundColor = tone === 'blue'
    ? '$blue3'
    : tone === 'green'
      ? '$green3'
      : tone === 'yellow'
        ? '$yellow3'
        : tone === 'red'
          ? '$red3'
          : '$color4'

  return (
    <XStack
      alignSelf="flex-start"
      paddingHorizontal="$2.5"
      paddingVertical="$1.5"
      borderRadius="$10"
      backgroundColor={backgroundColor}
      alignItems="center"
      gap="$1.5"
    >
      <YStack width={6} height={6} borderRadius="$10" backgroundColor={color} />
      <Text color={color} fontSize="$2" fontWeight="800">
        {children}
      </Text>
    </XStack>
  )
}

export function PrimaryAction({
  children,
  onPress,
  disabled,
  icon,
}: {
  children: ReactNode
  onPress: () => void
  disabled?: boolean
  icon?: ReactNode
}) {
  return (
    <Button
      size="$5"
      borderRadius="$4"
      backgroundColor="$blue9"
      borderColor="$blue9"
      color="white"
      fontWeight="800"
      disabled={disabled}
      onPress={onPress}
      hoverStyle={{ backgroundColor: '$blue10', borderColor: '$blue10', scale: 1.01 }}
      pressStyle={{ scale: 0.985 }}
      icon={icon ? () => icon : undefined}
    >
      {children}
    </Button>
  )
}

export function BrandBadge({ label = 'FANTAZONE' }: { label?: string }) {
  return (
    <XStack alignItems="center" gap="$2">
      <YStack
        width={34}
        height={34}
        borderRadius="$4"
        alignItems="center"
        justifyContent="center"
        backgroundColor="$blue9"
        shadowColor="$blue9"
        shadowOpacity={0.28}
        shadowRadius={12}
      >
        <Sparkles size="$1" color="white" />
      </YStack>
      <Text color="$color12" fontWeight="900" letterSpacing={1.1} fontSize="$4">
        {label}
      </Text>
    </XStack>
  )
}
