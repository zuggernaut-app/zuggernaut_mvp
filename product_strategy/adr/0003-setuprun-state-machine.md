# ADR 0003: SetupRun State Machine for Orchestration

## 1. Title

SetupRun State Machine for Orchestration

## 2. Status

Accepted

## 3. Context

The Zuggernaut platform automates a multi-step process for setting up digital marketing tools (GBP, GTM, Google Ads). This process involves sequential API interactions, user input, and potential asynchronous operations. Managing the state of this process reliably, handling errors, enabling retries, and providing clear status updates to the user requires a robust orchestration mechanism.

## 4. Decision

We will implement a **`SetupRun` state machine** to orchestrate the end-to-end user setup workflow. Each user's setup process will be represented by a `SetupRun` document (likely stored in MongoDB), which tracks the current state, workflow history, and any associated errors or details. The Orchestration Service will be responsible for managing transitions between states.

## 5. Rationale

*   **Reliability & Error Handling:** A state machine provides a structured way to manage complex workflows. It allows for explicit definition of states, transitions, and error handling logic. If a step fails, the machine can transition to an error state, allowing for retries or compensation actions without corrupting the overall process.
*   **Clarity & Maintainability:** Explicitly defining states and transitions makes the workflow logic clear and easier to understand, maintain, and extend. New steps can be added as new states or transitions.
*   **User Feedback:** The current state of the `SetupRun` can be easily queried and exposed to the frontend, enabling real-time status updates for the user (e.g., "Auditing GBP...", "Setting up GTM tags...").
*   **Auditability:** The `SetupRun` document can store a history of state transitions, providing a valuable audit trail of what steps were completed, when, and any associated errors.
*   **Idempotency & Compensation:** The state machine can facilitate idempotency by checking the current state before executing an action. It can also trigger compensation logic if a later step fails after an earlier, irreversible action has been performed (e.g., if GTM tag creation succeeds but campaign creation fails, compensation might involve removing or deactivating the created GTM tags to leave the container clean).
*   **Scalability:** By decoupling the state management from the individual service implementations, the Orchestration Service can scale independently, potentially managing many concurrent `SetupRun` instances.

## 6. Consequences

*   **Positive:**
    *   Improved reliability and robustness of the setup process.
    *   Clearer error handling and retry capabilities.
    *   Enhanced user experience through real-time status updates.
    *   Better auditability and debugging capabilities.
    *   Foundation for adding more complex workflows and compensation logic.
*   **Negative:**
    *   Requires initial investment in designing and implementing the state machine logic and data model.
    *   Adds a layer of abstraction that needs to be understood by developers.

## 7. Alternatives Considered

*   **Sequential Function Calls:** Simple function calls in a linear script. Rejected because it lacks inherent state management, error handling, retry, and compensation capabilities, making it brittle for complex, asynchronous operations.
*   **Simple Flag-Based System:** Using flags in a user document to track progress. Rejected as it quickly becomes complex to manage dependencies between steps and handle intricate error scenarios.
*   **External Workflow Engines (e.g., AWS Step Functions, Temporal):** While powerful, using an external engine adds infrastructure complexity and potentially vendor lock-in for V1. A custom state machine within our backend offers more control and reduces external dependencies initially.

## 8. Conclusion

Implementing a `SetupRun` state machine is the most effective approach for orchestrating the Zuggernaut setup workflow, providing the necessary structure for reliability, maintainability, and user feedback. This decision aligns with building an enterprise-grade, scalable system from the outset.

## Related ADRs

*   ADR 0001: GBP Audit - V1 Scope Decision
*   ADR 0002: Manual GTM Snippet Installation - V1 Manual Approach