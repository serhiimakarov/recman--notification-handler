/**
 * Field-level validators / normalizers shared by all event types. Each one
 * either returns the normalized value or throws an EventError; the pipeline
 * turns the throw into a per-event error and continues.
 *
 * Error messages never echo the raw value: it may be PII and they end up in
 * logs and HTTP responses.
 */
import { EventError } from './errors.js';

/** Pragmatic email check: dot-atom local part, dotted hostname labels, alpha TLD. */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/** Non-empty trimmed string. */
export function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EventError(`"${field}" is required and must be a non-empty string`, 'missing_field');
  }
  return value.trim();
}

/** Lower-cased, trimmed, syntactically valid email address. */
export function normalizeEmail(value, field = 'email') {
  const email = requireString(value, field).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new EventError(`"${field}" is not a valid email address`, 'invalid_email');
  return email;
}

// ponytail: tiny allow-list of zone abbreviations; extend the map (or require numeric offsets) if producers send others.
const ZONE_OFFSET_MIN = {
  Z: 0, UTC: 0, GMT: 0,
  EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420,
  CET: 60, CEST: 120, BST: 60,
};
const ZONE = String.raw`(?:\s*(Z|UTC|GMT|[A-Z]{3,4}|[+-]\d{2}:?\d{2}))?`;
const TIME = String.raw`(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?`;
/** YYYY-MM-DD / YYYY/MM/DD, optional time, optional zone. */
const NUMERIC_RE = new RegExp(String.raw`^(\d{4})[-/](\d{2})[-/](\d{2})${TIME}${ZONE}$`);
/** "April 5th, 2021 13:45 PST", "Apr 5 2021". */
const TEXTUAL_RE = new RegExp(String.raw`^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})${TIME}${ZONE}$`, 'i');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function zoneOffsetMinutes(zone) {
  if (!zone) return 0; // zone-less = UTC, so results never depend on the machine TZ
  const named = ZONE_OFFSET_MIN[zone.toUpperCase()];
  if (named !== undefined) return named;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (!m) return NaN;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Explicit date formats -> ISO 8601 UTC string. Accepted:
 *   2021-04-01 | 2021/06/01 10:23+02:00 | 2021-07-15T00:00:00[.sss][Z]
 *   April 5th, 2021 13:45 PST | Apr 5 2021
 * Zone-less input is taken as UTC. Everything else (relative words, bare
 * numbers, engine-specific `Date` parsing quirks) is rejected.
 */
export function normalizeDate(value, field) {
  const raw = requireString(value, field);
  let y, mo, d, h = 0, mi = 0, s = 0, ms = 0, zone;
  let m = NUMERIC_RE.exec(raw);
  if (m) {
    [, y, mo, d, h = 0, mi = 0, s = 0, ms = 0, zone] = m;
  } else if ((m = TEXTUAL_RE.exec(raw))) {
    [, mo, d, y, h = 0, mi = 0, s = 0, ms = 0, zone] = m;
    mo = MONTHS.indexOf(mo.slice(0, 3).toLowerCase()) + 1;
  }
  const offset = m ? zoneOffsetMinutes(zone) : NaN;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s, String(ms).padEnd(3, '0'));
  const date = new Date(utc - offset * 60_000);
  // Date.UTC silently rolls over 2021-02-30; a round-trip check catches it.
  const valid = !Number.isNaN(date.getTime()) && mo >= 1 && new Date(utc).getUTCMonth() === mo - 1 && new Date(utc).getUTCDate() === Number(d);
  if (!valid) throw new EventError(`"${field}" is not a recognizable date`, 'invalid_date');
  return date.toISOString();
}

/**
 * roles -> array of unique, trimmed, non-empty strings.
 * Accepts a comma-separated string, an array of strings, or null/undefined
 * (-> []). Anything else (numbers, objects, nested arrays) is rejected.
 */
export function normalizeRoles(value, field = 'roles') {
  if (value === null || value === undefined) return [];
  const list = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(list) || list.some((r) => typeof r !== 'string')) {
    throw new EventError(`"${field}" must be a string or an array of strings`, 'invalid_roles');
  }
  return [...new Set(list.map((r) => r.trim()).filter(Boolean))];
}
