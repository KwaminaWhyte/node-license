import axios, { AxiosInstance, AxiosError } from 'axios';
import jwt from 'jsonwebtoken';
import type {
  ClientConfig,
  LicenseServiceInterface,
  ValidationResult,
  ActivationResult,
  DeactivationResult,
  HeartbeatResult,
  LicenseInfo,
  LicenseStatus,
  FeatureConfig,
  CacheAdapter,
  SystemInfo,
  FingerprintConfig,
  LoggingConfig,
} from '../types';
import { HardwareFingerprintService } from './HardwareFingerprintService';
import { MemoryCacheAdapter } from '../utils/cache';
import { LicenseEventEmitter, getLicenseEventEmitter } from '../events/LicenseEventEmitter';
import {
  LicenseError,
  LicenseInvalidError,
  LicenseExpiredError,
  LicenseServerError,
} from '../utils/errors';
import { transformKeys } from '../utils/transform';

/**
 * Cache keys
 */
const CACHE_KEYS = {
  LICENSE: 'license:data',
  OFFLINE_TOKEN: 'license:offline_token',
  VALIDATION: 'license:validation',
  FEATURES: 'license:features',
  LAST_HEARTBEAT: 'license:last_heartbeat',
};

/**
 * Default client configuration
 */
const DEFAULT_CLIENT_CONFIG: Partial<ClientConfig> = {
  cacheTtl: 86400, // 24 hours
  offlineMode: true,
  autoFingerprint: true,
  httpTimeout: 10000, // 10 seconds
  retry: {
    enabled: true,
    times: 3,
    sleepMs: 1000,
  },
  heartbeatInterval: 86400, // 24 hours
  onFailure: 'throw',
  gracePeriodWarning: true,
  systemInfo: {
    enabled: true,
    includeNodeVersion: true,
    includePlatform: true,
    includeHostname: true,
  },
};

/**
 * Client license service for validating licenses against a remote server
 */
export class ClientLicenseService implements LicenseServiceInterface {
  private config: ClientConfig;
  private fingerprintService: HardwareFingerprintService;
  private cache: CacheAdapter;
  private httpClient: AxiosInstance;
  private eventEmitter: LicenseEventEmitter;
  private loggingConfig?: LoggingConfig;

