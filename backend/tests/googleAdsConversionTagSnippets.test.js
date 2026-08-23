'use strict';

const {
  parseSendToFromEventSnippet,
  extractConversionMeasurementFromTagSnippets,
} = require('../lib/googleAdsConversionTagSnippets');

describe('googleAdsConversionTagSnippets', () => {
  it('parses send_to from event snippet', () => {
    const parsed = parseSendToFromEventSnippet(
      "gtag('event', 'conversion', {'send_to': 'AW-1234567890/AbCdEfGh'});"
    );
    expect(parsed).toEqual({
      conversionId: 'AW-1234567890',
      conversionLabel: 'AbCdEfGh',
    });
  });

  it('extracts measurement from tag snippets array', () => {
    const measurement = extractConversionMeasurementFromTagSnippets([
      {
        type: 'WEBPAGE',
        eventSnippet:
          "gtag('event', 'conversion', {'send_to': 'AW-999/label_xyz'});",
      },
    ]);
    expect(measurement).toEqual(
      expect.objectContaining({
        conversionId: 'AW-999',
        conversionLabel: 'label_xyz',
      })
    );
  });
});
