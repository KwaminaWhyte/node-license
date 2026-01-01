import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import type {
  ServerConfig,
  DatabaseAdapter,
  LicenseServiceInterface,
  ValidationResult,
  ActivationResult,
  DeactivationResult,
  HeartbeatResult,
  LicenseInfo,
  LicenseStatus,
  FeatureConfig,
  LicenseRecord,
  ProductRecord,
  SystemInfo,
  FingerprintConfig,
  LoggingConfig,
} from '../types';
import { HardwareFingerprintService } from './HardwareFingerprintService';
import { LicenseEventEmitter, getLicenseEventEmitter } from '../events/LicenseEventEmitter';
import {
  LicenseError,
  LicenseInvalidError,
  LicenseExpiredError,
  LicenseActivationLimitError,
  LicenseConfigError,
} from '../utils/errors';

/**
 * Default server configuration
 */
const DEFAULT_SERVER_CONFIG: Partial<ServerConfig> = {
  jwtAlgorithm: 'HS256',
  gracePeriodDays: 7,
  offlineValidationDays: 30,
  defaultActivationLimit: 5,
  apiPrefix: 'api/license',
  enableCors: true,
  corsOrigins: '*',
  rateLimiting: {
    enabled: true,
    maxAttempts: 60,
    decayMinutes: 1,
  },
};

/**
 * Server license service for managing license validation
 */
export class ServerLicenseService implements LicenseServiceInterface {
  private config: ServerConfig;
  private database: DatabaseAdapter;
  private fingerprintService: HardwareFingerprintService;
  private eventEmitter: LicenseEventEmitter;
  private loggingConfig?: LoggingConfig;

  // Current license context
  private currentLicenseKey?: string;
  private currentHardwareFingerprint?: string;
  private currentProductId?: string;
  private currentLicense?: LicenseRecord;
  private currentProduct?: ProductRecord;

  constructor(
    config: ServerConfig,
    options?: {
      fingerprintConfig?: FingerprintConfig;
      loggingConfig?: LoggingConfig;
      eventEmitter?: LicenseEventEmitter;
    }
  ) {
    if (!config.database) {
      throw new LicenseConfigError('Database adapter is required for server mode');
    }

    if (!config.jwtSecret) {
      throw new LicenseConfigError('JWT secret is required for server mode');
    }

    this.config = { ...DEFAULT_SERVER_CONFIG, ...config } as ServerConfig;
    this.database = config.database;
    this.fingerprintService = new HardwareFingerprintService(options?.fingerprintConfig);
    this.eventEmitter = options?.eventEmitter || getLicenseEventEmitter();
    this.loggingConfig = options?.loggingConfig;
  }

  /**
   * Set license parameters for validation
   */
  setLicenseParams(
    licenseKey: string,
    hardwareFingerprint: string,
    productId: string
  ): this {
    this.currentLicenseKey = licenseKey;
    this.currentHardwareFingerprint = hardwareFingerprint;
    this.currentProductId = productId;
    this.currentLicense = undefined;
    this.currentProduct = undefined;
    return this;
  }

  /**
   * Validate license
   */
  async validate(): Promise<ValidationResult> {
    return this.validateLicense(
      this.currentLicenseKey!,
      this.currentHardwareFingerprint!,
      this.currentProductId!
    );
  }

