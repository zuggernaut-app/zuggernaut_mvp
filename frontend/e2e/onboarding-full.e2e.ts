import { test, expect } from '@playwright/test'

/** Requires backend + MongoDB + Temporal and `npm run temporal:worker` so scraping can finish. */
const apiOrigin = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:3000'

test('full onboarding reaches setup after confirming context', async ({ page }) => {
  test.setTimeout(120_000)

  const health = await page.request.get(`${apiOrigin}/api/v1/health`)
  test.skip(!health.ok(), `Backend required at ${apiOrigin}`)

  const email = `e2e-full-${Date.now()}@example.com`

  await page.goto('/register')
  await page.getByLabel(/email/i).fill(email)
  await page.getByRole('button', { name: /continue/i }).click()
  await expect(page).toHaveURL(/\/onboarding\/business/)

  await page.getByLabel(/website url/i).fill('https://example.com')
  await page.getByRole('button', { name: /scrape suggestions/i }).click()
  await expect(page).toHaveURL(/\/onboarding\/suggestions/, { timeout: 180_000 })

  await page.getByRole('button', { name: /review & edit details/i }).click()
  await expect(page).toHaveURL(/\/onboarding\/review/)

  await page.getByRole('button', { name: /confirm & continue/i }).click()
  await expect(page).toHaveURL(/\/setup$/)
})
