import type { CreateUserResponse } from '../types/api'
import { apiRequest } from './client'

export function createUser(email: string, name?: string): Promise<CreateUserResponse> {
  return apiRequest<CreateUserResponse>('/users', {
    method: 'POST',
    body: { email, ...(name !== undefined ? { name } : {}) },
    skipAuth: true,
  })
}
