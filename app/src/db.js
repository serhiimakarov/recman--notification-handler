/**
 * MySQL integration (simulated). `toNotificationRow` is the real contract:
 * it maps a normalized event onto the `Notification` table columns. Replace
 * `insertToMySQL` with a mysql2 call when wiring a real database — the row
 * shape stays the same.
 */

/** CreatedByType values. ponytail: only SYSTEM is used; add USER/ADMIN when an actor is known. */
export const CREATED_BY_SYSTEM = 0;

/** Normalized event -> row for `Notification` (columns with DB defaults omitted). */
export function toNotificationRow({ type, typeId, eventId, data }) {
  return {
    NotificationTypeID: typeId,
    NotificationData: { type, ...(eventId ? { eventId } : {}), ...data },
    CreatedByType: CREATED_BY_SYSTEM,
    CreatedByID: 0,
  };
}

/**
 * Dummy insertToMySQL: logs the SQL that a real implementation would run and returns
 * a fake auto-increment id. Async so the signature matches a real driver.
 */
let nextId = 1;
export async function insertToMySQL(row, { logger } = {}) {
  const sql =
    'INSERT INTO `Notification` (NotificationTypeID, NotificationData, CreatedByType, CreatedByID) VALUES (?, ?, ?, ?)';
  const params = [row.NotificationTypeID, JSON.stringify(row.NotificationData), row.CreatedByType, row.CreatedByID];
  logger?.debug('insertToMySQL', { sql, params });
  return { NotificationID: nextId++ };
}
