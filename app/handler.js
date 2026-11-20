/**
 * AWS Lambda entry point. Supported event shapes (auto-detected):
 *   - API Gateway HTTP API (payload v2): events in `body` (base64-aware);
 *     returns { statusCode, body }. 200 when everything was handled,
 *     207 when some events hit a storage error (see results[].error).
 *   - Direct invocation with a bare array or { events: [...] }:
 *     returns { results, stats } itself.
 */
import { createLogger } from './src/logger.js';
import { extractEvents, processEvents } from './src/pipeline.js';
import { ValidationError } from './src/errors.js';

function isApiGatewayEvent(event) {
  return Boolean(event && typeof event === 'object' && !Array.isArray(event) && 'body' in event && 'requestContext' in event);
}

function parseHttpBody(event) {
  let raw = event.body ?? '';
  if (event.isBase64Encoded === true) raw = Buffer.from(String(raw), 'base64').toString('utf8');
  if (typeof raw !== 'string' || raw.trim() === '') throw new ValidationError('request body is empty');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ValidationError(`request body is not valid JSON: ${error.message}`);
  }
}

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function handler(event, context = {}) {
  const isHttp = isApiGatewayEvent(event);
  const requestId = context.awsRequestId ?? 'local';
  // Level filtering is Lambda's job (ApplicationLogLevel); LOG_LEVEL is only a local/test override.
  const logger = createLogger({ level: process.env.LOG_LEVEL ?? 'DEBUG', useConsole: true, base: { requestId } });

  try {
    const events = extractEvents(isHttp ? parseHttpBody(event) : event);
    const output = await processEvents(events, { logger });
    logger.info('invocation complete', output.stats);
    return isHttp ? json(output.stats.failed ? 207 : 200, output) : output;
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn('invocation rejected', { code: error.code, error: error.message });
      if (!isHttp) throw error;
      return json(error.httpStatus, { error: error.code, message: error.message });
    }
    logger.error('invocation failed', { code: error.code ?? 'internal_error', error: error.message, stack: error.stack });
    if (!isHttp) throw error;
    return json(500, { error: 'internal_error', message: `internal error (see logs, request id: ${requestId})` });
  }
}
