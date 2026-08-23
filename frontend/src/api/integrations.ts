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
  options?: { rediscover?: boolean },
): Promise<IntegrationStatusResponse> {
  const q = new URLSearchParams({ businessId })
  if (options?.rediscover) {
    q.set('rediscover', 'true')
  }
  return apiRequest<IntegrationStatusResponse>(`/integrations/status?${q.toString()}`)
}

export async function fetchGoogleConnectUrl(
  provider: IntegrationProvider,
  businessId: string,
  returnPath = '/setup',
): Promise<GoogleConnectUrlResponse> {
  const q = new URLSearchParams({ businessId })
  if (returnPath.startsWith('/') && !returnPath.startsWith('//')) {
    q.set('returnPath', returnPath)
  }
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

export interface GtmWorkspaceOption {
  workspaceId: string
  name: string | null
  path?: string | null
}

export interface GtmContainerOption {
  containerId: string
  name: string | null
  publicContainerId: string | null
  usageContext: string[]
  workspaces: GtmWorkspaceOption[]
}

export interface GtmAccountOption {
  accountId: string
  name: string | null
  path?: string | null
  containers: GtmContainerOption[]
}

export interface GtmResourceOptionsResult {
  businessId: string
  provider: 'gtm'
  selectionRequired: boolean
  reason: string | null
  accounts: GtmAccountOption[]
  selected: {
    accountId: string
    accountName: string | null
    containerId: string
    containerName: string | null
    publicContainerId: string | null
    workspaceId: string
    workspaceName: string | null
    selectedAt: string | null
  } | null
}

export interface GoogleAdsCustomerOption {
  customerId: string
  formattedCustomerId: string
  descriptiveName: string | null
  kind: string
  status: string | null
  testAccount?: boolean
  selectable: boolean
  nonSelectableReason: string | null
  loginCustomerId?: string | null
}

export interface GoogleAdsResourceOptionsResult {
  businessId: string
  provider: 'google_ads'
  selectionRequired: boolean
  reason: string | null
  options: GoogleAdsCustomerOption[]
  suggestedCustomerId: string | null
  selected: {
    customerId: string
    formattedCustomerId: string
    descriptiveName: string | null
    kind: string
    status: string | null
    selectedAt: string | null
  } | null
  accessibleCustomerIds: string[]
  loginCustomerId: string | null
}

export interface GtmSelectionBody {
  businessId: string
  accountId: string
  containerId: string
  workspaceId: string
}

export interface GoogleAdsSelectionBody {
  businessId: string
  customerId: string
}

export interface GoogleAdsProvisioningIntentBody {
  businessId: string
  provisioningIntent: 'mcc_create'
}

export interface GoogleAdsProvisioningIntentResult {
  businessId: string
  provider: 'google_ads'
  provisioningIntent: 'mcc_create'
}

export async function fetchGtmResourceOptions(
  businessId: string,
): Promise<{ result: GtmResourceOptionsResult }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest<{ result: GtmResourceOptionsResult }>(
    `/integrations/gtm/resource-options?${q.toString()}`,
  )
}

export interface GtmAccountsResult {
  businessId: string
  provider: 'gtm'
  accounts: Array<{ accountId: string; name?: string | null }>
  selectedAccountId: string | null
  selectedAccount: { accountId: string; name?: string | null } | null
}

export async function fetchGtmAccounts(
  businessId: string,
): Promise<{ result: GtmAccountsResult }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest<{ result: GtmAccountsResult }>(`/integrations/gtm/accounts?${q.toString()}`)
}

export async function saveGtmAccountSelection(body: {
  businessId: string
  accountId: string
}): Promise<{ result: Record<string, unknown> }> {
  return apiRequest(`/integrations/gtm/account-selection`, { method: 'PUT', body })
}

export async function saveGtmSelection(
  body: GtmSelectionBody,
): Promise<{ result: GtmResourceOptionsResult & { providerIdentifiers?: Record<string, unknown> } }> {
  return apiRequest(`/integrations/gtm/selection`, { method: 'PUT', body })
}

export async function fetchGoogleAdsResourceOptions(
  businessId: string,
): Promise<{ result: GoogleAdsResourceOptionsResult }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest<{ result: GoogleAdsResourceOptionsResult }>(
    `/integrations/google_ads/resource-options?${q.toString()}`,
  )
}

export async function saveGoogleAdsSelection(
  body: GoogleAdsSelectionBody,
): Promise<{ result: GoogleAdsResourceOptionsResult & { providerIdentifiers?: Record<string, unknown> } }> {
  return apiRequest(`/integrations/google_ads/selection`, { method: 'PUT', body })
}

export async function saveGoogleAdsProvisioningIntent(
  businessId: string,
): Promise<{ result: GoogleAdsProvisioningIntentResult }> {
  const body: GoogleAdsProvisioningIntentBody = {
    businessId,
    provisioningIntent: 'mcc_create',
  }
  return apiRequest(`/integrations/google_ads/provisioning-intent`, { method: 'PUT', body })
}

export interface MccLinkState {
  status: 'ACTIVE' | 'PENDING' | 'REQUIRED' | string | null
  managerCustomerId?: string | null
  clientCustomerId?: string | null
  managerLinkId?: string | null
  resourceName?: string | null
  invitedAt?: string | null
  acceptedAt?: string | null
  checkedAt?: string | null
  provisioningSource?: string | null
}

export interface MccLinkManualAcceptInstructions {
  summary: string
  steps: string[]
  googleAdsUrl: string
}

export interface MccLinkStatusResponse {
  businessId: string
  mccLink: MccLinkState | null
  manualAccept: MccLinkManualAcceptInstructions
  refreshed?: boolean
  customerId?: string | null
  outcome?: string
  message?: string
}

export async function getMccLinkStatus(
  businessId: string,
  options?: { refresh?: boolean },
): Promise<MccLinkStatusResponse> {
  const q = new URLSearchParams({ businessId })
  if (options?.refresh) {
    q.set('refresh', 'true')
  }
  return apiRequest<MccLinkStatusResponse>(`/integrations/google_ads/mcc-link-status?${q.toString()}`)
}

export async function sendMccLinkInvite(businessId: string): Promise<MccLinkStatusResponse> {
  return apiRequest<MccLinkStatusResponse>(`/integrations/google_ads/mcc-link/invite`, {
    method: 'POST',
    body: { businessId },
  })
}

export async function acceptMccLinkInvite(businessId: string): Promise<MccLinkStatusResponse> {
  return apiRequest<MccLinkStatusResponse>(`/integrations/google_ads/mcc-link/accept`, {
    method: 'POST',
    body: { businessId },
  })
}

export async function writeGbpLocation(
  locationId: string,
  body: Record<string, unknown>,
  consentGranted: boolean,
): Promise<{ result: Record<string, unknown> }> {
  return apiRequest<{ result: Record<string, unknown> }>(`/integrations/gbp/${locationId}/write`, {
    method: 'POST',
    headers: { 'x-gbp-write-consent': consentGranted ? 'true' : 'false' },
    body,
  })
}

export async function getMetaConnectUrl(): Promise<{ url: string | null; source: string }> {
  return apiRequest<{ url: string | null; source: string }>('/integrations/meta/connect-url')
}

export async function getMetaStatus(businessId: string): Promise<{ status: Record<string, unknown> }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest<{ status: Record<string, unknown> }>(`/integrations/meta/status?${q.toString()}`)
}

export async function runMetaSetup(businessId: string): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>('/integrations/meta/setup', {
    method: 'POST',
    body: { businessId },
  })
}
