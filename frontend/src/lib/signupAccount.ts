export const SIGNUP_ACCOUNT_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD'] as const

export type SignupAccountCurrency = (typeof SIGNUP_ACCOUNT_CURRENCIES)[number]

const CURRENCY_LABELS: Record<SignupAccountCurrency, string> = {
  USD: 'US dollars (USD)',
  EUR: 'Euros (EUR)',
  GBP: 'British pounds (GBP)',
  INR: 'Indian rupees (INR)',
  AUD: 'Australian dollars (AUD)',
  CAD: 'Canadian dollars (CAD)',
}

/** Euro-area and other EUR-using countries for signup currency preselect. */
const COUNTRY_DEFAULT_CURRENCY: Record<string, SignupAccountCurrency> = {
  US: 'USD',
  IN: 'INR',
  GB: 'GBP',
  AU: 'AUD',
  CA: 'CAD',
  AT: 'EUR',
  BE: 'EUR',
  CY: 'EUR',
  DE: 'EUR',
  EE: 'EUR',
  ES: 'EUR',
  FI: 'EUR',
  FR: 'EUR',
  GR: 'EUR',
  HR: 'EUR',
  IE: 'EUR',
  IT: 'EUR',
  LT: 'EUR',
  LU: 'EUR',
  LV: 'EUR',
  MT: 'EUR',
  NL: 'EUR',
  PT: 'EUR',
  SI: 'EUR',
  SK: 'EUR',
}

export function currencyLabel(code: SignupAccountCurrency): string {
  return CURRENCY_LABELS[code]
}

export function preselectedCurrencyForCountry(countryCode: string): SignupAccountCurrency {
  const code = countryCode.trim().toUpperCase()
  const mapped = COUNTRY_DEFAULT_CURRENCY[code]
  if (mapped) return mapped
  return 'USD'
}

export function listCountryOptions(): { code: string; name: string }[] {
  try {
    const codes = Intl.supportedValuesOf('region').filter((c) => c.length === 2)
    const display = new Intl.DisplayNames(['en'], { type: 'region' })
    return codes
      .map((code) => ({ code, name: display.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return [{ code: 'US', name: 'United States' }]
  }
}

export function listTimeZoneOptions(): string[] {
  try {
    return [...Intl.supportedValuesOf('timeZone')].sort()
  } catch {
    return []
  }
}

export function browserTimeZoneId(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return ''
  }
}
