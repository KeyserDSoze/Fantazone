import React, { useEffect, useMemo, useState } from 'react'
import { Linking, Platform } from 'react-native'
import { Button, Card, H1, H2, Paragraph, ScrollView, Spinner, Text, XStack, YStack } from 'tamagui'
import {
  GroupHelper,
  IdentityRole,
  type AuthenticatedGroupSession,
  type PushNotificationPreferences,
  type PushNotificationSettings,
} from '@fantazone/domain'
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
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <YStack width="100%" maxWidth={900} alignSelf="center" padding="$4" paddingBottom="$8" gap="$4">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$3" flexWrap="wrap" paddingTop="$2">
          <YStack gap="$1" flex={1} minWidth={260}>
            <H1>Notifiche push</H1>
            <Paragraph color="$color10">Preferenze e dispositivi sono salvati nel repository del gruppo. L’invio avviene con GitHub Actions: nessun backend Fantazone.</Paragraph>
          </YStack>
          <Button onPress={() => { void load() }} disabled={busy}>{busy ? <Spinner /> : 'Aggiorna'}</Button>
        </XStack>

        {error ? <Card borderWidth={1} borderColor="$red8" padding="$3"><Paragraph color="$red10">{error}</Paragraph></Card> : null}
        {message ? <Card borderWidth={1} borderColor="$green8" padding="$3"><Paragraph color="$green10">{message}</Paragraph></Card> : null}

        <Card borderWidth={1} borderColor="$borderColor" padding="$4">
          <YStack gap="$3">
            <H2 size="$6">Dispositivo corrente</H2>
            {Platform.OS !== 'web' ? (
              <Paragraph color="$color10">Le notifiche native iOS/Android richiedono il successivo blocco Expo/APNs/FCM. Questa versione abilita Web Push reali su browser.</Paragraph>
            ) : support?.supported === false ? (
              <Paragraph color="$orange10">{support.reason}</Paragraph>
            ) : (
              <>
                <Text>Permesso browser: {support?.supported ? support.permission : '—'}</Text>
                <Text>Registrazione nel gruppo: {registeredHere ? 'attiva' : 'non attiva'}</Text>
                <XStack gap="$2" flexWrap="wrap">
                  <Button onPress={() => { void subscribe() }} disabled={busy || registeredHere}>Abilita in questo gruppo</Button>
                  <Button variant="outlined" onPress={() => { void disableForGroup() }} disabled={busy || !registeredHere}>Disabilita in questo gruppo</Button>
                  <Button variant="outlined" onPress={() => { void sendTest() }} disabled={busy || !registeredHere || !transport?.current}>Invia notifica di prova</Button>
                </XStack>
              </>
            )}
          </YStack>
        </Card>

        <Card borderWidth={1} borderColor="$borderColor" padding="$4">
          <YStack gap="$3">
            <H2 size="$6">Preferenze</H2>
            {settings ? PREFERENCES.map(item => (
              <Card key={item.key} borderWidth={1} borderColor="$borderColor" padding="$3">
                <XStack justifyContent="space-between" gap="$3" alignItems="center" flexWrap="wrap">
                  <YStack gap="$1" flex={1} minWidth={220}>
                    <Text fontWeight="800">{item.label}</Text>
                    <Paragraph color="$color10" size="$2">{item.description}</Paragraph>
                  </YStack>
                  <Button size="$3" variant="outlined" backgroundColor={settings[item.key] ? '$green4' : 'transparent'} onPress={() => toggle(item.key)}>
                    {settings[item.key] ? 'Attiva' : 'Disattiva'}
                  </Button>
                </XStack>
              </Card>
            )) : <Spinner />}
            <Button alignSelf="flex-start" onPress={() => { void savePreferences() }} disabled={busy || !settings}>Salva preferenze</Button>
          </YStack>
        </Card>

        <Card borderWidth={1} borderColor={transport?.current ? '$green8' : '$orange8'} padding="$4">
          <YStack gap="$3">
            <H2 size="$6">Trasporto GitHub Actions</H2>
            <Paragraph color="$color10">
              {transport?.current
                ? `Installato e aggiornato (v${transport.version}).`
                : transport?.installed
                  ? 'Installato ma da aggiornare.'
                  : 'Non ancora installato nel repository del gruppo.'}
            </Paragraph>
            {isSuperAdmin ? (
              <>
                <Button alignSelf="flex-start" onPress={() => { void installTransport() }} disabled={busy || transport?.current}>
                  {transport?.installed ? 'Aggiorna trasporto push' : 'Installa trasporto push'}
                </Button>
                <Paragraph color="$color10">Nel repository del gruppo deve esistere il Secret Actions <Text fontWeight="900">FANTAZONE_VAPID_PRIVATE_KEY</Text>. Usa la chiave privata VAPID già impiegata dal legacy: la nuova app conserva la stessa chiave pubblica globale e non salva mai la privata nel client o nei JSON.</Paragraph>
                <Button alignSelf="flex-start" variant="outlined" onPress={() => { void Linking.openURL(secretsUrl) }}>Apri GitHub Actions Secrets</Button>
              </>
            ) : (
              <Paragraph color="$color10">Solo un SuperAdmin può installare/aggiornare il trasporto e configurare il Secret del repository.</Paragraph>
            )}
          </YStack>
        </Card>

        <Card borderWidth={1} borderColor="$yellow8" padding="$4">
          <YStack gap="$2">
            <Text fontWeight="900">Automazioni non ancora attive</Text>
            <Paragraph color="$color10">Le preferenze legacy sono già persistite, ma gli invii automatici per eventi live, reminder, fine giornata e mercato restano disabilitati finché il test reale del trasporto non è stato validato. Questo evita duplicati o spam durante la migrazione.</Paragraph>
          </YStack>
        </Card>
      </YStack>
    </ScrollView>
  )
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
