/** API error payload shape from backend JSON responses */
export interface ApiErrorBody {
  error: string
  message: string
  detail?: string
  setupRunId?: string
  workflowId?: string
  cancelPriorRunRequired?: boolean
  issues?: AdsReadinessIssue[]
}

export interface AdsReadinessIssue {
  code: string
  field: string
  message: string
}

export type AdsReadinessResult =
  | { ok: true; normalized?: Record<string, unknown> }
  | { ok: false; issues: AdsReadinessIssue[] }

export interface UserDto {
  id: string
  email: string
  name: string | null
  platformAdmin?: boolean
  primaryBusinessId?: string | null
  createdAt?: string
}

export interface CreateUserResponse {
  user: UserDto
}

export type ScrapeQuality = 'strong' | 'weak' | 'none'

/** Scraped suggestion payload — suggestions only until user confirms via PUT. */
export interface ScrapeSuggested {
  businessName?: string
  industry?: string
  services?: string[]
  serviceAreas?: string[]
  contactMethods?: unknown
  goals?: unknown
  differentiators?: string
  orderValueHint?: string
  scrapeQuality?: ScrapeQuality
  manualFallback?: boolean
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
  scrapeQuality?: ScrapeQuality | null
  manualFallback?: boolean | null
  createdAt?: string
  updatedAt?: string
}

/** Local scrape preview persisted until user confirms business context. */
export interface ScrapePreviewState {
  websiteUrl: string
  suggested: ScrapeSuggested
  scrapeStatus?: string
  scrapeQuality?: ScrapeQuality
  manualFallback?: boolean
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
  whoBuysToday?: string | null
  howBuyersContact?: string | null
  businessCountry?: string | null
  intakeFieldSources?: Record<string, string> | null
  setupCallConfirmedAt?: string | null
  thankYouUrls: string[]
  nameKey?: string | null
  uvp: string | null
  competitorLandscape: SusoCompetitorLandscape | null
  businessScope: SusoBusinessScope | null
  valueComplexity: SusoValueComplexity | null
  budgetTier: SusoBudgetTier | null
  susoVersion: number
  susoVersionUpdatedAt: string | null
  confirmedAt: string | null
  updatedAt?: string
}

export type SusoBusinessScope = 'local_service' | 'regional' | 'national_online'

export type SusoValueComplexity =
  | 'low_value_low_complexity'
  | 'low_value_high_complexity'
  | 'high_value_low_complexity'
  | 'high_value_high_complexity'

export type SusoBudgetTier = 'starter' | 'growth' | 'scale'

export interface SusoCompetitorEntry {
  name: string
  differentiation?: string
}

export interface SusoCompetitorLandscape {
  competitors?: SusoCompetitorEntry[]
  differentiationAngle?: string
}

export type SusoMatrixCellStatus = 'eligible' | 'trimmed' | 'gated'

export interface SusoMatrixCell {
  objective: string
  stage: string
  segment: string
  label: string
  status: SusoMatrixCellStatus
  gateReason?: string
}

export interface SusoFeasibilityGate {
  gate: string
  state: string
  label: string
  detail?: string
}

export interface SusoMatrixPreview {
  cells: SusoMatrixCell[]
  gates: SusoFeasibilityGate[]
  ctaStyle: string | null
}

export interface GetBusinessContextResponse {
  businessContext: BusinessContextDto
  adsReadiness: AdsReadinessResult
  susoMatrix: SusoMatrixPreview
}

export interface PutBusinessContextResponse {
  businessContext: BusinessContextDto
  adsReadiness: AdsReadinessResult
  susoMatrix: SusoMatrixPreview
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
  thankYouUrls?: string[]
  uvp?: string | null
  competitorLandscape?: SusoCompetitorLandscape | null
  businessScope?: SusoBusinessScope | null
  valueComplexity?: SusoValueComplexity | null
  budgetTier?: SusoBudgetTier | null
}

export interface SetupRunDto {
  id: string
  businessId: string
  temporalWorkflowId: string | null
  status: string
  lastErrorSummary: string | null
  meta: SetupRunMeta | null
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

export interface SetupRunMeta {
  supportState?: SetupRunSupportState
  compensation?: SetupRunCompensation
  [key: string]: unknown
}

export interface SetupRunDetailResponse {
  setupRun: SetupRunDto
  stuckState: SetupRunStuckState
  recovery: SetupRunReportRecovery | null
  steps: SetupStepDto[]
}

export interface LatestSetupRunResponse {
  setupRun: {
    id: string
    businessId: string
    temporalWorkflowId: string | null
    status: string
    createdAt?: string
    updatedAt?: string
  } | null
}

export interface SetupRunReportRecoveryStep {
  text: string
  href?: string
  external?: boolean
}

export interface SetupRunReportRecovery {
  title: string
  steps: SetupRunReportRecoveryStep[]
  advancedSteps?: SetupRunReportRecoveryStep[]
}

export interface SetupRunReportGbpGuidance {
  code: string
  title: string
  message: string
  blocking: boolean
}

export interface SetupRunReportGbpAudit {
  status: 'complete' | 'skipped' | 'guidance' | 'not_run'
  reason: string | null
  guidance: SetupRunReportGbpGuidance | null
  blocking: boolean
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

export interface SetupRunReportConversionActions {
  status: 'ready' | 'manual_review' | 'failed' | 'not_run'
  slotsResolved: number
  created: number
  reused: number
  message: string | null
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

export interface SetupRunReportRecommendation {
  id: string
  priority: 'recommended' | 'optional'
  title: string
  message: string
  steps: string[]
}

export interface SetupRunReportStructuralVerification {
  status:
    | 'pass'
    | 'skipped'
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

export interface SetupRunReportAdsCampaignFailure {
  provider: 'google_ads'
  stepName: string
  validationBucket: string | null
  bucketLabel: string | null
  field: string | null
  code: string | null
  message: string
  recommendedAction: string
  issues: Array<{
    code?: string
    field?: string
    message?: string
    bucket?: string
    rawValue?: string
    sanitizedValue?: string
  }>
}

export interface SetupRunReportAdsCampaign {
  status: 'campaigns_recorded' | 'failed' | 'not_run'
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
  failure: SetupRunReportAdsCampaignFailure | null
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
  conversionActions: SetupRunReportConversionActions
  adsCatalog: SetupRunReportAdsCatalog
  gtmSetup: SetupRunReportGtmSetup
  provisioning: SetupRunReportProvisioning
  structuralVerification: SetupRunReportStructuralVerification
  adsCampaign: SetupRunReportAdsCampaign
  recommendations: SetupRunReportRecommendation[]
  artifactCounts: SetupRunReportArtifactCounts
  steps: SetupStepDto[]
  susoStale: boolean
  susoVersions: {
    current: number
    artifact: number | null
  }
}

export interface SetupRunReportResponse {
  report: SetupRunReport
}

export interface CreateSetupRunBody {
  businessId: string
  force?: boolean
  confirmCancelPriorRun?: boolean
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
