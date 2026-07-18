import type { AdsReadinessIssue, AdsReadinessResult } from '../types/api'

export function isAdsReadinessOk(result: AdsReadinessResult | undefined): boolean {
  return result?.ok === true
}

export function adsReadinessIssueMessages(result: AdsReadinessResult | undefined): string[] {
  if (!result || result.ok || !Array.isArray(result.issues)) {
    return []
  }
  return result.issues.map((issue: AdsReadinessIssue) => issue.message)
}

export function adsReadinessSummary(result: AdsReadinessResult | undefined): string | null {
  const messages = adsReadinessIssueMessages(result)
  if (messages.length < 1) {
    return null
  }
  return messages[0]
}
