import { apiRequest } from './client'

export type OrgMembershipDto = {
  id: string
  name: string
  role: 'owner' | 'admin' | 'member'
}

export async function listOrgs(): Promise<{ orgs: OrgMembershipDto[] }> {
  return apiRequest<{ orgs: OrgMembershipDto[] }>('/orgs')
}

export async function createOrg(name: string): Promise<{ org: { id: string; name: string } }> {
  return apiRequest<{ org: { id: string; name: string } }>('/orgs', {
    method: 'POST',
    body: { name },
  })
}

export async function sendOrgInvite(
  orgId: string,
  email: string,
  role: 'admin' | 'member',
): Promise<{ ok: boolean; message: string }> {
  return apiRequest<{ ok: boolean; message: string }>(`/orgs/${orgId}/invites`, {
    method: 'POST',
    body: { email, role },
  })
}

export async function acceptOrgInvite(
  token: string,
  email?: string,
): Promise<{ ok: boolean; orgId: string }> {
  return apiRequest<{ ok: boolean; orgId: string }>('/orgs/accept-invite', {
    method: 'POST',
    body: { token, ...(email ? { email } : {}) },
  })
}
