import { describe, expect, it } from 'vitest'
import {
  conversionActionHeadline,
  parseConversionActionMeta,
} from './conversionActionsUi'

describe('conversionActionsUi', () => {
  it('parseConversionActionMeta returns ready summary from run meta', () => {
    const parsed = parseConversionActionMeta({
      conversionActionManagement: 'ok',
      conversionActionSlotsResolved: 2,
      conversionActionsCreated: 1,
      conversionActionsReused: 1,
    })
    expect(parsed.status).toBe('ready')
    expect(parsed.summary).toEqual({
      status: 'ready',
      slotsResolved: 2,
      created: 1,
      reused: 1,
      message: null,
    })
  })

  it('parseConversionActionMeta ignores incomplete meta', () => {
    expect(parseConversionActionMeta({ conversionActionManagement: 'pending' })).toEqual({
      status: null,
      summary: null,
    })
    expect(parseConversionActionMeta(null)).toEqual({ status: null, summary: null })
  })

  it('conversionActionHeadline describes reuse-only and created paths', () => {
    expect(
      conversionActionHeadline({
        status: 'ready',
        slotsResolved: 2,
        created: 0,
        reused: 2,
        message: null,
      }),
    ).toMatch(/reused existing Google Ads conversion actions/i)

    expect(
      conversionActionHeadline({
        status: 'ready',
        slotsResolved: 2,
        created: 1,
        reused: 1,
        message: null,
      }),
    ).toMatch(/created 1 missing conversion action/i)
  })
})
