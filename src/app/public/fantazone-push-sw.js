'use strict'

const APP_CACHE_PREFIX = 'fantazone-app-shell-'
const APP_CACHE = `${APP_CACHE_PREFIX}v1`

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await precacheApplicationShell()
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter(key => key.startsWith(APP_CACHE_PREFIX) && key !== APP_CACHE)
      .map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname === '/fantazone-push-sw.js') return

  const networkFirst = request.mode === 'navigate' || url.pathname.startsWith('/offline/serie-a/')
  event.respondWith(networkFirst ? networkFirstResponse(request) : cacheFirstResponse(request))
})

self.addEventListener('push', event => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'FantaZone', body: event.data.text(), data: { url: 'https://fanta.plus' } }
  }
  const title = payload.title || 'FantaZone'
  const options = {
    body: payload.body || '',
    data: payload.data || { url: 'https://fanta.plus' },
    icon: payload.icon,
    badge: payload.badge,
    tag: payload.tag,
    renotify: Boolean(payload.renotify),
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = event.notification.data?.url || 'https://fanta.plus'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client && client.url.startsWith('https://fanta.plus')) {
        if ('navigate' in client) await client.navigate(target)
        return client.focus()
      }
    }
    return self.clients.openWindow(target)
  })())
})

async function precacheApplicationShell() {
  try {
    const response = await fetch('/', { cache: 'reload' })
    if (!response.ok) return
    const cache = await caches.open(APP_CACHE)
    await cache.put('/', response.clone())
    const html = await response.text()
    const urls = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match => match[1])
      .filter(value => value && !value.startsWith('http:') && !value.startsWith('https:') && !value.startsWith('data:'))
      .map(value => new URL(value, self.location.origin).toString())
    await Promise.all(urls.map(async url => {
      try {
        const asset = await fetch(url, { cache: 'reload' })
        if (asset.ok) await cache.put(url, asset)
      } catch {
        // One optional asset must not prevent the rest of the shell from installing.
      }
    }))
  } catch {
    // A first install while offline cannot pre-cache; later normal fetches still populate it.
  }
}

async function networkFirstResponse(request) {
  const cache = await caches.open(APP_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) return cached
    if (request.mode === 'navigate') {
      const shell = await cache.match('/')
      if (shell) return shell
    }
    throw error
  }
}

async function cacheFirstResponse(request) {
  const cache = await caches.open(APP_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}
