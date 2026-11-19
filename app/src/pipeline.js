/**
 * Core flow, shared by the Lambda handler and the CLI:
 *   for each event: resolve type -> dedupe -> normalize -> map to row -> insert.
 * A bad event becomes a per-event error (logged, counted) and the run goes on.
 */
import { EVENT_TYPES } from './events/index.js';
import { EventError, ValidationError } from './errors.js';
import { toNotificationRow, insert } from './db.js';

/** Accept a bare array or { events: [...] }; anything else is a bad request. */
export function extractEvents(payload) {
  const events = Array.isArray(payload) ? payload : payload?.events;
  if (!Array.isArray(events)) {
    throw new ValidationError('expected a JSON array of events (or an object with an "events" array)');
  }
  return events;
}

/**
 * @returns {{ results: object[], stats: object }}
 *   results[i] mirrors events[i]: { index, type, ok: true, notification } or
 *   { index, type, ok: false, error, message }.
 */
export async function processEvents(events, { logger, insert = insert, types = EVENT_TYPES } = {}) {
  const seen = new Set(); // ponytail: in-memory per invocation; a UNIQUE(event_id) column covers cross-invocation dedupe
  const results = [];

  for (const [index, event] of events.entries()) {
    const type = event?.type;
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new EventError('event must be a JSON object', 'invalid_event');
      }
      const definition = types[type];
      if (!definition) throw new EventError(`unsupported event type: ${JSON.stringify(type)}`, 'unknown_type');

      const eventId = typeof event.event_id === 'string' && event.event_id.trim() ? event.event_id.trim() : undefined;
      if (eventId) {
        if (seen.has(eventId)) throw new EventError(`duplicate event_id "${eventId}" (first occurrence wins)`, 'duplicate_event');
        seen.add(eventId);
      }

      const data = definition.normalize(event);
      const row = toNotificationRow({ type, typeId: definition.typeId, eventId, data });
      const { NotificationID } = await insert(row, { logger });
      results.push({ index, type, ok: true, notification: { NotificationID, ...row } });
    } catch (error) {
      if (!(error instanceof EventError)) throw error; // bugs / DB outages stay fatal
      logger?.warn('event rejected', { index, type, code: error.code, error: error.message });
      results.push({ index, type, ok: false, error: error.code, message: error.message });
    }
  }

  const stored = results.filter((r) => r.ok).length;
  return { results, stats: { events: events.length, stored, rejected: events.length - stored } };
}
