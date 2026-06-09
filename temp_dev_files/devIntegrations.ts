import type { ScrapeRunDto, ScrapeRunPollResponse, ScrapeStartResponse } from '../types/api'
import { apiRequest } from './client'
import type { IntegrationProvider } from './integrations'

export interface SandboxBusinessResponse {
  businessId: string
  created: boolean
  businessName: string
  confirmedAt: string | null
}

export interface DiagnosticsEnvironment {
  googleOAuthMock: boolean
  gtmApiMock: boolean
  googleAdsApiMock: boolean
  gbpApiMock: boolean
  gtmApiEnabled: boolean
  googleAdsApiEnabled: boolean
  googleAdsApiVersion?: string
  gbpApiEnabled: boolean
}

export interface GoogleAdsDiagnosticTest {
  name: string
  ok: boolean
  includesLoginCustomerId: boolean | null
  errorCode?: string | null
  message?: string
  googleErrorSummary?: Record<string, unknown> | null
  details?: Record<string, unknown>
}

export interface DiagnosticsOverviewResponse {
  businessId: string
  connections: Record<
    IntegrationProvider,
    {
      provider: IntegrationProvider
      ready: boolean
      reason: string
      connectionHealth: string | null
      nextAction: string | null
      scopesGranted: string[]
      scopesMissing: string[]
      providerIdentifiers: Record<string, unknown> | null
    }
  >
  provisioning: unknown
  environment: DiagnosticsEnvironment
}

export interface SmokeTestResult {
  provider: IntegrationProvider
  ok: boolean
  startedAt: string
  apiVersion?: string | null
  errorCode?: string
  message?: string
  connectionHealth?: string
  discoveryReason?: string | null
  providerIdentifiers?: Record<string, unknown> | null
  tests?: GoogleAdsDiagnosticTest[]
  extra?: Record<string, unknown>
}

export interface ProvisioningCheckResponse {
  businessId: string
  provider: 'gtm' | 'google_ads'
  provisioningRequired: boolean
  connection: unknown
  activeRequest: unknown
  latestRequest: unknown
}

export async function createSandboxBusiness(): Promise<SandboxBusinessResponse> {
  return apiRequest<SandboxBusinessResponse>('/dev/integrations/sandbox-business', {
    method: 'POST',
  })
}

export async function fetchDiagnosticsOverview(
  businessId: string,
): Promise<DiagnosticsOverviewResponse> {
  const q = new URLSearchParams({ businessId })
  return apiRequest<DiagnosticsOverviewResponse>(`/dev/integrations/overview?${q.toString()}`)
}

export async function fetchDevGoogleConnectUrl(
  provider: IntegrationProvider,
  businessId: string,
): Promise<{ url: string; provider: IntegrationProvider; businessId: string }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest(`/dev/integrations/google/${provider}/connect-url?${q.toString()}`)
}

export async function runProviderSmokeTest(
  provider: IntegrationProvider,
  businessId: string,
): Promise<{ result: SmokeTestResult }> {
  return apiRequest(`/dev/integrations/${provider}/smoke-test`, {
    method: 'POST',
    body: { businessId },
  })
}

export async function startDevScrape(
  businessId: string,
  websiteUrl: string,
): Promise<ScrapeStartResponse> {
  return apiRequest<ScrapeStartResponse>('/dev/integrations/scrape', {
    method: 'POST',
    body: { businessId, websiteUrl },
  })
}

export async function pollDevScrapeRun(
  businessId: string,
  scrapeRunId: string,
): Promise<ScrapeRunPollResponse> {
  const q = new URLSearchParams({ businessId })
  return apiRequest<ScrapeRunPollResponse>(
    `/dev/integrations/scrape-runs/${scrapeRunId}?${q.toString()}`,
  )
}

const TERMINAL_SCRAPE_STATUSES = new Set(['SUCCEEDED', 'PARTIAL', 'BLOCKED', 'FAILED'])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitForDevScrapeCompletion(
  businessId: string,
  scrapeRunId: string,
  options?: { maxAttempts?: number; delayMs?: number },
): Promise<ScrapeRunDto> {
  const maxAttempts = options?.maxAttempts ?? 120
  const delayMs = options?.delayMs ?? 2000

  for (let i = 0; i < maxAttempts; i++) {
    const { scrapeRun } = await pollDevScrapeRun(businessId, scrapeRunId)
    if (TERMINAL_SCRAPE_STATUSES.has(scrapeRun.status)) {
      return scrapeRun
    }
    await sleep(delayMs)
  }

  const { scrapeRun } = await pollDevScrapeRun(businessId, scrapeRunId)
  return scrapeRun
}

export async function fetchProvisioningCheck(
  provider: 'gtm' | 'google_ads',
  businessId: string,
): Promise<ProvisioningCheckResponse> {
  const q = new URLSearchParams({ businessId })
  return apiRequest<ProvisioningCheckResponse>(
    `/dev/integrations/${provider}/provisioning-check?${q.toString()}`,
  )
}

export type CreationDiagnosticRunMode =
  | 'validate_only'
  | 'create_paused'
  | 'create_and_publish'

export interface CreationDiagnosticStepResult {
  name: string
  provider: 'google_ads' | 'gtm'
  action: string
  ok: boolean
  skipped: boolean
  resourceType: string
  resourceId?: string
  resourceName?: string
  message: string
  errorCode?: string
  details?: Record<string, unknown>
}

