/**
 * Custom Error Classes for HeyGen Module
 */

export class HeyGenError extends Error {
  constructor(message, code = "HEYGEN_ERROR", status = 500, details = null) {
    super(message);
    this.name = "HeyGenError";
    this.code = code;
    this.status = status;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class HeyGenAPIError extends HeyGenError {
  constructor(message, status = 400, details = null, apiErrorCode = null) {
    super(message, "HEYGEN_API_ERROR", status, details);
    this.name = "HeyGenAPIError";
    this.apiErrorCode = apiErrorCode;
  }
}

export class HeyGenValidationError extends HeyGenError {
  constructor(message, details = null) {
    super(message, "HEYGEN_VALIDATION_ERROR", 400, details);
    this.name = "HeyGenValidationError";
  }
}

export class HeyGenTimeoutError extends HeyGenError {
  constructor(message = "Operation timed out", details = null) {
    super(message, "HEYGEN_TIMEOUT_ERROR", 408, details);
    this.name = "HeyGenTimeoutError";
  }
}

export class HeyGenWebhookError extends HeyGenError {
  constructor(message, details = null) {
    super(message, "HEYGEN_WEBHOOK_ERROR", 401, details);
    this.name = "HeyGenWebhookError";
  }
}

export default {
  HeyGenError,
  HeyGenAPIError,
  HeyGenValidationError,
  HeyGenTimeoutError,
  HeyGenWebhookError,
};
