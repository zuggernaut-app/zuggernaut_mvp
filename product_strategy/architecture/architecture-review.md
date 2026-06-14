# Architecture Review: Zuggernaut

## 1. Executive Summary

This document details the proposed architecture for Zuggernaut, an AI-powered digital marketing automation platform designed for small businesses (SMBs). The architecture prioritizes scalability, maintainability, security, and robust operational capabilities to support a "0 to 1" marketing setup for SMBs, with a clear path for enterprise-grade expansion. It emphasizes automated workflows for Google Business Profile (GBP) audit, Google Tag Manager (GTM) conversion tracking setup, and Google Ads campaign creation, **with a strategic focus on explicitly defining the most impactful Google Ads API parameters.**

## 2. Guiding Principles

*   **Enterprise-Grade Foundation:** Build with best practices for scalability, reliability, and maintainability from day one.
*   **No Technical Debt:** Prioritize clean code, modular design, and well-defined interfaces.
*   **Scalability:** Design for high concurrency to handle a large number of simultaneous users and automated processes.
*   **Security First:** Implement robust security measures for API access, data storage, and tenant isolation.
*   **Observability:** Ensure comprehensive logging, monitoring, and tracing for operational insight.
*   **Testability:** Architect for thorough unit, integration, and end-to-end testing.
*   **Iterative Development:** Support phased rollout and continuous improvement based on feedback and data.

## 3. V1 Product Scope & Goals

*   **Target User:** Small businesses seeking to automate initial digital marketing setup.
*   **Core Offerings:**
    *   GBP Audit (Read-Only):
        *   Fetch and audit existing GBP information against best practices.
    *   GTM Conversion Tracking Setup:
        *   Automate creation of Google Ads conversion tags and basic triggers.
        *   Requires manual GTM snippet installation by the user.
    *   Google Ads Campaign Creation:
        *   Automated initial campaign setup (structure, keywords, ad copy) based on business input.
        *   **Campaign creation will strictly enforce a prioritized set of Google Ads API parameters (Core Campaign Definition & Strategy, Ad Group Structure & Ad Creative, Core Targeting & Conversion Goal Linking) to ensure strategic alignment and API compliance.**
        *   Campaign launch is gated by required GTM setup and structural verification checks.
*   **User Experience:**
    *   Section 1: User Input (business details, goals, permissions, GTM IDs).
    *   Section 2: Automated Backend Processes (hidden from user).

## 4. Core Architecture Components

### 4.1. Frontend (User Interface)

*   **Technology:** React
*   **Responsibilities:**
    *   User input forms for business details, goals, and API permissions.
    *   Displaying GBP audit results and setup status.
    *   Providing instructions for manual GTM snippet installation.
*   **Key Features:** Responsive design, clear separation between user input and backend process visualization.

### 4.2. Backend (Orchestration & Services)

*   **Technology:** Node.js (Express.js)
*   **Architecture Style:** Microservices / Capability-based Services
*   **Core Services:**
    *   **Orchestration Service:** Manages the overall setup workflow using a state machine.
    *   **GBP Read-Only Audit Service:** Integrates with GBP API to fetch and analyze business profile data.
    *   **GTM Conversion Setup Service:** Integrates with GTM API to create conversion tags and triggers.
    *   **Google Ads Auto-Campaign Service:** Integrates with Google Ads API to create, configure, and launch campaigns, **with built-in logic for strict parameter validation and definition as per the prioritized list.**
    *   **Business Context Service:** Manages scraping, data enrichment (AI), and user-provided business information.
    *   **Authentication & Authorization Service:** Handles OAuth 2.0 flows for Google APIs, manages access tokens, and enforces tenant isolation.
    *   **Notification Service:** Communicates status updates and results to the frontend.

### 4.3. Data Management

*   **Primary Database:** MongoDB
    *   **Purpose:** Storing business context, user configurations, campaign data, API tokens, and state machine progress.
    *   **Key Considerations:** Schema design for efficient querying, indexing for performance.
