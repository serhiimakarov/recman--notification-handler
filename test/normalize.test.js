import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { normalizeEmail, normalizeDate, normalizeRoles, requireString } from '../app/src/normalize.js';

const rejects = (fn, code) => assert.throws(fn, (e) => e.code === code);

test('email: trims, lower-cases, rejects malformed, never echoes the value', () => {
  assert.equal(normalizeEmail('  Alice@Example.COM '), 'alice@example.com');
  for (const bad of ['bob.smith(at)example.com', 'no-at-sign', 'a b@example.com', 'a@b.c.', 'a@-.xx', 'a@b..cc', 'a@b.c']) {
    assert.throws(() => normalizeEmail(bad), (e) => e.code === 'invalid_email' && !e.message.includes(bad));
  }
  rejects(() => normalizeEmail(''), 'missing_field');
  rejects(() => normalizeEmail(undefined), 'missing_field');
});

const DATES = {
  '2021-04-01': '2021-04-01T00:00:00.000Z',
  'April 5th, 2021 13:45 PST': '2021-04-05T21:45:00.000Z',
  'Apr 5 2021': '2021-04-05T00:00:00.000Z',
  '2021/06/01 10:23+02:00': '2021-06-01T08:23:00.000Z',
  '2021-07-15T00:00:00': '2021-07-15T00:00:00.000Z', // zone-less = UTC
  '2021-07-15T00:00:00.5Z': '2021-07-15T00:00:00.500Z',
  'April 5, 2021 13:45': '2021-04-05T13:45:00.000Z',
};

test('date: every sample format becomes ISO 8601 UTC; garbage is rejected', () => {
  for (const [input, expected] of Object.entries(DATES)) assert.equal(normalizeDate(input, 'd'), expected, input);
  for (const bad of ['yesterday', '1', '12', 'Sat 2021', '2021-02-30', '2021-13-01', '2021-04-01 10:00 XYZ', '01/02/2021']) {
    assert.throws(() => normalizeDate(bad, 'd'), (e) => e.code === 'invalid_date' && !e.message.includes(bad), bad);
  }
  rejects(() => normalizeDate(20210401, 'd'), 'missing_field');
});

test('date: output does not depend on the machine timezone', () => {
  const script = `import('${new URL('../app/src/normalize.js', import.meta.url).href}')
    .then(({ normalizeDate }) => console.log(JSON.stringify(Object.keys(${JSON.stringify(DATES)}).map((d) => normalizeDate(d, 'd')))))`;
  for (const TZ of ['America/New_York', 'Asia/Tokyo']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), Object.values(DATES), TZ);
  }
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
