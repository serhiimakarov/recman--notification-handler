/**
 * JSON-lines logger with level filtering and child loggers (bound context).
 * Lambda logs to stdout (CloudWatch); the CLI to stderr so stdout stays
 * clean for the result JSON.
 */

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

/** Resolve a level name; unknown values fall back to INFO. */
function levelValue(level) {
  return LEVELS[String(level).toUpperCase()] ?? LEVELS.INFO;
}

/**
 * @param {object} [options]
 * @param {string} [options.level]  - DEBUG | INFO | WARN | ERROR (default INFO).
 * @param {object} [options.stream] - Writable stream (default stderr).
 * @param {object} [options.base]   - Fields bound to every log entry.
 */
export function createLogger({ level = 'INFO', stream = process.stderr, base = {} } = {}) {
  const min = levelValue(level);

  const write = (levelName) => (message, fields = {}) => {
    if (LEVELS[levelName] < min) return;
    const entry = { ts: new Date().toISOString(), level: levelName, msg: message, ...base, ...fields };
    let line;
    try {
      line = JSON.stringify(entry);
    } catch {
      // Unserializable field (BigInt, circular) — never crash the log path.
      line = JSON.stringify({
        ts: entry.ts,
        level: levelName,
        msg: message,
        note: 'unserializable log fields were dropped',
      });
    }
    stream.write(`${line}\n`);
  };

  return {
    debug: write('DEBUG'),
    info: write('INFO'),
    warn: write('WARN'),
    error: write('ERROR'),
    /** Create a child logger with additional bound fields. */
    child: (fields) => createLogger({ level, stream, base: { ...base, ...fields } }),
  };
}
