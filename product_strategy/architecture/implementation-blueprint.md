# Implementation Blueprint: Zuggernaut

## 1. Overview

This blueprint details the technical implementation plan for Zuggernaut V1, an AI-powered digital marketing automation platform for small businesses. It translates the architectural decisions outlined in `architecture-review.md` into actionable implementation steps, focusing on core services and workflows, **with an explicit emphasis on robust Google Ads API parameter management for campaign creation.**

## 2. Core Services & Technologies

| Service                       | Primary Technology        | Key Responsibilities                                                                                                                                                                                                                                                                                          |
| :---------------------------- | :------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Orchestration Service**     | Node.js (Express.js)      | Manages `SetupRun` state machine, orchestrates calls to other services, handles retries and error compensation.                                                                                                                                                                                       |
| **GBP Audit Service**         | Node.js (Express.js)      | Integrates with GBP API (read-only) to fetch and analyze business profile data against audit checklist.                                                                                                                                                                                               |
| **GTM Conversion Service**    | Node.js (Express.js)      | Integrates with GTM API (v2) to create Google Ads conversion tags and basic triggers. Requires GTM Container ID.                                                                                                                                                                                      |
| **Ads Auto-Campaign Service** | Node.js (Express.js)      | Integrates with Google Ads API to create campaigns. Generates strategies, keywords, and ad copy (via AI Service). **Implements strict validation and definition of critical Google Ads API parameters from the Core Campaign Definition & Strategy, Ad Group Structure & Ad Creative, and Core Targeting & Conversion Goal Linking buckets.** |
| **Business Context Service**  | Node.js (Express.js)      | Handles website scraping (Axios, Cheerio), AI data enrichment (OpenAI), and stores/retrieves user-provided business info.                                                                                                                                                                             |
| **Auth Service**              | Node.js (Express.js)      | Manages OAuth 2.0 for Google APIs, secure storage (encrypted) of tokens, enforces tenant isolation (`businessId`).                                                                                                                                                                                    |
| **Notification Service**      | Node.js (Express.js)      | Communicates status updates from backend processes to the frontend.                                                                                                                                                                                                                                   |
| **AI Service (Wrapper)**      | Node.js (Express.js)      | Abstracts calls to OpenAI API for data enrichment, ad copy generation, and campaign strategy suggestions.                                                                                                                                                                                             |

## 3. Data Model (MongoDB)

*   **`Businesses` Collection:**
    *   `_id` (ObjectId)
    *   `businessId` (String, Tenant ID)
    *   `ownerUserId` (String)
    *   `name` (String)
    *   `websiteUrl` (String)
    *   `industry` (String)
    *   `serviceAreas` (Array<String>)
    *   `orderValue` (String)
    *   `primaryGoal` (String)
    *   `scrapedData` (Object, includes enriched details)
    *   `googleProfile` (Object, for audit results)
    *   `gtmConfig` (Object, GTM account/container/workspace IDs, conversion IDs/labels, created tag IDs, created trigger IDs)
    *   `adsConfig` (Object, linked Ads account ID, MCC ID, created budget IDs, campaign IDs, ad group IDs)
    *   `trackingVerification` (Object, latest structural verification result, checked URLs/selectors, failure reasons)
    *   `configVersions` (Object, GTM template version, Ads template version, prompt version, GBP audit rules version)
    *   `createdAt`, `updatedAt`

*   **`SetupRuns` Collection:**
    *   `_id` (ObjectId)
    *   `businessId` (String)
    *   `currentState` (String, e.g., `AWAITING_USER_INPUT`, `CONFIGURING_GTM`, `SETUP_COMPLETE`)
    *   `workflowHistory` (Array<Object>, timestamps and state changes)
    *   `errorDetails` (Object, if state is `SETUP_FAILED`)
    *   `idempotencyKey` (String, unique per setup attempt)
    *   `externalResources` (Object, IDs and resource names created in GBP/GTM/Ads where applicable)
    *   `retryCounters` (Object, count by step and external API)
    *   `lastCorrelationId` (String)
    *   `manualReviewRequired` (Boolean)
    *   `manualReviewReason` (String)
    *   `createdAt`, `updatedAt`

*   **`AuthTokens` Collection:**
    *   `_id` (ObjectId)
    *   `businessId` (String)
    *   `googleAccessToken` (String, encrypted)
    *   `googleRefreshToken` (String, encrypted)
    *   `googleExpiresIn` (Number)
    *   `googleScope` (String)
    *   `googleAdsAccountId` (String)
    *   `googleAdsAccountName` (String)
    *   `scopesGranted` (Array<String>)
    *   `lastRefreshedAt` (Date)
    *   `createdAt`, `updatedAt`

*   **`IntegrationEvents` Collection:**
    *   `_id` (ObjectId)
    *   `businessId` (String)
    *   `setupRunId` (String)
    *   `provider` (String, e.g., `google_business_profile`, `google_tag_manager`, `google_ads`, `openai`)
    *   `operation` (String)
    *   `idempotencyKey` (String)
    *   `correlationId` (String)
    *   `status` (String, e.g., `started`, `succeeded`, `failed`, `compensated`)
    *   `externalResourceId` (String)
    *   `errorCode` (String)
    *   `errorMessage` (String, sanitized)
    *   `createdAt`

*   **`VerificationResults` Collection:**
    *   `_id` (ObjectId)
    *   `businessId` (String)
    *   `setupRunId` (String)
    *   `verificationType` (String, e.g., `gtm_snippet_presence`, `thank_you_url_exists`, `dom_selector_present`)
    *   `target` (String, URL or selector)
    *   `status` (String, e.g., `passed`, `failed`, `manual_review_required`)
    *   `evidence` (Object, sanitized response metadata or DOM findings)
    *   `createdAt`

