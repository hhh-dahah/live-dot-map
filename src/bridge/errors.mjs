export class BridgeError extends Error {
  constructor(code, message, { status = 500, details, cause } = {}) {
    super(message, { cause });
    this.name = 'BridgeError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function asBridgeError(error) {
  if (error instanceof BridgeError) return error;
  return new BridgeError('INTERNAL_ERROR', 'Local bridge request failed', {
    cause: error,
  });
}

