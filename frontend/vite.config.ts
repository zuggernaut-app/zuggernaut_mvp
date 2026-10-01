/// <reference types="vitest/config" />

import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/

/** Dev proxy target; Playwright sets E2E_API_PROXY_TARGET so E2E always hits the API it started. */
const apiProxyTarget =
  process.env.E2E_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:3000'

const repoRoot = path.resolve(__dirname, '..')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.test.{ts,tsx}', 'src/test/**'],
      thresholds: {
        statements: 82,
        branches: 72,
        functions: 70,
        lines: 85,
      },
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
    // SPA calls same-origin /api/v1 → proxied → Express so the browser avoids CORS in dev.
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
})
