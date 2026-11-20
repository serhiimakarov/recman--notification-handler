/**
 * Typed errors with a stable machine-readable `code`, so the pipeline, CLI and
 * Lambda handler react to failures programmatically instead of parsing messages.
 */

export class AppError extends Error {
  constructor(message, { code = 'internal_error', httpStatus = 500, cause } = {}) {
    super(message, cause !== undefined ? { cause } : {});
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Operator mistake: bad CLI flags, unreadable input file. */
export class ConfigurationError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: 'configuration_error', ...options });
  }
}

/** Malformed request payload as a whole (caller's fault -> HTTP 400/413). */
export class ValidationError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: 'invalid_request', httpStatus: 400, ...options });
  }
}

/**
 * One event failed validation. Never fatal: the pipeline logs it and keeps
 * going. `code` is one of: invalid_event, missing_field, invalid_email,
 * invalid_date, invalid_roles, unknown_type, duplicate_event.
 */
export class EventError extends AppError {
  constructor(message, code) {
    super(message, { code });
  }
}
