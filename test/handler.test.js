import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.LOG_LEVEL = 'ERROR';
const { handler } = await import('../app/handler.js');

const sample = JSON.parse(readFileSync(new URL('../sample/events.json', import.meta.url), 'utf8'));
const httpEvent = (body, extra = {}) => ({
  body: typeof body === 'string' ? body : JSON.stringify(body),
  isBase64Encoded: false,
  requestContext: { http: { method: 'POST', path: '/events' } },
  ...extra,
});

test('direct invocation returns { results, stats }', async () => {
  const out = await handler(sample, { awsRequestId: 'r1' });
  assert.equal(out.stats.stored, 4);
  assert.equal(out.results.length, 7);
});

test('direct invocation with { events } wrapper', async () => {
  const out = await handler({ events: [sample[2]] });
  assert.deepEqual(out.stats, { events: 1, stored: 1, rejected: 0 });
});

test('direct invocation with a bad payload throws', async () => {
  await assert.rejects(handler({ nope: true }), (e) => e.code === 'invalid_request');
});

test('HTTP API event returns 200 with a JSON body', async () => {
  const res = await handler(httpEvent(sample));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).stats.rejected, 3);
});

test('HTTP: base64 body is decoded', async () => {
  const body = Buffer.from(JSON.stringify([sample[3]])).toString('base64');
  const res = await handler(httpEvent(body, { isBase64Encoded: true }));
  assert.equal(JSON.parse(res.body).stats.stored, 1);
});

test('HTTP: malformed / empty body -> 400 invalid_request', async () => {
  for (const body of ['{not json', '', '{"foo":1}']) {
    const res = await handler(httpEvent(body));
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'invalid_request');
  }
});