  /**
   * Validate license with full parameters
   */
  async validateLicense(
    licenseKey: string,
    hardwareFingerprint: string,
    productId: string,
    options?: {
      systemInfo?: SystemInfo;
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<ValidationResult> {
    // Find license
    const license = await this.database.findLicenseByKey(licenseKey);

    if (!license) {
      await this.logValidation(licenseKey, 'online', 'failure', hardwareFingerprint, {
        error: 'License not found',
        ipAddress: options?.ipAddress,
      });

      await this.eventEmitter.emit('license:invalid', {
        message: 'License not found',
        context: { licenseKey },
      });

      return {
        valid: false,
        status: 'inactive',
        message: 'License not found',
        errors: ['LICENSE_NOT_FOUND'],
      };
    }

    // Check if license is for the correct product
    if (license.productId !== productId) {
      await this.logValidation(licenseKey, 'online', 'failure', hardwareFingerprint, {
        error: 'Product mismatch',
        ipAddress: options?.ipAddress,
      });

      return {
        valid: false,
        status: 'inactive',
        message: 'License is not valid for this product',
        errors: ['PRODUCT_MISMATCH'],
      };
    }

    // Get product info
    const product = await this.database.findProductById(productId);

    // Check license status
    if (license.status === 'suspended') {
      await this.eventEmitter.emit('license:invalid', {
        license: this.formatLicenseInfo(license, product),
        message: 'License is suspended',
      });

      return {
        valid: false,
        status: 'suspended',
        license: this.formatLicenseInfo(license, product),
        message: 'License is suspended',
        errors: ['LICENSE_SUSPENDED'],
      };
    }

    if (license.status === 'inactive') {
      return {
        valid: false,
        status: 'inactive',
        license: this.formatLicenseInfo(license, product),
        message: 'License is inactive',
        errors: ['LICENSE_INACTIVE'],
      };
    }

    // Check expiration
    const expirationResult = this.checkExpiration(license, product);
    if (!expirationResult.valid && !expirationResult.inGracePeriod) {
      await this.eventEmitter.emit('license:expired', {
        license: this.formatLicenseInfo(license, product),
        message: 'License has expired',
      });

      return {
        valid: false,
        status: 'expired',
        license: this.formatLicenseInfo(license, product),
        message: 'License has expired',
        errors: ['LICENSE_EXPIRED'],
      };
    }

    // Check/update activation
    const activationResult = await this.handleActivation(
      license,
      hardwareFingerprint,
      options?.systemInfo,
      options?.ipAddress
    );

    if (!activationResult.success) {
      return {
        valid: false,
        status: 'active',
        license: this.formatLicenseInfo(license, product),
        message: activationResult.message,
        errors: activationResult.errors,
      };
    }

    // Generate offline token
    const offlineToken = this.generateOfflineToken(license, hardwareFingerprint, product);

    // Log successful validation
    await this.logValidation(licenseKey, 'online', 'success', hardwareFingerprint, {
      ipAddress: options?.ipAddress,
    });

    // Emit event
    const licenseInfo = this.formatLicenseInfo(license, product);
    await this.eventEmitter.emit('license:validated', {
      license: licenseInfo,
      message: 'License validated successfully',
    });

    if (expirationResult.inGracePeriod) {
      await this.eventEmitter.emit('license:grace_period', {
        license: licenseInfo,
        message: `License is in grace period (${expirationResult.daysRemaining} days remaining)`,
      });
    }

    return {
      valid: true,
      status: expirationResult.inGracePeriod ? 'grace_period' : 'active',
      license: licenseInfo,
      offlineToken,
      nextValidation: this.calculateNextValidation(),
      message: expirationResult.inGracePeriod
        ? `License is in grace period`
        : 'License is valid',
    };
  }

  /**
   * Activate license
   */
  async activateLicense(
    licenseKey: string,
    hardwareFingerprint: string,
    productId: string,
    options?: {
      systemInfo?: SystemInfo;
      ipAddress?: string;
    }
  ): Promise<ActivationResult> {
    // Find license
    const license = await this.database.findLicenseByKey(licenseKey);

    if (!license) {
      return {
        success: false,
        message: 'License not found',
        errors: ['LICENSE_NOT_FOUND'],
      };
    }

    // Check if license is for the correct product
    if (license.productId !== productId) {
      return {
        success: false,
        message: 'License is not valid for this product',
        errors: ['PRODUCT_MISMATCH'],
      };
    }

    // Check license status
    if (license.status !== 'active' && license.status !== 'inactive') {
      return {
        success: false,
        message: `License cannot be activated (status: ${license.status})`,
        errors: ['INVALID_STATUS'],
      };
    }

    // Check activation limit
    const activeCount = await this.database.countActiveActivations(license.id);
    const limit = license.activationLimit || this.config.defaultActivationLimit!;

    // Check if already activated on this device
    const existingActivation = await this.database.findActivationByFingerprint(
      license.id,
      hardwareFingerprint
    );

    if (existingActivation && existingActivation.isActive) {
      // Already activated, just return success
      const product = await this.database.findProductById(productId);
      const licenseInfo = this.formatLicenseInfo(license, product);
      const offlineToken = this.generateOfflineToken(license, hardwareFingerprint, product);

      return {
        success: true,
        message: 'License is already activated on this device',
        license: licenseInfo,
        offlineToken,
      };
    }

    if (!existingActivation && activeCount >= limit) {
      return {
        success: false,
        message: `Activation limit exceeded (${activeCount}/${limit})`,
        errors: ['ACTIVATION_LIMIT_EXCEEDED'],
      };
    }

    // Create or update activation
    if (existingActivation) {
      await this.database.updateActivation(existingActivation.id, {
        isActive: true,
        lastCheckedAt: new Date(),
        systemInfo: options?.systemInfo as Record<string, unknown>,
        ipAddress: options?.ipAddress,
      });
    } else {
      await this.database.createActivation({
        licenseId: license.id,
        hardwareFingerprint,
        systemInfo: options?.systemInfo as Record<string, unknown>,
        ipAddress: options?.ipAddress,
      });
    }

    // Get product and generate response
    const product = await this.database.findProductById(productId);
    const licenseInfo = this.formatLicenseInfo(license, product);
    const offlineToken = this.generateOfflineToken(license, hardwareFingerprint, product);

    await this.eventEmitter.emit('license:activated', {
      license: licenseInfo,
      message: 'License activated successfully',
      context: { hardwareFingerprint },
    });

    return {
      success: true,
      message: 'License activated successfully',
      license: licenseInfo,
      offlineToken,
    };
  }

  /**
   * Deactivate license
   */
  async deactivateLicense(
    licenseKey: string,
    hardwareFingerprint: string,
    reason?: string
  ): Promise<DeactivationResult> {
    // Find license
    const license = await this.database.findLicenseByKey(licenseKey);

    if (!license) {
      return {
        success: false,
        message: 'License not found',
        errors: ['LICENSE_NOT_FOUND'],
      };
    }

    // Find activation
    const activation = await this.database.findActivationByFingerprint(
      license.id,
      hardwareFingerprint
    );

    if (!activation) {
      return {
        success: false,
        message: 'No activation found for this device',
        errors: ['ACTIVATION_NOT_FOUND'],
      };
    }

    // Deactivate
    await this.database.deactivateActivation(activation.id);

    await this.eventEmitter.emit('license:deactivated', {
      message: reason || 'License deactivated',
      context: { licenseKey, hardwareFingerprint },
    });

    return {
      success: true,
      message: 'License deactivated successfully',
    };
  }

  /**
   * Handle heartbeat
   */
  async heartbeat(
    licenseKey: string,
    hardwareFingerprint: string
  ): Promise<HeartbeatResult> {
    // Find license
    const license = await this.database.findLicenseByKey(licenseKey);

    if (!license) {
      return {
        success: false,
        status: 'inactive',
        message: 'License not found',
      };
    }

    // Find and update activation
    const activation = await this.database.findActivationByFingerprint(
      license.id,
      hardwareFingerprint
    );

    if (activation && activation.isActive) {
      await this.database.updateActivation(activation.id, {
        lastCheckedAt: new Date(),
      });
    }

    // Check expiration
    const expirationResult = this.checkExpiration(license);

    return {
      success: true,
      status: expirationResult.inGracePeriod ? 'grace_period' : license.status as LicenseStatus,
      nextHeartbeat: this.calculateNextValidation(),
    };
  }

  /**
   * Verify offline token
   */
  verifyOfflineToken(
    token: string,
    hardwareFingerprint: string
  ): ValidationResult {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret, {
        algorithms: [this.config.jwtAlgorithm as jwt.Algorithm],
      }) as {
        license: LicenseInfo;
        hardware_fingerprint: string;
        product_id: string;
      };

      // Verify hardware fingerprint
      const matches = this.fingerprintService.compare(
        hardwareFingerprint,
        decoded.hardware_fingerprint
      );

      if (!matches) {
        return {
          valid: false,
          status: 'inactive',
          message: 'Hardware fingerprint mismatch',
          errors: ['FINGERPRINT_MISMATCH'],
        };
      }

      return {
        valid: true,
        status: decoded.license.status,
        license: decoded.license,
        message: 'Offline token verified',
      };
    } catch (error) {
      return {
        valid: false,
        status: 'inactive',
        message: error instanceof Error ? error.message : 'Invalid offline token',
        errors: ['INVALID_TOKEN'],
      };
    }
  }

