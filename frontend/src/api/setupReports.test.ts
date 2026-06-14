import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSetupRunReport } from './setupReports'
import { apiRequest } from './client'

vi.mock('./client', () => ({
  apiRequest: vi.fn(),
}))

const mockedApiRequest = vi.mocked(apiRequest)

describe('setupReports API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getSetupRunReport fetches the report endpoint', async () => {
    mockedApiRequest.mockResolvedValueOnce({
      report: {
        setupRun: { id: '507f1f77bcf86cd799439011', status: 'SUCCEEDED' },
      },
    })

    const res = await getSetupRunReport('507f1f77bcf86cd799439011')

    expect(mockedApiRequest).toHaveBeenCalledWith('/setup-runs/507f1f77bcf86cd799439011/report', {
      method: 'GET',
    })
    expect(res.report.setupRun.status).toBe('SUCCEEDED')
  })
})
