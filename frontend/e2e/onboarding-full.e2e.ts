import { test, expect } from '@playwright/test'

import { E2E_API_ORIGIN as apiOrigin } from './constants'

const fullStackEnabled =
  process.env.E2E_FULL_ONBOARDING === '1' || process.env.E2E_FULL_ONBOARDING === 'true'

/**
 * Temporal workflow + worker must progress the scrape; Playwright‑started API uses in‑memory Mongo only.
 */
test('full onboarding reaches setup after confirming context', async ({ page }) => {
  test.skip(
    !fullStackEnabled,
    'Set E2E_FULL_ONBOARDING=1 and run Temporal + npm run temporal:worker. Use: npm run test:e2e:full',
  )

  /** Scrape polling +Temporal can exceed two minutes locally. */
  test.setTimeout(360_000)

  const health = await page.request.get(`${apiOrigin}/api/v1/health`)
  test.skip(!health.ok(), `Backend required at ${apiOrigin}`)

  const email = `e2e-full-${Date.now()}@example.com`
  const password = 'E2EFullPhrase12'

  await page.goto('/register')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('#confirmPassword').fill(password)

  const registerResponse = page.waitForResponse(
    (res) =>
      res.url().includes('/api/v1/auth/register') && res.request().method() === 'POST',
    { timeout: 60_000 }
  )
  await page.getByRole('button', { name: /continue/i }).click()
  const res = await registerResponse
  const body = await res.text()
  if (!res.ok()) {
    throw new Error(`POST /auth/register failed: HTTP ${res.status()} ${body.slice(0, 600)}`)
  }

  await expect(page).toHaveURL(/\/onboarding\/business/, { timeout: 15_000 })

  await page.getByLabel(/website url/i).fill('https://example.com')
  await page.getByRole('button', { name: /scrape suggestions/i }).click()
  await expect(page).toHaveURL(/\/onboarding\/suggestions/, { timeout: 180_000 })

  await page.getByRole('button', { name: /review & edit details/i }).click()
  await expect(page).toHaveURL(/\/onboarding\/review/)

  await page.getByRole('button', { name: /confirm & continue/i }).click()
  await expect(page).toHaveURL(/\/setup$/)
})
