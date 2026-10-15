import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  adminGetOperatorCallContext,
  adminOperatorCallApi,
  type OperatorCallContext,
} from '../../api/adminOperatorCall'
import { createGtmBusinessSetupContainer, fetchIntegrationStatus } from '../../api/integrations'
import { ApiError } from '../../api/client'
import { ErrorAlert } from '../../components/feedback/ErrorAlert'
import { InlineLoading } from '../../components/feedback/InlineLoading'
import { PageLayout } from '../../components/layout/PageLayout'
import {
  CALL_STEPS,
  type CallStep,
  type OperatorPhase,
  allCallStepsSaved,
  allRequiredStepsSaved,
  deriveInitialPhase,
  firstUnsavedCallStep,
  formatOperatorStatus,
  formAdInPlay,
  hasWebsiteOnRecord,
  isAfterWorkComplete,
  isCallStepSaved,
  liveCheckResult,
  needsAfterFormFlow,
  needsAfterPageSource,
  signupScrapeMessage,
  stepSaved,
} from '../../lib/operatorCallProgress'
import {
  SIGNUP_ACCOUNT_CURRENCIES,
  formatTimeZoneSelectLabel,
  listCountryOptions,
  listTimeZoneOptions,
} from '../../lib/signupAccount'

function phaseLabel(phase: OperatorPhase, callStep: CallStep): string {
  if (phase === 'before') return 'Before the call'
  if (phase === 'call') {
    const idx = CALL_STEPS.indexOf(callStep) + 1
    return `On the call — step ${idx} of ${CALL_STEPS.length}`
  }
  if (phase === 'after') return 'After the call'
  return 'Everything is captured'
}

function displayLine(value: string | null | undefined, empty = 'Not entered yet'): string {
  const t = typeof value === 'string' ? value.trim() : ''
  return t || empty
}

