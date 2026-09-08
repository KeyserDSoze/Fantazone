import React, { useEffect, useState } from 'react'
import { Button, Card, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui'
import { APP_VERSION } from '../config/version'

const VERSION_URL = '/version.json'
const CHECK_INTERVAL_MS = 5 * 60 * 1000
const LATER_KEY_PREFIX = 'fantazone_update_later_'

type PublishedVersion = {
  version: string
}

export function VersionUpdateBanner() {
  const [availableVersion, setAvailableVersion] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let active = true

    async function checkVersion() {
      try {
        const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' })
        if (!response.ok) return
        const published = await response.json() as PublishedVersion
        if (!active || !isNewerVersion(published.version, APP_VERSION)) return
        if (wasDeferredForThisSession(published.version)) return
        setAvailableVersion(published.version)
      } catch {
        // Offline-first: inability to check the release must never block the app.
      }
    }

    void checkVersion()
    const timer = setInterval(() => { void checkVersion() }, CHECK_INTERVAL_MS)
    const onFocus = () => { void checkVersion() }
    const onOnline = () => { void checkVersion() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  if (!availableVersion) return null

  async function updateNow() {
    setUpdating(true)
    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map(registration => registration.update().catch(() => undefined)))
      }
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys()
        await Promise.all(keys
          .filter(key => key.startsWith('fantazone-app-shell-'))
          .map(key => caches.delete(key)))
      }
    } finally {
      if (typeof window !== 'undefined') window.location.reload()
    }
  }

  function updateLater() {
    deferForThisSession(availableVersion!)
    setAvailableVersion(null)
  }

  return (
    <Card
      position="absolute"
      right="$3"
      bottom="$3"
      zIndex={1100}
      width={380}
      maxWidth="92%"
      padding="$3"
      borderWidth={1}
      borderColor="$blue8"
      backgroundColor="$blue2"
      elevation={12}
    >
      <YStack gap="$2">
        <YStack gap="$1">
          <Text fontWeight="900">Nuova versione disponibile</Text>
          <Paragraph size="$2" color="$color10">
            Fantazone {availableVersion} è pronta. L’aggiornamento ricarica solo l’app e conserva dati offline, gruppi e modifiche in attesa.
          </Paragraph>
        </YStack>
        <XStack gap="$2" justifyContent="flex-end" flexWrap="wrap">
          <Button size="$3" chromeless disabled={updating} onPress={updateLater}>Più tardi</Button>
          <Button size="$3" theme="accent" disabled={updating} onPress={() => { void updateNow() }}>
            {updating ? <Spinner /> : 'Aggiorna ora'}
          </Button>
        </XStack>
      </YStack>
    </Card>
  )
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const installed = parseVersion(current)
  if (!next || !installed) return candidate.trim() !== current.trim()
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index]
  }
  return false
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function wasDeferredForThisSession(version: string): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(`${LATER_KEY_PREFIX}${version}`) === '1'
  } catch {
    return false
  }
}

function deferForThisSession(version: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(`${LATER_KEY_PREFIX}${version}`, '1')
  } catch {
    // Session storage is optional; dismissal still applies until this component remounts.
  }
}
