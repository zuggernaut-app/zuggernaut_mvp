import type {
  CreateSetupRunBody,
  CreateSetupRunSuccessResponse,
  LatestSetupRunResponse,
  SetupRunDetailResponse,
} from '../types/api'
import { apiRequest } from './client'

export function getLatestSetupRun(businessId: string): Promise<LatestSetupRunResponse> {
  const params = new URLSearchParams({ businessId })
  return apiRequest<LatestSetupRunResponse>(`/setup-runs/latest?${params.toString()}`, {
    method: 'GET',
  })
}

export function startSetupRun(
  businessId: string,
  options?: { force?: boolean; confirmCancelPriorRun?: boolean },
): Promise<CreateSetupRunSuccessResponse> {
  const body: CreateSetupRunBody = { businessId }
  if (options?.force) body.force = true
  if (options?.confirmCancelPriorRun) body.confirmCancelPriorRun = true
  return apiRequest<CreateSetupRunSuccessResponse>('/setup-runs', {
    method: 'POST',
    body,
  })
}

export function getSetupRun(setupRunId: string): Promise<SetupRunDetailResponse> {
  return apiRequest<SetupRunDetailResponse>(`/setup-runs/${setupRunId}`, {
    method: 'GET',
  })
}
