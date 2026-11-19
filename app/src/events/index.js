/**
 * Event type registry — the single place to extend when adding an event type.
 *
 * Each definition is { typeId, normalize(event) }:
 *  - typeId:    stable NotificationTypeID stored in MySQL (never reuse/renumber);
 *  - normalize: raw event -> normalized data object, or throws an EventError.
 *
 * To add a type: create app/src/events/<type>.js exporting such an object,
 * import it here, and register it under its `type` string. Nothing else
 * (pipeline, handler, CLI, DB mapping) needs to change.
 */
import userRegistered from './user-registered.js';
import passwordReset from './password-reset.js';
import userDeleted from './user-deleted.js';

export const EVENT_TYPES = Object.freeze({
  user_registered: userRegistered,
  password_reset: passwordReset,
  user_deleted: userDeleted,
});
