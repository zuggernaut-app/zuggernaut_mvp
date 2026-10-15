import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  adminGetOperatorCallContext,
  adminOperatorCallApi,
  type OperatorCallContext,
} from '../../api/adminOperatorCall'
import { createGtmBusinessSetupContainer } from '../../api/integrations'
import { ApiError } from '../../api/client'
import { ErrorAlert } from '../../components/feedback/ErrorAlert'
import { InlineLoading } from '../../components/feedback/InlineLoading'
import { PageLayout } from '../../components/layout/PageLayout'

const CALL_STEPS = [
  'account_settings',
  'business_answers',
  'website',
  'goal_choice',
  'permission',
  'snippet',
  'close',
] as const

type CallStep = (typeof CALL_STEPS)[number]

const CALL_STEP_SAVE_KEYS: Record<CallStep, string | readonly string[]> = {
  account_settings: 'call_account_settings',
  business_answers: 'call_business_answers',
  website: 'call_website',
  goal_choice: 'call_goal_choice',
  permission: 'call_permission',
  snippet: ['call_snippet_new', 'call_snippet_existing_gtm', 'call_snippet_pasted'],
  close: 'call_close',
}

function stepSaved(ctx: OperatorCallContext, key: string): boolean {
  const wf = ctx.operatorCallWorkflow as { stepSavedAt?: Record<string, string> }
  return Boolean(wf?.stepSavedAt?.[key])
}

function isCallStepSaved(ctx: OperatorCallContext, step: CallStep): boolean {
  const keys = CALL_STEP_SAVE_KEYS[step]
  if (Array.isArray(keys)) {
    return keys.some((key) => stepSaved(ctx, key))
  }
  return stepSaved(ctx, keys)
}

function maxReachableCallStepIndex(ctx: OperatorCallContext): number {
  for (let i = 0; i < CALL_STEPS.length; i += 1) {
    if (!isCallStepSaved(ctx, CALL_STEPS[i])) return i
  }
  return CALL_STEPS.length - 1
}

