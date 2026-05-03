import { test, expect } from '@playwright/test'

const apiOrigin = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:3000'

test('register completes against running API', async ({ page }) => {
  const health = await page.request.get(`${apiOrigin}/api/v1/health`)
  test.skip(!health.ok(), `Start backend on ${apiOrigin} (GET /api/v1/health) for this flow`)

  await page.goto('/register')
  await page.getByLabel(/email/i).fill(`e2e-${Date.now()}@example.com`)
  await page.getByRole('button', { name: /continue/i }).click()

  await expect(page).toHaveURL(/\/onboarding\/business/)
})
