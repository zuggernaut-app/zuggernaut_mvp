'use strict';

function resolvePrimaryGoal(goals) {
  const raw = goals?.primary;
  if (raw == null || raw === '') return 'both';
  const p = String(raw).toLowerCase();
  if (p === 'calls' || p === 'call') return 'calls';
  if (p === 'forms' || p === 'form' || p === 'leads' || p === 'lead') return 'forms';
  if (p === 'both') return 'both';
  return 'both';
}

/**
 * @param {string | null | undefined} dateRaw
 * @param {Date} startedAt
 */
function isConversionAfterStart(dateRaw, startedAt) {
  if (!dateRaw || !startedAt) return false;
  const parsed = new Date(dateRaw);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() >= startedAt.getTime();
}

/**
 * @param {object[]} actions
 * @param {'forms' | 'calls'} goal
 */
function pickConversionForGoal(actions, goal) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  if (goal === 'calls') {
    return (
      actions.find((a) => a.category === 'PHONE_CALL_LEAD' || a.type === 'AD_CALL') ?? null
    );
  }
  return (
    actions.find((a) => a.category === 'SUBMIT_LEAD_FORM' || a.type === 'WEBPAGE') ?? actions[0]
  );
}

/**
 * @param {object | null | undefined} trackingTestResult
 * @param {object | null | undefined} goals
 */
function trackingTestPassedForRun(trackingTestResult, goals) {
  const primary = resolvePrimaryGoal(goals);
  const required = [];
  if (primary === 'forms' || primary === 'both') required.push('forms');
  if (primary === 'calls' || primary === 'both') required.push('calls');
  if (required.length === 0) return true;
  if (!trackingTestResult || typeof trackingTestResult !== 'object') return false;
  return required.every((g) => trackingTestResult[g] === 'pass');
}

module.exports = {
  isConversionAfterStart,
  pickConversionForGoal,
  trackingTestPassedForRun,
};
