import { expect, test } from '@playwright/test'

test('login shell is usable on a real browser', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Il tuo fantacalcio, senza backend.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accedi con Microsoft' })).toBeVisible()
  await expect(page.getByText(/I tuoi gruppi vengono sincronizzati nel tuo OneDrive/i)).toBeVisible()
})
