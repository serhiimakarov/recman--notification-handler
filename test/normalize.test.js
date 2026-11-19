import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, normalizeDate, normalizeRoles, requireString } from '../app/src/normalize.js';

const rejects = (fn, code) => assert.throws(fn, (e) => e.code === code);

test('email: trims, lower-cases, rejects malformed', () => {
  assert.equal(normalizeEmail('  Alice@Example.COM '), 'alice@example.com');
  rejects(() => normalizeEmail('bob.smith(at)example.com'), 'invalid_email');
  rejects(() => normalizeEmail('no-at-sign'), 'invalid_email');
  rejects(() => normalizeEmail('a b@example.com'), 'invalid_email');
  rejects(() => normalizeEmail(''), 'missing_field');
  rejects(() => normalizeEmail(undefined), 'missing_field');
});

test('date: every sample format becomes ISO 8601 UTC', () => {
  assert.equal(normalizeDate('2021-04-01', 'd'), '2021-04-01T00:00:00.000Z');
  assert.equal(normalizeDate('April 5th, 2021 13:45 PST', 'd'), '2021-04-05T21:45:00.000Z');
  assert.equal(normalizeDate('2021/06/01 10:23+02:00', 'd'), '2021-06-01T08:23:00.000Z');
  assert.equal(normalizeDate('2021-07-15T00:00:00', 'd'), '2021-07-15T00:00:00.000Z'); // zone-less = UTC
  assert.equal(normalizeDate('2021-07-15T00:00:00Z', 'd'), '2021-07-15T00:00:00.000Z');
  rejects(() => normalizeDate('yesterday', 'd'), 'invalid_date');
  rejects(() => normalizeDate(20210401, 'd'), 'missing_field');
});

test('roles: string, array, null -> trimmed unique array of strings', () => {
  assert.deepEqual(normalizeRoles('admin, editor , manager'), ['admin', 'editor', 'manager']);
  assert.deepEqual(normalizeRoles(['viewer', ' ']), ['viewer']);
  assert.deepEqual(normalizeRoles('admin,admin'), ['admin']);
  assert.deepEqual(normalizeRoles(null), []);
  assert.deepEqual(normalizeRoles(undefined), []);
  rejects(() => normalizeRoles(42), 'invalid_roles');
  rejects(() => normalizeRoles(['a', 1]), 'invalid_roles');
});

test('requireString rejects empty / non-string', () => {
  assert.equal(requireString(' x ', 'f'), 'x');
  rejects(() => requireString('  ', 'f'), 'missing_field');
  rejects(() => requireString(null, 'f'), 'missing_field');
});