export function AdminOperatorBusinessPage(): ReactElement {
  const { businessId = '' } = useParams()
  const [context, setContext] = useState<OperatorCallContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<OperatorPhase>('before')
  const [callStep, setCallStep] = useState<CallStep>('account_settings')
  const [followUpNote, setFollowUpNote] = useState('')
  const [gtmError, setGtmError] = useState<string | null>(null)
  const [gtmContainerExists, setGtmContainerExists] = useState(false)
  const [phaseInitialized, setPhaseInitialized] = useState(false)

  const refresh = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError(null)
    try {
      const res = await adminGetOperatorCallContext(businessId)
      setContext(res.context)
      if (!phaseInitialized) {
        const initial = deriveInitialPhase(res.context)
        setPhase(initial)
        if (initial === 'call') {
          setCallStep(firstUnsavedCallStep(res.context))
        }
        setPhaseInitialized(true)
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not load operator workflow.')
    } finally {
      setLoading(false)
    }
  }, [businessId, phaseInitialized])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!businessId) return
    void fetchIntegrationStatus(businessId)
      .then((res) => {
        const containerId = res.connections.gtm?.providerIdentifiers?.containerId
        setGtmContainerExists(typeof containerId === 'string' && containerId.trim().length > 0)
      })
      .catch(() => {
        setGtmContainerExists(false)
      })
  }, [businessId])

  const countryOptions = useMemo(() => listCountryOptions(), [])
  const timeZoneOptions = useMemo(() => listTimeZoneOptions(), [])

  const callStepIndex = CALL_STEPS.indexOf(callStep)
  const currentStepSaved = context != null ? isCallStepSaved(context, callStep) : false
  const allComplete = context != null && allRequiredStepsSaved(context)
  const maxReachableCallIndex =
    context != null ? CALL_STEPS.indexOf(firstUnsavedCallStep(context)) : 0

  const liveCheck = context ? liveCheckResult(context) : null
  const websiteOnCall = context ? hasWebsiteOnRecord(context) : false

  async function saveAndRefresh(
    fn: () => Promise<{ context: OperatorCallContext }>,
  ): Promise<OperatorCallContext | null> {
    setError(null)
    try {
      const res = await fn()
      setContext(res.context)
      if (allRequiredStepsSaved(res.context)) {
        setPhase('success')
      }
      return res.context
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Save failed.')
      return null
    }
  }

  function goToPhase(next: OperatorPhase): void {
    setPhase(next)
    if (next === 'call' && context) {
      setCallStep(firstUnsavedCallStep(context))
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
          ? `${context.customerEmail ?? 'no email'} · status ${formatOperatorStatus(context.operatorListStatus)}`
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
          <p style={{ marginBottom: '1rem', fontWeight: 600 }}>{phaseLabel(phase, callStep)}</p>

          {allComplete ? (
            <nav className="actions" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.35rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setPhase('before')}>
                Review before the call
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setPhase('call')}>
                Review on the call
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setPhase('after')}>
                Review after the call
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setPhase('success')}>
                Success summary
              </button>
            </nav>
          ) : null}

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

          {phase === 'success' ? (
            <section>
              <h2>Everything is captured</h2>
              <p>All required operator steps for this business are saved. The product does not create ads or publish tags from this screen.</p>
            </section>
          ) : null}

          {phase === 'before' ? (
            <section>
              <h2>Customer answers</h2>
              <dl style={{ margin: 0 }}>
                <dt>Business name</dt>
                <dd>{displayLine(context.businessName)}</dd>
                <dt>Country</dt>
                <dd>{displayLine(context.businessCountry)}</dd>
                <dt>Currency</dt>
                <dd>{displayLine(context.accountCurrencyCode)}</dd>
                <dt>Time zone</dt>
                <dd>{displayLine(context.accountTimeZone)}</dd>
                <dt>Website</dt>
                <dd>{context.websiteUrl?.trim() ? context.websiteUrl : 'No website'}</dd>
                <dt>What they sell</dt>
                <dd>{context.services.length ? context.services.join(', ') : 'Not entered yet'}</dd>
                <dt>Who buys today</dt>
                <dd>{displayLine(context.whoBuysToday)}</dd>
                <dt>Where they serve</dt>
                <dd>{context.serviceAreas.length ? context.serviceAreas.join(', ') : 'Not entered yet'}</dd>
                <dt>How buyers get in touch</dt>
                <dd>{displayLine(context.howBuyersContact)}</dd>
                <dt>Typical order value</dt>
                <dd>{displayLine(context.orderValueHint)}</dd>
              </dl>

              <h3 style={{ marginTop: '1.25rem' }}>Fetched website</h3>
              {context.signupScrape.fetched ? (
                <>
                  <p>Fetched at: {String(context.signupScrape.fetchedAt)}</p>
                  <p>Homepage Tag Manager: {context.signupScrape.homepageGtmPublicId ?? 'none'}</p>
                  <ul>
                    {context.signupScrape.pages.map((p, i) => (
                      <li key={i}>{p.url}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>{signupScrapeMessage(context) ?? 'Nothing fetched.'}</p>
              )}

              {context.signupScrape.fetched ? (
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
                  <h3>Upload page source (optional)</h3>
                  <label>
                    Homepage HTML
                    <textarea name="pageSourceHome" rows={4} style={{ width: '100%' }} />
                  </label>
                  <label>
                    Other pages HTML
                    <textarea name="pageSourceOther" rows={4} style={{ width: '100%' }} />
                  </label>
                  <button type="submit" className="btn btn-secondary">Save page source</button>
                  {stepSaved(context, 'before_page_source') ? <span> Saved.</span> : null}
                </form>
              ) : null}

              {stepSaved(context, 'start_call') ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ marginTop: '1rem' }}
                  onClick={() => goToPhase('call')}
                >
                  Continue on the call
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ marginTop: '1rem' }}
                  onClick={() =>
                    void saveAndRefresh(() => adminOperatorCallApi.startCall(businessId)).then(
                      (ctx) => {
                        if (ctx) goToPhase('call')
                      },
                    )
                  }
                >
                  Start the call
                </button>
              )}
            </section>
          ) : null}

          {phase === 'call' ? (
            <section>
              <div className="actions" style={{ marginBottom: '0.75rem', gap: '0.35rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={callStepIndex <= 0 && !allComplete}
                  onClick={() => {
                    if (callStepIndex > 0) setCallStep(CALL_STEPS[callStepIndex - 1])
                    else setPhase('before')
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    !allComplete &&
                    (!currentStepSaved ||
                      callStepIndex >= CALL_STEPS.length - 1 ||
                      callStepIndex >= maxReachableCallIndex)
                  }
                  onClick={() => {
                    if (callStepIndex < CALL_STEPS.length - 1) {
                      setCallStep(CALL_STEPS[callStepIndex + 1])
                    }
                  }}
                >
                  Next
                </button>
                {allCallStepsSaved(context) ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setPhase('after')}
                  >
                    Continue after the call
                  </button>
                ) : null}
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
                      {SIGNUP_ACCOUNT_CURRENCIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Time zone
                    <select name="accountTimeZone" defaultValue={context.accountTimeZone ?? ''}>
                      <option value="">Select time zone</option>
                      {timeZoneOptions.map((tz) => (
                        <option key={tz} value={tz}>{formatTimeZoneSelectLabel(tz)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Country
                    <select name="businessCountry" defaultValue={context.businessCountry ?? ''}>
                      <option value="">Select country</option>
                      {countryOptions.map((opt) => (
                        <option key={opt.code} value={opt.code}>{opt.name}</option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="btn btn-primary">Save</button>
                  {currentStepSaved ? <span> Saved.</span> : null}
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
                    <input name="services" defaultValue={context.services.join(', ')} />
                  </label>
                  <label>
                    Where they serve (comma-separated)
                    <input name="serviceAreas" defaultValue={context.serviceAreas.join(', ')} />
                  </label>
                  <label>Who buys <input name="whoBuysToday" defaultValue={context.whoBuysToday ?? ''} /></label>
                  <label>How contact <input name="howBuyersContact" defaultValue={context.howBuyersContact ?? ''} /></label>
                  <label>Order value <input name="orderValueHint" defaultValue={context.orderValueHint ?? ''} /></label>
                  <label><input type="checkbox" name="orderValueUnknown" /> Unknown order value (needs follow-up)</label>
                  <button type="submit" className="btn btn-primary">Save</button>
                  {currentStepSaved ? <span> Saved.</span> : null}
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
                      const url = document.querySelector<HTMLInputElement>('input[name="websiteUrl"]')?.value
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
                  {currentStepSaved ? <span> Saved.</span> : null}
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
                  {currentStepSaved ? <span> Saved.</span> : null}
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
                  {currentStepSaved ? <span> Saved.</span> : null}
                </div>
              ) : null}

              {callStep === 'snippet' ? (
                <div>
                  <p className="say-this">Say: check live page for GTM, gtag, hard-coded conversion.</p>
                  {!websiteOnCall ? (
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
                  ) : (
                    <>
                      <p>Live check result</p>
                      <div className="actions" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() =>
                            void saveAndRefresh(() =>
                              adminOperatorCallApi.callLiveCheck(businessId, {
                                liveCheckResult: 'existing_gtm',
                              }),
                            )
                          }
                        >
                          Existing Tag Manager box
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() =>
                            void saveAndRefresh(() =>
                              adminOperatorCallApi.callLiveCheck(businessId, {
                                liveCheckResult: 'no_google_tag',
                              }),
                            )
                          }
                        >
                          No Google tag
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() =>
                            void saveAndRefresh(() =>
                              adminOperatorCallApi.callLiveCheck(businessId, {
                                liveCheckResult: 'hard_coded_no_gtm',
                              }),
                            )
                          }
                        >
                          Hard-coded conversion, no box
                        </button>
                      </div>

                      {liveCheck === 'existing_gtm' || liveCheck === 'no_google_tag' ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ marginTop: '0.75rem' }}
                          onClick={() =>
                            void saveAndRefresh(() =>
                              adminOperatorCallApi.callSnippetNew(businessId, { snippetPending: true }),
                            )
                          }
                        >
                          Snippet pending (reschedule)
                        </button>
                      ) : null}

                      {liveCheck === 'existing_gtm' ? (
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
                            Publish access granted (zuggernaut.work@gmail.com)
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
                            No publish access (no form ad)
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ marginTop: '0.75rem', display: 'block' }}
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
                        </div>
                      ) : null}

                      {liveCheck === 'no_google_tag' ? (
                        <div style={{ marginTop: '0.75rem' }}>
                          {gtmContainerExists ? (
                            <p>Tag Manager container already exists for this business.</p>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={async () => {
                                setGtmError(null)
                                try {
                                  await createGtmBusinessSetupContainer(businessId)
                                  setGtmContainerExists(true)
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
                          )}
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
                        </div>
                      ) : null}

                      {liveCheck === 'hard_coded_no_gtm' ? (
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
                          <label>
                            <input type="checkbox" name="noFormAd" defaultChecked /> No form ad
                          </label>
                          <label>
                            What was removed (if replaced)
                            <input name="pastedCodeRemoved" />
                          </label>
                          <label>
                            Existing conversion ID
                            <input name="existingConversionId" />
                          </label>
                          <label>
                            Existing conversion label
                            <input name="existingConversionLabel" />
                          </label>
                          <button type="submit" className="btn btn-primary">Save pasted code</button>
                        </form>
                      ) : null}
                    </>
                  )}
                  {currentStepSaved ? <p style={{ marginTop: '0.75rem' }}>Saved.</p> : null}
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
                    onClick={() =>
                      void saveAndRefresh(() => adminOperatorCallApi.callClose(businessId)).then((ctx) => {
                        if (!ctx) return
                        if (allRequiredStepsSaved(ctx)) return
                        if (allCallStepsSaved(ctx) && !isAfterWorkComplete(ctx)) {
                          setPhase('after')
                        }
                      })
                    }
                  >
                    Save close statement
                  </button>
                  {currentStepSaved ? <span> Saved.</span> : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {phase === 'after' ? (
            <section>
              {needsAfterPageSource(context) ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const fd = new FormData(e.currentTarget)
                    void saveAndRefresh(() =>
                      adminOperatorCallApi.afterPageSource(businessId, {
                        pageSourceHome: fd.get('pageSourceHome'),
                        pageSourceOther: fd.get('pageSourceOther'),
                      }),
                    )
                  }}
                >
                  <h3>New page source (website changed on call)</h3>
                  <label>Homepage HTML <textarea name="pageSourceHome" rows={3} style={{ width: '100%' }} /></label>
                  <label>Other pages HTML <textarea name="pageSourceOther" rows={3} style={{ width: '100%' }} /></label>
                  <button type="submit" className="btn btn-primary">Save page source</button>
                  {stepSaved(context, 'after_page_source') ? <span> Saved.</span> : null}
                </form>
              ) : null}

              {needsAfterFormFlow(context) ? (
                <>
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
                    {stepSaved(context, 'after_form_result') ? <span> Saved.</span> : null}
                  </form>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: '0.75rem' }}
                    disabled={!stepSaved(context, 'after_form_result')}
                    onClick={() => void saveAndRefresh(() => adminOperatorCallApi.afterTestLeadPassed(businessId))}
                  >
                    Mark test lead passed
                  </button>
                  {stepSaved(context, 'after_test_lead_passed') ? <span> Saved.</span> : null}
                </>
              ) : null}

              {!needsAfterPageSource(context) && !needsAfterFormFlow(context) ? (
                <p>No after-call entries are required for this business.</p>
              ) : null}

              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: '1rem' }}
                onClick={() => setPhase('call')}
              >
                Back to on the call
              </button>
            </section>
          ) : null}
        </>
      )}
    </PageLayout>
  )
}
