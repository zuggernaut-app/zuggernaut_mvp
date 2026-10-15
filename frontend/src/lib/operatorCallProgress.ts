import type { OperatorCallContext } from '../api/adminOperatorCall'

export const CALL_STEPS = [
  'account_settings',
  'business_answers',
  'website',
  'goal_choice',
  'permission',
  'snippet',
  'close',
] as const

export type CallStep = (typeof CALL_STEPS)[number]

export type OperatorPhase = 'before' | 'call' | 'after' | 'success'

type Wf = {
  stepSavedAt?: Record<string, string>
  snippetPending?: boolean
  call?: {
    snippetBranch?: string
    snippetInstalledAt?: string | null
    noFormAd?: boolean
    websiteChangedOnCall?: boolean
    liveCheckResult?: string
    noWebsite?: boolean
  }
  afterCall?: { noFormAd?: boolean }
}

function wfOf(ctx: OperatorCallContext): Wf {
  return (ctx.operatorCallWorkflow ?? {}) as Wf
}

export function stepSaved(ctx: OperatorCallContext, key: string): boolean {
  return Boolean(wfOf(ctx).stepSavedAt?.[key])
}

export function formatOperatorStatus(status: string): string {
  return status.replace(/_/g, ' ')
}

export function isSnippetStepSaved(ctx: OperatorCallContext): boolean {
  const wf = wfOf(ctx)
  if (wf.snippetPending) return false
  const branch = wf.call?.snippetBranch
  if (branch === 'pending') return false

  if (!hasWebsiteOnRecord(ctx)) {
    return branch === 'not_applicable' && stepSaved(ctx, 'call_snippet_new')
  }

  const check = liveCheckResult(ctx)
  if (!check) return false

  if (check === 'existing_gtm') {
    return (
      branch === 'existing_gtm' &&
      stepSaved(ctx, 'call_snippet_existing_gtm') &&
      Boolean(wf.call?.snippetInstalledAt)
    )
  }
  if (check === 'no_google_tag') {
    return (
      branch === 'new_container' &&
      stepSaved(ctx, 'call_snippet_new') &&
      Boolean(wf.call?.snippetInstalledAt)
    )
  }
  if (check === 'hard_coded_no_gtm') {
    return branch === 'pasted_code' && stepSaved(ctx, 'call_snippet_pasted')
  }
  return false
}

export function isCallStepSaved(ctx: OperatorCallContext, step: CallStep): boolean {
  if (step === 'snippet') return isSnippetStepSaved(ctx)
  const keys: Record<Exclude<CallStep, 'snippet'>, string> = {
    account_settings: 'call_account_settings',
    business_answers: 'call_business_answers',
    website: 'call_website',
    goal_choice: 'call_goal_choice',
    permission: 'call_permission',
    close: 'call_close',
  }
  return stepSaved(ctx, keys[step])
}

export function firstUnsavedCallStep(ctx: OperatorCallContext): CallStep {
  for (const step of CALL_STEPS) {
    if (!isCallStepSaved(ctx, step)) return step
  }
  return 'close'
}

export function allCallStepsSaved(ctx: OperatorCallContext): boolean {
  return CALL_STEPS.every((step) => isCallStepSaved(ctx, step))
}

function goalPrimary(ctx: OperatorCallContext): string {
  return String(ctx.goals?.primary ?? '').toLowerCase()
}

export function formAdInPlay(ctx: OperatorCallContext): boolean {
  const wf = wfOf(ctx)
  if (wf.call?.noFormAd === true || wf.afterCall?.noFormAd === true) return false
  const primary = goalPrimary(ctx)
  return primary === 'forms' || primary === 'both'
}

export function needsAfterPageSource(ctx: OperatorCallContext): boolean {
  const wf = wfOf(ctx)
  return (
    wf.call?.websiteChangedOnCall === true &&
    Boolean(ctx.websiteUrl?.trim()) &&
    wf.call?.noWebsite !== true
  )
}

export function needsAfterFormFlow(ctx: OperatorCallContext): boolean {
  return formAdInPlay(ctx)
}

export function isAfterWorkComplete(ctx: OperatorCallContext): boolean {
  if (needsAfterPageSource(ctx) && !stepSaved(ctx, 'after_page_source')) return false
  if (!needsAfterFormFlow(ctx)) return true
  if (!stepSaved(ctx, 'after_form_result')) return false
  if (!stepSaved(ctx, 'after_test_lead_passed')) return false
  return true
}

export function allRequiredStepsSaved(ctx: OperatorCallContext): boolean {
  if (!stepSaved(ctx, 'start_call')) return false
  if (!allCallStepsSaved(ctx)) return false
  return isAfterWorkComplete(ctx)
}

export function deriveInitialPhase(ctx: OperatorCallContext): OperatorPhase {
  if (allRequiredStepsSaved(ctx)) return 'success'
  if (!stepSaved(ctx, 'start_call')) return 'before'
  if (!allCallStepsSaved(ctx)) return 'call'
  return 'after'
}

const TERMINAL_SCRAPE = new Set(['SUCCEEDED', 'PARTIAL', 'BLOCKED', 'FAILED'])

export function signupScrapeMessage(ctx: OperatorCallContext): string | null {
  const hasWebsite = Boolean(ctx.websiteUrl?.trim())
  if (!hasWebsite) return null
  const scrape = ctx.signupScrape
  if (scrape.fetched) return null
  if (!scrape.status) return 'Nothing was fetched.'
  const businessUrl = (ctx.websiteUrl ?? '').trim()
  const scrapeUrl = (scrape.websiteUrl ?? '').trim()
  if (scrapeUrl && businessUrl && scrapeUrl !== businessUrl) {
    return 'The fetch is for a different address.'
  }
  if (!TERMINAL_SCRAPE.has(String(scrape.status))) {
    return 'The fetch did not complete.'
  }
  return 'The fetch did not complete.'
}

export type LiveCheckResult = 'existing_gtm' | 'no_google_tag' | 'hard_coded_no_gtm'

export function liveCheckResult(ctx: OperatorCallContext): LiveCheckResult | null {
  const raw = wfOf(ctx).call?.liveCheckResult
  if (raw === 'existing_gtm' || raw === 'no_google_tag' || raw === 'hard_coded_no_gtm') {
    return raw
  }
  return null
}

export function hasWebsiteOnRecord(ctx: OperatorCallContext): boolean {
  const wf = wfOf(ctx)
  if (wf.call?.noWebsite === true) return false
  return Boolean(ctx.websiteUrl?.trim())
}
