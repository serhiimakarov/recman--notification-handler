import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { processEvents, extractEvents, MAX_EVENTS } from '../app/src/pipeline.js';
import { EVENT_TYPES } from '../app/src/events/index.js';
import { normalizeEmail } from '../app/src/normalize.js';
import { captureLogger } from './helpers.js';

const sample = JSON.parse(readFileSync(new URL('../sample/events.json', import.meta.url), 'utf8'));
const okInsert = async () => ({ NotificationID: 1 });

test('sample file: valid events stored, invalid ones rejected, run continues', async () => {
  const { logger, entries } = captureLogger();
  const { results, stats } = await processEvents(sample, { logger });

  assert.deepEqual(stats, { events: 7, stored: 4, rejected: 3, failed: 0 });
  assert.deepEqual(results.map((r) => r.ok ? 'ok' : r.error),
    ['ok', 'invalid_email', 'ok', 'ok', 'unknown_type', 'ok', 'duplicate_event']);
  assert.deepEqual(results[0].notification.NotificationData.roles, ['admin', 'editor', 'manager']);
  assert.equal(results[0].notification.NotificationTypeID, EVENT_TYPES.user_registered.typeId);
  assert.equal(results[2].notification.NotificationData.requested, '2021-06-01T08:23:00.000Z');
  assert.deepEqual(results[5].notification.NotificationData.roles, []); // first dedupe-1 wins
  assert.equal(results[5].notification.EventID, 'dedupe-1');
  assert.equal(results[0].notification.EventID, null);
  assert.equal(entries.filter((e) => e.level === 'WARN').length, 3);
  assert.ok(!JSON.stringify(entries).includes('bob.smith'), 'rejected values must not leak into logs');
});

test('results are index-aligned with input and non-object events are rejected', async () => {
  const { results } = await processEvents([null, 'str', { type: 'user_deleted' }], { insert: okInsert });
  assert.deepEqual(results.map((r) => [r.index, r.error]), [[0, 'invalid_event'], [1, 'invalid_event'], [2, 'missing_field']]);
});

test('prototype keys and non-string types are unknown_type, not a crash', async () => {
  const events = ['constructor', 'toString', '__proto__', 42, null].map((type) => ({ type }));
  const { results } = await processEvents(events, { insert: okInsert });
  assert.deepEqual(results.map((r) => r.error), Array(events.length).fill('unknown_type'));
});

test('DB failure is a per-event storage_error; other events still stored', async () => {
  const { logger, entries } = captureLogger();
  let calls = 0;
  const insert = async () => { if (++calls === 1) throw new Error('connection refused'); return { NotificationID: calls }; };
  const { results, stats } = await processEvents([sample[0], sample[2]], { logger, insert });
  assert.deepEqual(stats, { events: 2, stored: 1, rejected: 0, failed: 1 });
  assert.equal(results[0].error, 'storage_error');
  assert.ok(!results[0].message.includes('connection refused'), 'DB details stay in the logs');
  assert.equal(entries.find((e) => e.level === 'ERROR').error, 'connection refused');
});

test('dedupe: an invalid or unstored first occurrence does not block a valid retry', async () => {
  const bad = { ...sample[5], email: 'nope' };
  const { results } = await processEvents([bad, sample[5], sample[5]], { insert: okInsert });
  assert.deepEqual(results.map((r) => r.ok || r.error), ['invalid_email', true, 'duplicate_event']);
});

test('extensibility: a new type is just a registry entry', async () => {
  const types = { ...EVENT_TYPES, email_changed: { typeId: 4, normalize: (e) => ({ email: normalizeEmail(e.email) }) } };
  const { results } = await processEvents([{ type: 'email_changed', email: 'X@y.io' }], { types, insert: async () => ({ NotificationID: 9 }) });
  assert.deepEqual(results[0].notification, {
    NotificationID: 9, NotificationTypeID: 4, EventID: null,
    NotificationData: { type: 'email_changed', email: 'x@y.io' }, CreatedByType: 0, CreatedByID: 0,
  });
});

test('registry typeIds are unique', () => {
  const ids = Object.values(EVENT_TYPES).map((d) => d.typeId);
  assert.equal(new Set(ids).size, ids.length);
});

test('extractEvents accepts an array or { events }, rejects the rest and oversized batches', () => {
  assert.deepEqual(extractEvents([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(extractEvents({ events: [] }), []);
  assert.throws(() => extractEvents({ foo: [] }), (e) => e.code === 'invalid_request');
  assert.throws(() => extractEvents('nope'), (e) => e.code === 'invalid_request');
  assert.throws(() => extractEvents(Array(MAX_EVENTS + 1).fill({})), (e) => e.httpStatus === 413);
});