  /**
   * Get license info
   */
  async getLicenseInfo(licenseKey?: string): Promise<LicenseInfo | null> {
    const key = licenseKey || this.currentLicenseKey;
    if (!key) return null;

    const license = await this.database.findLicenseByKey(key);
    if (!license) return null;

    const product = await this.database.findProductById(license.productId);
    return this.formatLicenseInfo(license, product);
  }

  /**
   * Check if license is valid
   */
  async isValid(): Promise<boolean> {
    if (!this.currentLicenseKey) return false;

    const result = await this.validate();
    return result.valid;
  }

  /**
   * Get license status
   */
  async getStatus(): Promise<LicenseStatus> {
    const info = await this.getLicenseInfo();
    return info?.status || 'inactive';
  }

  /**
   * Check if feature is available
   */
  async hasFeature(featureKey: string): Promise<boolean> {
    const features = await this.getFeatures();
    return features[featureKey]?.enabled ?? false;
  }

  /**
   * Check if feature can be used
   */
  async canUseFeature(featureKey: string, currentUsage?: number): Promise<boolean> {
    const feature = await this.getFeatureConfig(featureKey);

    if (!feature || !feature.enabled) {
      return false;
    }

    if (feature.limit !== undefined && currentUsage !== undefined) {
      return currentUsage < feature.limit;
    }

    return true;
  }

