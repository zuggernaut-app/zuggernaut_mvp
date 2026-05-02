'use strict';

const request = require('supertest');
const { createApp } = require('../app');
const { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH } = require('../lib/validation');

describe('POST /api/v1/users', () => {
  const app = createApp();

  it('creates a user with normalized email', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .send({ email: '  Hello@Example.COM ', name: 'Ada' })
      .expect(201);

    expect(res.body.user.email).toBe('hello@example.com');
    expect(res.body.user.name).toBe('Ada');
    expect(res.body.user.id).toMatch(/^[a-f0-9]{24}$/);
  });

  it('allows optional empty name', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .send({ email: 'only@example.com', name: '' })
      .expect(201);

    expect(res.body.user.name).toBeNull();
  });

  it('rejects missing email', async () => {
    const res = await request(app).post('/api/v1/users').send({}).expect(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('rejects duplicate email', async () => {
    await request(app).post('/api/v1/users').send({ email: 'dup@example.com' }).expect(201);

    const res = await request(app)
      .post('/api/v1/users')
      .send({ email: 'dup@example.com' })
      .expect(409);

    expect(res.body.error).toBe('conflict');
  });

  it('rejects invalid ObjectId-looking email via format rule', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .send({ email: 'not-an-email' })
      .expect(400);

    expect(res.body.message).toMatch(/invalid/i);
  });

  it('rejects email over max length', async () => {
    const email = `${'b'.repeat(MAX_EMAIL_LENGTH)}x@z.co`;
    expect(email.length).toBeGreaterThan(MAX_EMAIL_LENGTH);

    const res = await request(app).post('/api/v1/users').send({ email }).expect(400);

    expect(res.body.error).toBe('validation_error');
  });

  it('rejects name over max length', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .send({ email: 'longname@example.com', name: 'y'.repeat(MAX_NAME_LENGTH + 1) })
      .expect(400);

    expect(res.body.error).toBe('validation_error');
  });
});
