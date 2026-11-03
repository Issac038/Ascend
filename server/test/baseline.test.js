// AI-free regression suite for the real /api/baseline route.
'use strict';

const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const JWT_SECRET = 'baseline-test-secret';
const previousJwtSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const modelPath = require.resolve('../models/Baseline');
const routePath = require.resolve('../routes/baseline');

const records = new Map();
beforeEach(() => records.clear());

const modelMock = {
  async findOne({ userId }) { return records.get(String(userId)) || null; },
  async findOneAndUpdate({ userId }, update) {
    const key = String(userId);
    const previous = records.get(key) || { userId };
    const doc = { ...previous, ...update.$set, userId: key, save: async function () {} };
    records.set(key, doc);
    return doc;
  }
};

require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: modelMock };
delete require.cache[routePath];
const baselineRouter = require('../routes/baseline');
delete require.cache[modelPath];

function makeUserToken(userId = 'baseline-test-user') {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
}

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.cookies?.token) {
    try { req.userId = jwt.verify(req.cookies.token, JWT_SECRET).userId; } catch (e) { /* fall through */ }
  }
  next();
});
app.use('/api/baseline', baselineRouter);

test.after(() => {
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
});

const MOCK_BASELINE = {
  answers: { body: 1, discipline: 5, learning: 10, productivity: 7, goalDrive: 'I am training for a race.' },
  assessments: {
    body: { score: 1, explanation: 'Self-reported rating (1/10).', confidence: null, followUpQuestion: null, insufficient: false },
    discipline: { score: 5, explanation: 'Self-reported rating (5/10).', confidence: null, followUpQuestion: null, insufficient: false },
    learning: { score: 10, explanation: 'Self-reported rating (10/10).', confidence: null, followUpQuestion: null, insufficient: false },
    productivity: { score: 7, explanation: 'Self-reported rating (7/10).', confidence: null, followUpQuestion: null, insufficient: false },
    goalDrive: { score: null, explanation: 'Saved as personal motivation and is not scored.', confidence: null, followUpQuestion: null, insufficient: true }
  },
  status: 'draft',
  assessedAt: new Date('2026-01-01T00:00:00Z'),
  confirmedAt: null,
  rubricVersion: '2.0',
  model: '',
  assessmentMethod: 'self-reported'
};

test('baseline route requires authentication', async () => {
  const response = await request(app).post('/api/baseline/assess').send({ answers: MOCK_BASELINE.answers });
  assert.equal(response.status, 401);
});

test('numeric slider payload passes the real route validation and persists the five categories', async () => {
  const response = await request(app)
    .post('/api/baseline/assess')
    .set('Cookie', 'token=' + makeUserToken())
    .send({ answers: MOCK_BASELINE.answers });
  assert.equal(response.status, 200);
  assert.equal(response.body.overallRating, 5.75);
  assert.deepEqual(response.body.baseline.answers, MOCK_BASELINE.answers);
  assert.equal(response.body.baseline.assessments.goalDrive.score, null);
  assert.equal(response.body.baseline.assessmentMethod, 'self-reported');
  assert.equal('provider' in response.body, false);
  assert.equal('aiCalled' in response.body, false);
});

test('the active route accepts every integer slider rating from 1 through 10', async () => {
  for (let rating = 1; rating <= 10; rating += 1) {
    const answers = { body: rating, discipline: rating, learning: rating, productivity: rating, goalDrive: 'Keep going.' };
    const response = await request(app)
      .post('/api/baseline/assess')
      .set('Cookie', 'token=' + makeUserToken())
      .send({ answers });
    assert.equal(response.status, 200, 'rating ' + rating + ' should be accepted');
    assert.equal(response.body.overallRating, rating);
  }
});

test('the route rejects strings, decimals, and out-of-range values for slider answers', async () => {
  const invalidCases = [
    { key: 'body', value: '1', message: 'body must be an integer from 1 to 10' },
    { key: 'discipline', value: 1.5, message: 'discipline must be an integer from 1 to 10' },
    { key: 'learning', value: 0, message: 'learning must be an integer from 1 to 10' },
    { key: 'productivity', value: 11, message: 'productivity must be an integer from 1 to 10' }
  ];
  for (const invalid of invalidCases) {
    const answers = { ...MOCK_BASELINE.answers, [invalid.key]: invalid.value };
    const response = await request(app)
      .post('/api/baseline/assess')
      .set('Cookie', 'token=' + makeUserToken())
      .send({ answers });
    assert.equal(response.status, 400, 'expected 400 for ' + invalid.key);
    assert.match(response.body.message, new RegExp(invalid.message));
  }
});

test('a confirmed baseline is preserved and not overwritten by a new slider submission', async () => {
  const doc = { userId: 'baseline-test-user', answers: { body: 9, discipline: 8, learning: 7, productivity: 6, goalDrive: 'Preserved.' }, status: 'confirmed', save: async function () {} };
  records.set('baseline-test-user', doc);
  const preserved = { ...doc.answers };
  const response = await request(app)
    .post('/api/baseline/assess')
    .set('Cookie', 'token=' + makeUserToken('baseline-test-user'))
    .send({ answers: MOCK_BASELINE.answers });
  assert.equal(response.status, 409);
  const refreshed = records.get('baseline-test-user');
  assert.ok(refreshed, 'doc should still be stored');
  assert.deepEqual(refreshed.answers, preserved);
});

test('only the four slider keys reach the local scoring service', async () => {
  const response = await request(app)
    .post('/api/baseline/assess')
    .set('Cookie', 'token=' + makeUserToken())
    .send({ answers: MOCK_BASELINE.answers });
  assert.equal(response.status, 200);
  assert.deepEqual(
    Object.fromEntries(['body', 'discipline', 'learning', 'productivity'].map((key) => [
      key,
      response.body.baseline.assessments[key].score
    ])),
    { body: 1, discipline: 5, learning: 10, productivity: 7 }
  );
  assert.equal(response.body.baseline.assessments.goalDrive.score, null);
});
