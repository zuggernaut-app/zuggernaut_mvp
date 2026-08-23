import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'
import { SetupReportPage } from './SetupReportPage'
import type { SetupRunReportResponse } from '../types/api'

const mockUseSetupRunReport = vi.fn()

vi.mock('../hooks/useSetupRunReport', () => ({
  useSetupRunReport: (setupRunId: string | null) => mockUseSetupRunReport(setupRunId),
}))

vi.mock('../components/setup/EnableCampaignCard', () => ({
  EnableCampaignCard: () => <div data-testid="enable-campaign-card">Campaign management</div>,
}))

function fullReport(overrides: Partial<SetupRunReportResponse['report']> = {}): SetupRunReportResponse {
  return {
    report: {
      setupRun: {
        id: TEST_IDS.setupRun,
        businessId: TEST_IDS.business,
        temporalWorkflowId: 'wf-1',
        status: 'SUCCEEDED',
        lastErrorSummary: null,
        meta: null,
      },
      business: { businessName: 'Acme Co', websiteUrl: 'https://acme.example', goals: { primary: 'calls' } },
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
        status: 'complete',
        reason: null,
        guidance: null,
        blocking: false,
        summary: { presentCount: 3, missingCount: 1, needsAttentionCount: 0 },
        findings: { present: ['Business name'], missing: ['Hours'], needsAttention: [] },
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
        summary: 'All checks passed',
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
          campaignName: 'Acme Co — Zuggernaut Search',
          bidding: 'maximize_conversions',
          budgetAmountMicros: 10_000_000,
        },
        failure: null,
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
      steps: [{ id: 's1', stepName: 'ads_campaign_creation', provider: 'google_ads', status: 'success', attemptCount: 1, startedAt: null, endedAt: null, lastErrorSummary: null, details: null }],
      ...overrides,
    },
  }
}

function renderReport(path: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OnboardingProvider>
        <Routes>
          <Route path="/setup/report/:setupRunId" element={<SetupReportPage />} />
          <Route path="/setup/report" element={<SetupReportPage />} />
        </Routes>
      </OnboardingProvider>
    </MemoryRouter>,
  )
}

