import { renderHook, waitFor } from '@testing-library/react'
import type { SetupRunReportResponse } from '../types/api'
import { useSetupRunReport } from './useSetupRunReport'
import { getSetupRunReport } from '../api/setupReports'
import { ApiError } from '../api/client'

vi.mock('../api/setupReports', () => ({
  getSetupRunReport: vi.fn(),
}))

const mockGetSetupRunReport = vi.mocked(getSetupRunReport)

function makeReport(status: string): SetupRunReportResponse {
  return {
    report: {
      setupRun: {
        id: 'run-1',
        businessId: 'biz-1',
        temporalWorkflowId: 'wf-1',
        status,
        lastErrorSummary: null,
        meta: null,
      },
      business: { businessName: 'Acme', websiteUrl: 'https://acme.example', goals: null },
      outcome: {
        kind: status === 'SUCCEEDED' ? 'succeeded' : 'in_progress',
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
      gbpAudit: { status: 'not_run', summary: null, findings: null },
      adsCatalog: { status: 'not_run', summary: null },
      gtmSetup: { status: 'not_run', summary: null },
      provisioning: {
        gtm: { status: 'not_required', requestId: null },
        googleAds: { status: 'not_required', requestId: null },
      },
      structuralVerification: { status: 'not_run', summary: null, evidence: null },
      adsCampaign: { status: 'not_run', summary: null, plan: null },
      artifactCounts: {
        gtmTags: 0,
        gtmTriggers: 0,
        gtmVariables: 0,
        adsConversions: 0,
        adsCampaignBudgets: 0,
        adsCampaigns: 0,
        adsAdGroups: 0,
        adsAds: 0,
        adsConversionLinks: 0,
      },
      steps: [],
    },
  }
}

describe('useSetupRunReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resets when setupRunId is null', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useSetupRunReport(id),
      { initialProps: { id: 'x' as string | null } },
    )
    rerender({ id: null })
    expect(result.current.report).toBe(null)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(null)
  })

  it('loads report for setupRunId', async () => {
    mockGetSetupRunReport.mockResolvedValueOnce(makeReport('SUCCEEDED'))

    const { result } = renderHook(() => useSetupRunReport('run-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.report?.setupRun.status).toBe('SUCCEEDED')
    expect(result.current.error).toBe(null)
    expect(result.current.lastUpdatedAt).not.toBeNull()
  })

  it('surfaces API errors', async () => {
    mockGetSetupRunReport.mockRejectedValueOnce(new ApiError(404, 'Not found', 'not_found'))

    const { result } = renderHook(() => useSetupRunReport('run-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.report).toBe(null)
    expect(result.current.error).toBe('Not found')
  })
})
