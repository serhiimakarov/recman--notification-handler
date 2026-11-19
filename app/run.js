#!/usr/bin/env node
/**
 * Local Lambda simulator: same pipeline as app/handler.js without AWS.
 * Output (the Lambda "return value") goes to stdout, logs to stderr, so
 * stdout can be piped:  node app/run.js --input sample/events.json > out.json
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createLogger } from './src/logger.js';
import { extractEvents, processEvents } from './src/pipeline.js';
import { ConfigurationError } from './src/errors.js';

const USAGE = `Usage: node app/run.js --input <file> [--log-level DEBUG|INFO|WARN|ERROR] [--help]

  --input <file>   JSON file: an array of events, or { "events": [...] }
  --log-level      Default INFO (or $LOG_LEVEL). DEBUG shows the simulated SQL.`;

async function main() {
  const { values: args } = parseArgs({
    options: { input: { type: 'string' }, 'log-level': { type: 'string' }, help: { type: 'boolean' } },
  });
  if (args.help) return process.stderr.write(`${USAGE}\n`);

  const logger = createLogger({ level: args['log-level'] ?? process.env.LOG_LEVEL ?? 'INFO', stream: process.stderr });
  try {
    if (!args.input) throw new ConfigurationError('missing required flag --input <file>');
    let raw;
    try {
      raw = readFileSync(args.input, 'utf8');
    } catch (error) {
      throw new ConfigurationError(`cannot read input file "${args.input}": ${error.message}`);
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      throw new ConfigurationError(`input file "${args.input}" is not valid JSON: ${error.message}`);
    }

    const output = await processEvents(extractEvents(payload), { logger });
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    logger.info('run complete', output.stats);
  } catch (error) {
    logger.error('run failed', { code: error.code ?? 'internal_error', error: error.message, stack: error.stack });
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ level: 'ERROR', msg: 'run failed', error: error.message })}\n`);
  process.exitCode = 1;
});
