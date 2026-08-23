import { apiRequest } from './client'

export type BillingSubscriptionDto = {
  status: string
  currentPeriodEnd?: string
  cancelAtPeriodEnd: boolean
  plan: { tier: string; name: string } | null
}

export type BillingStatusResponse = {
  subscription: BillingSubscriptionDto | null
}

export type CheckoutResponse = {
  checkoutUrl: string
  sessionId: string
}

export type PortalResponse = {
  portalUrl: string
}

export async function billingStatus(): Promise<BillingStatusResponse> {
  return apiRequest<BillingStatusResponse>('/billing/status')
}

export async function billingCheckout(tier = 'starter'): Promise<CheckoutResponse> {
  return apiRequest<CheckoutResponse>('/billing/checkout', {
    method: 'POST',
    body: { tier },
  })
}

export async function billingPortal(): Promise<PortalResponse> {
  return apiRequest<PortalResponse>('/billing/portal', {
    method: 'POST',
    body: {},
  })
}