  constructor(
    config: ClientConfig,
    options?: {
      fingerprintConfig?: FingerprintConfig;
      loggingConfig?: LoggingConfig;
      eventEmitter?: LicenseEventEmitter;
    }
  ) {
    this.config = { ...DEFAULT_CLIENT_CONFIG, ...config } as ClientConfig;
    this.fingerprintService = new HardwareFingerprintService(options?.fingerprintConfig);
    this.cache = config.cache || new MemoryCacheAdapter();
    this.eventEmitter = options?.eventEmitter || getLicenseEventEmitter();
    this.loggingConfig = options?.loggingConfig;

    // Create HTTP client
    this.httpClient = axios.create({
      baseURL: this.config.serverUrl,
      timeout: this.config.httpTimeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
  }

  /**
   * Validate license (online first, then offline fallback)
   */
  async validate(): Promise<ValidationResult> {
    try {
      // Try online validation first
      return await this.validateOnline();
    } catch (error) {
      // If offline mode is enabled, try offline validation
      if (this.config.offlineMode) {
        this.log('info', 'Online validation failed, trying offline validation', {
          error: error instanceof Error ? error.message : String(error),
        });
        return await this.validateOffline();
      }

      return this.handleFailure(error);
    }
  }

  /**
   * Validate license online against the server
   */
  async validateOnline(): Promise<ValidationResult> {
    const fingerprint = await this.getFingerprint();
    const systemInfo = await this.getSystemInfo();

    const payload = {
      license_key: this.config.licenseKey,
      hardware_fingerprint: fingerprint,
      product_id: this.config.productId,
      system_info: systemInfo,
    };

    const response = await this.makeRequest<ValidationResult>('POST', '/validate', payload);

    // Cache the result
    await this.cache.set(CACHE_KEYS.VALIDATION, response, this.config.cacheTtl);

    if (response.license) {
      await this.cache.set(CACHE_KEYS.LICENSE, response.license, this.config.cacheTtl);
    }

    if (response.offlineToken) {
      await this.cache.set(CACHE_KEYS.OFFLINE_TOKEN, response.offlineToken);
    }

    // Cache features if present in response (at top level)
    const responseWithFeatures = response as ValidationResult & { features?: Record<string, FeatureConfig> };
    if (responseWithFeatures.features && Object.keys(responseWithFeatures.features).length > 0) {
      await this.cache.set(CACHE_KEYS.FEATURES, responseWithFeatures.features, this.config.cacheTtl);
    }

    // Emit events
    if (response.valid) {
      await this.eventEmitter.emit('license:validated', {
        license: response.license,
        message: 'License validated successfully',
      });

      if (response.status === 'grace_period' && this.config.gracePeriodWarning) {
        await this.eventEmitter.emit('license:grace_period', {
          license: response.license,
          message: 'License is in grace period',
        });
      }
    } else {
      if (response.status === 'expired') {
        await this.eventEmitter.emit('license:expired', {
          license: response.license,
          message: response.message || 'License has expired',
        });
      } else {
        await this.eventEmitter.emit('license:invalid', {
          license: response.license,
          message: response.message || 'License is invalid',
        });
      }
    }

    return response;
  }

  /**
   * Validate license offline using cached token
   */
  async validateOffline(): Promise<ValidationResult> {
    // Try to validate using offline token
    const offlineToken = await this.cache.get<string>(CACHE_KEYS.OFFLINE_TOKEN);

    if (offlineToken) {
      try {
        const decoded = jwt.decode(offlineToken) as {
          exp?: number;
          hardware_fingerprint?: string;
          license?: LicenseInfo;
        } | null;

        if (decoded) {
          // Check token expiration
          if (decoded.exp && decoded.exp * 1000 < Date.now()) {
            this.log('warn', 'Offline token has expired');
          } else {
            // Verify hardware fingerprint
            const currentFingerprint = await this.getFingerprint();
            if (decoded.hardware_fingerprint) {
              const matches = this.fingerprintService.compare(
                currentFingerprint,
                decoded.hardware_fingerprint
              );

              if (matches && decoded.license) {
                return {
                  valid: true,
                  status: decoded.license.status,
                  license: decoded.license,
                  message: 'Validated using offline token',
                };
              }
            }
          }
        }
      } catch (error) {
        this.log('warn', 'Failed to validate offline token', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Fall back to cached validation result
    const cachedValidation = await this.cache.get<ValidationResult>(CACHE_KEYS.VALIDATION);
    if (cachedValidation && cachedValidation.valid) {
      return {
        ...cachedValidation,
        message: 'Validated using cached data',
      };
    }

    // Fall back to cached license data
    const cachedLicense = await this.cache.get<LicenseInfo>(CACHE_KEYS.LICENSE);
    if (cachedLicense && !cachedLicense.isExpired) {
      return {
        valid: true,
        status: cachedLicense.status,
        license: cachedLicense,
        message: 'Validated using cached license data',
      };
    }

    return {
      valid: false,
      status: 'inactive',
      message: 'No valid cached data available for offline validation',
    };
  }

  /**
   * Check if license is valid
   */
  async isValid(): Promise<boolean> {
    try {
      const result = await this.validate();
      return result.valid;
    } catch {
      return false;
    }
  }

  /**
   * Get current license status
   */
  async getStatus(): Promise<LicenseStatus> {
    const result = await this.validate();
    return result.status;
  }

  /**
   * Refresh license data from server
   */
  async refresh(): Promise<ValidationResult> {
    // Clear cache and revalidate
    await this.cache.delete(CACHE_KEYS.VALIDATION);
    await this.cache.delete(CACHE_KEYS.LICENSE);
    return await this.validateOnline();
  }

  /**
   * Activate license on current device
   */
  async activate(): Promise<ActivationResult> {
    const fingerprint = await this.getFingerprint();
    const systemInfo = await this.getSystemInfo();

    const payload = {
      license_key: this.config.licenseKey,
      hardware_fingerprint: fingerprint,
      product_id: this.config.productId,
      system_info: systemInfo,
    };

    const response = await this.makeRequest<ActivationResult>('POST', '/activate', payload);

    if (response.success) {
      if (response.license) {
        await this.cache.set(CACHE_KEYS.LICENSE, response.license, this.config.cacheTtl);
      }

      if (response.offlineToken) {
        await this.cache.set(CACHE_KEYS.OFFLINE_TOKEN, response.offlineToken);
      }

      await this.eventEmitter.emit('license:activated', {
        license: response.license,
        message: 'License activated successfully',
      });
    }

    return response;
  }

  /**
   * Deactivate license on current device
   */
  async deactivate(reason?: string): Promise<DeactivationResult> {
    const fingerprint = await this.getFingerprint();

    const payload = {
      license_key: this.config.licenseKey,
      hardware_fingerprint: fingerprint,
      reason,
    };

    const response = await this.makeRequest<DeactivationResult>('POST', '/deactivate', payload);

    if (response.success) {
      // Clear cache
      await this.cache.delete(CACHE_KEYS.LICENSE);
      await this.cache.delete(CACHE_KEYS.VALIDATION);
      await this.cache.delete(CACHE_KEYS.OFFLINE_TOKEN);

      await this.eventEmitter.emit('license:deactivated', {
        message: reason || 'License deactivated',
      });
    }

    return response;
  }

  /**
   * Send heartbeat to server
   */
  async heartbeat(): Promise<HeartbeatResult> {
    const fingerprint = await this.getFingerprint();

    const payload = {
      license_key: this.config.licenseKey,
      hardware_fingerprint: fingerprint,
    };

    const response = await this.makeRequest<HeartbeatResult>('POST', '/heartbeat', payload);

    if (response.success) {
      await this.cache.set(CACHE_KEYS.LAST_HEARTBEAT, Date.now());
    }

    return response;
  }

  /**
   * Check if a feature is available
   */
  async hasFeature(featureKey: string): Promise<boolean> {
    const features = await this.getFeatures();
    const feature = features[featureKey];
    return feature?.enabled ?? false;
  }

  /**
   * Check if a feature can be used (with limit checking)
   */
  async canUseFeature(featureKey: string, currentUsage?: number): Promise<boolean> {
    const feature = await this.getFeatureConfig(featureKey);

    if (!feature || !feature.enabled) {
      return false;
    }

    // If there's a limit and current usage is provided, check it
    if (feature.limit !== undefined && currentUsage !== undefined) {
      return currentUsage < feature.limit;
    }

    return true;
  }

  /**
   * Get all features
   */
  async getFeatures(): Promise<Record<string, FeatureConfig>> {
    // Try to get from cache first
    const cached = await this.cache.get<Record<string, FeatureConfig>>(CACHE_KEYS.FEATURES);
    if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
      // Only use cache if it's in the correct object format
      return cached;
    }

    // Get validation result which includes features at top level
    type StructuredFeature = {
      key: string;
      name: string;
      type: string;
      configuration?: { limit?: number; quota?: number } | [];
    };
    type ValidationWithFeatures = ValidationResult & {
      features?: string[] | Record<string, FeatureConfig>;
      structuredFeatures?: Record<string, StructuredFeature[]>;
      structured_features?: Record<string, StructuredFeature[]>; // snake_case from server
    };
    const validation = await this.cache.get<ValidationWithFeatures>(CACHE_KEYS.VALIDATION);

    let features: Record<string, FeatureConfig> = {};

    // First try to use structuredFeatures for detailed config (check both camelCase and snake_case)
    const structuredFeatures = validation?.structuredFeatures || validation?.structured_features;
    if (structuredFeatures) {
      for (const category of Object.values(structuredFeatures)) {
        for (const feature of category) {
          const config = Array.isArray(feature.configuration) ? {} : feature.configuration;
          features[feature.key] = {
            enabled: true,
            limit: config?.limit,
            quota: config?.quota,
          };
        }
      }
    }

    // If no structuredFeatures, check features field
    if (Object.keys(features).length === 0 && validation?.features) {
      // Features can be an array of strings or an object
      if (Array.isArray(validation.features)) {
        // Convert array to object format
        for (const key of validation.features) {
          features[key] = { enabled: true };
        }
      } else if (typeof validation.features === 'object') {
        features = validation.features;
      }
    }

    // Fallback: check license.product.features for backward compatibility
    if (Object.keys(features).length === 0) {
      const license = await this.getLicenseInfo();
      const productFeatures = license?.product?.features;
      if (productFeatures) {
        if (Array.isArray(productFeatures)) {
          for (const key of productFeatures) {
            features[key] = { enabled: true };
          }
        } else if (typeof productFeatures === 'object') {
          features = productFeatures as Record<string, FeatureConfig>;
        }
      }
    }

    // Cache features in correct format
    if (Object.keys(features).length > 0) {
      await this.cache.set(CACHE_KEYS.FEATURES, features, this.config.cacheTtl);
    }

    return features;
  }

  /**
   * Get feature configuration
   */
  async getFeatureConfig(featureKey: string): Promise<FeatureConfig | null> {
    const features = await this.getFeatures();
    return features[featureKey] || null;
  }

  /**
   * Get license information
   */
  async getLicenseInfo(): Promise<LicenseInfo | null> {
    // Try cache first
    const cached = await this.cache.get<LicenseInfo>(CACHE_KEYS.LICENSE);
    if (cached) {
      return cached;
    }

    // Validate to get license info
    const result = await this.validate();
    return result.license || null;
  }

  /**
   * Get days until license expiry
   */
  async getDaysUntilExpiry(): Promise<number | null> {
    const license = await this.getLicenseInfo();
    return license?.daysUntilExpiry ?? null;
  }

  /**
   * Get hardware fingerprint
   */
  async getFingerprint(): Promise<string> {
    if (this.config.hardwareFingerprint) {
      return this.config.hardwareFingerprint;
    }

    if (this.config.autoFingerprint) {
      return await this.fingerprintService.generate();
    }

    throw new LicenseError('No hardware fingerprint configured', 'NO_FINGERPRINT');
  }

  /**
   * Get system information
   */
  private async getSystemInfo(): Promise<SystemInfo | undefined> {
    if (!this.config.systemInfo?.enabled) {
      return undefined;
    }

    const info: SystemInfo = {};

    if (this.config.systemInfo.includeNodeVersion) {
      info.nodeVersion = process.version;
    }

    if (this.config.systemInfo.includePlatform) {
      const os = await import('os');
      info.platform = os.platform();
      info.arch = os.arch();
    }

    if (this.config.systemInfo.includeHostname) {
      const os = await import('os');
      info.hostname = os.hostname();
    }

    return info;
  }

  /**
   * Make HTTP request with retry logic
   */
  private async makeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: unknown
  ): Promise<T> {
    const maxRetries = this.config.retry?.enabled ? this.config.retry.times : 1;
    const sleepMs = this.config.retry?.sleepMs || 1000;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.httpClient.request<T>({
          method,
          url: endpoint,
          data,
        });

        // Transform response keys from snake_case to camelCase
        return transformKeys<T>(response.data);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          this.log('warn', `Request failed (attempt ${attempt}/${maxRetries}), retrying...`, {
            endpoint,
            error: lastError.message,
          });
          await this.sleep(sleepMs);
        }
      }
    }

    // Handle the error
    if (lastError instanceof AxiosError) {
      throw new LicenseServerError(
        lastError.response?.data?.message || lastError.message,
        {
          statusCode: lastError.response?.status,
          response: lastError.response?.data,
        }
      );
    }

    throw new LicenseServerError(lastError?.message || 'Unknown error');
  }

