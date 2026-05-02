'use strict';

const request = require('supertest');
const { createApp } = require('../app');
const { createDevUser, authHeader } = require('./helpers');

describe('PUT /api/v1/business-contexts', () => {
  const app = createApp();

  async function draftAndConfirmHeaders(email) {
    const user = await createDevUser(email);
    const h = authHeader(user);
    const draft = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);
    const bid = draft.body.businessId;
    await request(app)
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .set(h)
      .send({ websiteUrl: 'https://example.com' })
      .expect(200);

    const res = await request(app).put(`/api/v1/business-contexts/${bid}`).set(h).send({
      businessName: 'Acme',
      services: [' one ', 'two'],
      contactMethods: { phone: '1' },
    });

    expect(res.status).toBe(200);
    expect(res.body.businessContext.confirmedAt).toBeTruthy();

    return { user, h, bid };
  }

  it('returns 400 for invalid businessId', async () => {
    const user = await createDevUser();
    const res = await request(app)
      .put('/api/v1/business-contexts/not-an-object-id')
      .set(authHeader(user))
      .send({ businessName: 'X' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('422-ish validation for invalid services type', async () => {
    const user = await createDevUser();
    const h = authHeader(user);
    const draft = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);
    const bid = draft.body.businessId;

    const res = await request(app).put(`/api/v1/business-contexts/${bid}`).set(h).send({
      services: 'not-array',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('404 when updating another users business', async () => {
    const { bid } = await draftAndConfirmHeaders('owner@test.com');
    const other = await createDevUser('other@test.com');

    await request(app)
      .put(`/api/v1/business-contexts/${bid}`)
      .set(authHeader(other))
      .send({ businessName: 'X' })
      .expect(404);
  });

  it('clears optional fields with empty string', async () => {
    const { h, bid } = await draftAndConfirmHeaders('clear@test.com');

    const res = await request(app).put(`/api/v1/business-contexts/${bid}`).set(h).send({
      differentiators: '',
    });

    expect(res.status).toBe(200);
    expect(res.body.businessContext.differentiators).toBeNull();
  });
});
