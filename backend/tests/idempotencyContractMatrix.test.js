'use strict';

const fs = require('fs');
const path = require('path');
const { PROVIDER_MUTATION_CONTRACT } = require('../constants/idempotency');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');

/**
 * Each row maps a PROVIDER_MUTATION_CONTRACT entry to a real test that proves
 * lookup-before-create (or read-only external) behavior. Rows without coverage
 * must set `gap: true` with an explicit TODO — never paper over missing tests.
 */
const COVERAGE_MATRIX = Object.freeze([
  {
    stepName: SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES,
    testFile: 'gtmProvisioningService.test.js',
    testName: 'reuses artifacts on retry without duplicate create calls',
  },
  {
    stepName: SETUP_STEP_NAMES.PROVISION_GOOGLE_ADS_CUSTOMER,
    testFile: 'adsProvisioningService.test.js',
    testName: 'reuses artifacts on retry without duplicate create calls',
  },
  {
    stepName: SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
    testFile: 'gtmConversionSetupService.test.js',
    testName: 'persists artifacts and snapshot idempotently on retry',
  },
  {
    stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
    testFile: 'adsAutoCampaignService.test.js',
    testName: 'resumes from existing budget and campaign artifacts on partial retry',
  },
  {
    stepName: SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG,
    testFile: 'adsConversionCatalogService.test.js',
    testName: 'selects one artifact for calls goal using mock catalog',
    note: 'readOnlyExternal — catalog fetch does not mutate Google Ads',
  },
  {
    stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
    testFile: 'conversionActionRequirements.test.js',
    testName: 'reuses existing artifact without creating again',
  },
]);

const TESTS_DIR = path.join(__dirname);

function readTestFile(relPath) {
  return fs.readFileSync(path.join(TESTS_DIR, relPath), 'utf8');
}

function assertTestExists(row) {
  if (row.gap) {
    expect(typeof row.gapTodo).toBe('string');
    expect(row.gapTodo.length).toBeGreaterThan(0);
    return;
  }

  expect(row.testFile).toBeTruthy();
  expect(row.testName).toBeTruthy();
  expect(fs.existsSync(path.join(TESTS_DIR, row.testFile))).toBe(true);

  const src = readTestFile(row.testFile);
  expect(src).toContain(`it('${row.testName}'`);
}

describe('PROVIDER_MUTATION_CONTRACT coverage matrix', () => {
  it('has one matrix row per contract entry', () => {
    const contractSteps = PROVIDER_MUTATION_CONTRACT.map((row) => row.stepName).sort();
    const matrixSteps = COVERAGE_MATRIX.map((row) => row.stepName).sort();
    expect(matrixSteps).toEqual(contractSteps);
  });

  it.each(COVERAGE_MATRIX)('$stepName references a real artifact-lookup test or explicit gap', (row) => {
    const contract = PROVIDER_MUTATION_CONTRACT.find((entry) => entry.stepName === row.stepName);
    expect(contract).toBeDefined();
    assertTestExists(row);
  });

  it('documents read-only catalog contract separately from mutating steps', () => {
    const catalog = PROVIDER_MUTATION_CONTRACT.find(
      (row) => row.stepName === SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG
    );
    expect(catalog?.readOnlyExternal).toBe(true);
    const matrixRow = COVERAGE_MATRIX.find(
      (row) => row.stepName === SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG
    );
    expect(matrixRow?.note).toMatch(/readOnlyExternal/i);
  });
});
