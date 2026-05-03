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

export interface SetupRunDetailResponse {
  setupRun: SetupRunDto
  steps: SetupStepDto[]
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
