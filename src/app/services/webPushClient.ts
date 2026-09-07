import { Platform } from 'react-native'
import { FANTAZONE_VAPID_PUBLIC_KEY } from '@fantazone/github'
import type { PushSubscription } from '@fantazone/domain'

const SERVICE_WORKER_PATH = '/fantazone-push-sw.js'
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null

export type WebPushSupportState =
  | { supported: true; permission: NotificationPermission }
  | { supported: false; reason: string }

export function isWebPushSupported(): boolean {
  return Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
}

export async function getWebPushSupportState(): Promise<WebPushSupportState> {
  if (!isWebPushSupported()) {
    return { supported: false, reason: 'Le Web Push sono disponibili solo su browser compatibili.' }
  }
  return { supported: true, permission: Notification.permission }
}

export async function getExistingWebPushSubscription(): Promise<PushSubscription | null> {
  const registration = await ensureRegistration()
  if (!registration) return null
  const subscription = await registration.pushManager.getSubscription()
  return subscription ? mapSubscription(subscription) : null
}

export async function subscribeCurrentBrowserForPush(now = new Date()): Promise<PushSubscription> {
  const registration = await ensureRegistration()
  if (!registration) throw new Error('Service Worker Web Push non disponibile su questo dispositivo.')
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission
  if (permission !== 'granted') throw new Error('Permesso notifiche non concesso dal browser.')

  const existing = await registration.pushManager.getSubscription()
  if (existing) return mapSubscription(existing)
  const created = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(FANTAZONE_VAPID_PUBLIC_KEY) as unknown as BufferSource,
  })
  return { ...mapSubscription(created), createdAt: now.toISOString() }
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) return null
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register(SERVICE_WORKER_PATH)
      .then(async registration => {
        await navigator.serviceWorker.ready
        return registration
      })
      .catch(error => {
        registrationPromise = null
        throw error
      })
  }
  return registrationPromise
}

function mapSubscription(subscription: globalThis.PushSubscription): PushSubscription {
  const json = subscription.toJSON()
  const endpoint = json.endpoint ?? ''
  const p256dh = json.keys?.p256dh ?? ''
  const auth = json.keys?.auth ?? ''
  if (!endpoint || !p256dh || !auth) throw new Error('Subscription Web Push incompleta.')
  return {
    endpoint,
    p256dh,
    auth,
    createdAt: new Date().toISOString(),
  }
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  return Uint8Array.from(raw, char => char.charCodeAt(0))
}
