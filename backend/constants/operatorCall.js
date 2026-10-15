'use strict';

const OPERATOR_LIST_STATUSES = Object.freeze([
  'signup_not_finished',
  'signup_complete',
  'snippet_pending',
  'needs_operator_follow_up',
  'awaiting_test_lead',
  'finished',
]);

const OPERATOR_CALL_STEPS = Object.freeze([
  'before_page_source',
  'call_account_settings',
  'call_business_answers',
  'call_website',
  'call_goal_choice',
  'call_permission',
  'call_snippet_new',
  'call_snippet_existing_gtm',
  'call_snippet_pasted',
  'call_close',
  'after_page_source',
  'after_form_result',
  'after_test_lead_passed',
]);

module.exports = {
  OPERATOR_LIST_STATUSES,
  OPERATOR_CALL_STEPS,
};