export function AdminOperatorBusinessPage(): ReactElement {
  const { businessId = '' } = useParams()
  const [context, setContext] = useState<OperatorCallContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [callStep, setCallStep] = useState<CallStep>('account_settings')
  const [followUpNote, setFollowUpNote] = useState('')
  const [gtmError, setGtmError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError(null)
    try {
      const res = await adminGetOperatorCallContext(businessId)
      setContext(res.context)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not load operator workflow.')
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const hasWebsite = Boolean(context?.websiteUrl?.trim())

  const callStepIndex = CALL_STEPS.indexOf(callStep)
  const maxReachable =
    context != null ? maxReachableCallStepIndex(context) : 0
  const currentStepSaved = context != null ? isCallStepSaved(context, callStep) : false

  const snippetSubSteps = useMemo(() => {
    if (!context) return 'new' as const
    const branch = (context.operatorCallWorkflow as { call?: { snippetBranch?: string } })?.call
      ?.snippetBranch
    if (branch === 'existing_gtm') return 'existing' as const
    if (branch === 'pasted_code') return 'pasted' as const
    return 'new' as const
  }, [context])

  async function saveAndRefresh(
    fn: () => Promise<{ context: OperatorCallContext }>,
  ): Promise<void> {
    setError(null)
    try {
      const res = await fn()
      setContext(res.context)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Save failed.')
    }
  }

  if (!businessId) {
    return (
      <PageLayout title="Operator call">
        <p>Missing business id.</p>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title={context?.businessName ?? 'Operator call'}
      lead={
        context
          ? `${context.customerEmail ?? 'no email'} · status ${context.operatorListStatus}`
          : undefined
      }
    >
      <p>
        <Link to="/admin">Back to list</Link>
      </p>
      <ErrorAlert message={error} />
      {loading || !context ? (
        <InlineLoading label="Loading…" />
      ) : (
        <>
          {context.operatorListStatus === 'needs_operator_follow_up' ? (
            <section style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #ccc' }}>
              <h2>Clear needs operator follow-up</h2>
              <label>
                One-line note
                <input
                  type="text"
                  value={followUpNote}
                  onChange={(e) => setFollowUpNote(e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: '0.5rem' }}
                onClick={() =>
                  void saveAndRefresh(() =>
                    adminOperatorCallApi.clearFollowUp(businessId, followUpNote),
                  )
                }
              >
                Clear follow-up
              </button>
            </section>
          ) : null}

          <section style={{ marginBottom: '1.5rem' }}>
            <h2>Before the call</h2>
            <h3>Customer answers (view only)</h3>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>
              {JSON.stringify(
                {
                  businessName: context.businessName,
                  businessCountry: context.businessCountry,
                  accountCurrencyCode: context.accountCurrencyCode,
                  accountTimeZone: context.accountTimeZone,
                  websiteUrl: context.websiteUrl,
                  services: context.services,
                  serviceAreas: context.serviceAreas,
                  whoBuysToday: context.whoBuysToday,
                  howBuyersContact: context.howBuyersContact,
                  orderValueHint: context.orderValueHint,
                },
                null,
                2,
              )}
            </pre>
            <h3>Fetched website</h3>
            {context.signupScrape.fetched ? (
              <>
                <p>Fetched at: {String(context.signupScrape.fetchedAt)}</p>
                <p>Homepage GTM: {context.signupScrape.homepageGtmPublicId ?? 'none'}</p>
                <ul>
                  {context.signupScrape.pages.map((p, i) => (
                    <li key={i}>
                      {p.url} {p.homepageGtmPublicId ? `· ${p.homepageGtmPublicId}` : ''}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Nothing fetched (no website or fetch did not complete).</p>
            )}
            {hasWebsite ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const fd = new FormData(e.currentTarget)
                  void saveAndRefresh(() =>
                    adminOperatorCallApi.beforePageSource(businessId, {
                      pageSourceHome: String(fd.get('pageSourceHome') ?? ''),
                      pageSourceOther: String(fd.get('pageSourceOther') ?? ''),
                    }),
                  )
                }}
              >
                <h3>Upload page source</h3>
                <label>
                  Homepage HTML
                  <textarea name="pageSourceHome" rows={4} style={{ width: '100%' }} />
                </label>
                <label>
                  Other pages HTML
                  <textarea name="pageSourceOther" rows={4} style={{ width: '100%' }} />
                </label>
                <button type="submit" className="btn btn-primary">Save page source</button>
                {stepSaved(context, 'before_page_source') ? <span> Saved.</span> : null}
              </form>
            ) : (
              <p>No website — skip page source before the call.</p>
            )}
          </section>

          <section style={{ marginBottom: '1.5rem' }}>
            <h2>On the call</h2>
            <p style={{ marginBottom: '0.5rem' }}>
              Call step {callStepIndex + 1} of {CALL_STEPS.length}: {callStep.replace('_', ' ')}
            </p>
            <div className="actions" style={{ marginBottom: '0.75rem', gap: '0.35rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={callStepIndex <= 0}
                onClick={() => setCallStep(CALL_STEPS[callStepIndex - 1])}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !currentStepSaved ||
                  callStepIndex >= CALL_STEPS.length - 1 ||
                  callStepIndex + 1 > maxReachable
                }
                onClick={() => setCallStep(CALL_STEPS[callStepIndex + 1])}
              >
                Next
              </button>
            </div>

            {callStep === 'account_settings' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const fd = new FormData(e.currentTarget)
                  void saveAndRefresh(() =>
                    adminOperatorCallApi.callAccountSettings(businessId, {
                      accountCurrencyCode: fd.get('accountCurrencyCode'),
                      accountTimeZone: fd.get('accountTimeZone'),
                      businessCountry: fd.get('businessCountry'),
                    }),
                  )
                }}
              >
                <p className="say-this">Say: confirm currency, time zone, and country.</p>
                <label>
                  Currency
                  <select name="accountCurrencyCode" defaultValue={context.accountCurrencyCode ?? 'USD'}>
                    {['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Time zone
                  <input name="accountTimeZone" defaultValue={context.accountTimeZone ?? ''} />
                </label>
                <label>
                  Country (ISO)
                  <input name="businessCountry" defaultValue={context.businessCountry ?? ''} maxLength={2} />
                </label>
                <button type="submit" className="btn btn-primary">Save</button>
              </form>
            ) : null}

            {callStep === 'business_answers' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const fd = new FormData(e.currentTarget)
                  void saveAndRefresh(() =>
                    adminOperatorCallApi.callBusinessAnswers(businessId, {
                      services: fd.get('services'),
                      serviceAreas: fd.get('serviceAreas'),
                      whoBuysToday: fd.get('whoBuysToday'),
                      howBuyersContact: fd.get('howBuyersContact'),
                      orderValueHint: fd.get('orderValueHint'),
                      orderValueUnknown: fd.get('orderValueUnknown') === 'on',
                    }),
                  )
                }}
              >
                <p className="say-this">Say: read back answers; ask only blanks.</p>
                <label>
                  What they sell (comma-separated)
                  <input
                    name="services"
                    defaultValue={context.services.join(', ')}
                  />
                </label>
                <label>
                  Where they serve (comma-separated)
                  <input
                    name="serviceAreas"
                    defaultValue={context.serviceAreas.join(', ')}
                  />
                </label>
                <label>Who buys <input name="whoBuysToday" defaultValue={context.whoBuysToday ?? ''} /></label>
                <label>How contact <input name="howBuyersContact" defaultValue={context.howBuyersContact ?? ''} /></label>
                <label>Order value <input name="orderValueHint" defaultValue={context.orderValueHint ?? ''} /></label>
                <label><input type="checkbox" name="orderValueUnknown" /> Unknown order value (needs follow-up)</label>
                <button type="submit" className="btn btn-primary">Save</button>
              </form>
            ) : null}

            {callStep === 'website' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const fd = new FormData(e.currentTarget)
                  void saveAndRefresh(() =>
                    adminOperatorCallApi.callWebsite(businessId, {
                      noWebsite: fd.get('noWebsite') === 'on',
                      websiteUrl: fd.get('websiteUrl'),
                      ctaNote: fd.get('ctaNote'),
                      triggerFetch: false,
                    }),
                  )
                }}
              >
                <p className="say-this">Say: confirm website or no website.</p>
                <label><input type="checkbox" name="noWebsite" /> No website</label>
                <label>Website <input name="websiteUrl" defaultValue={context.websiteUrl ?? ''} /></label>
                <label>CTA note (not final) <input name="ctaNote" /></label>
                <button type="submit" className="btn btn-primary">Save (no fetch)</button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginLeft: '0.5rem' }}
                  onClick={() => {
                    const url = (document.querySelector<HTMLInputElement>('input[name="websiteUrl"]'))?.value
                    void saveAndRefresh(() =>
                      adminOperatorCallApi.callWebsite(businessId, {
                        websiteUrl: url,
                        triggerFetch: true,
                      }),
                    )
                  }}
                >
                  Save and fetch
                </button>
              </form>
            ) : null}

            {callStep === 'goal_choice' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const fd = new FormData(e.currentTarget)
                  void saveAndRefresh(() =>
                    adminOperatorCallApi.callGoalChoice(businessId, {
                      primary: fd.get('primary'),
                      noFormAd: fd.get('noFormAd') === 'on',
                    }),
                  )
                }}
              >
                <p className="say-this">Say: choose calls, form, or both.</p>
                {!context.callsAllowed ? <p>Calls not on forwarding-number list for this country.</p> : null}
                <label>
                  Primary
                  <select name="primary" defaultValue={context.goals?.primary ?? 'forms'}>
                    <option value="forms">forms</option>
                    {context.callsAllowed ? <option value="calls">calls</option> : null}
                    {context.callsAllowed ? <option value="both">both</option> : null}
                  </select>
                </label>
                <label><input type="checkbox" name="noFormAd" /> No form ad</label>
                <button type="submit" className="btn btn-primary">Save</button>
              </form>
            ) : null}

            {callStep === 'permission' ? (
              <div>
                <p className="say-this">Say: confirm Zuggernaut creates account, MCC link, billing.</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void saveAndRefresh(() =>
                      adminOperatorCallApi.callPermission(businessId, { managedConsent: true }),
                    )
                  }
                >
                  Save managed yes
                </button>
                <form
                  style={{ marginTop: '0.75rem' }}
                  onSubmit={(e) => {
                    e.preventDefault()
                    const fd = new FormData(e.currentTarget)
                    void saveAndRefresh(() =>
                      adminOperatorCallApi.callPermission(businessId, {
                        useOwnAccount: true,
                        managerLinkAccepted: fd.get('managerLinkAccepted') === 'on',
                        ownAccountBillingOk: fd.get('ownAccountBillingOk') === 'on',
                        ownAccountCurrencyMatch: fd.get('ownAccountCurrencyMatch') === 'on',
                      }),
                    )
                  }}
                >
                  <p>Own Google Ads account</p>
                  <label>
                    <input type="checkbox" name="managerLinkAccepted" /> Manager link accepted on the call
                  </label>
                  <label>
                    <input type="checkbox" name="ownAccountBillingOk" /> Google billing already set
                  </label>
                  <label>
                    <input type="checkbox" name="ownAccountCurrencyMatch" /> Currency matches that account
                  </label>
                  <button type="submit" className="btn btn-secondary">Save own account</button>
                </form>
              </div>
            ) : null}

            {callStep === 'snippet' ? (
              <div>
                <p className="say-this">Say: check live page for GTM, gtag, hard-coded conversion.</p>
                {snippetSubSteps === 'new' ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() =>
                        void saveAndRefresh(() =>
                          adminOperatorCallApi.callSnippetNew(businessId, { notApplicable: true }),
                        )
                      }
                    >
                      No website / not applicable
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        void saveAndRefresh(() =>
                          adminOperatorCallApi.callSnippetNew(businessId, { snippetPending: true }),
                        )
                      }
                    >
                      Snippet pending (reschedule)
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={async () => {
                        setGtmError(null)
                        try {
                          await createGtmBusinessSetupContainer(businessId)
                        } catch (err) {
                          if (err instanceof ApiError) {
                            setGtmError(
                              err.message.includes('GTM') || err.message.includes('account')
                                ? 'Connect Tag Manager manually for this business, then retry.'
                                : err.message,
                            )
                          } else setGtmError('Container create failed.')
                        }
                      }}
                    >
                      Create container (product)
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginLeft: '0.5rem' }}
                      onClick={() =>
                        void saveAndRefresh(() =>
                          adminOperatorCallApi.callSnippetNew(businessId, { snippetInstalled: true }),
                        )
                      }
                    >
                      Mark snippet installed on live site
                    </button>
                    {gtmError ? <p style={{ color: 'crimson' }}>{gtmError}</p> : null}
                  </>
                ) : null}
                {snippetSubSteps === 'existing' || snippetSubSteps === 'new' ? (
                  <div style={{ marginTop: '0.75rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        void saveAndRefresh(() =>
                          adminOperatorCallApi.callSnippetExistingGtm(businessId, {
                            publishAccessGranted: true,
                          }),
                        )
                      }
                    >
                      Existing GTM — publish access granted (zuggernaut.work@gmail.com)
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginLeft: '0.5rem' }}
                      onClick={() =>
                        void saveAndRefresh(() =>
                          adminOperatorCallApi.callSnippetExistingGtm(businessId, {
                            publishAccessGranted: false,
                          }),
                        )
                      }
                    >
                      Existing GTM — no publish access (no form ad)
                    </button>
                  </div>
                ) : null}
                {snippetSubSteps === 'existing' ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginTop: '0.75rem' }}
                    onClick={() => {
                      const call = (context.operatorCallWorkflow as { call?: { publishAccessGranted?: boolean } })
                        ?.call
                      void saveAndRefresh(() =>
                        adminOperatorCallApi.callSnippetExistingGtm(businessId, {
                          publishAccessGranted: call?.publishAccessGranted === true,
                          snippetInstalled: true,
                        }),
                      )
                    }}
                  >
                    Mark snippet installed on live site
                  </button>
                ) : null}
                <form
                  style={{ marginTop: '0.75rem' }}
                  onSubmit={(e) => {
                    e.preventDefault()
                    const fd = new FormData(e.currentTarget)
                    void saveAndRefresh(() =>
                      adminOperatorCallApi.callSnippetPasted(businessId, {
                        noFormAd: fd.get('noFormAd') === 'on',
                        pastedCodeRemoved: fd.get('pastedCodeRemoved'),
                        existingConversionId: fd.get('existingConversionId'),
                        existingConversionLabel: fd.get('existingConversionLabel'),
                      }),
                    )
                  }}
                >
                  <p>Pasted gtag / hard-coded conversion (no box)</p>
                  <label>
                    <input type="checkbox" name="noFormAd" defaultChecked /> No form ad
                  </label>
                  <label>
                    What was removed (if replaced)
                    <input name="pastedCodeRemoved" />
                  </label>
                  <label>
                    Existing conversion ID (their account, reuse)
                    <input name="existingConversionId" />
                  </label>
                  <label>
                    Existing conversion label
                    <input name="existingConversionLabel" />
                  </label>
                  <button type="submit" className="btn btn-secondary">Save pasted code</button>
                </form>
              </div>
            ) : null}

            {callStep === 'close' ? (
              <div>
                <p className="say-this">
                  Say: a test lead marked TEST — Zuggernaut will be sent later; do not send on the call.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void saveAndRefresh(() => adminOperatorCallApi.callClose(businessId))}
                >
                  Save close statement
                </button>
              </div>
            ) : null}
          </section>

          <section>
            <h2>After the call</h2>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                void saveAndRefresh(() =>
                  adminOperatorCallApi.afterPageSource(businessId, { skipped: true }),
                )
              }
            >
              Skip page source (when not needed)
            </button>
            <form
              style={{ marginTop: '0.75rem' }}
              onSubmit={(e) => {
                e.preventDefault()
                const fd = new FormData(e.currentTarget)
                void saveAndRefresh(() =>
                  adminOperatorCallApi.afterFormResult(businessId, {
                    formAfterSubmit: fd.get('formAfterSubmit'),
                    tagTrigger: fd.get('tagTrigger'),
                    noFormAd: fd.get('noFormAd') === 'on',
                  }),
                )
              }}
            >
              <h3>Form result</h3>
              <label>After submit <input name="formAfterSubmit" /></label>
              <label>Tag trigger <input name="tagTrigger" /></label>
              <label><input type="checkbox" name="noFormAd" /> No form ad</label>
              <button type="submit" className="btn btn-primary">Save form result</button>
            </form>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '0.75rem' }}
              onClick={() =>
                void saveAndRefresh(() => adminOperatorCallApi.afterTestLeadPassed(businessId))
              }
            >
              Mark test lead passed
            </button>
          </section>
        </>
      )}
    </PageLayout>
  )
}
