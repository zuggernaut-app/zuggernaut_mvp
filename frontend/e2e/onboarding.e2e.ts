import { test, expect } from '@playwright/test'

import { E2E_API_ORIGIN as apiOrigin } from './constants'

test('register completes against running API', async ({ page }) => {
  const health = await page.request.get(`${apiOrigin}/api/v1/health`)
  test.skip(!health.ok(), `Start backend on ${apiOrigin} (GET /api/v1/health) for this flow`)

  const email = `e2e-${Date.now()}@example.com`
  const password = 'E2EPassPhrase12'

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
})
