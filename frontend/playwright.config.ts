import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

import { E2E_API_ORIGIN, E2E_BACKEND_PORT } from './e2e/constants'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

/** Mirrors {@link ./e2e/constants.ts JWT length rule} — backend refuses shorter secrets outside NODE_ENV=test. */
const PLAYWRIGHT_JWT_SECRET = 'playwright-e2e-jwt-secret-at-least-thirty-two-chars-xx'
const PLAYWRIGHT_TOKEN_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  /**
   * Start this repo's API on :3999 plus Vite on :5173 so E2E never depends on a stale `node`
   * process still listening on :3000 from before auth routes existed.
   * Stop any local `npm run dev` on 5173 before running (strictPort).
   */
  webServer: [
    {
      command: 'npm run start:e2e',
      cwd: path.join(repoRoot, 'backend'),
      env: {
        ...process.env,
        PORT: String(E2E_BACKEND_PORT),
        JWT_SECRET: PLAYWRIGHT_JWT_SECRET,
        TOKEN_ENCRYPTION_KEY: PLAYWRIGHT_TOKEN_ENCRYPTION_KEY,
        TEMPORAL_E2E_MOCK: 'true',
        GOOGLE_OAUTH_MOCK: 'true',
        GTM_API_MOCK: 'true',
        GOOGLE_ADS_API_MOCK: 'true',
        GBP_API_MOCK: 'true',
        GOOGLE_CLIENT_ID: 'playwright-e2e-google-client-id',
        GOOGLE_CLIENT_SECRET: 'playwright-e2e-google-client-secret',
        FRONTEND_ORIGIN: 'http://127.0.0.1:5173',
      },
      url: `${E2E_API_ORIGIN}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      cwd: path.join(__dirname),
      env: {
        ...process.env,
        E2E_API_PROXY_TARGET: `${E2E_API_ORIGIN}`,
      },
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
