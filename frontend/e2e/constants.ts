/**
 * Playwright onboarding tests expect a reachable API at this origin.
 * `frontend/playwright.config.ts` starts Express on port {@link E2E_BACKEND_PORT} with in-memory
 * MongoDB (`backend/scripts/start-e2e-api.js`) unless you override the env vars.
 *
 * **`E2E_FULL_ONBOARDING`:** set to `1` for `onboarding-full.e2e.ts`; you need Temporal and
 * `npm run temporal:worker` (see `npm run test:e2e:full`).
 *
 * Override API origin only when you start Express yourself:
 * `E2E_API_ORIGIN=http://127.0.0.1:3000 npm run test:e2e`
 */
const portRaw = process.env.E2E_BACKEND_PORT ?? '3999'
export const E2E_BACKEND_PORT = Number.parseInt(portRaw, 10)
export const E2E_API_ORIGIN =
  process.env.E2E_API_ORIGIN ?? `http://127.0.0.1:${E2E_BACKEND_PORT}`
