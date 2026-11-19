/**
 * Field-level validators / normalizers shared by all event types. Each one
 * either returns the normalized value or throws an EventError; the pipeline
 * turns the throw into a per-event error and continues.
 */
import { EventError } from './errors.js';

/** Pragmatic email check: one "@", no whitespace, a dotted domain. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
  if (!EMAIL_RE.test(email)) {
    throw new EventError(`"${field}" is not a valid email address: ${JSON.stringify(value)}`, 'invalid_email');
  }
  return email;
}

/**
 * Any date Node can parse -> ISO 8601 UTC string. Two fix-ups before parsing:
 *  - ordinal suffixes ("April 5th") are stripped, V8 rejects them;
 *  - a zone-less ISO timestamp ("2021-07-15T00:00:00") is treated as UTC, so
 *    results do not depend on the machine's TZ (Lambda runs in UTC anyway).
 * Relative words ("yesterday") are rejected: there is no reference point.
 */
export function normalizeDate(value, field) {
  const raw = requireString(value, field)
    .replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
    .replace(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)$/, '$1Z');
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new EventError(`"${field}" is not a recognizable date: ${JSON.stringify(value)}`, 'invalid_date');
  }
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
