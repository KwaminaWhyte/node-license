// Types
export * from './types';

// Services
export {
  HardwareFingerprintService,
  createFingerprintService,
} from './services/HardwareFingerprintService';

export {
  ClientLicenseService,
  createClientLicenseService,
} from './services/ClientLicenseService';

export {
  ServerLicenseService,
  createServerLicenseService,
} from './services/ServerLicenseService';

// Events
export {
  LicenseEventEmitter,
  getLicenseEventEmitter,
  createLicenseEventEmitter,
} from './events/LicenseEventEmitter';

// Cache
export {
  MemoryCacheAdapter,
  FileCacheAdapter,
  createMemoryCache,
  createFileCache,
} from './utils/cache';

// Errors
export {
  LicenseError,
  LicenseInvalidError,
  LicenseExpiredError,
  LicenseServerError,
  LicenseActivationLimitError,
  FeatureNotAvailableError,
  LicenseConfigError,
} from './utils/errors';

// Middleware and utilities
export {
  createLicenseMiddleware,
  createFeatureMiddleware,
  createLicenseRoutes,
  licenseUtils,
} from './middleware';

export type {
  LicenseRequest,
  LicenseMiddlewareOptions,
  FeatureMiddlewareOptions,
} from './middleware';

// Convenience factory function
import type { LicenseConfig, ClientConfig, ServerConfig, FingerprintConfig, LoggingConfig } from './types';
import { ClientLicenseService } from './services/ClientLicenseService';
import { ServerLicenseService } from './services/ServerLicenseService';
import { LicenseEventEmitter, createLicenseEventEmitter } from './events/LicenseEventEmitter';

/**
 * Create a license service based on configuration
 */
export function createLicenseService(
  config: LicenseConfig
): ClientLicenseService | ServerLicenseService {
  const eventEmitter = createLicenseEventEmitter();

  if (config.mode === 'server') {
    if (!config.server) {
      throw new Error('Server configuration is required for server mode');
    }

    return new ServerLicenseService(config.server, {
      fingerprintConfig: config.fingerprint,
      loggingConfig: config.logging,
      eventEmitter,
    });
  }

  if (!config.client) {
    throw new Error('Client configuration is required for client mode');
  }

  return new ClientLicenseService(config.client, {
    fingerprintConfig: config.fingerprint,
    loggingConfig: config.logging,
    eventEmitter,
  });
}

/**
 * Create a client license service (convenience function)
 */
export function createClient(
  options: {
    serverUrl: string;
    licenseKey: string;
    productId: string;
  } & Partial<ClientConfig>,
  additionalOptions?: {
    fingerprintConfig?: FingerprintConfig;
    loggingConfig?: LoggingConfig;
  }
): ClientLicenseService {
  return new ClientLicenseService(options as ClientConfig, additionalOptions);
}

/**
 * Create a server license service (convenience function)
 */
export function createServer(
  options: {
    jwtSecret: string;
    database: ServerConfig['database'];
  } & Partial<ServerConfig>,
  additionalOptions?: {
    fingerprintConfig?: FingerprintConfig;
    loggingConfig?: LoggingConfig;
  }
): ServerLicenseService {
  return new ServerLicenseService(options as ServerConfig, additionalOptions);
}
