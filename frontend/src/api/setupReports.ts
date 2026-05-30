import type { SetupRunReportResponse } from '../types/api'
import { apiRequest } from './client'

export function getSetupRunReport(setupRunId: string): Promise<SetupRunReportResponse> {
  return apiRequest<SetupRunReportResponse>(`/setup-runs/${setupRunId}/report`, {
    method: 'GET',
  })
}
