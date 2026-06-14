import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'
import { SetupProgressPage } from './SetupProgressPage'
import { startSetupRun } from '../api/setupRuns'

const mockUseSetupRunStatus = vi.fn()
const mockedStartSetupRun = vi.mocked(startSetupRun)

vi.mock('../hooks/useSetupRunStatus', () => ({
  useSetupRunStatus: (setupRunId: string | null) => mockUseSetupRunStatus(setupRunId),
}))

const mockUseProvisioningOverview = vi.fn()

vi.mock('../hooks/useProvisioningOverview', () => ({
  useProvisioningOverview: (...args: unknown[]) => mockUseProvisioningOverview(...args),
}))

vi.mock('../api/setupRuns', () => ({
  startSetupRun: vi.fn(),
}))

vi.mock('../hooks/useIntegrationConnections', () => ({
  useIntegrationConnections: vi.fn(() => ({
    connections: {},
    loading: false,
    error: null,
    refetch: vi.fn(),
    connectProvider: vi.fn(),
    providerLabels: {
      gbp: 'Google Business Profile (optional)',
      gtm: 'Google Tag Manager (optional, recommended)',
      google_ads: 'Google Ads (required)',
    },
    statusLabel: (s: { ready: boolean }) => (s.ready ? 'Connected' : 'Not connected'),
  })),
  INTEGRATION_PROVIDERS: ['gbp', 'gtm', 'google_ads'],
}))

function defaultProvisioningHook() {
  return {
    overview: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
    createRequest: vi.fn(),
    approveRequest: vi.fn(),
    cancelRequest: vi.fn(),
    mutationByProvider: {},
  }
}

function defaultHookReturn() {
  return {
    data: null as null,
    loading: false,
    error: null as string | null,
    lastUpdatedAt: null as number | null,
    refetch: vi.fn(),
    appearsStuck: false,
    pollingPaused: false,
  }
}

function renderProgress(path: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OnboardingProvider>
        <Routes>
          <Route path="/setup/progress/:setupRunId" element={<SetupProgressPage />} />
          <Route path="/setup/no-param" element={<SetupProgressPage />} />
          <Route path="/setup" element={<div data-testid="setup-link-target">setup page</div>} />
        </Routes>
      </OnboardingProvider>
    </MemoryRouter>,
  )
}

