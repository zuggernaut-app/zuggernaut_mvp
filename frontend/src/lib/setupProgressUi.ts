import type { IntegrationConnectionStatusDto } from '../api/integrations'
import type { BusinessContextDto } from '../types/api'
import {
  allTrackingGoalsPass,
  isStep2Complete,
  isStep3ObjectiveComplete,
  readPrimaryGoal,
  step1PendingItems,
} from './businessSetupUi'

export interface SetupProgressItem {
  id: 'accounts' | 'facts' | 'strategy' | 'tracking'
  label: string
  done: boolean
}

export function buildSetupProgressItems(
  ctx: BusinessContextDto | null | undefined,
  connections: Record<string, IntegrationConnectionStatusDto | null | undefined> | null,
  trackingTestResult?: Record<string, string> | null,
): SetupProgressItem[] {
  const pendingAccounts = connections ? step1PendingItems(connections) : ['Connect Google Ads']
  const accountsDone =
    Boolean(ctx?.accountLinksCompletedAt) &&
    pendingAccounts.filter((p) => !p.includes('optional')).length === 0

  return [
    {
      id: 'accounts',
      label: 'Google accounts & site snippet',
      done: accountsDone,
    },
    {
      id: 'facts',
      label: 'Business facts confirmed',
      done: isStep2Complete(ctx),
    },
    {
      id: 'strategy',
      label: 'Campaign objectives',
      done: isStep3ObjectiveComplete(ctx),
    },
    {
      id: 'tracking',
      label: 'Tracking test',
      done: allTrackingGoalsPass(trackingTestResult ?? undefined, readPrimaryGoal(ctx?.goals)),
    },
  ]
}