describe('SetupReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSetupRunReport.mockReturnValue({
      report: null,
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
    })
  })

  it('shows missing setupRunId message', () => {
    seedSession({ userId: TEST_IDS.user })
    renderReport('/setup/report')
    expect(screen.getByText(/Missing setupRunId/i)).toBeInTheDocument()
  })

  it('shows loading state', () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: null,
      loading: true,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
    })
    renderReport(`/setup/report/${TEST_IDS.setupRun}`)
    expect(screen.getByText(/Loading/i)).toBeInTheDocument()
  })

  it('renders full setup report sections', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: fullReport().report,
      loading: false,
      error: null,
      lastUpdatedAt: Date.now(),
      refetch: vi.fn(),
    })

    renderReport(`/setup/report/${TEST_IDS.setupRun}`)

    expect(await screen.findByRole('heading', { name: /Setup report/i })).toBeInTheDocument()
    expect(screen.getByText(/Setup completed successfully/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /GBP audit/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Conversion actions/i })).toBeInTheDocument()
    expect(screen.getByText(/reused existing Google Ads conversion actions/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Ads conversion catalog/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /GTM setup/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Google Ads campaign/i })).toBeInTheDocument()
    expect(screen.getByText(/customers\/123\/campaigns\/zug-campaign/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Artifacts created/i })).toBeInTheDocument()
    expect(screen.getByText(/Ads campaigns/)).toBeInTheDocument()
    expect(screen.getByTestId('enable-campaign-card')).toBeInTheDocument()
  })

  it('shows enable campaign card when setup succeeded with campaign created', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: fullReport().report,
      loading: false,
      error: null,
      lastUpdatedAt: Date.now(),
      refetch: vi.fn(),
    })

    renderReport(`/setup/report/${TEST_IDS.setupRun}`)

    expect(await screen.findByTestId('enable-campaign-card')).toBeInTheDocument()
  })

  it('shows Ads campaign failure details when campaign creation failed', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: fullReport({
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-1',
          status: 'FAILED',
          lastErrorSummary: 'Keyword text contains invalid characters or symbols.',
          meta: null,
        },
        outcome: {
          kind: 'failed',
          headline: 'Setup failed.',
          recovery: null,
        },
        adsCampaign: {
          status: 'failed',
          summary: null,
          plan: null,
          failure: {
            provider: 'google_ads',
            stepName: 'ads_campaign_creation',
            validationBucket: 'keywords',
            bucketLabel: 'Bucket 3: Keywords',
            field: 'keywords[0].text',
            code: 'ADS_INTENT_KEYWORD_INVALID_CHARS',
            message: 'Keyword text contains invalid characters or symbols.',
            recommendedAction: 'Remove unsupported symbols or adjust business/service wording.',
            issues: [
              {
                code: 'ADS_INTENT_KEYWORD_INVALID_CHARS',
                field: 'keywords[0].text',
                message: 'Keyword text contains invalid characters or symbols.',
                bucket: 'keywords',
              },
            ],
          },
        },
      }).report,
      loading: false,
      error: null,
      lastUpdatedAt: Date.now(),
      refetch: vi.fn(),
    })

    renderReport(`/setup/report/${TEST_IDS.setupRun}`)

    expect(
      await screen.findByText(/Google Ads campaign creation failed in Bucket 3: Keywords/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/keywords\[0\]\.text/i)).toBeInTheDocument()
    expect(screen.getByText(/ADS_INTENT_KEYWORD_INVALID_CHARS/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Remove unsupported symbols or adjust business\/service wording\./i),
    ).toBeInTheDocument()
  })

  it('shows GBP guidance when no profile location was accessible', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: fullReport({
        gbpAudit: {
          status: 'guidance',
          reason: 'GBP_NO_LOCATIONS',
          blocking: false,
          guidance: {
            code: 'GBP_NO_LOCATIONS',
            title: 'No Google Business Profile location found',
            message: 'Add or claim a business location in Google Business Profile to enable the audit.',
            blocking: false,
          },
          summary: { presentCount: 0, missingCount: 0, needsAttentionCount: 1 },
          findings: { present: [], missing: [], needsAttention: ['Add or claim a business location'] },
        },
      }).report,
      loading: false,
      error: null,
      lastUpdatedAt: Date.now(),
      refetch: vi.fn(),
    })

    renderReport(`/setup/report/${TEST_IDS.setupRun}`)

    expect(await screen.findByText(/No Google Business Profile location found/i)).toBeInTheDocument()
    expect(screen.getByText(/continued without blocking automation/i)).toBeInTheDocument()
  })

  it('shows recovery guidance for snippet pending', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: fullReport({
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-1',
          status: 'GTM_SNIPPET_PENDING',
          lastErrorSummary: 'Install GTM snippet',
          meta: null,
        },
        outcome: {
          kind: 'snippet_pending',
          headline: 'GTM snippet must be installed before Ads campaign creation can continue.',
          recovery: {
            title: 'Install the Google Tag Manager snippet',
            steps: [{ text: 'Add the GTM container snippet to the head of every page.' }],
          },
        },
        structuralVerification: {
          status: 'snippet_pending',
          summary: 'Install GTM snippet',
          evidence: { missing: ['snippet'], snippetPresent: false, publicContainerId: 'GTM-X' },
        },
        adsCampaign: { status: 'not_run', summary: null, plan: null },
      }).report,
      loading: false,
      error: null,
      lastUpdatedAt: Date.now(),
      refetch: vi.fn(),
    })

    renderReport(`/setup/report/${TEST_IDS.setupRun}`)

    expect(await screen.findByText(/Install the Google Tag Manager snippet/i)).toBeInTheDocument()
    expect(screen.getByText(/Add the GTM container snippet/i)).toBeInTheDocument()
  })

  it('shows API error', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: null,
      loading: false,
      error: 'Failed to load setup report',
      lastUpdatedAt: null,
      refetch: vi.fn(),
    })

    renderReport(`/setup/report/${TEST_IDS.setupRun}`)
    expect(await screen.findByText(/Failed to load setup report/i)).toBeInTheDocument()
  })

  it('shows partial setup compensation actions', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: fullReport({
        compensation: {
          appliedAt: '2026-01-01T00:00:00.000Z',
          failedStep: 'ads_campaign_creation',
          actions: [
            {
              type: 'ads_campaign_pause',
              outcome: 'paused',
              campaignResourceName: 'customers/123/campaigns/zug-campaign',
            },
          ],
        },
      }).report,
      loading: false,
      error: null,
      lastUpdatedAt: Date.now(),
      refetch: vi.fn(),
    })

    renderReport(`/setup/report/${TEST_IDS.setupRun}`)

    expect(await screen.findByRole('heading', { name: /Partial setup actions/i })).toBeInTheDocument()
    expect(screen.getByText(/ads campaign pause/i)).toBeInTheDocument()
  })

  it('shows tracking recommendations after successful Ads-only launch', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: fullReport({
        structuralVerification: {
          status: 'skipped',
          summary: 'GTM is not configured; structural verification skipped.',
          evidence: { gtmOptional: true },
        },
        gtmSetup: { status: 'not_run', summary: null },
        recommendations: [
          {
            id: 'connect_gtm',
            priority: 'recommended',
            title: 'Set up Google Tag Manager tracking',
            message:
              'Your Google Ads campaign was created paused and is ready to enable in Google Ads. Connect Google Tag Manager next so Zuggernaut can measure website conversions accurately.',
            steps: [
              'Open the setup page and connect Google Tag Manager.',
              'Select or provision a GTM container and workspace.',
              'Install the GTM snippet on your website when you are ready.',
            ],
          },
        ],
      }).report,
      loading: false,
      error: null,
      lastUpdatedAt: Date.now(),
      refetch: vi.fn(),
    })

    renderReport(`/setup/report/${TEST_IDS.setupRun}`)

    expect(await screen.findByRole('heading', { name: /Recommendations/i })).toBeInTheDocument()
    expect(screen.getByText(/Set up Google Tag Manager tracking/i)).toBeInTheDocument()
    expect(screen.getByText(/Install the GTM snippet on your website/i)).toBeInTheDocument()
  })

  it('shows created conversion actions when report includes creation counts', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: fullReport({
        conversionActions: {
          status: 'ready',
          slotsResolved: 2,
          created: 1,
          reused: 1,
          message: null,
        },
      }).report,
      loading: false,
      error: null,
      lastUpdatedAt: Date.now(),
      refetch: vi.fn(),
    })

    renderReport(`/setup/report/${TEST_IDS.setupRun}`)

    expect(await screen.findByText(/created 1 missing conversion action/i)).toBeInTheDocument()
    expect(screen.getByText(/Reused/)).toBeInTheDocument()
    expect(screen.getByText(/Created/)).toBeInTheDocument()
  })

  it('hides conversion actions section when report status is not_run', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: fullReport({
        conversionActions: {
          status: 'not_run',
          slotsResolved: 0,
          created: 0,
          reused: 0,
          message: null,
        },
      }).report,
      loading: false,
      error: null,
      lastUpdatedAt: Date.now(),
      refetch: vi.fn(),
    })

    renderReport(`/setup/report/${TEST_IDS.setupRun}`)

    await screen.findByRole('heading', { name: /Setup report/i })
    expect(screen.queryByRole('heading', { name: /Conversion actions/i })).not.toBeInTheDocument()
  })

  it('shows manual review conversion action message', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: fullReport({
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-1',
          status: 'SETUP_NEEDS_MANUAL_REVIEW',
          lastErrorSummary: 'Conversion action creation is disabled and required slots are unfilled.',
          meta: null,
        },
        outcome: {
          kind: 'manual_review',
          headline: 'Setup paused until Google integrations are connected.',
          recovery: {
            title: 'Conversion actions need manual setup',
            steps: [{ text: 'Create the required conversion actions in Google Ads.' }],
          },
        },
        conversionActions: {
          status: 'manual_review',
          slotsResolved: 1,
          created: 0,
          reused: 1,
          message: 'Conversion action creation is disabled and required slots are unfilled.',
        },
      }).report,
      loading: false,
      error: null,
      lastUpdatedAt: Date.now(),
      refetch: vi.fn(),
    })

    renderReport(`/setup/report/${TEST_IDS.setupRun}`)

    const heading = await screen.findByRole('heading', { name: /Conversion actions/i })
    const section = heading.closest('section')
    expect(section).not.toBeNull()
    expect(section).toHaveTextContent(/creation is disabled/i)
    expect(screen.getByText(/Conversion actions need manual setup/i)).toBeInTheDocument()
  })

  it('shows provisioning status and support details', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })
    mockUseSetupRunReport.mockReturnValue({
      report: fullReport({
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-1',
          status: 'GTM_PROVISIONING_REQUIRED',
          lastErrorSummary: 'GTM provisioning approval required',
          meta: null,
        },
        outcome: {
          kind: 'provisioning_required',
          headline: 'Provisioning approval is required before setup can continue.',
          recovery: {
            title: 'Approve Google resource provisioning',
            steps: [{ text: 'Approve provisioning, then start a new setup run.' }],
          },
        },
        supportState: {
          failedStep: 'provision_gtm_resources',
          errorCode: 'GTM_PROVISIONING_FAILED',
        },
        provisioning: {
          gtm: { status: 'approval_required', requestId: 'req-gtm' },
          googleAds: { status: 'not_required', requestId: null },
        },
      }).report,
      loading: false,
      error: null,
      lastUpdatedAt: Date.now(),
      refetch: vi.fn(),
    })

    renderReport(`/setup/report/${TEST_IDS.setupRun}`)

    expect(await screen.findByRole('heading', { name: /Provisioning status/i })).toBeInTheDocument()
    expect(screen.getByText('Google Tag Manager')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Support details/i })).toBeInTheDocument()
    expect(screen.getByText(/provision gtm resources/i)).toBeInTheDocument()
  })
})