*   **Configuration Store:** Centralized management of API keys, GTM IDs, Ads IDs, and other service parameters.

### 4.4. AI Integration

*   **Provider:** OpenAI API (GPT-3.5 Turbo / GPT-4)
*   **Usage:**
    *   Enriching scraped business data.
    *   Generating campaign strategies, keywords, and ad copy.
    *   Potentially assisting in GTM trigger logic discovery.

### 4.5. Third-Party Integrations (Google APIs)

*   **Google Business Profile API:** For read-only audit.
*   **Google Tag Manager API (v2):** For tag and trigger creation.
*   **Google Ads API:** For campaign management and data retrieval.
*   **Authentication:** OAuth 2.0 using Google's client libraries.

## 5. Workflow & State Management

*   **Process:** `SetupRun` State Machine
*   **Purpose:** Manages the end-to-end user setup process, ensuring reliable, sequential execution of tasks and enabling retries and error handling.
*   **Key States (Illustrative):**
    *   `AWAITING_USER_INPUT`
    *   `FETCHING_BUSINESS_CONTEXT`
    *   `AWAITING_PERMISSIONS`
    *   `AUDITING_GBP`
    *   `CONFIGURING_GTM`
    *   `VERIFYING_TRACKING_STRUCTURE`
    *   `CREATING_ADS_CAMPAIGN`
    *   `SETUP_COMPLETE`
    *   `SETUP_FAILED`
*   **Implementation:** Each state transition triggers actions within the relevant service and records external resource IDs, retry attempts, and failure reasons for auditability. **The `CREATING_ADS_CAMPAIGN` state specifically includes pre-validation for critical Google Ads API parameters.**

## 6. Scalability & Concurrency

*   **Microservices Architecture:** Enables independent scaling of individual services.
*   **Asynchronous Processing:** Use of background job queues (e.g., RabbitMQ, Redis Queue) for long-running tasks like API calls and AI processing.
*   **Stateless Services:** Where possible, services should be stateless to facilitate horizontal scaling.
*   **Database Scaling:** MongoDB's sharding capabilities can be leveraged as needed.
*   **Rate Limiting:** Robust internal and external (Google API) rate limiting mechanisms (e.g., token bucket, leaky bucket).

## 7. Security Considerations

*   **OAuth 2.0:** Secure handling of access and refresh tokens at rest (encrypted).
*   **API Key Management:** Secure storage and rotation of API credentials.
*   **Tenant Isolation:** Logical separation of customer data and processes using `businessId` and database partitioning/schemas.
*   **Data Encryption:** Encryption of sensitive user data at rest and in transit (TLS/SSL).
*   **Input Validation:** Rigorous validation of all user inputs and API payloads, **including strict schema validation for Google Ads API parameters.**
*   **Least Privilege:** Services should only have the permissions necessary to perform their functions.

## 8. Observability & Monitoring

*   **Structured Logging:** Consistent log format across all services (e.g., JSON) with relevant context (request IDs, `businessId`, state IDs).
*   **Metrics:** Key performance indicators (KPIs) for API usage, processing times, error rates, concurrency levels.
*   **Tracing:** Distributed tracing to track requests across multiple services.
*   **Alerting:** Proactive alerts for critical errors, performance degradations, or API quota issues.
*   **Dashboards:** Centralized dashboard (e.g., Grafana, Datadog) for visualizing metrics and logs.

## 9. Testing Strategy

*   **Unit Tests:** For individual functions, services, and state transitions, **including specific tests for Google Ads API parameter validation.**
*   **Integration Tests:** Verifying interactions between microservices and external APIs (using mocks where appropriate for external services).
*   **End-to-End (E2E) Tests:** Simulating the complete user journey through the frontend and backend.
*   **Contract Testing:** Ensuring compatibility between service APIs.
*   **Performance Testing:** Load testing to validate scalability and identify bottlenecks.

## 10. API Versioning & Management

