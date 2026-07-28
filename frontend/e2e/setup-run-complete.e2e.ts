import { test, expect } from '@playwright/test'

import { E2E_API_ORIGIN as apiOrigin } from './constants'
import { registerViaUi, seedSetupReadyBusiness } from './helpers'

const TERMINAL_SETUP_STATUSES = new Set([
  'SUCCEEDED',
  'FAILED',
  'GTM_SNIPPET_PENDING',
  'GTM_PROVISIONING_REQUIRED',
  'ADS_PROVISIONING_REQUIRED',
  'SETUP_NEEDS_MANUAL_REVIEW',
  'SETUP_NEEDS_TRACKING_FIX',
])

async function pollSetupRunUntilTerminal(
  request: import('@playwright/test').APIRequestContext,
  setupRunId: string,
  timeoutMs = 180_000,
) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = 'RUNNING'

  while (Date.now() < deadline) {
    const res = await request.get(`${apiOrigin}/api/v1/setup-runs/${setupRunId}`)
    const body = (await res.json()) as { setupRun?: { status?: string } }
    lastStatus = body.setupRun?.status ?? lastStatus

    if (TERMINAL_SETUP_STATUSES.has(lastStatus)) {
      return { status: lastStatus, body }
    }

    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  throw new Error(`Setup run ${setupRunId} did not reach a terminal status (last: ${lastStatus})`)
}

test('setup run reaches terminal status via real API polling with embedded worker', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000)
  const health = await request.get(`${apiOrigin}/api/v1/health`)
  test.skip(!health.ok(), `Backend required at ${apiOrigin}`)

  const healthBody = (await health.json()) as {
    orchestration?: { temporalE2eEmbeddedWorker?: boolean }
  }
  test.skip(
    !healthBody.orchestration?.temporalE2eEmbeddedWorker,
    'Embedded E2E Temporal worker required (start:e2e stack)',
  )

  const email = `e2e-complete-${Date.now()}@example.com`
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

  const terminal = await pollSetupRunUntilTerminal(page.request, body.setupRunId!)
  expect(TERMINAL_SETUP_STATUSES.has(terminal.status)).toBe(true)
  expect(terminal.status).toBe('SUCCEEDED')

  await page.reload()
  await expect(page.getByText('SUCCEEDED')).toBeVisible({ timeout: 15_000 })
})
