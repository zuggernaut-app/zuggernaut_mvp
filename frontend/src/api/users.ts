import { apiRequest } from './client'
import type { BusinessContextDto } from '../types/api'

export type BusinessContextListResponse = {
  businessContexts: BusinessContextDto[]
}

export async function listBusinessContexts(): Promise<BusinessContextListResponse> {
  return apiRequest<BusinessContextListResponse>('/business-contexts')
}

export async function setPrimaryBusiness(businessId: string): Promise<{
  ok: boolean
  primaryBusinessId: string
}> {
  return apiRequest<{ ok: boolean; primaryBusinessId: string }>('/users/primary-business', {
    method: 'PUT',
    body: { businessId },
  })
}
