'use strict';

const fs = require('fs');
const path = require('path');
const {
  TEMPORAL_DEFAULT_TASK_QUEUE,
  SETUP_RUN_WORKFLOW_NAME,
  SCRAPE_WORKFLOW_NAME,
  resolveTemporalTaskQueue,
} = require('../constants/temporalDefaults');
const { SETUP_RUN_WORKFLOW_ACTIVITIES } = require('../constants/setupWorkflow');
const activities = require('../activities');

describe('temporal orchestration config', () => {
  it('exposes stable default task queue for API and worker', () => {
    expect(TEMPORAL_DEFAULT_TASK_QUEUE).toBe('setup-run');
    expect(resolveTemporalTaskQueue()).toBe('setup-run');
  });

  it('uses shared task queue resolver in API workflow start sites', () => {
    const repoRoot = path.join(__dirname, '..');
    const files = [
      'api/v1/setupRuns.js',
      'api/v1/onboarding.js',
      'scripts/temporal-worker.js',
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      expect(src).toContain('resolveTemporalTaskQueue');
      expect(src).not.toMatch(/process\.env\.TEMPORAL_TASK_QUEUE\s*\|\|\s*['"]setup-run['"]/);
    }
  });

  it('registers every setupRunWorkflow activity on the worker bundle', () => {
    for (const name of SETUP_RUN_WORKFLOW_ACTIVITIES) {
      expect(typeof activities[name]).toBe('function');
    }
  });

  it('documents stable workflow names', () => {
    expect(SETUP_RUN_WORKFLOW_NAME).toBe('setupRunWorkflow');
    expect(SCRAPE_WORKFLOW_NAME).toBe('scrapeWorkflow');
  });
});

describe('temporal E2E mock client', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
    jest.resetModules();
  });

  it('rejects workflow start when task queue does not match configured queue', async () => {
    process.env.TEMPORAL_E2E_MOCK = 'true';
    process.env.TEMPORAL_TASK_QUEUE = 'setup-run';
    const { getTemporalClient } = require('../lib/temporalClient');
    const client = await getTemporalClient();

    await expect(
      client.workflow.start('setupRunWorkflow', {
        taskQueue: 'wrong-queue',
        workflowId: 'wf-test',
        args: [{ setupRunId: 'abc' }],
      })
    ).rejects.toThrow(/task queue mismatch/i);

    await expect(
      client.workflow.start('setupRunWorkflow', {
        taskQueue: resolveTemporalTaskQueue(),
        workflowId: 'wf-test-ok',
        args: [{ setupRunId: 'abc' }],
      })
    ).resolves.toBeUndefined();
  });
});
