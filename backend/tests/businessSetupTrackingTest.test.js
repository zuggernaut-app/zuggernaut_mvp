'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isConversionAfterStart,
  pickConversionForGoal,
  trackingTestPassedForRun,
} = require('../services/capabilities/businessSetupTrackingTestLogic');
describe('businessSetupTrackingTestService', () => {
  it('isConversionAfterStart compares dates against test start', () => {
    const started = new Date('2026-01-01T12:00:00.000Z');
    assert.equal(isConversionAfterStart('2026-01-02', started), true);
    assert.equal(isConversionAfterStart('2025-12-01', started), false);
    assert.equal(isConversionAfterStart(null, started), false);
  });

  it('pickConversionForGoal selects form and call actions', () => {
    const actions = [
      { category: 'PHONE_CALL_LEAD', type: 'AD_CALL', externalId: '1' },
      { category: 'SUBMIT_LEAD_FORM', type: 'WEBPAGE', externalId: '2' },
    ];
    assert.equal(pickConversionForGoal(actions, 'calls')?.externalId, '1');
    assert.equal(pickConversionForGoal(actions, 'forms')?.externalId, '2');
  });

  it('trackingTestPassedForRun requires pass for each primary goal', () => {
    assert.equal(
      trackingTestPassedForRun({ forms: 'pass', calls: 'pass' }, { primary: 'both' }),
      true
    );
    assert.equal(
      trackingTestPassedForRun({ forms: 'not_fired', calls: 'pass' }, { primary: 'both' }),
      false
    );
  });
});
