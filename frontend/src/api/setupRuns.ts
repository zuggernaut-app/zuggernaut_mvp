import type { CreateSetupRunSuccessResponse, SetupRunDetailResponse } from '../types/api'
import { apiRequest } from './client'

export function startSetupRun(businessId: string): Promise<CreateSetupRunSuccessResponse> {
  return apiRequest<CreateSetupRunSuccessResponse>('/setup-runs', {
    method: 'POST',
    body: { businessId },
  })
}

export function getSetupRun(setupRunId: string): Promise<SetupRunDetailResponse> {
  return apiRequest<SetupRunDetailResponse>(`/setup-runs/${setupRunId}`, {
    method: 'GET',
  })
}
