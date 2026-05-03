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
    if (looksLikeProxyOrDown && import.meta.env.DEV) {
      msg =
        'API server unreachable or proxy error (start Express on port 3000 — see vite.config.ts `server.proxy`).'
    }

    throw new ApiError(res.status, msg, code, errPayload)
  }

  return data as T
}
