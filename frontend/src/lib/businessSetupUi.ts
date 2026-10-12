import type { IntegrationConnectionStatusDto } from '../api/integrations'
import type { BusinessContextDto } from '../types/api'
import type { LeadCampaignSlotState } from '../api/leadCampaigns'

export function readPrimaryGoal(goals: unknown): 'forms' | 'calls' | 'both' {
  if (!goals || typeof goals !== 'object') return 'forms'
  const primary = (goals as { primary?: string }).primary
  if (primary === 'calls' || primary === 'both' || primary === 'forms') return primary
  return 'forms'
}

export function step1PendingItems(
  connections: Record<string, IntegrationConnectionStatusDto | null | undefined>,
): string[] {
  const pending: string[] = []
  const ads = connections.google_ads
  const gtm = connections.gtm
  if (!ads?.ready) pending.push('Connect Google Ads')
  if (!gtm?.ready) pending.push('Connect Google Tag Manager')
  return pending
}

export function isStep2Complete(ctx: BusinessContextDto | null | undefined): boolean {
  return Boolean(ctx?.factCheckCompletedAt)
}

export function isStep3ObjectiveComplete(ctx: BusinessContextDto | null | undefined): boolean {
  if (!ctx) return false
  return Boolean(
    ctx.uvp?.trim() &&
      ctx.businessScope &&
      ctx.valueComplexity &&
      ctx.budgetTier,
  )
}

export function bothDraftsApproved(
  slots: {
    recommended: LeadCampaignSlotState | null
    alternative: LeadCampaignSlotState | null
  },
): boolean {
  const rec = slots.recommended
  const alt = slots.alternative
  if (!rec || !alt) return false
  return rec.reviewStatus === 'approved' && alt.reviewStatus === 'approved'
}

export function trackingGoalLabel(status: string | undefined): string {
  if (status === 'pass') return 'Works'
  if (status === 'no_conversion_action') return 'No conversion action found'
  return 'Not fired yet'
}

export function allTrackingGoalsPass(
  goals: Record<string, string> | undefined,
  primary: 'forms' | 'calls' | 'both',
): boolean {
  const required: string[] = []
  if (primary === 'forms' || primary === 'both') required.push('forms')
  if (primary === 'calls' || primary === 'both') required.push('calls')
  if (required.length === 0) return true
  if (!goals) return false
  return required.every((g) => goals[g] === 'pass')
}
