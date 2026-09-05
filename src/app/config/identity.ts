import { PUBLIC_WEB_ORIGIN } from './publicOrigin'

declare const process: { env: Record<string, string | undefined> }

export const MICROSOFT_CLIENT_ID = 'fc83d630-7c49-4bb8-9361-c14950b6ff49'
export const MICROSOFT_HOME_TENANT_ID = '302135a8-33c7-448c-87cb-cc71fe0136c9'
export const MICROSOFT_AUTHORITY_TENANT = process.env.EXPO_PUBLIC_MICROSOFT_AUTHORITY_TENANT?.trim() || 'common'
export const MICROSOFT_REDIRECT_URI = PUBLIC_WEB_ORIGIN

/** Google web OAuth client id. Configure it as a GitHub Actions variable for the Pages build. */
export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID?.trim() || ''
