import { apiRequest } from './client'
import type { SetupRunReportResponse } from '../types/api'

export type AdminUserDto = {
  id: string
  email: string
  name: string | null
  platformAdmin: boolean
  createdAt?: string
}

export type AdminBusinessDto = {
  businessId: string
  businessName: string | null
  userId: string
  orgId: string | null
  confirmedAt: string | null
  updatedAt: string
}

export type AdminSetupRunDto = {
  setupRunId: string
  businessId: string
  status: string
  temporalWorkflowId: string | null
  createdAt: string
  updatedAt: string
}

export async function adminListUsers(): Promise<{ users: AdminUserDto[] }> {
  return apiRequest<{ users: AdminUserDto[] }>('/admin/users')
}

export async function adminListBusinesses(): Promise<{ businesses: AdminBusinessDto[] }> {
  return apiRequest<{ businesses: AdminBusinessDto[] }>('/admin/businesses')
}

export async function adminListSetupRuns(): Promise<{ setupRuns: AdminSetupRunDto[] }> {
  return apiRequest<{ setupRuns: AdminSetupRunDto[] }>('/admin/setup-runs')
}

export async function adminGetSetupRunReport(setupRunId: string): Promise<SetupRunReportResponse> {
  return apiRequest<SetupRunReportResponse>(`/admin/setup-runs/${setupRunId}/report`)
}
