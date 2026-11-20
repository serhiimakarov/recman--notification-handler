import { test, mock } from 'node:test';
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
  assert.deepEqual(out.stats, { events: 1, stored: 1, rejected: 0, failed: 0 });
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

test('HTTP: malformed / empty body -> 400 invalid_request, oversized -> 413', async () => {
  for (const body of ['{not json', '', '{"foo":1}']) {
    const res = await handler(httpEvent(body));
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'invalid_request');
  }
  assert.equal((await handler(httpEvent(Array(1001).fill({})))).statusCode, 413);
});

test('HTTP: unexpected error -> 500 with a generic message, details only in the logs', async () => {
  const error = mock.method(console, 'error', () => {});
  try {
    const poison = { requestContext: {}, get body() { throw new Error('secret detail'); } };
    const res = await handler(poison, { awsRequestId: 'r500' });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(JSON.parse(res.body), { error: 'internal_error', message: 'internal error (see logs, request id: r500)' });
    assert.equal(error.mock.calls[0].arguments[0].error, 'secret detail');
  } finally {
    error.mock.restore();
  }
});
