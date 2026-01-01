import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ClientLicenseService } from '../services/ClientLicenseService';
import type { ServerLicenseService } from '../services/ServerLicenseService';
import type { ValidationResult, LicenseInfo } from '../types';
import { LicenseError, LicenseInvalidError, FeatureNotAvailableError } from '../utils/errors';

/**
 * Extended Express Request with license info
 */
export interface LicenseRequest extends Request {
  license?: LicenseInfo;
  licenseValidation?: ValidationResult;
}

/**
 * Options for license middleware
 */
export interface LicenseMiddlewareOptions {
  /** Redirect URL on failure (if not set, returns JSON error) */
  redirectUrl?: string;

  /** Custom error handler */
  onError?: (error: LicenseError, req: Request, res: Response, next: NextFunction) => void;

  /** Skip validation for certain paths */
  skip?: (req: Request) => boolean;

  /** Custom validation function */
  validate?: (req: Request) => Promise<ValidationResult>;
}

/**
 * Create Express middleware for license validation (client mode)
 */
export function createLicenseMiddleware(
  licenseService: ClientLicenseService,
  options?: LicenseMiddlewareOptions
): RequestHandler {
  return async (req: LicenseRequest, res: Response, next: NextFunction) => {
    // Check if we should skip
    if (options?.skip && options.skip(req)) {
      return next();
    }

    try {
      // Custom validation or default
      const result = options?.validate
        ? await options.validate(req)
        : await licenseService.validate();

      if (!result.valid) {
        const error = new LicenseInvalidError(result.message || 'License validation failed');

        if (options?.onError) {
          return options.onError(error, req, res, next);
        }

        if (options?.redirectUrl) {
          return res.redirect(options.redirectUrl);
        }

        return res.status(403).json({
          success: false,
          error: 'LICENSE_INVALID',
          message: result.message || 'License validation failed',
          status: result.status,
        });
      }

      // Attach license info to request
      req.license = result.license;
      req.licenseValidation = result;

      next();
    } catch (error) {
      if (error instanceof LicenseError && options?.onError) {
        return options.onError(error, req, res, next);
      }

      if (options?.redirectUrl) {
        return res.redirect(options.redirectUrl);
      }

      const message = error instanceof Error ? error.message : 'License validation error';
      return res.status(500).json({
        success: false,
        error: 'LICENSE_ERROR',
        message,
      });
    }
  };
}

/**
 * Options for feature check middleware
 */
export interface FeatureMiddlewareOptions {
  /** Required feature key */
  feature: string;

  /** Current usage for limit-based features */
  getCurrentUsage?: (req: Request) => Promise<number> | number;

  /** Redirect URL on failure */
  redirectUrl?: string;

  /** Custom error handler */
  onError?: (error: FeatureNotAvailableError, req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Create Express middleware for feature checking
 */
export function createFeatureMiddleware(
  licenseService: ClientLicenseService | ServerLicenseService,
  options: FeatureMiddlewareOptions
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let canUse: boolean;

      if (options.getCurrentUsage) {
        const usage = await options.getCurrentUsage(req);
        canUse = await licenseService.canUseFeature(options.feature, usage);
      } else {
        canUse = await licenseService.hasFeature(options.feature);
      }

      if (!canUse) {
        const error = new FeatureNotAvailableError(options.feature);

        if (options.onError) {
          return options.onError(error, req, res, next);
        }

        if (options.redirectUrl) {
          return res.redirect(options.redirectUrl);
        }

        return res.status(403).json({
          success: false,
          error: 'FEATURE_NOT_AVAILABLE',
          message: `Feature '${options.feature}' is not available with your current license`,
          feature: options.feature,
        });
      }

      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Feature check error';
      return res.status(500).json({
        success: false,
        error: 'FEATURE_CHECK_ERROR',
        message,
      });
    }
  };
}

/**
 * Remix/generic utilities for license checking
 */
