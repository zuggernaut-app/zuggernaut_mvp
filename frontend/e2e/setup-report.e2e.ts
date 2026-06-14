import { test, expect } from '@playwright/test'

import { E2E_API_ORIGIN as apiOrigin } from './constants'
import { registerViaUi, seedSetupReadyBusiness } from './helpers'

test('setup report page renders succeeded dashboard sections', async ({ page, request }) => {
  const health = await request.get(`${apiOrigin}/api/v1/health`)
  test.skip(!health.ok(), `Backend required at ${apiOrigin}`)

  const email = `e2e-report-${Date.now()}@example.com`
  const password = 'E2ESetupPhrase12'
  const setupRunId = '507f1f77bcf86cd799439011'

  await registerViaUi(page, email, password)
  await seedSetupReadyBusiness(page)

  await page.evaluate((id) => {
    localStorage.setItem('zuggernaut:setupRunId', id)
  }, setupRunId)

  await page.route(`**/api/v1/setup-runs/${setupRunId}/report`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        report: {
          setupRun: {
            id: setupRunId,
            businessId: '507f1f77bcf86cd799439012',
            temporalWorkflowId: 'wf-e2e',
            status: 'SUCCEEDED',
            lastErrorSummary: null,
            meta: null,
          },
          business: {
            businessName: 'Playwright E2E Co',
            websiteUrl: 'https://acme.example',
            goals: { primary: 'calls' },
          },
          outcome: {
            kind: 'succeeded',
            headline: 'Setup completed successfully.',
            recovery: null,
          },
          stuckState: {
            stuck: false,
            runningForMs: null,
            thresholdMs: 300000,
            guidance: null,
          },
          supportState: null,
          compensation: null,
          gbpAudit: {
            status: 'skipped',
            reason: null,
            guidance: null,
            blocking: false,
            summary: null,
            findings: null,
          },
          conversionActions: {
            status: 'ready',
            slotsResolved: 1,
            created: 0,
            reused: 1,
            message: null,
          },
          adsCatalog: {
            status: 'ready',
            summary: {
              primaryGoal: 'calls',
              totalInCatalog: 2,
              selectedCount: 1,
              selectedCategories: ['call'],
            },
          },
          gtmSetup: {
            status: 'setup_complete',
            summary: {
              templateVersion: 1,
              tagsCreated: 2,
              triggersCreated: 4,
              variablesCreated: 3,
              reusedArtifacts: 0,
              publishedVersion: 'accounts/mock/versions/1',
            },
          },
          provisioning: {
            gtm: { status: 'not_required', requestId: null },
            googleAds: { status: 'not_required', requestId: null },
          },
          structuralVerification: {
            status: 'pass',
            summary: 'Structural verification passed.',
            evidence: { missing: [], snippetPresent: true, publicContainerId: 'GTM-MOCK' },
          },
          adsCampaign: {
            status: 'campaigns_recorded',
            summary: {
              campaignCreated: true,
              adGroupCreated: true,
              adCreated: true,
              reusedArtifacts: 0,
              campaignExternalId: 'customers/123/campaigns/zug-campaign',
              conversionLinkCount: 1,
            },
            plan: {
              campaignName: 'Playwright E2E Co — Zuggernaut Search',
              bidding: 'maximize_conversions',
              budgetAmountMicros: 10000000,
            },
          },
          recommendations: [],
          artifactCounts: {
            gtmTags: 2,
            gtmTriggers: 4,
            gtmVariables: 3,
            adsConversions: 1,
            adsCampaignBudgets: 1,
            adsCampaigns: 1,
            adsAdGroups: 1,
            adsAds: 1,
            adsConversionLinks: 1,
          },
          steps: [],
        },
      }),
    })
  })

  await page.goto(`/setup/report/${setupRunId}`)

  await expect(page.getByRole('heading', { name: /setup report/i })).toBeVisible()
  await expect(page.getByText(/Setup completed successfully/i)).toBeVisible()
  await expect(page.getByRole('heading', { name: /Conversion actions/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Artifacts created/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Google Ads campaign/i })).toBeVisible()
  await expect(page.getByText(/customers\/123\/campaigns\/zug-campaign/)).toBeVisible()
})
