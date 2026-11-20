import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const RUN = new URL('../app/run.js', import.meta.url).pathname;
const SAMPLE = new URL('../sample/events.json', import.meta.url).pathname;

test('CLI prints results JSON to stdout, logs to stderr, exits 0', () => {
  const r = spawnSync(process.execPath, [RUN, '--input', SAMPLE, '--log-level', 'WARN'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.stats, { events: 7, stored: 4, rejected: 3, failed: 0 });
  assert.match(r.stderr, /"level":"WARN"/);
});

test('CLI exits 1 on missing --input / unreadable file / unknown flag', () => {
  for (const args of [[], ['--input', '/nope.json'], ['--input', SAMPLE, '--bogus']]) {
    const r = spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1, JSON.stringify(args));
  }
});

test('--help prints usage', () => {
  const r = spawnSync(process.execPath, [RUN, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /Usage:/);
});
