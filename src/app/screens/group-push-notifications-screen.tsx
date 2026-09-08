import React, { useEffect, useMemo, useState } from 'react'
import { Linking, Platform } from 'react-native'
import {
  Bell,
  BellRing,
  ExternalLink,
  RefreshCw,
  Send,
  ShieldCheck,
  Wrench,
} from '@tamagui/lucide-icons-2'
import { Button, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  GroupHelper,
  IdentityRole,
  type AuthenticatedGroupSession,
  type PushNotificationPreferences,
  type PushNotificationSettings,
} from '@fantazone/domain'
import { AppScreen, PageIntro, PrimaryAction, StatusPill, Surface } from '../components/design-system'
import { GroupPushNotificationService, type PushTransportStatus } from '../services/groupPushNotificationService'
import type { GroupSessionRuntime } from '../services/groupSessionRuntime'
import {
  getExistingWebPushSubscription,
  getWebPushSupportState,
  subscribeCurrentBrowserForPush,
  type WebPushSupportState,
} from '../services/webPushClient'

type Props = {
  runtime: GroupSessionRuntime
  session: AuthenticatedGroupSession
}

type PreferenceKey = keyof PushNotificationPreferences

const PREFERENCES: Array<{ key: PreferenceKey; label: string; description: string }> = [
  { key: 'matchEvents', label: 'Eventi dei miei giocatori', description: 'Goal, assist, cartellini, rigori e altri eventi live della tua formazione.' },
  { key: 'opponentMatchEvents', label: 'Eventi dell’avversario', description: 'Eventi live dei giocatori schierati dall’avversario nelle tue leghe.' },
  { key: 'deploymentReminder', label: 'Promemoria formazione', description: 'Ricorda di schierare la formazione prima dell’inizio della giornata.' },
  { key: 'endDay', label: 'Fine giornata', description: 'Notifica quando la giornata è conclusa e i risultati sono disponibili.' },
  { key: 'marketEvents', label: 'Mercato', description: 'Aggiornamenti sugli scambi e sugli eventi di mercato rilevanti.' },
]

