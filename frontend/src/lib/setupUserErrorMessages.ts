const GENERIC_SETUP_FAILURE =
  'Setup could not be completed. Review the details below and try again, or contact support if the issue persists.'

const SETUP_USER_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  GTM_ACCOUNT_NOT_FOUND:
    'No Google Tag Manager account was found. Create one at tagmanager.google.com, then approve provisioning again.',
  GTM_PROVISIONING_FAILED:
    'Google Tag Manager provisioning failed. Review your GTM connection and try again.',
  ADS_PROVISIONING_FAILED:
    'Google Ads customer provisioning failed. Review your Google Ads connection and MCC configuration, then try again.',
  ADS_MCC_PERMISSION_DENIED:
    'Google Ads provisioning was denied. Confirm MCC permissions and billing eligibility, then try again.',
  ADS_CUSTOMER_SELECTION_REQUIRED:
    'Select which Google Ads customer account Zuggernaut should use, or approve creating a new one.',
  ADS_CUSTOMER_NOT_FOUND:
    'No usable Google Ads customer account was found for this connection.',
  ADS_DISCOVERY_FAILED:
    'Google Ads customer discovery failed. Reconnect Google Ads and try again.',
  GOOGLE_ADS_SETUP_NOT_READY:
    'Google Ads is not ready for setup. Review your connection and selected customer account.',
  GTM_SETUP_FAILED: 'Google Tag Manager setup failed. Review your GTM connection and container access.',
  GTM_SNIPPET_PENDING:
    'Install the Google Tag Manager snippet on your website before setup can continue.',
  SETUP_NEEDS_TRACKING_FIX:
    'Tracking setup needs attention before setup can continue. Review the verification details below.',
  CONVERSION_ACTION_CREATE_FAILED:
    'Google Ads conversion action setup failed. Review account permissions and try again.',
  CONVERSION_STRATEGY_MISSING_GOALS:
    'Confirm your primary business goal (calls, forms, or both) before conversion actions can be created.',
  ConversionActionManagementError:
    'Conversion action management failed. Review Google Ads permissions and try again.',
  GOOGLE_ADS_MUTATE_FAILED:
    'Google Ads could not apply the requested changes. Review account permissions and setup inputs, then try again.',
  ADS_INTENT_KEYWORD_INVALID_CHARS: 'Keyword text contains invalid characters or symbols.',
  ADS_INTENT_UNRESOLVED_GEO: 'Could not resolve a location target from your service area.',
  ADS_INTENT_INVALID_GEO_TARGET: 'The selected service area is not a valid Google Ads location target.',
  AdsCampaignError: 'Google Ads campaign creation failed.',
})

function isLikelyRawProviderError(message: string): boolean {
  const text = message.trim()
  if (!text) return false

  return (
    /Google Ads API/i.test(text) ||
    /Tag Manager API/i.test(text) ||
    /operations\[\d+\]/i.test(text) ||
    /\bPERMISSION_DENIED\b/.test(text) ||
    /\bcustomers\/\d+/i.test(text) ||
    /\bstatus:\s*\d{3}\b/i.test(text) ||
    /\bUNAUTHENTICATED\b/.test(text) ||
    /\bINVALID_ARGUMENT\b/.test(text) ||
    /fieldError:/i.test(text) ||
    /responseBody/i.test(text) ||
    text.length > 240
  )
}

export function resolveSetupUserErrorMessage(input?: {
  errorCode?: string | null
  fallbackMessage?: string | null
}): string {
  const errorCode = typeof input?.errorCode === 'string' ? input.errorCode.trim() : ''
  const fallbackMessage =
    typeof input?.fallbackMessage === 'string' ? input.fallbackMessage.trim() : ''

  if (errorCode && SETUP_USER_ERROR_MESSAGES[errorCode]) {
    return SETUP_USER_ERROR_MESSAGES[errorCode]
  }

  if (fallbackMessage && !isLikelyRawProviderError(fallbackMessage)) {
    return fallbackMessage
  }

  return GENERIC_SETUP_FAILURE
}

export function errorCodeFromStepDetails(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null
  const row = details as Record<string, unknown>
  if (typeof row.code === 'string' && row.code.trim()) return row.code.trim()
  if (typeof row.errorCode === 'string' && row.errorCode.trim()) return row.errorCode.trim()

  const issues = Array.isArray(row.issues) ? row.issues : []
  const firstIssue =
    issues.length > 0 && issues[0] && typeof issues[0] === 'object'
      ? (issues[0] as Record<string, unknown>)
      : null
  if (typeof firstIssue?.code === 'string' && firstIssue.code.trim()) {
    return firstIssue.code.trim()
  }

  return null
}

export function sanitizeSetupErrorSummary(
  summary: string | null | undefined,
  errorCode?: string | null,
): string | null {
  if (typeof summary !== 'string' || !summary.trim()) return null
  return resolveSetupUserErrorMessage({ errorCode, fallbackMessage: summary })
}
