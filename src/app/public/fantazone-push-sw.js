'use strict'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
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