*   **Internal APIs:** Versioning of microservice APIs to allow for independent deployment and evolution.
*   **External APIs:** Tracking and adapting to changes in Google's API versions.
*   **Configuration Management:** Versioned configurations for services, GTM templates, and campaign structures.

## 11. Risks & Mitigation

| Risk | Impact | Likelihood | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| Google API changes/deprecation | High | Medium | Monitor API updates, implement versioned API clients, use contract testing, and keep GTM/Ads templates versioned in configuration. **Prioritize and validate key API parameters to reduce exposure to minor changes.** |
| Inaccurate scraped business data | Medium | Medium | Use AI enrichment, manual fallback, and an explicit user confirmation step before setup begins. |
| User struggles with manual GTM snippet install | Medium | High | Provide clear instructions, visual guides, status checks, a setup-pending state, and a support/manual review path. |
| Google API rate limits exceeded | High | Medium | Implement per-tenant and global rate limiting, circuit breakers, and retries with exponential backoff and jitter. |
| Inconsistent GTM trigger behavior | Medium | Medium | Use discoverable V1 trigger templates, structural verification gates, versioned trigger configs, and a manual review fallback. |
| AI output unpredictability/cost | Medium | Medium | Version prompts, validate generated outputs, cache repeatable outputs, monitor cost, and maintain deterministic template fallbacks. |
| Complex cross-service error handling | High | Medium | Use `SetupRun` state transitions, idempotency keys, correlation IDs, structured logs, and compensation jobs. |
| Scalability bottlenecks | High | Medium | Use async workers, queue backpressure, horizontal service scaling, database indexes/sharding plans, and load testing. |
| Token or secret leakage | Critical | Low | Encrypt tokens at rest, use a secrets manager, enforce least privilege, rotate secrets, and audit token access. |
| **Google Ads API `INVALID_ARGUMENT` errors due to under/over-specification of parameters** | High | Medium | **Implement strict parameter validation and enforcement for the most impactful fields (Core Campaign Definition & Strategy, Ad Group Structure & Ad Creative, Core Targeting & Conversion Goal Linking) based on Google Ads API documentation and best practices. Fail fast on missing/invalid critical parameters.** |

## 12. Questions for Solutions Architect

1.  **GTM Snippet Installation Automation:** What are the most reliable programmatic methods to detect and inject GTM snippets into various website CMS platforms (WordPress, Shopify, Wix, Squarespace) for V2? Are there existing libraries or reliable headless approaches?
2.  **Scalable Job Queueing:** Recommend a robust, scalable, and cost-effective managed job queueing system for handling potentially millions of asynchronous tasks across microservices (e.g., AWS SQS, Google Cloud Tasks, Azure Queue Storage, or a self-hosted solution like RabbitMQ).
3.  **Database Strategy for Multi-tenancy:** Given the need for strict tenant isolation and potential for large datasets per tenant, what are the recommended MongoDB configurations or strategies (e.g., per-tenant databases vs. sharded collections with tenant IDs)?
4.  **Secret Management:** Recommend a secure and scalable solution for managing API keys, OAuth tokens, and other secrets across microservices (e.g., AWS Secrets Manager, Google Secret Manager, HashiCorp Vault).
5.  **Observability Stack:** Suggest a comprehensive, integrated observability stack (logging, metrics, tracing) suitable for a microservices architecture, considering ease of setup and long-term management.
6.  **CI/CD Pipeline Design:** Outline a robust CI/CD pipeline strategy that supports microservices, automated testing (unit, integration, E2E), and safe deployments (blue/green, canary).
7.  **AI Model Cost Management:** Strategies for optimizing OpenAI API costs, including prompt engineering, caching, and selecting appropriate models (e.g., balancing GPT-4 power with GPT-3.5 cost).
8.  **GTM Trigger Discovery Reliability:** Beyond basic URL/click signals, what other client-side or server-side signals could be reliably used for GTM trigger discovery without direct website code modification by the user, and how can we robustly verify these signals?