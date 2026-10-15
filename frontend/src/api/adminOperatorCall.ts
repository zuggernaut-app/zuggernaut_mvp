import { apiRequest } from './client'

export type OperatorListStatus =
  | 'signup_not_finished'
  | 'signup_complete'
  | 'snippet_pending'
  | 'needs_operator_follow_up'
  | 'awaiting_test_lead'
  | 'finished'

export type OperatorCallContext = {
  businessId: string
  userId: string
  customerEmail: string | null
  operatorListStatus: OperatorListStatus
  signupCompletedAt: string | null
  businessName: string | null
  businessCountry: string | null
  accountCurrencyCode: string | null
  accountTimeZone: string | null
  websiteUrl: string | null
  services: string[]
  serviceAreas: string[]
  whoBuysToday: string | null
  howBuyersContact: string | null
  orderValueHint: string | null
  goals: { primary?: string } | null
  managedAdsAccountConsentAt: string | null
  operatorCallWorkflow: Record<string, unknown>
  signupScrape: {
    fetched: boolean
    pages: Array<{
      url: string | null
      title: string | null
      textPreview: string | null
      homepageGtmPublicId: string | null
    }>
    fetchedAt: string | null
    homepageGtmPublicId: string | null
    status: string | null
    websiteUrl: string | null
  }
  callsAllowed: boolean
}

export async function adminGetOperatorCallContext(
  businessId: string,
): Promise<{ context: OperatorCallContext }> {
  return apiRequest<{ context: OperatorCallContext }>(
    `/admin/businesses/${businessId}/operator-call`,
  )
}

async function patchOperatorCall(
  businessId: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ context: OperatorCallContext }> {
  return apiRequest<{ context: OperatorCallContext }>(
    `/admin/businesses/${businessId}/operator-call/${path}`,
    { method: 'PATCH', body },
  )
}

export const adminOperatorCallApi = {
  startCall: (businessId: string) => patchOperatorCall(businessId, 'start-call', {}),
  callLiveCheck: (businessId: string, body: Record<string, unknown>) =>
    patchOperatorCall(businessId, 'call/live-check', body),
  beforePageSource: (businessId: string, body: Record<string, unknown>) =>
    patchOperatorCall(businessId, 'before-page-source', body),
  callAccountSettings: (businessId: string, body: Record<string, unknown>) =>
    patchOperatorCall(businessId, 'call/account-settings', body),
  callBusinessAnswers: (businessId: string, body: Record<string, unknown>) =>
    patchOperatorCall(businessId, 'call/business-answers', body),
  callWebsite: (businessId: string, body: Record<string, unknown>) =>
    patchOperatorCall(businessId, 'call/website', body),
  callGoalChoice: (businessId: string, body: Record<string, unknown>) =>
    patchOperatorCall(businessId, 'call/goal-choice', body),
  callPermission: (businessId: string, body: Record<string, unknown>) =>
    patchOperatorCall(businessId, 'call/permission', body),
  callSnippetNew: (businessId: string, body: Record<string, unknown>) =>
    patchOperatorCall(businessId, 'call/snippet-new', body),
  callSnippetExistingGtm: (businessId: string, body: Record<string, unknown>) =>
    patchOperatorCall(businessId, 'call/snippet-existing-gtm', body),
  callSnippetPasted: (businessId: string, body: Record<string, unknown>) =>
    patchOperatorCall(businessId, 'call/snippet-pasted', body),
  callClose: (businessId: string) => patchOperatorCall(businessId, 'call/close', {}),
  afterPageSource: (businessId: string, body: Record<string, unknown>) =>
    patchOperatorCall(businessId, 'after/page-source', body),
  afterFormResult: (businessId: string, body: Record<string, unknown>) =>
    patchOperatorCall(businessId, 'after/form-result', body),
  afterTestLeadPassed: (businessId: string) =>
    patchOperatorCall(businessId, 'after/test-lead-passed', {}),
  clearFollowUp: (businessId: string, note: string) =>
    patchOperatorCall(businessId, 'clear-follow-up', { note }),
}
