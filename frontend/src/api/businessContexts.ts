import type { BusinessContextUpdateBody, PutBusinessContextResponse } from '../types/api'
import { apiRequest } from './client'

export function updateBusinessContext(
  businessId: string,
  body: BusinessContextUpdateBody
): Promise<PutBusinessContextResponse> {
  return apiRequest<PutBusinessContextResponse>(`/business-contexts/${businessId}`, {
    method: 'PUT',
    body,
  })
}
