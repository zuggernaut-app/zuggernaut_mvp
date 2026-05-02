'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { createDevUser, authHeader } = require('./helpers');

describe('POST /api/v1/onboarding', () => {
  const app = createApp();

  it('sets primaryBusinessId only when missing', async () => {
    const user = await createDevUser('primary@test.com');
    const h = authHeader(user);

    const first = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);
    await mongoose.model('User').findByIdAndUpdate(user._id, {
      primaryBusinessId: first.body.businessId,
    });

    const second = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);

    expect(second.body.businessId).not.toBe(first.body.businessId);

    const refreshed = await mongoose.model('User').findById(user._id).lean();
    expect(refreshed.primaryBusinessId.toString()).toBe(first.body.businessId);
  });

  it('rejects scrape with invalid businessId', async () => {
    const user = await createDevUser();
    const res = await request(app)
      .post('/api/v1/onboarding/business/not-an-id/scrape')
      .set(authHeader(user))
      .send({ websiteUrl: 'https://example.com' })
      .expect(400);

    expect(res.body.error).toBe('validation_error');
  });

  it('rejects scrape with bad URL', async () => {
    const user = await createDevUser();
    const draft = await request(app).post('/api/v1/onboarding/business').set(authHeader(user)).expect(201);

    const res = await request(app)
      .post(`/api/v1/onboarding/business/${draft.body.businessId}/scrape`)
      .set(authHeader(user))
      .send({ websiteUrl: 'ftp://bad' })
      .expect(400);

    expect(res.body.error).toBe('validation_error');
  });

  it('404 when scraping another users draft', async () => {
    const u1 = await createDevUser('a@test.com');
    const u2 = await createDevUser('b@test.com');
    const draft = await request(app).post('/api/v1/onboarding/business').set(authHeader(u1)).expect(201);

    await request(app)
      .post(`/api/v1/onboarding/business/${draft.body.businessId}/scrape`)
      .set(authHeader(u2))
      .send({ websiteUrl: 'https://example.com' })
      .expect(404);
  });

  it('appends raw scrape runs', async () => {
    const user = await createDevUser('runs@test.com');
    const h = authHeader(user);
    const draft = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);
    const bid = draft.body.businessId;

    await request(app)
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .set(h)
      .send({ websiteUrl: 'https://one.example.com' })
      .expect(200);

    await request(app)
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .set(h)
      .send({ websiteUrl: 'https://two.example.com' })
      .expect(200);

    const BusinessContext = mongoose.model('BusinessContext');
    const doc = await BusinessContext.findOne({
      businessId: new mongoose.Types.ObjectId(bid),
    })
      .select('+rawScrapeOutput')
      .lean();

    expect(doc.rawScrapeOutput.runs.length).toBe(2);
    expect(doc.websiteUrl).toBe('https://two.example.com');
  });
});
