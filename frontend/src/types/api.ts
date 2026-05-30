/** API error payload shape from backend JSON responses */
export interface ApiErrorBody {
  error: string
  message: string
  detail?: string
  setupRunId?: string
}

export interface UserDto {
  id: string
  email: string
  name: string | null
  createdAt?: string
}

export interface CreateUserResponse {
  user: UserDto
}

/** Scraped suggestion payload (placeholder scraper keys) */
export interface ScrapeSuggested {
  businessName?: string
  industry?: string
  services?: string[]
  serviceAreas?: string[]
  differentiators?: string
  orderValueHint?: string
  [key: string]: unknown
}

/** Response from POST …/scrape — async job started; poll GET …/scrape-runs/:id */
export interface ScrapeStartResponse {
  businessId: string
  websiteUrl: string
  scrapeRunId: string
  workflowId: string | null
  status: string
}

export interface ScrapeRunDto {
  id: string
  businessId: string
  websiteUrl: string
  temporalWorkflowId: string | null
  status: string
  lastErrorSummary: string | null
  suggested: ScrapeSuggested | null
  createdAt?: string
  updatedAt?: string
}

export interface ScrapeRunPollResponse {
  scrapeRun: ScrapeRunDto
}

export interface BusinessContextDto {
  businessId: string
  userId: string
  websiteUrl: string | null
  businessName: string | null
  industry: string | null
  services: string[]
  serviceAreas: string[]
  contactMethods: unknown
  audienceSignals: unknown
  goals: unknown
  differentiators: string | null
  orderValueHint: string | null
  confirmedAt: string
  updatedAt?: string
}

export interface PutBusinessContextResponse {
  businessContext: BusinessContextDto
}

/** Subset matching backend EDITABLE_FIELDS */
export interface BusinessContextUpdateBody {
  websiteUrl?: string | null
  businessName?: string | null
  industry?: string | null
  services?: string[]
  serviceAreas?: string[]
  contactMethods?: unknown
  audienceSignals?: unknown
  goals?: unknown
  differentiators?: string | null
  orderValueHint?: string | null
}

export interface SetupRunDto {
  id: string
  businessId: string
  temporalWorkflowId: string | null
  status: string
  lastErrorSummary: string | null
  meta: unknown
  createdAt?: string
  updatedAt?: string
}

export interface SetupStepDto {
  id: string
  stepName: string
  provider: string | null
  status: string
  attemptCount: number
  startedAt: string | null
  endedAt: string | null
  lastErrorSummary: string | null
  details: unknown
  updatedAt?: string
}

export interface SetupRunStuckState {
  stuck: boolean
  runningForMs: number | null
  thresholdMs: number
  guidance: string | null
}

export interface SetupRunCompensationAction {
  type: string
  outcome?: string
  message?: string
  campaignResourceName?: string
  artifactCount?: number
}

export interface SetupRunCompensation {
  appliedAt: string
  failedStep: string
  actions: SetupRunCompensationAction[]
}

export interface SetupRunSupportState {
  failedStep?: string
  errorCode?: string | null
  compensation?: SetupRunCompensation
  updatedAt?: string
}

export interface SetupRunDetailResponse {
  setupRun: SetupRunDto
  stuckState: SetupRunStuckState
  steps: SetupStepDto[]
}

export interface SetupRunReportRecovery {
  title: string
  steps: string[]
}

export interface SetupRunReportGbpAudit {
  status: 'complete' | 'skipped' | 'not_run'
  summary: {
    presentCount: number
    missingCount: number
    needsAttentionCount: number
  } | null
  findings: {
    present: string[]
    missing: string[]
    needsAttention: string[]
  } | null
}

export interface SetupRunReportAdsCatalog {
  status: 'ready' | 'not_run'
  summary: {
    primaryGoal: string
    totalInCatalog: number
    selectedCount: number
    selectedCategories: string[]
  } | null
}

export interface SetupRunReportGtmSetup {
  status: 'setup_complete' | 'not_run'
  summary: {
    templateVersion: number
    tagsCreated: number
    triggersCreated: number
    variablesCreated: number
    reusedArtifacts: number
    publishedVersion: string
  } | null
}

export interface SetupRunReportProvisioningProvider {
  status: 'not_required' | 'approval_required' | 'provisioned' | 'failed'
  requestId: string | null
}

export interface SetupRunReportProvisioning {
  gtm: SetupRunReportProvisioningProvider
  googleAds: SetupRunReportProvisioningProvider
}

export interface SetupRunReportStructuralVerification {
  status:
    | 'pass'
    | 'snippet_pending'
    | 'needs_tracking_fix'
    | 'manual_review'
    | 'not_run'
  summary: string | null
  evidence: {
    missing?: string[]
    snippetPresent?: boolean | null
    publicContainerId?: string | null
  } | null
}

export interface SetupRunReportAdsCampaign {
  status: 'campaigns_recorded' | 'not_run'
  summary: {
    campaignCreated: boolean
    adGroupCreated: boolean
    adCreated: boolean
    reusedArtifacts: number
    campaignExternalId: string
    conversionLinkCount: number
  } | null
  plan: {
    campaignName: string | null
    bidding: string | null
    budgetAmountMicros: number | null
  } | null
}

export interface SetupRunReportArtifactCounts {
  gtmTags: number
  gtmTriggers: number
  gtmVariables: number
  adsConversions: number
  adsCampaignBudgets: number
  adsCampaigns: number
  adsAdGroups: number
  adsAds: number
  adsConversionLinks: number
}

export interface SetupRunReport {
  setupRun: SetupRunDto
  business: {
    businessName: string | null
    websiteUrl: string | null
    goals: unknown
  } | null
  outcome: {
    kind:
      | 'succeeded'
      | 'failed'
      | 'in_progress'
      | 'snippet_pending'
      | 'tracking_fix'
      | 'manual_review'
      | 'provisioning_required'
    headline: string
    recovery: SetupRunReportRecovery | null
  }
  stuckState: SetupRunStuckState
  supportState: SetupRunSupportState | null
  compensation: SetupRunCompensation | null
  gbpAudit: SetupRunReportGbpAudit
  adsCatalog: SetupRunReportAdsCatalog
  gtmSetup: SetupRunReportGtmSetup
  provisioning: SetupRunReportProvisioning
  structuralVerification: SetupRunReportStructuralVerification
  adsCampaign: SetupRunReportAdsCampaign
  artifactCounts: SetupRunReportArtifactCounts
  steps: SetupStepDto[]
}

export interface SetupRunReportResponse {
  report: SetupRunReport
}

export interface CreateSetupRunBody {
  businessId: string
}

export interface CreateSetupRunSuccessResponse {
  setupRunId: string
  workflowId: string | null
  status: string
}

export interface TemporalUnavailableResponse extends ApiErrorBody {
  setupRunId: string
  workflowId: null
  status: string
}

export interface ScrapePreviewState {
  websiteUrl: string
  suggested: ScrapeSuggested
}