export const licenseUtils = {
  /**
   * Check license validity (for use in Remix loaders/actions)
   */
  async checkLicense(
    licenseService: ClientLicenseService
  ): Promise<{ valid: boolean; license?: LicenseInfo; error?: string }> {
    try {
      const result = await licenseService.validate();
      return {
        valid: result.valid,
        license: result.license,
        error: result.valid ? undefined : result.message,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'License validation error',
      };
    }
  },

  /**
   * Require valid license (throws on failure)
   */
  async requireLicense(
    licenseService: ClientLicenseService
  ): Promise<LicenseInfo> {
    const result = await licenseService.validate();

    if (!result.valid) {
      throw new LicenseInvalidError(result.message || 'Valid license required');
    }

    if (!result.license) {
      throw new LicenseInvalidError('License information not available');
    }

    return result.license;
  },

  /**
   * Require specific feature (throws on failure)
   */
  async requireFeature(
    licenseService: ClientLicenseService | ServerLicenseService,
    featureKey: string,
    currentUsage?: number
  ): Promise<void> {
    const canUse = currentUsage !== undefined
      ? await licenseService.canUseFeature(featureKey, currentUsage)
      : await licenseService.hasFeature(featureKey);

    if (!canUse) {
      throw new FeatureNotAvailableError(featureKey);
    }
  },

  /**
   * Check if feature is available
   */
  async checkFeature(
    licenseService: ClientLicenseService | ServerLicenseService,
    featureKey: string,
    currentUsage?: number
  ): Promise<boolean> {
    try {
      return currentUsage !== undefined
        ? await licenseService.canUseFeature(featureKey, currentUsage)
        : await licenseService.hasFeature(featureKey);
    } catch {
      return false;
    }
  },
};

/**
 * Server mode: Create Express routes for license API
 */
export function createLicenseRoutes(
  serverLicenseService: ServerLicenseService
): {
  validate: RequestHandler;
  activate: RequestHandler;
  deactivate: RequestHandler;
  heartbeat: RequestHandler;
  status: RequestHandler;
} {
  return {
    validate: async (req: Request, res: Response) => {
      try {
        const { license_key, hardware_fingerprint, product_id, system_info } = req.body;

        if (!license_key || !hardware_fingerprint || !product_id) {
          return res.status(400).json({
            valid: false,
            status: 'inactive',
            message: 'Missing required fields: license_key, hardware_fingerprint, product_id',
          });
        }

        const result = await serverLicenseService.validateLicense(
          license_key,
          hardware_fingerprint,
          product_id,
          {
            systemInfo: system_info,
            ipAddress: req.ip || req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
          }
        );

        res.json(result);
      } catch (error) {
        res.status(500).json({
          valid: false,
          status: 'inactive',
          message: error instanceof Error ? error.message : 'Validation error',
        });
      }
    },

    activate: async (req: Request, res: Response) => {
      try {
        const { license_key, hardware_fingerprint, product_id, system_info } = req.body;

        if (!license_key || !hardware_fingerprint || !product_id) {
          return res.status(400).json({
            success: false,
            message: 'Missing required fields: license_key, hardware_fingerprint, product_id',
          });
        }

        const result = await serverLicenseService.activateLicense(
          license_key,
          hardware_fingerprint,
          product_id,
          {
            systemInfo: system_info,
            ipAddress: req.ip || req.socket.remoteAddress,
          }
        );

        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Activation error',
        });
      }
    },

    deactivate: async (req: Request, res: Response) => {
      try {
        const { license_key, hardware_fingerprint, reason } = req.body;

        if (!license_key || !hardware_fingerprint) {
          return res.status(400).json({
            success: false,
            message: 'Missing required fields: license_key, hardware_fingerprint',
          });
        }

        const result = await serverLicenseService.deactivateLicense(
          license_key,
          hardware_fingerprint,
          reason
        );

        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Deactivation error',
        });
      }
    },

    heartbeat: async (req: Request, res: Response) => {
      try {
        const { license_key, hardware_fingerprint } = req.body;

        if (!license_key || !hardware_fingerprint) {
          return res.status(400).json({
            success: false,
            status: 'inactive',
            message: 'Missing required fields: license_key, hardware_fingerprint',
          });
        }

        const result = await serverLicenseService.heartbeat(
          license_key,
          hardware_fingerprint
        );

        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          status: 'inactive',
          message: error instanceof Error ? error.message : 'Heartbeat error',
        });
      }
    },

    status: async (req: Request, res: Response) => {
      try {
        const licenseKey = req.query.license_key as string || req.params.licenseKey;

        if (!licenseKey) {
          return res.status(400).json({
            success: false,
            message: 'Missing license_key parameter',
          });
        }

        const license = await serverLicenseService.getLicenseInfo(licenseKey);

        if (!license) {
          return res.status(404).json({
            success: false,
            message: 'License not found',
          });
        }

        res.json({
          success: true,
          license,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Status error',
        });
      }
    },
  };
}
