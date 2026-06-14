export interface ConversionActionSummary {
  status: 'ready' | 'manual_review' | 'failed' | 'not_run'
  slotsResolved: number
  created: number
  reused: number
  message: string | null
}

export interface ConversionActionProgressMeta {
  conversionActionManagement?: unknown
  conversionActionSlotsResolved?: unknown
  conversionActionsCreated?: unknown
  conversionActionsReused?: unknown
}

export function parseConversionActionMeta(
  meta: unknown,
): { status: 'ready' | null; summary: ConversionActionSummary | null } {
  if (!meta || typeof meta !== 'object') {
    return { status: null, summary: null }
  }
  const m = meta as ConversionActionProgressMeta
  if (m.conversionActionManagement !== 'ok') {
    return { status: null, summary: null }
  }

  const slotsResolved =
    typeof m.conversionActionSlotsResolved === 'number' ? m.conversionActionSlotsResolved : 0
  const created = typeof m.conversionActionsCreated === 'number' ? m.conversionActionsCreated : 0
  const reused = typeof m.conversionActionsReused === 'number' ? m.conversionActionsReused : 0

  return {
    status: 'ready',
    summary: {
      status: 'ready',
      slotsResolved,
      created,
      reused,
      message: null,
    },
  }
}

export function conversionActionHeadline(summary: ConversionActionSummary): string {
  if (summary.status === 'manual_review') {
    return 'Conversion actions need review before campaign creation can continue.'
  }
  if (summary.status === 'failed') {
    return summary.message ?? 'Conversion action creation failed.'
  }
  if (summary.created > 0 && summary.reused > 0) {
    return `Conversion actions are ready. Zuggernaut created ${summary.created} missing conversion action${summary.created === 1 ? '' : 's'} and reused ${summary.reused} existing one${summary.reused === 1 ? '' : 's'}.`
  }
  if (summary.created > 0) {
    return `Conversion actions are ready. Zuggernaut created ${summary.created} missing conversion action${summary.created === 1 ? '' : 's'}.`
  }
  return 'Conversion actions are ready. Zuggernaut reused existing Google Ads conversion actions.'
}