export interface CreationDiagnosticRunResult {
  diagnosticRunId: string
  matrixVersion: string
  provider: 'google_ads' | 'gtm'
  mode: CreationDiagnosticRunMode
  businessId: string
  ok: boolean
  startedAt: string
  completedAt: string
  message: string
  errorCode?: string | null
  steps: CreationDiagnosticStepResult[]
  summary: {
    total: number
    passed: number
    failed: number
    skipped: number
  }
}

export interface CreationDiagnosticRunDetail extends CreationDiagnosticRunResult {
  artifacts: Array<{
    stepId: string
    resourceType: string
    resourceId: string
    resourceName: string | null
    resourcePath: string | null
    externalUrl: string | null
    cleanupStatus: string
    createdAt: string
  }>
}

export async function runGtmCreationDiagnostics(
  businessId: string,
  mode: CreationDiagnosticRunMode,
  confirmCreateExternalResources: boolean,
): Promise<{ result: CreationDiagnosticRunResult }> {
  return apiRequest('/dev/integrations/gtm/create-diagnostics', {
    method: 'POST',
    body: { businessId, mode, confirmCreateExternalResources },
  })
}

export async function runGoogleAdsCreationDiagnostics(
  businessId: string,
  mode: CreationDiagnosticRunMode,
  confirmCreateExternalResources: boolean,
): Promise<{ result: CreationDiagnosticRunResult }> {
  return apiRequest('/dev/integrations/google_ads/create-diagnostics', {
    method: 'POST',
    body: { businessId, mode, confirmCreateExternalResources },
  })
}

export async function fetchDiagnosticRun(
  businessId: string,
  diagnosticRunId: string,
): Promise<{ result: CreationDiagnosticRunDetail }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest(`/dev/integrations/diagnostic-runs/${diagnosticRunId}?${q.toString()}`)
}

export type GoogleAdsAccountKind = 'manager' | 'client' | 'unknown'
export type GoogleAdsAccountStatus =
  | 'enabled'
  | 'cancelled'
  | 'closed'
  | 'suspended'
  | 'unknown'

export interface GoogleAdsCustomerOption {
  customerId: string
  formattedCustomerId: string | null
  descriptiveName: string | null
  kind: GoogleAdsAccountKind
  status: GoogleAdsAccountStatus
  testAccount: boolean
  selectable: boolean
  nonSelectableReason: string | null
  loginCustomerId: string | null
}

export interface GoogleAdsSelectedCustomer {
  customerId: string
  formattedCustomerId: string | null
  descriptiveName: string | null
  kind: GoogleAdsAccountKind
  status: GoogleAdsAccountStatus
  selectedAt: string | null
}

export interface GoogleAdsResourceOptionsResult {
  businessId: string
  provider: 'google_ads'
  selectionRequired: boolean
  reason: string | null
  options: GoogleAdsCustomerOption[]
  suggestedCustomerId?: string | null
  selected: GoogleAdsSelectedCustomer | null
  accessibleCustomerIds: string[]
  loginCustomerId: string | null
}

export interface GoogleAdsSelectionResult {
  businessId: string
  provider: 'google_ads'
  selectionRequired: boolean
  selected: GoogleAdsSelectedCustomer
}

export interface GtmWorkspaceOption {
  workspaceId: string
  name: string | null
  path: string | null
}

export interface GtmContainerOption {
  containerId: string
  publicContainerId: string | null
  name: string | null
  path: string | null
  usageContext: string[]
  workspaces: GtmWorkspaceOption[]
}

export interface GtmAccountOption {
  accountId: string
  name: string | null
  path: string | null
  containers: GtmContainerOption[]
}

export interface GtmSelectedResource {
  accountId: string
  accountName: string | null
  containerId: string
  containerName: string | null
  publicContainerId: string | null
  workspaceId: string
  workspaceName: string | null
  selectedAt: string | null
}

export interface GtmResourceOptionsResult {
  businessId: string
  provider: 'gtm'
  selectionRequired: boolean
  reason: string | null
  accounts: GtmAccountOption[]
  selected: GtmSelectedResource | null
}

export interface GtmSelectionResult {
  businessId: string
  provider: 'gtm'
  selectionRequired: boolean
  selected: GtmSelectedResource
}

export async function fetchGoogleAdsResourceOptions(
  businessId: string,
): Promise<{ result: GoogleAdsResourceOptionsResult }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest(`/dev/integrations/google_ads/resources?${q.toString()}`)
}

export async function saveGoogleAdsSelection(
  businessId: string,
  customerId: string,
): Promise<{ result: GoogleAdsSelectionResult }> {
  return apiRequest('/dev/integrations/google_ads/selection', {
    method: 'POST',
    body: { businessId, customerId },
  })
}

export async function fetchGtmResourceOptions(
  businessId: string,
): Promise<{ result: GtmResourceOptionsResult }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest(`/dev/integrations/gtm/resources?${q.toString()}`)
}

export async function saveGtmSelection(
  businessId: string,
  selection: { accountId: string; containerId: string; workspaceId: string },
): Promise<{ result: GtmSelectionResult }> {
  return apiRequest('/dev/integrations/gtm/selection', {
    method: 'POST',
    body: { businessId, ...selection },
  })
}

export function isDevIntegrationsEnabled(): boolean {
  const flag = import.meta.env.VITE_ENABLE_INTEGRATION_DIAGNOSTICS?.trim().toLowerCase()
  return import.meta.env.DEV && (flag === 'true' || flag === '1')
}
