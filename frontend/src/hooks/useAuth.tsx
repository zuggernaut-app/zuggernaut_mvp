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
import type { UserDto } from '../types/api'
import { clearStoredUserId, resetLocalSession, setStoredUserId } from '../utils/storage'

export type AuthContextValue = {
  user: UserDto | null
  loading: boolean
  register: (body: RegisterBody) => Promise<UserDto>
  login: (email: string, password: string) => Promise<UserDto>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [user, setUser] = useState<UserDto | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshSession = useCallback(async () => {
    try {
      const res = await authMe()
      setUser(res.user)
      setStoredUserId(res.user.id)
    } catch {
      setUser(null)
      clearStoredUserId()
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await refreshSession()
      setLoading(false)
    })()
  }, [refreshSession])

  const register = useCallback(async (body: RegisterBody) => {
    const res = await authRegister(body)
    setUser(res.user)
    setStoredUserId(res.user.id)
    return res.user
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await authLogin({ email, password })
    setUser(res.user)
    setStoredUserId(res.user.id)
    return res.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await authLogout()
    } finally {
      setUser(null)
      resetLocalSession()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, register, login, logout }),
    [user, loading, register, login, logout]
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
