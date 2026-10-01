import type { UserDto } from '../types/api'
import { apiRequest } from './client'

export interface LoginBody {
  email: string
  password: string
}

export interface RegisterBody extends LoginBody {
  name?: string
  phone: string
  websiteUrl?: string
}

export type AuthSessionResponse = { user: UserDto }

export async function authRegister(body: RegisterBody): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>('/auth/register', {
    method: 'POST',
    body,
    skipAuth: true,
  })
}

export async function authLogin(body: LoginBody): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>('/auth/login', {
    method: 'POST',
    body,
    skipAuth: true,
  })
}

export async function authLogout(): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/auth/logout', {
    method: 'POST',
    body: {},
    skipAuth: true,
  })
}

export async function authMe(): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>('/auth/me')
}

export type PasswordResetMessageResponse = { ok: boolean; message: string }

export async function authPasswordResetRequest(body: { email: string }): Promise<PasswordResetMessageResponse> {
  return apiRequest<PasswordResetMessageResponse>('/auth/password-reset/request', {
    method: 'POST',
    body,
    skipAuth: true,
  })
}

export async function authPasswordResetConfirm(body: {
  email: string
  token: string
  password: string
}): Promise<PasswordResetMessageResponse> {
  return apiRequest<PasswordResetMessageResponse>('/auth/password-reset/confirm', {
    method: 'POST',
    body,
    skipAuth: true,
  })
}
