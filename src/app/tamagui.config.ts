import { defaultConfig } from '@tamagui/config/v5'
import { animations } from '@tamagui/config/v5-rn'
import { createInterFont } from '@tamagui/font-inter'
import { createMedia } from '@tamagui/react-native-media-driver'
import { createTamagui } from 'tamagui'

const headingFont = createInterFont()
const bodyFont = createInterFont()

const config = createTamagui({
  ...defaultConfig,
  animations,
  fonts: {
    ...defaultConfig.fonts,
    body: bodyFont,
    heading: headingFont,
  },
  media: createMedia({
    xs: { maxWidth: 660 },
    sm: { maxWidth: 800 },
    md: { maxWidth: 1020 },
    lg: { maxWidth: 1280 },
    xl: { maxWidth: 1420 },
    xxl: { maxWidth: 1600 },
    gtXs: { minWidth: 661 },
    gtSm: { minWidth: 801 },
    gtMd: { minWidth: 1021 },
    gtLg: { minWidth: 1281 },
    short: { maxHeight: 820 },
    tall: { minHeight: 820 },
    hoverNone: { hover: 'none' },
    pointerCoarse: { pointer: 'coarse' },
  }),
  settings: {
    ...defaultConfig.settings,
    allowedStyleValues: false,
    disableSSR: true,
    defaultPosition: 'relative',
    mediaQueryDefaultActive: {},
    onlyAllowShorthands: false,
    styleCompat: 'legacy',
  },
})

export type AppConfig = typeof config

declare module 'tamagui' {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config
