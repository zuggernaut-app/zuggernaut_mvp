import type { APIRequestContext, Page } from '@playwright/test'

import { E2E_API_ORIGIN as apiOrigin } from './constants'

type IntegrationProvider = 'gtm' | 'google_ads'

export async function registerViaUi(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/register')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('#confirmPassword').fill(password)

  const registerResponse = page.waitForResponse(
    (res) =>
      res.url().includes('/api/v1/auth/register') && res.request().method() === 'POST',
    { timeout: 60_000 },
  )
  await page.getByRole('button', { name: /continue/i }).click()
  const res = await registerResponse
  const body = await res.text()
  if (!res.ok()) {
    throw new Error(`POST /auth/register failed: HTTP ${res.status()} ${body.slice(0, 600)}`)
  }

  await page.waitForURL(/\/onboarding\/business/, { timeout: 15_000 })
}

export async function seedConfirmedBusiness(page: Page): Promise<string> {
  const request = page.request
  const draft = await request.post(`${apiOrigin}/api/v1/onboarding/business`)
  if (!draft.ok()) {
    throw new Error(`POST /onboarding/business failed: HTTP ${draft.status()} ${await draft.text()}`)
  }
  const draftBody = (await draft.json()) as { businessId: string }
  const businessId = draftBody.businessId

  const confirm = await request.put(`${apiOrigin}/api/v1/business-contexts/${businessId}`, {
    data: { businessName: 'Playwright E2E Co' },
  })
  if (!confirm.ok()) {
    throw new Error(
      `PUT /business-contexts/${businessId} failed: HTTP ${confirm.status()} ${await confirm.text()}`,
    )
  }

  return businessId
}

export async function connectMockGoogleIntegration(
  page: Page,
  businessId: string,
  provider: IntegrationProvider,
): Promise<void> {
  const request = page.request
  const urlRes = await request.get(
    `${apiOrigin}/api/v1/integrations/google/${provider}/connect-url?businessId=${businessId}`,
  )
  if (!urlRes.ok()) {
    throw new Error(
      `connect-url failed for ${provider}: HTTP ${urlRes.status()} ${await urlRes.text()}`,
    )
  }
  const { url } = (await urlRes.json()) as { url: string }
  const state = new URL(url).searchParams.get('state')
  if (!state) {
    throw new Error(`Missing OAuth state for ${provider}`)
  }

  const callback = await request.get(
    `${apiOrigin}/api/v1/integrations/google/callback?code=mock-code&state=${encodeURIComponent(state)}`,
  )
  if (!callback.ok() && callback.status() !== 302) {
    throw new Error(
      `OAuth callback failed for ${provider}: HTTP ${callback.status()} ${await callback.text()}`,
    )
  }
}

export async function seedSetupReadyBusiness(page: Page): Promise<string> {
  const businessId = await seedConfirmedBusiness(page)
  await connectMockGoogleIntegration(page, businessId, 'gtm')
  await connectMockGoogleIntegration(page, businessId, 'google_ads')

  await page.evaluate((id) => {
    localStorage.setItem('zuggernaut:businessId', id)
  }, businessId)

  return businessId
}

export async function assertOrchestrationHealth(request: APIRequestContext): Promise<void> {
  const health = await request.get(`${apiOrigin}/api/v1/health`)
  if (!health.ok()) {
    throw new Error(`Health check failed: HTTP ${health.status()}`)
  }
  const body = (await health.json()) as {
    orchestration?: { taskQueue?: string; setupWorkflow?: string; temporalE2eMock?: boolean }
  }
  if (body.orchestration?.taskQueue !== 'setup-run') {
    throw new Error(`Unexpected orchestration taskQueue: ${body.orchestration?.taskQueue}`)
  }
  if (body.orchestration?.setupWorkflow !== 'setupRunWorkflow') {
    throw new Error(`Unexpected setup workflow: ${body.orchestration?.setupWorkflow}`)
  }
}