describe('SetupProgressPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedSession({})
    mockUseSetupRunStatus.mockImplementation(() => defaultHookReturn())
    mockUseProvisioningOverview.mockImplementation(() => defaultProvisioningHook())
  })

  it('shows missing setup run message when no id', async () => {
    seedSession({ userId: TEST_IDS.user })

    renderProgress('/setup/no-param')

    expect(await screen.findByRole('alert')).toHaveTextContent(/missing setupRunId/i)
    expect(screen.getByRole('link', { name: /go to setup/i })).toHaveAttribute('href', '/setup')
  })

  it('renders status, steps, and stuck hint', async () => {
    seedSession({ userId: TEST_IDS.user })

    const refetch = vi.fn()
    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'RUNNING',
          lastErrorSummary: 'worker paused',
          meta: null,
        },
        steps: [
          {
            id: 'step1',
            stepName: 'alpha',
            provider: null,
            status: 'success',
            attemptCount: 1,
            startedAt: null,
            endedAt: null,
            lastErrorSummary: 'step busted',
            details: null,
          },
        ],
      },
      loading: false,
      error: null,
      lastUpdatedAt: 1_700_000_000_000,
      refetch,
      appearsStuck: true,
      pollingPaused: false,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    await screen.findByText(TEST_IDS.setupRun)
    expect(screen.getByText('RUNNING')).toBeInTheDocument()
    expect(screen.getByText(/worker paused/i)).toBeInTheDocument()
    expect(screen.getByText(/looks stuck/i)).toBeInTheDocument()
    expect(screen.getByText(/step busted/i)).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /refresh now/i }))
    expect(refetch).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^refresh$/i }))
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  it('shows hook error message', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      ...defaultHookReturn(),
      error: 'Could not load run',
      loading: false,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load run')
  })

  it('persists route param setupRunId into session when mismatched', async () => {
    seedSession({
      userId: TEST_IDS.user,
      setupRunId: '507f1f77bcf86cd799439099',
    })

    mockUseSetupRunStatus.mockReturnValue(defaultHookReturn())

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    await waitFor(() => {
      expect(localStorage.getItem('zuggernaut:setupRunId')).toBe(TEST_IDS.setupRun)
    })
  })

  it('shows GBP audit summary when present in run meta', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'SUCCEEDED',
          lastErrorSummary: null,
          meta: {
            gbpAudit: 'complete',
            gbpAuditSummary: {
              presentCount: 3,
              missingCount: 1,
              needsAttentionCount: 2,
            },
          },
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: 1_700_000_000_000,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: true,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    const heading = await screen.findByRole('heading', { name: /GBP audit summary/i })
    const section = heading.closest('section')
    expect(section).not.toBeNull()
    expect(section).toHaveTextContent('Present')
    expect(section).toHaveTextContent('3 fields')
    expect(section).toHaveTextContent('Missing')
    expect(section).toHaveTextContent('1 field')
    expect(section).toHaveTextContent('Needs attention')
    expect(section).toHaveTextContent('2 items')
  })

  it('shows provisioning and structural verification status from run meta', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'STRUCTURAL_VERIFIED',
          lastErrorSummary: null,
          meta: {
            gtmProvisioning: 'provisioned',
            gtmProvisioningRequestId: 'req-gtm-1',
            structuralVerification: { missing: [], snippetPresent: true, publicContainerId: 'GTM-MOCK' },
            structuralVerificationSummary: 'Structural verification passed.',
          },
        },
        steps: [
          {
            id: 'step-verify',
            stepName: 'structural_verification',
            provider: 'gtm',
            status: 'success',
            attemptCount: 1,
            startedAt: null,
            endedAt: null,
            lastErrorSummary: null,
            details: null,
          },
        ],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: false,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    expect(await screen.findByRole('heading', { name: /Provisioning status/i })).toBeInTheDocument()
    expect(screen.getByText(/Google Tag Manager/)).toBeInTheDocument()
    expect(screen.getByText(/provisioned/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Structural verification/i })).toBeInTheDocument()
    expect(screen.getByText('Structural verification passed.')).toBeInTheDocument()
  })

  it('shows GBP guidance when profile is missing but setup continued', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'GBP_AUDIT_COMPLETE',
          lastErrorSummary: null,
          meta: {
            gbpAudit: 'guidance',
            gbpGuidance: {
              code: 'GBP_NO_LOCATIONS',
              title: 'No Google Business Profile location found',
              message:
                'Your Google account has a Business Profile account but no locations. Add or claim a business location in Google Business Profile to enable the audit.',
              blocking: false,
            },
          },
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: false,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    expect(await screen.findByText(/No Google Business Profile location found/i)).toBeInTheDocument()
    expect(screen.getByText(/optional for setup/i)).toBeInTheDocument()
  })

  it('shows GBP skipped notice when audit was not run', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'RUNNING',
          lastErrorSummary: null,
          meta: { gbpAudit: 'skipped' },
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: false,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    expect(await screen.findByText(/GBP audit skipped/i)).toBeInTheDocument()
  })

  it('shows conversion action summary when management succeeded in run meta', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'RUNNING',
          lastErrorSummary: null,
          meta: {
            conversionActionManagement: 'ok',
            conversionActionSlotsResolved: 2,
            conversionActionsCreated: 1,
            conversionActionsReused: 1,
          },
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: false,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    const heading = await screen.findByRole('heading', { name: /Conversion actions/i })
    const section = heading.closest('section')
    expect(section).not.toBeNull()
    expect(section).toHaveTextContent('created 1 missing conversion action')
    expect(section).toHaveTextContent('Reused')
    expect(section).toHaveTextContent('Created')
  })

  it('does not show conversion action summary before management succeeds', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'RUNNING',
          lastErrorSummary: null,
          meta: { catalog: 'ready' },
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: false,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    await screen.findByText('RUNNING')
    expect(screen.queryByRole('heading', { name: /Conversion actions/i })).not.toBeInTheDocument()
  })

  it('shows Ads conversion catalog summary when present in run meta', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'RUNNING',
          lastErrorSummary: null,
          meta: {
            catalog: 'ready',
            catalogSummary: {
              primaryGoal: 'both',
              totalInCatalog: 4,
              selectedCount: 2,
              selectedCategories: ['call', 'form'],
            },
          },
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: false,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    const heading = await screen.findByRole('heading', { name: /Ads conversion catalog/i })
    const section = heading.closest('section')
    expect(section).not.toBeNull()
    expect(section).toHaveTextContent('Primary goal')
    expect(section).toHaveTextContent('both')
    expect(section).toHaveTextContent('4 conversions')
    expect(section).toHaveTextContent('call, form')
  })

  it('shows GTM setup summary when present in run meta', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'RUNNING',
          lastErrorSummary: null,
          meta: {
            gtm: 'setup_complete',
            gtmSummary: {
              templateVersion: 1,
              tagsCreated: 2,
              triggersCreated: 4,
              variablesCreated: 3,
              reusedArtifacts: 0,
              publishedVersion: 'accounts/mock/containers/mock/versions/1',
            },
          },
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: false,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    const heading = await screen.findByRole('heading', { name: /GTM setup status/i })
    const section = heading.closest('section')
    expect(section).not.toBeNull()
    expect(section).toHaveTextContent('2 created')
    expect(section).toHaveTextContent('4 created')
    expect(section).toHaveTextContent('accounts/mock/containers/mock/versions/1')
  })

  it('shows Ads campaign summary when present in run meta', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'SUCCEEDED',
          lastErrorSummary: null,
          meta: {
            ads: 'campaigns_recorded',
            adsCampaignSummary: {
              campaignCreated: true,
              adGroupCreated: true,
              adCreated: true,
              reusedArtifacts: 0,
              campaignExternalId: 'customers/123/campaigns/zug-campaign-mock',
              conversionLinkCount: 1,
            },
          },
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: true,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    const heading = await screen.findByRole('heading', { name: /Google Ads campaign/i })
    const section = heading.closest('section')
    expect(section).not.toBeNull()
    expect(section).toHaveTextContent('customers/123/campaigns/zug-campaign-mock')
    expect(section).toHaveTextContent('Conversion links')
  })

  it('shows GTM snippet pending instructions', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'GTM_SNIPPET_PENDING',
          lastErrorSummary: 'Install GTM snippet',
          meta: {
            structuralVerification: {
              missing: ['snippet'],
              snippetPresent: false,
              publicContainerId: 'GTM-MOCK',
            },
          },
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: true,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    expect(await screen.findByText(/Install the Google Tag Manager snippet/i)).toBeInTheDocument()
    expect(screen.getAllByText('GTM-MOCK').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: /Structural verification/i })).toBeInTheDocument()
  })

  it('shows structural verification missing items for tracking fix', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'SETUP_NEEDS_TRACKING_FIX',
          lastErrorSummary: 'Structural verification failed',
          meta: {
            structuralVerification: {
              missing: ['gtm_tags', 'published container version'],
            },
          },
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: true,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    expect(await screen.findByText(/Tracking setup needs attention/i)).toBeInTheDocument()
    const heading = screen.getByRole('heading', { name: /Structural verification/i })
    const section = heading.closest('section')
    expect(section).toHaveTextContent('published container version')
  })

  it('shows link to setup report when run is terminal', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'SUCCEEDED',
          lastErrorSummary: null,
          meta: null,
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: true,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    const link = await screen.findByRole('link', { name: /View setup report/i })
    expect(link).toHaveAttribute('href', `/setup/report/${TEST_IDS.setupRun}`)
  })

  it('shows backend stuck guidance when stuckState is true', async () => {
    seedSession({ userId: TEST_IDS.user, setupRunId: TEST_IDS.setupRun })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'RUNNING',
          lastErrorSummary: null,
          meta: null,
        },
        stuckState: {
          stuck: true,
          runningForMs: 400000,
          thresholdMs: 300000,
          guidance: 'Verify the Temporal worker is running.',
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: true,
      pollingPaused: false,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    expect(await screen.findByText(/Verify the Temporal worker is running/i)).toBeInTheDocument()
  })

  it('shows GTM provisioning consent card', async () => {
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'GTM_PROVISIONING_REQUIRED',
          lastErrorSummary: 'GTM provisioning approval required',
          meta: null,
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: true,
    })

    mockUseProvisioningOverview.mockReturnValue({
      ...defaultProvisioningHook(),
      overview: {
        businessId: TEST_IDS.business,
        providers: {
          gtm: {
            provider: 'gtm',
            provisioningRequired: true,
            connection: { provider: 'gtm', ready: false, reason: 'provisioning_required' },
            activeRequest: {
              id: 'req-gtm',
              businessId: TEST_IDS.business,
              provider: 'gtm',
              status: 'pending_approval',
              requestedResources: ['gtm_account', 'gtm_container', 'gtm_workspace'],
              approvedAt: null,
              createdProviderIdentifiers: null,
              errorCode: null,
              errorMessage: null,
              setupRunId: TEST_IDS.setupRun,
            },
            latestRequest: null,
          },
          google_ads: {
            provider: 'google_ads',
            provisioningRequired: false,
            connection: { provider: 'google_ads', ready: true, reason: 'ok' },
            activeRequest: null,
            latestRequest: null,
          },
        },
      },
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    expect(
      await screen.findByRole('heading', { name: /Google Tag Manager provisioning approval/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Web container')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Approve provisioning/i })).toBeInTheDocument()
  })

  it('shows Ads provisioning consent card', async () => {
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'ADS_PROVISIONING_REQUIRED',
          lastErrorSummary: 'Google Ads provisioning approval required',
          meta: null,
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: true,
    })

    mockUseProvisioningOverview.mockReturnValue({
      ...defaultProvisioningHook(),
      overview: {
        businessId: TEST_IDS.business,
        providers: {
          gtm: {
            provider: 'gtm',
            provisioningRequired: false,
            connection: { provider: 'gtm', ready: true, reason: 'ok' },
            activeRequest: null,
            latestRequest: null,
          },
          google_ads: {
            provider: 'google_ads',
            provisioningRequired: true,
            connection: { provider: 'google_ads', ready: false, reason: 'provisioning_required' },
            activeRequest: {
              id: 'req-ads',
              businessId: TEST_IDS.business,
              provider: 'google_ads',
              status: 'pending_approval',
              requestedResources: ['google_ads_customer'],
              approvedAt: null,
              createdProviderIdentifiers: null,
              errorCode: null,
              errorMessage: null,
              setupRunId: TEST_IDS.setupRun,
            },
            latestRequest: null,
          },
        },
      },
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    expect(
      await screen.findByRole('heading', { name: /Google Ads customer provisioning approval/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Approve provisioning/i })).toBeInTheDocument()
  })

  it('approves provisioning and shows continue setup action', async () => {
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })

    const approveRequest = vi.fn().mockResolvedValue({
      id: 'req-gtm',
      status: 'approved',
    })
    const refetchProvisioning = vi.fn()

    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'GTM_PROVISIONING_REQUIRED',
          lastErrorSummary: null,
          meta: null,
        },
        steps: [],
      },
      loading: false,
      error: null,
      lastUpdatedAt: null,
      refetch: vi.fn(),
      appearsStuck: false,
      pollingPaused: true,
    })

    mockUseProvisioningOverview.mockReturnValue({
      overview: {
        businessId: TEST_IDS.business,
        providers: {
          gtm: {
            provider: 'gtm',
            provisioningRequired: true,
            connection: { provider: 'gtm', ready: false, reason: 'provisioning_required' },
            activeRequest: {
              id: 'req-gtm',
              businessId: TEST_IDS.business,
              provider: 'gtm',
              status: 'pending_approval',
              requestedResources: ['gtm_account'],
              approvedAt: null,
              createdProviderIdentifiers: null,
              errorCode: null,
              errorMessage: null,
              setupRunId: TEST_IDS.setupRun,
            },
            latestRequest: null,
          },
          google_ads: {
            provider: 'google_ads',
            provisioningRequired: false,
            connection: { provider: 'google_ads', ready: true, reason: 'ok' },
            activeRequest: null,
            latestRequest: null,
          },
        },
      },
      loading: false,
      error: null,
      refetch: refetchProvisioning,
      createRequest: vi.fn(),
      approveRequest,
      cancelRequest: vi.fn(),
      mutationByProvider: {},
    })

    mockedStartSetupRun.mockResolvedValueOnce({
      setupRunId: 'new-run-id',
      workflowId: 'wf-new',
      status: 'RUNNING',
    })

    const user = userEvent.setup()
    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    await user.click(await screen.findByRole('button', { name: /Approve provisioning/i }))
    expect(approveRequest).toHaveBeenCalledWith('req-gtm')

    expect(
      await screen.findByText(/Approved\. Start setup again to provision resources and continue\./i),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Continue setup/i }))
    expect(mockedStartSetupRun).toHaveBeenCalledWith(TEST_IDS.business)
  })
})
