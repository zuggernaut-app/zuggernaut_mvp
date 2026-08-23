'use strict';

const {
  inspectGtmTagArtifact,
  inspectPublishedGtmTag,
  summarizeGtmConversionTagInventory,
} = require('../lib/gtmConversionTagInventory');

describe('gtmConversionTagInventory', () => {
  it('flags artifact using ads customer id variable for conversionId', () => {
    const issues = inspectGtmTagArtifact({
      externalId: 'tag-1',
      metadata: {
        template: 'ads_conversion_form',
        bindsToAdsConversionId: '1002',
        gtmPayload: {
          parameter: [
            { key: 'conversionId', value: '{{Zuggernaut Ads Customer ID}}' },
            { key: 'conversionLabel', value: '{{Zuggernaut Form Conversion Label}}' },
          ],
        },
      },
    });
    expect(issues).toContain('uses_ads_customer_id_for_conversion_id');
  });

  it('flags published awct tag with numeric literal conversion label', () => {
    const issues = inspectPublishedGtmTag({
      type: 'awct',
      name: 'Zuggernaut Form Conversion',
      tagId: '7',
      parameter: [
        { key: 'conversionId', value: '1234567890' },
        { key: 'conversionLabel', value: '1002' },
      ],
    });
    expect(issues).toContain('uses_ads_customer_id_for_conversion_id');
    expect(issues).toContain('literal_api_id_used_as_conversion_label');
  });

  it('accepts correct awct variable references', () => {
    const issues = inspectPublishedGtmTag({
      type: 'awct',
      name: 'Zuggernaut Form Conversion',
      parameter: [
        { key: 'conversionId', value: '{{Zuggernaut Form Conversion ID}}' },
        { key: 'conversionLabel', value: '{{Zuggernaut Form Conversion Label}}' },
      ],
    });
    expect(issues).toHaveLength(0);
  });

  describe('summarizeGtmConversionTagInventory', () => {
    it('requires repair when affected artifacts exist', () => {
      const summary = summarizeGtmConversionTagInventory(
        { affected: [{ source: 'artifact' }] },
        { affected: [], skipped: [] },
      );
      expect(summary.repairRequired).toBe(true);
      expect(summary.provenClean).toBe(false);
      expect(summary.affected).toBe(1);
    });

    it('is proven clean when zero affected and zero skipped', () => {
      const summary = summarizeGtmConversionTagInventory(
        { affected: [] },
        { affected: [], skipped: [] },
      );
      expect(summary.repairRequired).toBe(false);
      expect(summary.provenClean).toBe(true);
      expect(summary.affected).toBe(0);
    });

    it('is not proven clean when published scans were skipped', () => {
      const summary = summarizeGtmConversionTagInventory(
        { affected: [] },
        {
          affected: [],
          skipped: [
            {
              businessId: 'bid',
              reason: 'GTM live version fetch skipped in mock mode',
            },
          ],
        },
      );
      expect(summary.repairRequired).toBe(true);
      expect(summary.provenClean).toBe(false);
      expect(summary.affected).toBe(0);
    });
  });
});