  /**
   * Get all features
   */
  async getFeatures(): Promise<Record<string, FeatureConfig>> {
    if (!this.currentProductId && !this.currentLicense) {
      return {};
    }

    const productId = this.currentProductId || this.currentLicense?.productId;
    if (!productId) return {};

    const product = await this.database.findProductById(productId);
    return product?.features || {};
  }

  /**
   * Get feature configuration
   */
  async getFeatureConfig(featureKey: string): Promise<FeatureConfig | null> {
    const features = await this.getFeatures();
    return features[featureKey] || null;
  }

  /**
   * Get days until expiry
   */
  async getDaysUntilExpiry(): Promise<number | null> {
    const info = await this.getLicenseInfo();
    return info?.daysUntilExpiry ?? null;
  }

  /**
   * Handle activation check and update
   */
  private async handleActivation(
    license: LicenseRecord,
    hardwareFingerprint: string,
    systemInfo?: SystemInfo,
    ipAddress?: string
  ): Promise<{ success: boolean; message?: string; errors?: string[] }> {
    const activeCount = await this.database.countActiveActivations(license.id);
    const limit = license.activationLimit || this.config.defaultActivationLimit!;

    // Check for existing activation
    const existingActivation = await this.database.findActivationByFingerprint(
      license.id,
      hardwareFingerprint
    );

    if (existingActivation) {
      // Update last checked time
      await this.database.updateActivation(existingActivation.id, {
        lastCheckedAt: new Date(),
        systemInfo: systemInfo as Record<string, unknown>,
        ipAddress,
      });

      if (!existingActivation.isActive) {
        // Reactivate if within limits
        if (activeCount >= limit) {
          return {
            success: false,
            message: `Activation limit exceeded (${activeCount}/${limit})`,
            errors: ['ACTIVATION_LIMIT_EXCEEDED'],
          };
        }

        await this.database.updateActivation(existingActivation.id, {
          isActive: true,
        });
      }

      return { success: true };
    }

    // New device - check limits
    if (activeCount >= limit) {
      return {
        success: false,
        message: `Activation limit exceeded (${activeCount}/${limit})`,
        errors: ['ACTIVATION_LIMIT_EXCEEDED'],
      };
    }

    // Create new activation
    await this.database.createActivation({
      licenseId: license.id,
      hardwareFingerprint,
      systemInfo: systemInfo as Record<string, unknown>,
      ipAddress,
    });

    return { success: true };
  }