export function GroupPushNotificationsScreen({ runtime, session }: Props) {
  const service = useMemo(() => new GroupPushNotificationService(runtime), [runtime])
  const email = session.identity.email
  const [settings, setSettings] = useState<PushNotificationSettings | null>(null)
  const [support, setSupport] = useState<WebPushSupportState | null>(null)
  const [browserEndpoint, setBrowserEndpoint] = useState<string | null>(null)
  const [transport, setTransport] = useState<PushTransportStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const isSuperAdmin = GroupHelper.hasRole(session.member, IdentityRole.SuperAdmin)
  const registeredHere = Boolean(browserEndpoint && settings?.subscriptions.some(item => item.endpoint === browserEndpoint))

  async function load() {
    setBusy(true)
    setError(null)
    try {
      const [nextSettings, nextSupport, existing, nextTransport] = await Promise.all([
        service.getSettings(email, true),
        getWebPushSupportState(),
        getExistingWebPushSubscription(),
        service.getTransportStatus(),
      ])
      setSettings(nextSettings)
      setSupport(nextSupport)
      setBrowserEndpoint(existing?.endpoint ?? null)
      setTransport(nextTransport)
    } catch (value) {
      setError(toMessage(value))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void load() }, [service, email])

  function toggle(key: PreferenceKey) {
    setSettings(current => current ? { ...current, [key]: !current[key] } : current)
  }

  async function savePreferences() {
    if (!settings) return
    await action(async () => {
      const saved = await service.savePreferences(email, {
        matchEvents: settings.matchEvents,
        opponentMatchEvents: settings.opponentMatchEvents,
        deploymentReminder: settings.deploymentReminder,
        endDay: settings.endDay,
        marketEvents: settings.marketEvents,
      })
      setSettings(saved)
      setMessage('Preferenze push salvate nel repository del gruppo.')
    })
  }

  async function subscribe() {
    await action(async () => {
      const subscription = await subscribeCurrentBrowserForPush()
      const saved = await service.registerSubscription(email, subscription)
      setSettings(saved)
      setBrowserEndpoint(subscription.endpoint)
      setSupport(await getWebPushSupportState())
      setMessage('Questo browser è registrato per le Web Push del gruppo.')
    })
  }

  async function disableForGroup() {
    if (!browserEndpoint) return
    await action(async () => {
      setSettings(await service.unregisterSubscription(email, browserEndpoint))
      setMessage('Questo gruppo non invierà più Web Push a questo browser. La subscription fanta.plus resta attiva per gli altri gruppi.')
    })
  }

  async function installTransport() {
    await action(async () => {
      const next = await service.installTransport(session.member)
      setTransport(next)
      setMessage('Trasporto Web Push installato nel repository del gruppo. Configura ora il Secret GitHub richiesto.')
    })
  }

  async function sendTest() {
    await action(async () => {
      await service.dispatchTest(email)
      setMessage('Test Web Push avviato con GitHub Actions. Puoi verificarne l’esito nei Log di piattaforma/gruppo.')
    })
  }

  async function action(operation: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await operation()
    } catch (value) {
      setError(toMessage(value))
    } finally {
      setBusy(false)
    }
  }

  const secretsUrl = `https://github.com/${runtime.target.owner}/${runtime.target.repo}/settings/secrets/actions`

  return (
    <AppScreen maxWidth={1100}>
      <PageIntro
        eyebrow="Web Push"
        title="Notifiche"
        description="Scegli cosa ricevere e su quali dispositivi. Preferenze e subscription vivono nel repository del gruppo, mentre l’invio passa da GitHub Actions."
        action={(
          <Button
            variant="outlined"
            borderRadius="$4"
            disabled={busy}
            icon={busy ? undefined : RefreshCw}
            onPress={() => { void load() }}
          >
            {busy ? <Spinner /> : 'Aggiorna'}
          </Button>
        )}
      />

      {error ? (
        <Surface accent="red" padding="$3">
          <Paragraph color="$red11">{error}</Paragraph>
        </Surface>
      ) : null}
      {message ? (
        <Surface accent="green" padding="$3">
          <Paragraph color="$green11">{message}</Paragraph>
        </Surface>
      ) : null}

      <Surface accent={registeredHere ? 'green' : 'neutral'} padding="$5">
        <YStack gap="$4">
          <XStack gap="$3" justifyContent="space-between" alignItems="center" flexWrap="wrap">
            <XStack gap="$3" alignItems="center" flex={1} minWidth={250}>
              <YStack width={48} height={48} borderRadius="$5" backgroundColor={registeredHere ? '$green4' : '$color4'} alignItems="center" justifyContent="center">
                {registeredHere ? <BellRing size="$1.25" color="$green10" /> : <Bell size="$1.25" color="$color10" />}
              </YStack>
              <YStack gap="$1" flex={1}>
                <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Dispositivo corrente</Text>
                <Text color="$color12" fontSize="$6" fontWeight="900">{registeredHere ? 'Notifiche abilitate' : 'Notifiche non abilitate'}</Text>
              </YStack>
            </XStack>
            <XStack gap="$2" flexWrap="wrap">
              {Platform.OS === 'web' ? <StatusPill tone={support?.supported === false ? 'yellow' : 'blue'}>Web Push</StatusPill> : <StatusPill tone="neutral">Native in arrivo</StatusPill>}
              <StatusPill tone={registeredHere ? 'green' : 'neutral'}>{registeredHere ? 'Registrato' : 'Non registrato'}</StatusPill>
            </XStack>
          </XStack>

          {Platform.OS !== 'web' ? (
            <Paragraph color="$color9">Le notifiche native iOS/Android richiedono il successivo blocco Expo/APNs/FCM. Questa versione abilita Web Push reali su browser.</Paragraph>
          ) : support?.supported === false ? (
            <Paragraph color="$yellow11">{support.reason}</Paragraph>
          ) : (
            <>
              <XStack gap="$3" flexWrap="wrap">
                <DeviceMetric label="Permesso browser" value={support?.supported ? support.permission : '—'} />
                <DeviceMetric label="Gruppo" value={registeredHere ? 'Attivo' : 'Non attivo'} />
                <DeviceMetric label="Trasporto" value={transport?.current ? 'Pronto' : 'Da configurare'} />
              </XStack>
              <XStack gap="$2" flexWrap="wrap">
                <Button
                  borderRadius="$4"
                  backgroundColor={registeredHere ? '$color3' : '$blue4'}
                  borderColor={registeredHere ? '$color5' : '$blue7'}
                  disabled={busy || registeredHere}
                  onPress={() => { void subscribe() }}
                >
                  Abilita in questo gruppo
                </Button>
                <Button variant="outlined" borderRadius="$4" onPress={() => { void disableForGroup() }} disabled={busy || !registeredHere}>
                  Disabilita qui
                </Button>
                <Button
                  variant="outlined"
                  borderRadius="$4"
                  icon={Send}
                  onPress={() => { void sendTest() }}
                  disabled={busy || !registeredHere || !transport?.current}
                >
                  Invia prova
                </Button>
              </XStack>
            </>
          )}
        </YStack>
      </Surface>

      <Surface padding="$5">
        <YStack gap="$4">
          <YStack gap="$1">
            <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">Contenuti</Text>
            <Text color="$color12" fontSize="$6" fontWeight="900">Cosa vuoi ricevere</Text>
            <Paragraph color="$color9" size="$2">Le preferenze valgono per questo account nel gruppo corrente.</Paragraph>
          </YStack>

          {settings ? (
            <XStack gap="$3" flexWrap="wrap" alignItems="stretch">
              {PREFERENCES.map(item => (
                <YStack
                  key={item.key}
                  flexGrow={1}
                  flexBasis={420}
                  minWidth={270}
                  padding="$4"
                  borderRadius="$5"
                  borderWidth={1}
                  borderColor={settings[item.key] ? '$green6' : '$color5'}
                  backgroundColor={settings[item.key] ? '$green2' : '$color2'}
                  gap="$3"
                >
                  <XStack justifyContent="space-between" alignItems="flex-start" gap="$3">
                    <YStack gap="$1" flex={1} minWidth={0}>
                      <Text color="$color12" fontWeight="900">{item.label}</Text>
                      <Paragraph color="$color9" size="$2">{item.description}</Paragraph>
                    </YStack>
                    <StatusPill tone={settings[item.key] ? 'green' : 'neutral'}>{settings[item.key] ? 'Attiva' : 'Spenta'}</StatusPill>
                  </XStack>
                  <Button
                    size="$3"
                    alignSelf="flex-start"
                    borderRadius="$10"
                    backgroundColor={settings[item.key] ? '$green4' : '$color3'}
                    borderColor={settings[item.key] ? '$green7' : '$color5'}
                    onPress={() => toggle(item.key)}
                  >
                    {settings[item.key] ? 'Disattiva' : 'Attiva'}
                  </Button>
                </YStack>
              ))}
            </XStack>
          ) : (
            <YStack minHeight={120} alignItems="center" justifyContent="center"><Spinner /></YStack>
          )}

          <XStack justifyContent="flex-end">
            <PrimaryAction disabled={busy || !settings} onPress={() => { void savePreferences() }}>
              Salva preferenze
            </PrimaryAction>
          </XStack>
        </YStack>
      </Surface>

      <Surface accent={transport?.current ? 'green' : 'yellow'} padding="$5">
        <YStack gap="$4">
          <XStack gap="$3" justifyContent="space-between" alignItems="center" flexWrap="wrap">
            <XStack gap="$3" alignItems="center" flex={1} minWidth={250}>
              <YStack width={46} height={46} borderRadius="$4" backgroundColor={transport?.current ? '$green4' : '$yellow4'} alignItems="center" justifyContent="center">
                {transport?.current ? <ShieldCheck size="$1.2" color="$green10" /> : <Wrench size="$1.2" color="$yellow10" />}
              </YStack>
              <YStack gap="$1" flex={1}>
                <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">GitHub Actions</Text>
                <Text color="$color12" fontSize="$6" fontWeight="900">Trasporto push</Text>
              </YStack>
            </XStack>
            <StatusPill tone={transport?.current ? 'green' : 'yellow'}>
              {transport?.current ? `v${transport.version} pronta` : transport?.installed ? 'Da aggiornare' : 'Non installata'}
            </StatusPill>
          </XStack>

          {isSuperAdmin ? (
            <>
              <Paragraph color="$color9">
                Nel repository deve esistere il Secret Actions <Text fontWeight="900">FANTAZONE_VAPID_PRIVATE_KEY</Text>. La chiave privata non viene mai salvata nel client o nei JSON.
              </Paragraph>
              <XStack gap="$2" flexWrap="wrap">
                <Button
                  borderRadius="$4"
                  disabled={busy || transport?.current}
                  onPress={() => { void installTransport() }}
                >
                  {transport?.installed ? 'Aggiorna trasporto' : 'Installa trasporto'}
                </Button>
                <Button
                  variant="outlined"
                  borderRadius="$4"
                  icon={ExternalLink}
                  onPress={() => { void Linking.openURL(secretsUrl) }}
                >
                  GitHub Actions Secrets
                </Button>
              </XStack>
            </>
          ) : (
            <Paragraph color="$color9">Solo un SuperAdmin può installare/aggiornare il trasporto e configurare il Secret del repository.</Paragraph>
          )}
        </YStack>
      </Surface>

      <Surface accent="yellow" padding="$4">
        <YStack gap="$2">
          <Text color="$yellow11" fontWeight="900">Automazioni ancora protette</Text>
          <Paragraph color="$yellow11" size="$2">
            Le preferenze legacy sono già persistite, ma gli invii automatici per eventi live, reminder, fine giornata e mercato restano disabilitati finché il test reale del trasporto non è stato validato. Questo evita duplicati o spam durante la migrazione.
          </Paragraph>
        </YStack>
      </Surface>
    </AppScreen>
  )
}

function DeviceMetric({ label, value }: { label: string; value: string }) {
  return (
    <YStack flexGrow={1} flexBasis={150} minWidth={130} padding="$3" borderRadius="$4" backgroundColor="$color3" borderWidth={1} borderColor="$color4" gap="$1">
      <Text color="$color8" fontSize="$1" fontWeight="900" textTransform="uppercase">{label}</Text>
      <Text color="$color12" fontWeight="900">{value}</Text>
    </YStack>
  )
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
