import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { processEvents, extractEvents } from '../app/src/pipeline.js';
import { EVENT_TYPES } from '../app/src/events/index.js';
import { normalizeEmail } from '../app/src/normalize.js';
import { captureLogger } from './helpers.js';

const sample = JSON.parse(readFileSync(new URL('../sample/events.json', import.meta.url), 'utf8'));

test('sample file: valid events stored, invalid ones rejected, run continues', async () => {
  const { logger, entries } = captureLogger();
  const { results, stats } = await processEvents(sample, { logger });

  assert.deepEqual(stats, { events: 7, stored: 4, rejected: 3 });
  assert.deepEqual(results.map((r) => r.ok ? 'ok' : r.error),
    ['ok', 'invalid_email', 'ok', 'ok', 'unknown_type', 'ok', 'duplicate_event']);
  assert.deepEqual(results[0].notification.NotificationData.roles, ['admin', 'editor', 'manager']);
  assert.equal(results[0].notification.NotificationTypeID, EVENT_TYPES.user_registered.typeId);
  assert.equal(results[2].notification.NotificationData.requested, '2021-06-01T08:23:00.000Z');
  assert.deepEqual(results[5].notification.NotificationData.roles, []); // first dedupe-1 wins
  assert.equal(entries.filter((e) => e.level === 'WARN').length, 3);
});

test('results are index-aligned with input and non-object events are rejected', async () => {
  const { results } = await processEvents([null, 'str', { type: 'user_deleted' }], { insert: async () => ({ NotificationID: 1 }) });
  assert.deepEqual(results.map((r) => [r.index, r.error]), [[0, 'invalid_event'], [1, 'invalid_event'], [2, 'missing_field']]);
});

test('DB failures are fatal, not swallowed as per-event errors', async () => {
  await assert.rejects(
    processEvents([sample[0]], { insert: async () => { throw new Error('connection refused'); } }),
    /connection refused/,
  );
});

test('extensibility: a new type is just a registry entry', async () => {
  const types = { ...EVENT_TYPES, email_changed: { typeId: 4, normalize: (e) => ({ email: normalizeEmail(e.email) }) } };
  const { results } = await processEvents([{ type: 'email_changed', email: 'X@y.io' }], { types, insert: async () => ({ NotificationID: 9 }) });
  assert.deepEqual(results[0].notification, {
    NotificationID: 9, NotificationTypeID: 4,
    NotificationData: { type: 'email_changed', email: 'x@y.io' }, CreatedByType: 0, CreatedByID: 0,
  });
});

test('registry typeIds are unique', () => {
  const ids = Object.values(EVENT_TYPES).map((d) => d.typeId);
  assert.equal(new Set(ids).size, ids.length);
});

test('extractEvents accepts an array or { events }, rejects the rest', () => {
  assert.deepEqual(extractEvents([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(extractEvents({ events: [] }), []);
  assert.throws(() => extractEvents({ foo: [] }), (e) => e.code === 'invalid_request');
  assert.throws(() => extractEvents('nope'), (e) => e.code === 'invalid_request');
});
