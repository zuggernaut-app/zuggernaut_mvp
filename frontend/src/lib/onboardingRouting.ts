import type { BusinessContextDto } from '../types/api'

/** Legacy `confirmedAt` counts as questions complete for returning users. */
export function isQuestionsComplete(ctx: BusinessContextDto | null | undefined): boolean {
  return Boolean(ctx?.questionsCompletedAt || ctx?.confirmedAt)
}

export function isAccountLinksComplete(ctx: BusinessContextDto | null | undefined): boolean {
  return Boolean(ctx?.accountLinksCompletedAt)
}

/**
 * Next onboarding step for a signed-in user with an active business context.
 * Returns null when onboarding is finished (home shows thank-you or dashboard).
 */
export function resolveOnboardingPath(ctx: BusinessContextDto | null | undefined): string | null {
  if (!ctx) return null
  if (isQuestionsComplete(ctx)) return null
  if (isAccountLinksComplete(ctx)) return '/onboarding/business'
  return '/onboarding/accounts'
}
