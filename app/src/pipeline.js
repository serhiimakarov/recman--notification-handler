/**
 * Core flow, shared by the Lambda handler and the CLI:
 *   for each event: resolve type -> dedupe -> normalize -> map to row -> insert.
 * A bad event becomes a per-event error (logged, counted) and the run goes on.
 * A failed insert becomes a per-event `storage_error`, so the caller always
 * learns exactly which events were stored and can retry the rest safely
 * (inserts are idempotent on event_id, see db.js).
 */
import { EVENT_TYPES } from './events/index.js';
import { EventError, ValidationError } from './errors.js';
import { toNotificationRow, insertToMySQL } from './db.js';

/** Upper bound on events per invocation; keeps one request within Lambda time/memory limits. */
export const MAX_EVENTS = 1000;

/** Accept a bare array or { events: [...] }; anything else is a bad request. */
export function extractEvents(payload) {
  const events = Array.isArray(payload) ? payload : payload?.events;
  if (!Array.isArray(events)) {
    throw new ValidationError('expected a JSON array of events (or an object with an "events" array)');
  }
  if (events.length > MAX_EVENTS) {
    throw new ValidationError(`too many events: ${events.length} (max ${MAX_EVENTS})`, { httpStatus: 413 });
  }
  return events;
}

/**
 * @returns {{ results: object[], stats: object }}
 *   results[i] mirrors events[i]: { index, type, ok: true, notification } or
 *   { index, type, ok: false, error, message }. stats.failed counts storage errors.
 */
export async function processEvents(events, { logger, insert = insertToMySQL, types = EVENT_TYPES } = {}) {
  const seen = new Set(); // ponytail: in-batch dedupe only; UNIQUE(EventID) in the table covers cross-invocation
  const results = [];
  let failed = 0;

  for (const [index, event] of events.entries()) {
    const type = event?.type;
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new EventError('event must be a JSON object', 'invalid_event');
      }
      // Object.hasOwn: "constructor" / "__proto__" must not resolve to Object.prototype members.
      const definition = typeof type === 'string' && Object.hasOwn(types, type) ? types[type] : undefined;
      if (!definition) throw new EventError(`unsupported event type: ${JSON.stringify(type)}`, 'unknown_type');

      const eventId = typeof event.event_id === 'string' && event.event_id.trim() ? event.event_id.trim() : undefined;
      if (eventId && seen.has(eventId)) {
        throw new EventError(`duplicate event_id "${eventId}" (first stored occurrence wins)`, 'duplicate_event');
      }

      const data = definition.normalize(event);
      const row = toNotificationRow({ type, typeId: definition.typeId, eventId, data });
      let NotificationID;
      try {
        ({ NotificationID } = await insert(row, { logger }));
      } catch (error) {
        failed++;
        logger?.error('event not stored', { index, type, eventId, error: error.message, stack: error.stack });
        results.push({ index, type, ok: false, error: 'storage_error', message: 'could not store the event, retry later' });
        continue;
      }
      if (eventId) seen.add(eventId); // only a stored event claims its id; an invalid first occurrence does not block a valid retry
      results.push({ index, type, ok: true, notification: { NotificationID, ...row } });
    } catch (error) {
      if (!(error instanceof EventError)) throw error; // bugs stay fatal
      logger?.warn('event rejected', { index, type, code: error.code, error: error.message });
      results.push({ index, type, ok: false, error: error.code, message: error.message });
    }
  }

  const stored = results.filter((r) => r.ok).length;
  return { results, stats: { events: events.length, stored, rejected: events.length - stored - failed, failed } };
}
