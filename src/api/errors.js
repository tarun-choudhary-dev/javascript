export const ERROR_MESSAGES = Object.freeze({
  INVALID_REQUEST: 'Invalid run request.', INPUT_LIMIT: 'Run input exceeds an engine limit.',
  NOT_READY: 'Engine is not ready.', BUSY: 'Engine is busy.', DISPOSED: 'Engine is disposed.',
  UNSUPPORTED_ENVIRONMENT: 'Required browser runtime features are unavailable.',
  INITIALIZATION_FAILED: 'Runtime initialization failed.', INITIALIZATION_TIMEOUT: 'Runtime initialization timed out.',
  CANCELLED: 'Execution was cancelled.', RESET: 'Execution was reset.',
  EXECUTION_TIMEOUT: 'Execution timed out.', RESOURCE_LIMIT: 'A runtime resource limit was reached.',
  WORKER_FAILURE: 'Execution Worker failed.', RUNTIME_FAILURE: 'JavaScript runtime failed.',
  PROTOCOL_ERROR: 'Runtime protocol failed validation.', RECOVERY_FAILED: 'Runtime recovery failed.',
  RECOVERY_TIMEOUT: 'Runtime recovery timed out.',
});

export class EngineError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.RUNTIME_FAILURE);
    this.name = 'EngineError';
    this.kind = 'engine';
    this.code = code;
  }
}

export function engineResult(code, stdout, stderr, durationMs, truncated = false) {
  return {status: 'engine-error', stdout, stderr, durationMs,
    error: {kind: 'engine', code, message: ERROR_MESSAGES[code]}, truncated};
}
