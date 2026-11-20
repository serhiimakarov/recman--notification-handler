/**
 * MySQL integration (simulated). `toNotificationRow` is the real contract:
 * it maps a normalized event onto the `Notification` table columns. Replace
 * `insertToMySQL` with a mysql2 call when wiring a real database — the row
 * shape stays the same.
 *
 * Schema change (see README "Database mapping"): the table gets a nullable
 * `EventID` column with a UNIQUE index, so a retried batch cannot store the
 * same event twice (`INSERT IGNORE` makes the duplicate a no-op).
 */

/** CreatedByType values. ponytail: only SYSTEM is used; add USER/ADMIN when an actor is known. */
export const CREATED_BY_SYSTEM = 0;

/** Normalized event -> row for `Notification` (columns with DB defaults omitted). */
export function toNotificationRow({ type, typeId, eventId, data }) {
  return {
    NotificationTypeID: typeId,
    EventID: eventId ?? null,
    NotificationData: { type, ...data },
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
    'INSERT IGNORE INTO `Notification` (NotificationTypeID, EventID, NotificationData, CreatedByType, CreatedByID) VALUES (?, ?, ?, ?, ?)';
  const params = [row.NotificationTypeID, row.EventID, JSON.stringify(row.NotificationData), row.CreatedByType, row.CreatedByID];
  logger?.debug('insertToMySQL', { sql, params });
  return { NotificationID: nextId++ };
}