## 4. Key Workflows & Implementation Details

### 4.1. User Onboarding & Setup Process

1.  **Frontend:** User provides website URL, confirms/enters business details, provides goals, GTM IDs, and initiates OAuth flow.
2.  **Auth Service:** Handles OAuth 2.0 callbacks, stores encrypted tokens in `AuthTokens` collection.
3.  **Business Context Service:** Initiates scraping via `AI Service` upon receiving URL. Stores enriched data in `Businesses` document. **Validation ensures all critical Google Ads API parameters are captured in `BusinessContext`.**
4.  **Orchestration Service:** Creates a new `SetupRun` document with state `FETCHING_BUSINESS_CONTEXT` or `AWAITING_PERMISSIONS`. **Strict validation of Google Ads connection and `BusinessContext` completeness occurs before proceeding to campaign creation.**
5.  **GBP Audit Service:** Called by Orchestrator. Fetches GBP data using Auth tokens, performs audit, stores results in `Businesses.googleProfile`. Updates `SetupRun` state.
6.  **GTM Conversion Service:** Called by Orchestrator. Uses GTM API (with provided IDs and Ads Conversion IDs/Labels) to create tags/triggers. Updates `SetupRun` state.
7.  **Verification Step:** Checks required tracking structure (for example GTM snippet presence, expected thank-you URL availability, or known DOM selectors). Stores results in `VerificationResults`.
8.  **Ads Auto-Campaign Service:** Called by Orchestrator only after required verification gates pass or a manual review path is approved. Uses Google Ads API (with Auth tokens and business context) to create campaigns. **This service will implement strict enforcement of the prioritized Google Ads API parameters, halting the workflow if any are missing or invalid.** Updates `SetupRun` state.
9.  **Notification Service:** Pushes status updates to frontend throughout the process.

### 4.2. API Integrations

*   **Google APIs:** Use official Google client libraries for Node.js (`googleapis`).
*   **Authentication:** Implement refresh token logic to ensure continuous access.
*   **Error Handling:** Implement robust retry mechanisms (exponential backoff), circuit breakers, and graceful degradation for API failures.
*   **Rate Limiting:** Adhere strictly to Google API quotas. Implement internal rate limiting (e.g., token bucket) within services to avoid exceeding external limits.

### 4.3. AI Integration (OpenAI)

*   **Abstraction:** Implement a dedicated `AIService` wrapper to standardize calls, manage API keys, and handle OpenAI-specific errors.
*   **Prompt Engineering:** Develop and version specific prompts for data enrichment, ad copy generation, and campaign strategy recommendations.
*   **Caching:** Implement caching for AI responses where appropriate to reduce latency and cost.

### 4.4. Error Handling & Compensation

*   **State Machine:** Each state transition in `SetupRun` is atomic. If a step fails, the state machine records the error and transitions to `SETUP_FAILED`.
*   **Compensation:** For critical operations (e.g., campaign creation), implement compensation logic. If a subsequent step fails after campaign creation, trigger a compensation action (e.g., pause the created campaign) via a background job.
*   **Idempotency:** Ensure critical API calls (e.g., tag creation, campaign creation) are idempotent by using stable idempotency keys, storing external resource IDs, and checking for existing resources before creation.
*   **Auditability:** Record every external provider operation in `IntegrationEvents` with sanitized errors, correlation IDs, and compensation status.

## 5. Infrastructure & Deployment

*   **Deployment Target:** Cloud Provider (e.g., AWS, GCP, Azure).
*   **Containerization:** Docker for all microservices.
*   **Orchestration:** Kubernetes (e.g., EKS, GKE, AKS) for managing containerized applications.
*   **CI/CD:** Jenkins, GitLab CI, GitHub Actions for automated builds, testing, and deployments.
*   **Observability Stack:** Prometheus/Grafana for metrics, Elasticsearch/Logstash/Kibana (ELK) for logging, Jaeger/Tempo for distributed tracing.
*   **Job Queue:** RabbitMQ or Redis Queue for asynchronous task processing.

## 6. Security Implementation Details

*   **Secrets Management:** Integrate with a secure secrets manager (e.g., AWS Secrets Manager, Google Secret Manager, HashiCorp Vault).
*   **Token Encryption:** Use AES-256 or equivalent for encrypting Google OAuth refresh tokens at rest.
*   **API Gateway:** Use an API Gateway (e.g., AWS API Gateway) for request routing, authentication, and rate limiting at the edge.
*   **Input Sanitization:** Implement thorough input validation and sanitization on all user-provided data and API request bodies, **including strict schema validation for Google Ads API parameters.**
*   **Least Privilege:** Services should only have the permissions necessary to perform their functions.

## 7. Testing Plan

*   **Unit Tests:** Jest/Mocha for Node.js services, **with dedicated tests for Google Ads API parameter validation logic.**
*   **Integration Tests:** Verifying interactions between microservices and external APIs (using mocks where appropriate for external services).
*   **E2E Tests:** Cypress/Playwright to simulate user flows.
*   **Contract Testing:** Ensuring compatibility between service APIs.
*   **Load Testing:** k6/JMeter to simulate high concurrency.

## 8. Open Questions & Next Steps

*   Finalize choice of cloud provider and specific managed services (e.g., job queue, secrets manager).
*   Detailed schema design for all MongoDB collections.
*   Detailed implementation of compensation logic for each critical workflow step.
*   Refine AI prompts and explore model selection for cost/performance trade-offs.
*   Develop a comprehensive testing suite, starting with core workflows.
*   Establish detailed monitoring and alerting configurations.