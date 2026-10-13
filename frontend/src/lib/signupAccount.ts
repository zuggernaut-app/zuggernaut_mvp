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

/** ISO 3166-1 alpha-2 codes when `Intl.supportedValuesOf('region')` is unavailable. */
const ISO_3166_1_ALPHA2_FALLBACK =
  'AD,AE,AF,AG,AI,AL,AM,AO,AQ,AR,AS,AT,AU,AW,AX,AZ,BA,BB,BD,BE,BF,BG,BH,BI,BJ,BL,BM,BN,BO,BQ,BR,BS,BT,BV,BW,BY,BZ,CA,CC,CD,CF,CG,CH,CI,CK,CL,CM,CN,CO,CR,CU,CV,CW,CX,CY,CZ,DE,DJ,DK,DM,DO,DZ,EC,EE,EG,EH,ER,ES,ET,FI,FJ,FK,FM,FO,FR,GA,GB,GD,GE,GF,GG,GH,GI,GL,GM,GN,GP,GQ,GR,GS,GT,GU,GW,GY,HK,HM,HN,HR,HT,HU,ID,IE,IL,IM,IN,IO,IQ,IR,IS,IT,JE,JM,JO,JP,KE,KG,KH,KI,KM,KN,KP,KR,KW,KY,KZ,LA,LB,LC,LI,LK,LR,LS,LT,LU,LV,LY,MA,MC,MD,ME,MF,MG,MH,MK,ML,MM,MN,MO,MP,MQ,MR,MS,MT,MU,MV,MW,MX,MY,MZ,NA,NC,NE,NF,NG,NI,NL,NO,NP,NR,NU,NZ,OM,PA,PE,PF,PG,PH,PK,PL,PM,PN,PR,PS,PT,PW,PY,QA,RE,RO,RS,RU,RW,SA,SB,SC,SD,SE,SG,SH,SI,SJ,SK,SL,SM,SN,SO,SR,SS,ST,SV,SX,SY,SZ,TC,TD,TF,TG,TH,TJ,TK,TL,TM,TN,TO,TR,TT,TV,TW,TZ,UA,UG,UM,US,UY,UZ,VA,VC,VE,VG,VI,VN,VU,WF,WS,YE,YT,ZA,ZM,ZW'

function regionCodes(): string[] {
  try {
    return Intl.supportedValuesOf('region').filter((c) => c.length === 2)
  } catch {
    return ISO_3166_1_ALPHA2_FALLBACK.split(',')
  }
}

export function listCountryOptions(): { code: string; name: string }[] {
  const codes = regionCodes()
  let display: Intl.DisplayNames | null = null
  try {
    display = new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    display = null
  }
  return codes
    .map((code) => ({ code, name: display?.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name))
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
