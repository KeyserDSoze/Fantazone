import { expect, test } from '@playwright/test'

test('login shell is usable on a real browser', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Il fantacalcio che resta tuo.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continua con Microsoft' })).toBeVisible()
  await expect(page.getByText(/spazio privato dedicato all’app su OneDrive/i)).toBeVisible()
})
