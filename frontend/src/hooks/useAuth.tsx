import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { RegisterBody } from '../api/auth'
import { authLogin, authLogout, authMe, authRegister } from '../api/auth'
import { clearCsrfToken, ensureCsrfCookie, setOnUnauthorizedHandler } from '../api/client'
import { useNavigate } from 'react-router-dom'
import type { UserDto } from '../types/api'
import {
  clearOnboardingDrafts,
  clearStoredUserId,
  getStoredBusinessId,
  getStoredUserId,
  resetLocalSession,
  setStoredUserId,
} from '../utils/storage'
import { notifyOnboardingStorageChanged } from './useOnboardingState'

export type AuthContextValue = {
  user: UserDto | null
  loading: boolean
  sessionExpiredRedirect: boolean
  register: (body: RegisterBody) => Promise<UserDto>
  login: (email: string, password: string) => Promise<UserDto>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function reconcileOnboardingDraftsForSession(nextUserId: string): void {
  const prevId = getStoredUserId()
  if (prevId !== null && prevId !== nextUserId) {
    clearOnboardingDrafts()
    notifyOnboardingStorageChanged()
    return
  }
  if (prevId === null && getStoredBusinessId() !== null) {
    clearOnboardingDrafts()
    notifyOnboardingStorageChanged()
  }
}

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const navigate = useNavigate()
  const [user, setUser] = useState<UserDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionExpiredRedirect, setSessionExpiredRedirect] = useState(false)

  const refreshSession = useCallback(async () => {
    const hadStoredSession = getStoredUserId() !== null
    try {
      const res = await authMe()
      reconcileOnboardingDraftsForSession(res.user.id)
      setUser(res.user)
      setStoredUserId(res.user.id)
      setSessionExpiredRedirect(false)
    } catch {
      setUser(null)
      if (hadStoredSession) {
        setSessionExpiredRedirect(true)
      }
      clearStoredUserId()
      clearOnboardingDrafts()
      notifyOnboardingStorageChanged()
    }
  }, [])

  useEffect(() => {
    setOnUnauthorizedHandler(() => {
      if (window.location.pathname === '/login') return
      const from = `${window.location.pathname}${window.location.search}`
      setUser(null)
      setSessionExpiredRedirect(true)
      clearCsrfToken()
      clearStoredUserId()
      clearOnboardingDrafts()
      notifyOnboardingStorageChanged()
      navigate('/login', { replace: true, state: { from, sessionExpired: true } })
    })
    return () => setOnUnauthorizedHandler(null)
  }, [navigate])

  useEffect(() => {
    void (async () => {
      await ensureCsrfCookie().catch(() => undefined)
      await refreshSession()
      setLoading(false)
    })()
  }, [refreshSession])

  const register = useCallback(async (body: RegisterBody) => {
    const res = await authRegister(body)
    await ensureCsrfCookie(true)
    reconcileOnboardingDraftsForSession(res.user.id)
    setUser(res.user)
    setStoredUserId(res.user.id)
    setSessionExpiredRedirect(false)
    return res.user
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await authLogin({ email, password })
    await ensureCsrfCookie(true)
    reconcileOnboardingDraftsForSession(res.user.id)
    setUser(res.user)
    setStoredUserId(res.user.id)
    setSessionExpiredRedirect(false)
    return res.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await authLogout()
    } finally {
      setUser(null)
      setSessionExpiredRedirect(false)
      resetLocalSession()
      clearCsrfToken()
      notifyOnboardingStorageChanged()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, sessionExpiredRedirect, register, login, logout }),
    [user, loading, sessionExpiredRedirect, register, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Non-component hook lives alongside Provider for cohesion; isolate if react-refresh requirements change.
// eslint-disable-next-line react-refresh/only-export-components -- consumer hook intentionally colocated with provider
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
