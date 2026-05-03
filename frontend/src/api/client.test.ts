import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as storage from '../utils/storage'
import { apiRequest } from './client'

describe('apiRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns parsed JSON on 200', async () => {
    vi.spyOn(storage, 'getStoredUserId').mockReturnValue(null)
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
      expect.any(Object),
    )
  })

  it('adds x-dev-user-id when user is stored and skipAuth is false', async () => {
    vi.spyOn(storage, 'getStoredUserId').mockReturnValue('507f1f77bcf86cd799439011')
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }))

    await apiRequest('/users/me')

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const headers = init?.headers as Headers
    expect(headers.get('x-dev-user-id')).toBe('507f1f77bcf86cd799439011')
  })

  it('does not add dev header when skipAuth', async () => {
    vi.spyOn(storage, 'getStoredUserId').mockReturnValue('507f1f77bcf86cd799439011')
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }))

    await apiRequest('/users', { method: 'POST', body: {}, skipAuth: true })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const headers = init?.headers as Headers
    expect(headers.get('x-dev-user-id')).toBeNull()
  })

  it('serializes JSON body and sets Content-Type', async () => {
    vi.spyOn(storage, 'getStoredUserId').mockReturnValue(null)
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }))

    await apiRequest('/x', { method: 'POST', body: { a: 1 } })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const headers = init?.headers as Headers
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(init?.body).toBe(JSON.stringify({ a: 1 }))
  })

  it('throws ApiError on network failure', async () => {
    vi.spyOn(storage, 'getStoredUserId').mockReturnValue(null)
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(apiRequest('/x')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'network_error',
      status: 503,
    })
  })

  it('throws ApiError with server payload on non-OK response', async () => {
    vi.spyOn(storage, 'getStoredUserId').mockReturnValue(null)
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
