'use strict';

const {
  sanitizeKeywordText,
  sanitizeKeywordSeeds,
  validateKeywordCompliance,
  isKeywordTextCompliant,
  assertGoogleAdsCampaignCompliance,
} = require('../services/capabilities/googleAdsCampaignComplianceService');
const { ADS_INTENT_CODES } = require('../constants/adsCampaignIntent');

describe('googleAdsCampaignComplianceService', () => {
  it.each([
    ['tax prep & bookkeeping', 'tax prep bookkeeping'],
    ['#1 dentist near me!', '1 dentist near me'],
    ['HVAC repair/service', 'HVAC repair service'],
    ["women's health clinic", 'womens health clinic'],
    ['24/7 emergency plumber', '24 7 emergency plumber'],
    ['emoji 🚀 marketing', 'emoji marketing'],
  ])('sanitizeKeywordText(%j) => %j', (raw, expected) => {
    expect(sanitizeKeywordText(raw).text).toBe(expected);
  });

  it('rejects seeds that sanitize to empty', () => {
    const { keywords, rejected } = sanitizeKeywordSeeds(['(((( ))))', 'valid plumber']);

    expect(keywords).toEqual([{ text: 'valid plumber', matchType: 'PHRASE' }]);
    expect(rejected).toEqual([
      expect.objectContaining({ raw: '(((( ))))', reason: ADS_INTENT_CODES.KEYWORD_SANITIZED_EMPTY }),
    ]);
  });

  it('deduplicates keywords after sanitization', () => {
    const { keywords } = sanitizeKeywordSeeds([
      'tax prep & bookkeeping',
      'tax prep bookkeeping',
      'Tax Prep Bookkeeping',
    ]);

    expect(keywords).toHaveLength(1);
    expect(keywords[0].text).toBe('tax prep bookkeeping');
  });

  it('limits keyword text to 10 words', () => {
    const longPhrase = 'one two three four five six seven eight nine ten eleven twelve';
    const result = sanitizeKeywordText(longPhrase);

    expect(result.text.split(' ')).toHaveLength(10);
    expect(result.text).toBe('one two three four five six seven eight nine ten');
  });

  it('validateKeywordCompliance fails for invalid characters', () => {
    const result = validateKeywordCompliance([{ text: 'bad#keyword', matchType: 'PHRASE' }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_INTENT_CODES.KEYWORD_INVALID_CHARS);
  });

  it('validateKeywordCompliance fails for too many words', () => {
    const result = validateKeywordCompliance([
      {
        text: 'one two three four five six seven eight nine ten eleven',
        matchType: 'PHRASE',
      },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_INTENT_CODES.KEYWORD_TOO_MANY_WORDS);
  });

  it('validateKeywordCompliance passes for compliant keywords', () => {
    const result = validateKeywordCompliance([
      { text: 'plumbing Springfield', matchType: 'PHRASE' },
      { text: 'emergency plumber', matchType: 'PHRASE' },
    ]);

    expect(result.ok).toBe(true);
  });

  it('assertGoogleAdsCampaignCompliance throws before mutate on unsafe keywords', () => {
    expect(() =>
      assertGoogleAdsCampaignCompliance({
        keywords: [{ text: 'bad#keyword', matchType: 'PHRASE' }],
      })
    ).toThrow('Keyword text contains invalid characters or symbols.');

    expect(isKeywordTextCompliant('plumbing Springfield')).toBe(true);
  });
});
