import { apiRequest } from './client'

export type IntegrationProvider = 'gbp' | 'gtm' | 'google_ads'

export interface IntegrationConnectionStatusDto {
  provider: IntegrationProvider
  ready: boolean
  reason: string
  connectionHealth: string | null
  nextAction: string | null
  scopesGranted: string[]
  scopesMissing: string[]
  providerIdentifiers: Record<string, unknown> | null
}

export interface IntegrationStatusResponse {
  businessId: string
  connections: Record<IntegrationProvider, IntegrationConnectionStatusDto>
}

export interface GoogleConnectUrlResponse {
  provider: IntegrationProvider
  businessId: string
  url: string
}

export async function fetchIntegrationStatus(
  businessId: string,
): Promise<IntegrationStatusResponse> {
  const q = new URLSearchParams({ businessId })
  return apiRequest<IntegrationStatusResponse>(`/integrations/status?${q.toString()}`)
}

export async function fetchGoogleConnectUrl(
  provider: IntegrationProvider,
  businessId: string,
): Promise<GoogleConnectUrlResponse> {
  const q = new URLSearchParams({ businessId })
  return apiRequest<GoogleConnectUrlResponse>(
    `/integrations/google/${provider}/connect-url?${q.toString()}`,
  )
}

export type ProvisioningProvider = 'gtm' | 'google_ads'

export interface ProvisioningRequestDto {
  id: string
  businessId: string
  provider: ProvisioningProvider
  status: string
  requestedResources: string[]
  approvedAt: string | null
  createdProviderIdentifiers: Record<string, unknown> | null
  errorCode: string | null
  errorMessage: string | null
  setupRunId: string | null
  createdAt?: string
  updatedAt?: string
}

export interface ProvisioningProviderState {
  provider: ProvisioningProvider
  connection: IntegrationConnectionStatusDto
  activeRequest: ProvisioningRequestDto | null
  latestRequest: ProvisioningRequestDto | null
  provisioningRequired: boolean
}

export interface ProvisioningOverviewResponse {
  businessId: string
  providers: Record<ProvisioningProvider, ProvisioningProviderState>
}

export interface CreateProvisioningRequestBody {
  businessId: string
  setupRunId?: string
}

export interface CreateProvisioningRequestResponse {
  request: ProvisioningRequestDto
  created: boolean
}

export interface ApproveProvisioningRequestResponse {
  request: ProvisioningRequestDto
}

export interface CancelProvisioningRequestResponse {
  request: ProvisioningRequestDto
}

export async function fetchProvisioningOverview(
  businessId: string,
): Promise<ProvisioningOverviewResponse> {
  const q = new URLSearchParams({ businessId })
  return apiRequest<ProvisioningOverviewResponse>(
    `/integrations/provisioning?${q.toString()}`,
  )
}

export async function createProvisioningRequest(
  provider: ProvisioningProvider,
  body: CreateProvisioningRequestBody,
): Promise<CreateProvisioningRequestResponse> {
  return apiRequest<CreateProvisioningRequestResponse>(
    `/integrations/provisioning/${provider}/requests`,
    { method: 'POST', body },
  )
}

export async function approveProvisioningRequest(
  requestId: string,
  businessId: string,
): Promise<ApproveProvisioningRequestResponse> {
  return apiRequest<ApproveProvisioningRequestResponse>(
    `/integrations/provisioning/requests/${requestId}/approve`,
    { method: 'POST', body: { businessId } },
  )
}

export async function cancelProvisioningRequest(
  requestId: string,
  businessId: string,
): Promise<CancelProvisioningRequestResponse> {
  return apiRequest<CancelProvisioningRequestResponse>(
    `/integrations/provisioning/requests/${requestId}/cancel`,
    { method: 'POST', body: { businessId } },
  )
}
