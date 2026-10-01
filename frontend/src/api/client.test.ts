import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiRequest, clearCsrfToken, ensureCsrfCookie } from './client'

describe('apiRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearCsrfToken()
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns parsed JSON on 200', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, n: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const data = await apiRequest<{ ok: boolean; n: number }>('/health')
    expect(data).toEqual({ ok: true, n: 1 })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/health$/),
      expect.objectContaining({
        credentials: 'include',
      }),
    )
  })

  it('calls fetch with credentials include (cookie session)', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }))

    await apiRequest('/auth/me')

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const headers = init?.headers as Headers
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('x-dev-user-id')).toBeNull()
    expect(init).toMatchObject({
      credentials: 'include',
    })
  })

  it('omit skipAuth marker from Fetch init payload', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }))

    await apiRequest('/auth/login', {
      method: 'POST',
      body: {},
      skipAuth: true,
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init).not.toHaveProperty('skipAuth')
  })

  it('serializes JSON body and sets Content-Type', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }))

    await apiRequest('/x', { method: 'POST', body: { a: 1 } })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const headers = init?.headers as Headers
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(init?.body).toBe(JSON.stringify({ a: 1 }))
  })

  it('throws ApiError on network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(apiRequest('/x')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'network_error',
      status: 503,
    })
  })

  it('stores CSRF token from /auth/csrf and sends it on mutating requests', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ csrfToken: 'csrf-from-json' }), { status: 200 }),
    )
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await ensureCsrfCookie(true)
    await apiRequest('/onboarding/business', { method: 'POST', body: {} })

    const [, init] = vi.mocked(fetch).mock.calls[1]
    const headers = init?.headers as Headers
    expect(headers.get('X-CSRF-Token')).toBe('csrf-from-json')
  })

  it('throws ApiError with server payload on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'validation_error', message: 'Bad email' }), {
        status: 400,
      }),
    )

    await expect(apiRequest('/users')).rejects.toMatchObject({
      status: 400,
      code: 'validation_error',
      message: 'Bad email',
    })
  })
})
