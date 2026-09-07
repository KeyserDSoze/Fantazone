import { expect, test } from '@playwright/test'

test('web app shell reopens after connectivity is removed', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Accedi con Microsoft' })).toBeVisible()

  const hasServiceWorker = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    await navigator.serviceWorker.ready
    return Boolean(navigator.serviceWorker.controller || await navigator.serviceWorker.getRegistration())
  })
  expect(hasServiceWorker).toBe(true)

  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'Il tuo fantacalcio, senza backend.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accedi con Microsoft' })).toBeVisible()
})
