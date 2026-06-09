'use strict';

jest.mock('../lib/temporalClient', () => ({
  getTemporalClient: jest.fn(),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');
const { getTemporalClient } = require('../lib/temporalClient');

describe('integration diagnostics API', () => {
  const app = createApp();
  const prevFlag = process.env.ENABLE_INTEGRATION_DIAGNOSTICS;
  const prevNodeEnv = process.env.NODE_ENV;
  const workflowStart = jest.fn().mockResolvedValue(undefined);

  beforeAll(() => {
    process.env.ENABLE_INTEGRATION_DIAGNOSTICS = 'true';
    process.env.NODE_ENV = 'development';
  });

  beforeEach(() => {
    workflowStart.mockClear();
    getTemporalClient.mockResolvedValue({
      workflow: { start: workflowStart },
    });
  });

  afterAll(() => {
    if (prevFlag === undefined) delete process.env.ENABLE_INTEGRATION_DIAGNOSTICS;
    else process.env.ENABLE_INTEGRATION_DIAGNOSTICS = prevFlag;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  it('returns 404 when diagnostics flag is disabled', async () => {
    process.env.ENABLE_INTEGRATION_DIAGNOSTICS = 'false';
    const { agent } = await registerAgent(app, 'diag-off@test.com');
    await agent.post('/api/v1/dev/integrations/sandbox-business').expect(404);
    process.env.ENABLE_INTEGRATION_DIAGNOSTICS = 'true';
  });

  it('returns 401 without auth', async () => {
    await request(app).post('/api/v1/dev/integrations/sandbox-business').expect(401);
  });

  it('creates sandbox business and returns overview without secrets', async () => {
    const { agent } = await registerAgent(app, 'diag-sandbox@test.com');

    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);
    expect(sandbox.body.businessId).toBeTruthy();
    expect(sandbox.body.created).toBe(true);

    const overview = await agent
      .get('/api/v1/dev/integrations/overview')
      .query({ businessId: sandbox.body.businessId })
      .expect(200);

    expect(overview.body.businessId).toBe(sandbox.body.businessId);
    expect(overview.body.connections.gtm).toBeDefined();
    expect(overview.body.environment).toBeDefined();
    expect(JSON.stringify(overview.body)).not.toMatch(
      /accessToken|refreshToken|GOOGLE_CLIENT_SECRET|DEVELOPER_TOKEN/i,
    );

    const second = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(200);
    expect(second.body.created).toBe(false);
  });

  it('returns dev connect URL with return path in OAuth state', async () => {
    const { agent } = await registerAgent(app, 'diag-url@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);
    const bid = sandbox.body.businessId;

    const res = await agent
      .get('/api/v1/dev/integrations/google/google_ads/connect-url')
      .query({ businessId: bid })
      .expect(200);

    expect(res.body.url).toContain('accounts.google.com');
    const url = new URL(res.body.url);
    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();

    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(state, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    expect(payload.returnPath).toBe('/dev/integrations');
  });

  it('returns Google Ads OAuth lab connect URL and oauth trace stages', async () => {
    const { agent } = await registerAgent(app, 'diag-oauth-lab@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);
    const bid = sandbox.body.businessId;

    const connect = await agent
      .get('/api/v1/dev/integrations/googleads/connect-url')
      .query({ businessId: bid })
      .expect(200);

    expect(connect.body.returnPath).toBe('/dev/integrations/googleads');
    expect(connect.body.url).toContain('accounts.google.com');

    const trace = await agent
      .get('/api/v1/dev/integrations/googleads/oauth-trace')
      .query({ businessId: bid })
      .expect(409);

    expect(trace.body.result.provider).toBe('google_ads');
    expect(Array.isArray(trace.body.result.stages)).toBe(true);
    expect(trace.body.result.stages.some((s) => s.id === 'stored_connection')).toBe(true);
  });

  it('smoke test returns 409 when provider not connected', async () => {
    const { agent } = await registerAgent(app, 'diag-smoke@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);

    const res = await agent
      .post('/api/v1/dev/integrations/google_ads/smoke-test')
      .send({ businessId: sandbox.body.businessId })
      .expect(409);

    expect(res.body.result.ok).toBe(false);
  });

  it('starts sandbox scrape and polls scrape run', async () => {
    const { agent } = await registerAgent(app, 'diag-scrape@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);
    const bid = sandbox.body.businessId;

    const started = await agent
      .post('/api/v1/dev/integrations/scrape')
      .send({ businessId: bid, websiteUrl: 'https://scrape.example.com' })
      .expect(202);

    expect(started.body.scrapeRunId).toBeTruthy();
    expect(started.body.workflowId).toMatch(/^scrape-/);
    expect(started.body.status).toBe('RUNNING');
    expect(workflowStart).toHaveBeenCalled();

    const polled = await agent
      .get(`/api/v1/dev/integrations/scrape-runs/${started.body.scrapeRunId}`)
      .query({ businessId: bid })
      .expect(200);

    expect(polled.body.scrapeRun.id).toBe(started.body.scrapeRunId);
    expect(polled.body.scrapeRun.websiteUrl).toBe('https://scrape.example.com');
  });

  it('rejects scrape with invalid URL', async () => {
    const { agent } = await registerAgent(app, 'diag-scrape-bad@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);

    const res = await agent
      .post('/api/v1/dev/integrations/scrape')
      .send({ businessId: sandbox.body.businessId, websiteUrl: 'not-a-url' })
      .expect(400);

    expect(res.body.error).toBe('validation_error');
  });

  it('provisioning check works for gtm', async () => {
    const { agent } = await registerAgent(app, 'diag-prov@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);

    const res = await agent
      .get('/api/v1/dev/integrations/gtm/provisioning-check')
      .query({ businessId: sandbox.body.businessId })
      .expect(200);

    expect(res.body.provider).toBe('gtm');
    expect(typeof res.body.provisioningRequired).toBe('boolean');
  });

  it('returns 404 for creation diagnostics when diagnostics flag is disabled', async () => {
    process.env.ENABLE_INTEGRATION_DIAGNOSTICS = 'false';
    const { agent } = await registerAgent(app, 'diag-create-off@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(404);
    expect(sandbox.body).toBeDefined();
    await agent
      .post('/api/v1/dev/integrations/gtm/create-diagnostics')
      .send({ businessId: '000000000000000000000000', confirmCreateExternalResources: true })
      .expect(404);
    process.env.ENABLE_INTEGRATION_DIAGNOSTICS = 'true';
  });

  it('requires confirmation flag for creation diagnostics', async () => {
    const { agent } = await registerAgent(app, 'diag-create-confirm@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);

    const res = await agent
      .post('/api/v1/dev/integrations/gtm/create-diagnostics')
      .send({ businessId: sandbox.body.businessId, mode: 'create_paused' })
      .expect(400);

    expect(res.body.error).toBe('validation_error');
    expect(res.body.message).toMatch(/confirmCreateExternalResources/i);
  });

  it('runs GTM creation diagnostics and fetches the persisted run', async () => {
    const mongoose = require('mongoose');
    const { encryptToken } = require('../lib/crypto/tokenEncryption');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { agent } = await registerAgent(app, 'diag-create-gtm@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);
    const bid = sandbox.body.businessId;

    await IntegrationConnection.create({
      businessId: bid,
      provider: 'gtm',
      connectionHealth: 'connected',
      scopes: [
        'https://www.googleapis.com/auth/tagmanager.edit.containers',
        'https://www.googleapis.com/auth/tagmanager.publish',
        'https://www.googleapis.com/auth/tagmanager.manage.accounts',
      ],
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: {
        accountId: '6357971694',
        containerId: '253902272',
        workspaceId: '2',
        publicContainerId: 'GTM-TEST',
      },
    });

    const created = await agent
      .post('/api/v1/dev/integrations/gtm/create-diagnostics')
      .send({
        businessId: bid,
        mode: 'create_paused',
        confirmCreateExternalResources: true,
      })
      .expect(200);

    expect(created.body.result.diagnosticRunId).toBeTruthy();
    expect(created.body.result.ok).toBe(true);

    const fetched = await agent
      .get(`/api/v1/dev/integrations/diagnostic-runs/${created.body.result.diagnosticRunId}`)
      .query({ businessId: bid })
      .expect(200);

    expect(fetched.body.result.diagnosticRunId).toBe(created.body.result.diagnosticRunId);
    expect(fetched.body.result.artifacts.length).toBeGreaterThan(0);
  });

  it('runs Google Ads creation diagnostics in mock mode', async () => {
    const mongoose = require('mongoose');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { agent } = await registerAgent(app, 'diag-create-ads@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);
    const bid = sandbox.body.businessId;

    await IntegrationConnection.create({
      businessId: bid,
      provider: 'google_ads',
      connectionHealth: 'connected',
      scopes: ['https://www.googleapis.com/auth/adwords'],
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: { customerId: '1234567890' },
    });

    const created = await agent
      .post('/api/v1/dev/integrations/google_ads/create-diagnostics')
      .send({
        businessId: bid,
        mode: 'create_paused',
        confirmCreateExternalResources: true,
      })
      .expect(200);

    expect(created.body.result.provider).toBe('google_ads');
    expect(created.body.result.summary.passed).toBeGreaterThan(0);
  });

  it('lists Google Ads resource options after OAuth', async () => {
    const { encryptToken } = require('../lib/crypto/tokenEncryption');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { agent } = await registerAgent(app, 'diag-ads-resources@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);
    const bid = sandbox.body.businessId;

    process.env.GOOGLE_ADS_API_MOCK = 'true';
    await IntegrationConnection.create({
      businessId: bid,
      provider: 'google_ads',
      connectionHealth: 'selection_required',
      scopes: ['https://www.googleapis.com/auth/adwords'],
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: {
        accessibleCustomerIds: ['1234567890', '9876543210'],
      },
    });

    const res = await agent
      .get('/api/v1/dev/integrations/google_ads/resources')
      .query({ businessId: bid })
      .expect(200);

    expect(res.body.result.provider).toBe('google_ads');
    expect(res.body.result.selectionRequired).toBe(true);
    expect(res.body.result.options.length).toBeGreaterThan(0);
  });

  it('persists Google Ads customer selection via dev API', async () => {
    const { encryptToken } = require('../lib/crypto/tokenEncryption');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { agent } = await registerAgent(app, 'diag-ads-select@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);
    const bid = sandbox.body.businessId;

    process.env.GOOGLE_ADS_API_MOCK = 'true';
    await IntegrationConnection.create({
      businessId: bid,
      provider: 'google_ads',
      connectionHealth: 'selection_required',
      scopes: ['https://www.googleapis.com/auth/adwords'],
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: {
        accessibleCustomerIds: ['1234567890'],
      },
    });

    const saved = await agent
      .post('/api/v1/dev/integrations/google_ads/selection')
      .send({ businessId: bid, customerId: '1234567890' })
      .expect(200);

    expect(saved.body.result.selected.customerId).toBe('1234567890');

    const conn = await IntegrationConnection.findOne({ businessId: bid, provider: 'google_ads' }).lean();
    expect(conn.connectionHealth).toBe('connected');
    expect(conn.providerIdentifiers.customerId).toBe('1234567890');
  });

  it('lists GTM resource options after OAuth', async () => {
    const { encryptToken } = require('../lib/crypto/tokenEncryption');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { agent } = await registerAgent(app, 'diag-gtm-resources@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);
    const bid = sandbox.body.businessId;

    process.env.GTM_API_MOCK = 'true';
    await IntegrationConnection.create({
      businessId: bid,
      provider: 'gtm',
      connectionHealth: 'selection_required',
      scopes: [
        'https://www.googleapis.com/auth/tagmanager.edit.containers',
        'https://www.googleapis.com/auth/tagmanager.publish',
        'https://www.googleapis.com/auth/tagmanager.manage.accounts',
      ],
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: { discoveredAccountCount: 1 },
    });

    const res = await agent
      .get('/api/v1/dev/integrations/gtm/resources')
      .query({ businessId: bid })
      .expect(200);

    expect(res.body.result.provider).toBe('gtm');
    expect(res.body.result.accounts.length).toBeGreaterThan(0);
  });

  it('returns 409 for GTM creation diagnostics when selection is required', async () => {
    const { encryptToken } = require('../lib/crypto/tokenEncryption');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { agent } = await registerAgent(app, 'diag-gtm-create-gate@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);
    const bid = sandbox.body.businessId;

    await IntegrationConnection.create({
      businessId: bid,
      provider: 'gtm',
      connectionHealth: 'selection_required',
      scopes: [
        'https://www.googleapis.com/auth/tagmanager.edit.containers',
        'https://www.googleapis.com/auth/tagmanager.publish',
        'https://www.googleapis.com/auth/tagmanager.manage.accounts',
      ],
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: { discoveredAccountCount: 1 },
    });

    const created = await agent
      .post('/api/v1/dev/integrations/gtm/create-diagnostics')
      .send({
        businessId: bid,
        mode: 'create_paused',
        confirmCreateExternalResources: true,
      })
      .expect(409);

    expect(created.body.result.errorCode).toBe('SELECTION_REQUIRED');
  });

  it('returns 409 for Google Ads creation diagnostics when selection is required', async () => {
    const { encryptToken } = require('../lib/crypto/tokenEncryption');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { agent } = await registerAgent(app, 'diag-ads-create-gate@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);
    const bid = sandbox.body.businessId;

    await IntegrationConnection.create({
      businessId: bid,
      provider: 'google_ads',
      connectionHealth: 'selection_required',
      scopes: ['https://www.googleapis.com/auth/adwords'],
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: { accessibleCustomerIds: ['1234567890'] },
    });

    const created = await agent
      .post('/api/v1/dev/integrations/google_ads/create-diagnostics')
      .send({
        businessId: bid,
        mode: 'create_paused',
        confirmCreateExternalResources: true,
      })
      .expect(409);

    expect(created.body.result.errorCode).toBe('SELECTION_REQUIRED');
  });

  it('persists GTM selection via dev API', async () => {
    const { encryptToken } = require('../lib/crypto/tokenEncryption');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { agent } = await registerAgent(app, 'diag-gtm-select@test.com');
    const sandbox = await agent.post('/api/v1/dev/integrations/sandbox-business').expect(201);
    const bid = sandbox.body.businessId;

    process.env.GTM_API_MOCK = 'true';
    await IntegrationConnection.create({
      businessId: bid,
      provider: 'gtm',
      connectionHealth: 'selection_required',
      scopes: [
        'https://www.googleapis.com/auth/tagmanager.edit.containers',
        'https://www.googleapis.com/auth/tagmanager.publish',
        'https://www.googleapis.com/auth/tagmanager.manage.accounts',
      ],
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: { discoveredAccountCount: 1 },
    });

    const saved = await agent
      .post('/api/v1/dev/integrations/gtm/selection')
      .send({
        businessId: bid,
        accountId: 'mock-account',
        containerId: 'mock-container',
        workspaceId: 'mock-workspace',
      })
      .expect(200);

    expect(saved.body.result.selected.workspaceId).toBe('mock-workspace');

    const conn = await IntegrationConnection.findOne({ businessId: bid, provider: 'gtm' }).lean();
    expect(conn.connectionHealth).toBe('connected');
    expect(conn.providerIdentifiers.containerId).toBe('mock-container');
  });
});