  /**
   * Check license expiration
   */
  private checkExpiration(
    license: LicenseRecord,
    product?: ProductRecord | null
  ): {
    valid: boolean;
    inGracePeriod: boolean;
    daysRemaining?: number;
  } {
    if (!license.expiresAt) {
      return { valid: true, inGracePeriod: false };
    }

    const now = new Date();
    const expiresAt = new Date(license.expiresAt);

    if (now < expiresAt) {
      const daysRemaining = Math.ceil(
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      return { valid: true, inGracePeriod: false, daysRemaining };
    }

    // License has expired, check grace period
    const graceDays =
      license.gracePeriodDays ??
      product?.gracePeriodDays ??
      this.config.gracePeriodDays!;

    const graceEndDate = new Date(expiresAt);
    graceEndDate.setDate(graceEndDate.getDate() + graceDays);

    if (now < graceEndDate) {
      const daysRemaining = Math.ceil(
        (graceEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      return { valid: true, inGracePeriod: true, daysRemaining };
    }

    return { valid: false, inGracePeriod: false };
  }

  /**
   * Generate offline validation token
   */
  private generateOfflineToken(
    license: LicenseRecord,
    hardwareFingerprint: string,
    product?: ProductRecord | null
  ): string {
    const offlineDays =
      product?.offlineValidationDays ?? this.config.offlineValidationDays!;

    const payload = {
      license: this.formatLicenseInfo(license, product),
      hardware_fingerprint: hardwareFingerprint,
      product_id: license.productId,
    };

    return jwt.sign(payload, this.config.jwtSecret, {
      algorithm: this.config.jwtAlgorithm as jwt.Algorithm,
      expiresIn: `${offlineDays}d`,
    });
  }

  /**
   * Format license record to license info
   */
  private formatLicenseInfo(
    license: LicenseRecord,
    product?: ProductRecord | null
  ): LicenseInfo {
    const now = new Date();
    const expiresAt = license.expiresAt ? new Date(license.expiresAt) : undefined;
    const isExpired = expiresAt ? now > expiresAt : false;

    let daysUntilExpiry: number | undefined;
    if (expiresAt && !isExpired) {
      daysUntilExpiry = Math.ceil(
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    const graceDays =
      license.gracePeriodDays ??
      product?.gracePeriodDays ??
      this.config.gracePeriodDays!;

    let isInGracePeriod = false;
    if (isExpired && expiresAt) {
      const graceEndDate = new Date(expiresAt);
      graceEndDate.setDate(graceEndDate.getDate() + graceDays);
      isInGracePeriod = now < graceEndDate;
    }

    return {
      id: license.id,
      licenseKey: license.licenseKey,
      status: license.status as LicenseStatus,
      activatedAt: license.activatedAt?.toISOString(),
      expiresAt: license.expiresAt?.toISOString(),
      activationLimit: license.activationLimit,
      activationCount: license.activationCount,
      daysUntilExpiry,
      isExpired,
      isInGracePeriod,
      metadata: license.metadata,
      product: product
        ? {
            id: product.id,
            name: product.name,
            version: product.version,
            features: product.features,
          }
        : undefined,
    };
  }

  /**
   * Calculate next validation time
   */
  private calculateNextValidation(): string {
    const next = new Date();
    next.setHours(next.getHours() + 24);
    return next.toISOString();
  }

  /**
   * Log validation attempt
   */
  private async logValidation(
    licenseKey: string,
    validationType: 'online' | 'offline' | 'cache',
    result: 'success' | 'failure',
    hardwareFingerprint?: string,
    context?: Record<string, unknown>
  ): Promise<void> {
    if (this.database.logValidation) {
      try {
        await this.database.logValidation({
          licenseKey,
          validationType,
          result,
          hardwareFingerprint,
          ipAddress: context?.ipAddress as string,
          userAgent: context?.userAgent as string,
          errorMessage: context?.error as string,
          context,
        });
      } catch (error) {
        this.log('error', 'Failed to log validation', { error });
      }
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

    if (this.loggingConfig.logger) {
      this.loggingConfig.logger(level, message, context);
    } else {
      const logFn = console[level] || console.log;
      logFn(`[License Server] ${message}`, context || '');
    }
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
 * Create a server license service
 */
export function createServerLicenseService(
  config: ServerConfig,
  options?: {
    fingerprintConfig?: FingerprintConfig;
    loggingConfig?: LoggingConfig;
    eventEmitter?: LicenseEventEmitter;
  }
): ServerLicenseService {
  return new ServerLicenseService(config, options);
}
