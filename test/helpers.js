import { createLogger } from '../app/src/logger.js';

/** Logger that records entries in memory (level DEBUG so nothing is filtered). */
export function captureLogger() {
  const entries = [];
  const stream = { write: (line) => entries.push(JSON.parse(line)) };
  return { logger: createLogger({ level: 'DEBUG', stream }), entries };
}
