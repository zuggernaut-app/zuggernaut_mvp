import type { ApiErrorBody } from '../types/api'

const DEFAULT_BASE = '/api/v1'

/**
 * Prefer same-origin `/api/v1` in dev so Vite's `server.proxy` forwards to Express — avoids CORS.
 * If `.env` points at http://localhost:PORT (common misconfiguration), ignore in DEV and use the proxy.
 */
function resolveApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim()
  if (!raw) return DEFAULT_BASE
  const normalized = raw.replace(/\/+$/, '')
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const u = new URL(normalized)
      if (
        import.meta.env.DEV &&
        (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
      ) {
        console.warn(
          '[api] Dev: ignoring VITE_API_BASE_URL pointing at localhost. Using `/api/v1` via Vite proxy (see vite.config.ts). Remove VITE_API_BASE_URL from frontend/.env* for local UI→API routing.'
        )
        return DEFAULT_BASE
      }
    } catch {
      /* use raw below */
    }
    return normalized
  }
  return normalized
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly body?: ApiErrorBody

  constructor(status: number, message: string, code: string, body?: ApiErrorBody) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

function joinBaseAndPath(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

/** `skipAuth`: documents calls that omit cookies on purpose (`/auth/register`, `/auth/login`). */
export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  skipAuth?: boolean
}

const CSRF_COOKIE_NAME = 'zugg_csrf'
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** In-memory CSRF token for cross-origin prod (Firebase SPA + Railway API). */
let csrfTokenMemory: string | null = null

let onUnauthorized: (() => void) | null = null

export function setOnUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null
  const escaped = CSRF_COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : null
}

function getCsrfToken(): string | null {
  return csrfTokenMemory ?? readCsrfCookie()
}

export function clearCsrfToken(): void {
  csrfTokenMemory = null
}

/**
 * Bootstrap CSRF double-submit token before authenticated mutating API calls.
 * `force` refetches after login/register when the API issues a new cookie token.
 */
export async function ensureCsrfCookie(force = false): Promise<void> {
  if (!force && getCsrfToken()) return
  const res = await apiRequest<{ csrfToken: string }>('/auth/csrf')
  if (typeof res.csrfToken === 'string' && res.csrfToken.length > 0) {
    csrfTokenMemory = res.csrfToken
  }
}

async function parseJsonSafely(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { error: 'parse_error', message: text.slice(0, 200) }
  }
}

/**
 * Typed fetch wrapper: authenticated session passes via cookies (`credentials: 'include'`).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body: rawBody, skipAuth: _, ...fetchInit } = options
  void _

  const base = resolveApiBaseUrl()
  const url = joinBaseAndPath(base, path)

  const headers = new Headers(fetchInit.headers)

  const method = (fetchInit.method ?? 'GET').toUpperCase()
  if (MUTATING_METHODS.has(method)) {
    const csrf = getCsrfToken()
    if (csrf) {
      headers.set('X-CSRF-Token', csrf)
    }
  }

  let body: BodyInit | undefined = rawBody as BodyInit | undefined
  if (rawBody !== undefined && !(rawBody instanceof FormData)) {
    if (typeof rawBody === 'object' && rawBody !== null) {
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      body = JSON.stringify(rawBody)
    }
  }

  let res: Response
  try {
    res = await fetch(url, {
      ...fetchInit,
      credentials: 'include',
      headers,
      body,
    })
  } catch (e) {
    const fallback =
      import.meta.env.DEV
        ? 'Cannot reach the API. Start the backend (e.g. `npm start` in `backend/` on port 3000) so Vite can proxy `/api` to Express.'
        : 'Network error while calling the API.'
    const message = e instanceof Error && e.message ? `${fallback} (${e.message})` : fallback
    throw new ApiError(503, message, 'network_error')
  }

  const data = (await parseJsonSafely(res)) as Record<string, unknown> | null

  if (!res.ok) {
    const errPayload = data as unknown as ApiErrorBody | undefined
    let msg =
      (errPayload && typeof errPayload.message === 'string' && errPayload.message) ||
      res.statusText ||
      'Request failed'
    const code =
      (errPayload && typeof errPayload.error === 'string' && errPayload.error) ||
      `http_${res.status}`

    const looksLikeProxyOrDown =
      [502, 503, 504].includes(res.status) ||
      (res.status === 500 &&
        import.meta.env.DEV &&
        (!errPayload ||
          errPayload.message === 'Internal Server Error' ||
          typeof errPayload.message !== 'string'))
    const looksLikeExpressUnmatchedRoute =
      res.status === 404 &&
      typeof msg === 'string' &&
      /Cannot (?:GET|POST|PUT|PATCH|DELETE) /i.test(msg)
    if (looksLikeProxyOrDown && import.meta.env.DEV) {
      msg =
        'API server unreachable or proxy error (start Express on port 3000 — see vite.config.ts `server.proxy`).'
    } else if (looksLikeExpressUnmatchedRoute && import.meta.env.DEV) {
      msg =
        'API route not found on the running backend. Restart Express (`npm start` in `backend/`) so new routes load, then retry.'
    }

    if (res.status === 401) {
      onUnauthorized?.()
    }

    throw new ApiError(res.status, msg, code, errPayload)
  }

  return data as T
}
