import { createTamagui } from 'tamagui'
import { config as defaultConfig } from '@tamagui/config/v4'

const config = createTamagui(defaultConfig)

export type AppConfig = typeof config

declare module 'tamagui' {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config