  /**
   * Handle validation failure
   */
  private handleFailure(error: unknown): ValidationResult {
    const errorMessage = error instanceof Error ? error.message : String(error);

    switch (this.config.onFailure) {
      case 'throw':
        if (error instanceof LicenseError) {
          throw error;
        }
        throw new LicenseInvalidError(errorMessage);

      case 'log':
        this.log('error', 'License validation failed', { error: errorMessage });
        return {
          valid: false,
          status: 'inactive',
          message: errorMessage,
        };

      case 'silent':
      default:
        return {
          valid: false,
          status: 'inactive',
          message: errorMessage,
        };
    }
  }

  /**
   * Log message
   */
  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, unknown>
  ): void {
    if (!this.loggingConfig?.enabled) {
      return;
    }

    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = this.loggingConfig.level || 'info';

    if (levels.indexOf(level) < levels.indexOf(configLevel)) {
      return;
    }

    if (this.loggingConfig.logger) {
      this.loggingConfig.logger(level, message, context);
    } else {
      const logFn = console[level] || console.log;
      logFn(`[License] ${message}`, context || '');
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get the event emitter
   */
  getEventEmitter(): LicenseEventEmitter {
    return this.eventEmitter;
  }

  /**
   * Get the fingerprint service
   */
  getFingerprintService(): HardwareFingerprintService {
    return this.fingerprintService;
  }
}

/**
 * Create a client license service
 */
export function createClientLicenseService(
  config: ClientConfig,
  options?: {
    fingerprintConfig?: FingerprintConfig;
    loggingConfig?: LoggingConfig;
    eventEmitter?: LicenseEventEmitter;
  }
): ClientLicenseService {
  return new ClientLicenseService(config, options);
}
