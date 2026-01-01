/**
 * Base license exception
 */
export class LicenseError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code: string = 'LICENSE_ERROR', context?: Record<string, unknown>) {
    super(message);
    this.name = 'LicenseError';
    this.code = code;
    this.context = context;

    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * License is invalid
 */
export class LicenseInvalidError extends LicenseError {
  constructor(message: string = 'License is invalid', context?: Record<string, unknown>) {
    super(message, 'LICENSE_INVALID', context);
    this.name = 'LicenseInvalidError';
  }
}

/**
 * License has expired
 */
export class LicenseExpiredError extends LicenseError {
  public readonly expiredAt?: Date;
  public readonly gracePeriodDays?: number;

  constructor(
    message: string = 'License has expired',
    options?: {
      expiredAt?: Date;
      gracePeriodDays?: number;
      context?: Record<string, unknown>;
    }
  ) {
    super(message, 'LICENSE_EXPIRED', options?.context);
    this.name = 'LicenseExpiredError';
    this.expiredAt = options?.expiredAt;
    this.gracePeriodDays = options?.gracePeriodDays;
  }
}

/**
 * License server error
 */
export class LicenseServerError extends LicenseError {
  public readonly statusCode?: number;
  public readonly response?: unknown;

  constructor(
    message: string = 'License server error',
    options?: {
      statusCode?: number;
      response?: unknown;
      context?: Record<string, unknown>;
    }
  ) {
    super(message, 'LICENSE_SERVER_ERROR', options?.context);
    this.name = 'LicenseServerError';
    this.statusCode = options?.statusCode;
    this.response = options?.response;
  }
}

/**
 * License activation limit exceeded
 */
export class LicenseActivationLimitError extends LicenseError {
  public readonly limit: number;
  public readonly current: number;

  constructor(
    limit: number,
    current: number,
    context?: Record<string, unknown>
  ) {
    super(
      `Activation limit exceeded. Limit: ${limit}, Current: ${current}`,
      'LICENSE_ACTIVATION_LIMIT',
      context
    );
    this.name = 'LicenseActivationLimitError';
    this.limit = limit;
    this.current = current;
  }
}

/**
 * Feature not available
 */
export class FeatureNotAvailableError extends LicenseError {
  public readonly featureKey: string;

  constructor(featureKey: string, context?: Record<string, unknown>) {
    super(`Feature '${featureKey}' is not available`, 'FEATURE_NOT_AVAILABLE', context);
    this.name = 'FeatureNotAvailableError';
    this.featureKey = featureKey;
  }
}

/**
 * Configuration error
 */
export class LicenseConfigError extends LicenseError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'LICENSE_CONFIG_ERROR', context);
    this.name = 'LicenseConfigError';
  }
}
