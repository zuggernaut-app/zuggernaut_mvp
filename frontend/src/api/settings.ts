import { apiRequest } from './client'

export type SoftLaunchSettingsResponse = {
  softLaunchMode: boolean
}

export async function fetchSoftLaunchSettings(): Promise<SoftLaunchSettingsResponse> {
  return apiRequest<SoftLaunchSettingsResponse>('/settings/soft-launch')
}
