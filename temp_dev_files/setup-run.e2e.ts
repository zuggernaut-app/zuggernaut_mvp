import { test, expect } from '@playwright/test'

import { E2E_API_ORIGIN as apiOrigin } from './constants'
import {
  assertOrchestrationHealth,
  registerViaUi,
  seedSetupReadyBusiness,
} from './helpers'

test('health exposes orchestration config for CI reachability checks', async ({ request }) => {
  await assertOrchestrationHealth(request)
})

test('start setup run navigates to progress when Temporal is E2E-mocked', async ({
  page,
  request,
}) => {
  const health = await request.get(`${apiOrigin}/api/v1/health`)
  test.skip(!health.ok(), `Backend required at ${apiOrigin}`)

  const email = `e2e-setup-${Date.now()}@example.com`
  const password = 'E2ESetupPhrase12'

  await registerViaUi(page, email, password)
  await seedSetupReadyBusiness(page)

  await page.goto('/setup')
  await expect(page.getByRole('heading', { name: /start setup run/i })).toBeVisible()

  const startResponse = page.waitForResponse(
    (res) =>
      res.url().includes('/api/v1/setup-runs') && res.request().method() === 'POST',
    { timeout: 60_000 },
  )
  await page.getByRole('button', { name: /^start setup$/i }).click()

  const res = await startResponse
  const body = (await res.json()) as { setupRunId?: string; status?: string }
  expect(res.status()).toBe(201)
  expect(body.setupRunId).toMatch(/^[a-f0-9]{24}$/)
  expect(body.status).toBe('RUNNING')

  await expect(page).toHaveURL(new RegExp(`/setup/progress/${body.setupRunId}$`), {
    timeout: 15_000,
  })
  await expect(page.getByText('RUNNING')).toBeVisible()
})

test('setup page blocks start when integrations are missing', async ({ page, request }) => {
  const health = await request.get(`${apiOrigin}/api/v1/health`)
  test.skip(!health.ok(), `Backend required at ${apiOrigin}`)

  const email = `e2e-setup-block-${Date.now()}@example.com`
  const password = 'E2ESetupPhrase12'

  await registerViaUi(page, email, password)

  const draft = await page.request.post(`${apiOrigin}/api/v1/onboarding/business`)
  const { businessId } = (await draft.json()) as { businessId: string }
  await page.request.put(`${apiOrigin}/api/v1/business-contexts/${businessId}`, {
    data: { businessName: 'Unconnected Co' },
  })

  await page.evaluate((id) => {
    localStorage.setItem('zuggernaut:businessId', id)
  }, businessId)

  await page.goto('/setup')
  const startButton = page.getByRole('button', { name: /^start setup$/i })
  await expect(startButton).toBeDisabled()
})
