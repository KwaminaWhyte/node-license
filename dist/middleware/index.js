'use strict';

// src/utils/errors.ts
var LicenseError = class extends Error {
  code;
  context;
  constructor(message, code = "LICENSE_ERROR", context) {
    super(message);
    this.name = "LicenseError";
    this.code = code;
    this.context = context;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
};
var LicenseInvalidError = class extends LicenseError {
  constructor(message = "License is invalid", context) {
    super(message, "LICENSE_INVALID", context);
    this.name = "LicenseInvalidError";
  }
};
var FeatureNotAvailableError = class extends LicenseError {
  featureKey;
  constructor(featureKey, context) {
    super(`Feature '${featureKey}' is not available`, "FEATURE_NOT_AVAILABLE", context);
    this.name = "FeatureNotAvailableError";
    this.featureKey = featureKey;
  }
};

// src/middleware/index.ts
function createLicenseMiddleware(licenseService, options) {
  return async (req, res, next) => {
    if (options?.skip && options.skip(req)) {
      return next();
    }
    try {
      const result = options?.validate ? await options.validate(req) : await licenseService.validate();
      if (!result.valid) {
        const error = new LicenseInvalidError(result.message || "License validation failed");
        if (options?.onError) {
          return options.onError(error, req, res, next);
        }
        if (options?.redirectUrl) {
          return res.redirect(options.redirectUrl);
        }
        return res.status(403).json({
          success: false,
          error: "LICENSE_INVALID",
          message: result.message || "License validation failed",
          status: result.status
        });
      }
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
      const message = error instanceof Error ? error.message : "License validation error";
      return res.status(500).json({
        success: false,
        error: "LICENSE_ERROR",
        message
      });
    }
  };
}
function createFeatureMiddleware(licenseService, options) {
  return async (req, res, next) => {
    try {
      let canUse;
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
          error: "FEATURE_NOT_AVAILABLE",
          message: `Feature '${options.feature}' is not available with your current license`,
          feature: options.feature
        });
      }
      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Feature check error";
      return res.status(500).json({
        success: false,
        error: "FEATURE_CHECK_ERROR",
        message
      });
    }
  };
}
var licenseUtils = {
  /**
   * Check license validity (for use in Remix loaders/actions)
   */
  async checkLicense(licenseService) {
    try {
      const result = await licenseService.validate();
      return {
        valid: result.valid,
        license: result.license,
        error: result.valid ? void 0 : result.message
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "License validation error"
      };
    }
  },
  /**
   * Require valid license (throws on failure)
   */
  async requireLicense(licenseService) {
    const result = await licenseService.validate();
    if (!result.valid) {
      throw new LicenseInvalidError(result.message || "Valid license required");
    }
    if (!result.license) {
      throw new LicenseInvalidError("License information not available");
    }
    return result.license;
  },
  /**
   * Require specific feature (throws on failure)
   */
  async requireFeature(licenseService, featureKey, currentUsage) {
    const canUse = currentUsage !== void 0 ? await licenseService.canUseFeature(featureKey, currentUsage) : await licenseService.hasFeature(featureKey);
    if (!canUse) {
      throw new FeatureNotAvailableError(featureKey);
    }
  },
  /**
   * Check if feature is available
   */
  async checkFeature(licenseService, featureKey, currentUsage) {
    try {
      return currentUsage !== void 0 ? await licenseService.canUseFeature(featureKey, currentUsage) : await licenseService.hasFeature(featureKey);
    } catch {
      return false;
    }
  }
};
function createLicenseRoutes(serverLicenseService) {
  return {
    validate: async (req, res) => {
      try {
        const { license_key, hardware_fingerprint, product_id, system_info } = req.body;
        if (!license_key || !hardware_fingerprint || !product_id) {
          return res.status(400).json({
            valid: false,
            status: "inactive",
            message: "Missing required fields: license_key, hardware_fingerprint, product_id"
          });
        }
        const result = await serverLicenseService.validateLicense(
          license_key,
          hardware_fingerprint,
          product_id,
          {
            systemInfo: system_info,
            ipAddress: req.ip || req.socket.remoteAddress,
            userAgent: req.headers["user-agent"]
          }
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({
          valid: false,
          status: "inactive",
          message: error instanceof Error ? error.message : "Validation error"
        });
      }
    },
    activate: async (req, res) => {
      try {
        const { license_key, hardware_fingerprint, product_id, system_info } = req.body;
        if (!license_key || !hardware_fingerprint || !product_id) {
          return res.status(400).json({
            success: false,
            message: "Missing required fields: license_key, hardware_fingerprint, product_id"
          });
        }
        const result = await serverLicenseService.activateLicense(
          license_key,
          hardware_fingerprint,
          product_id,
          {
            systemInfo: system_info,
            ipAddress: req.ip || req.socket.remoteAddress
          }
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : "Activation error"
        });
      }
    },
    deactivate: async (req, res) => {
      try {
        const { license_key, hardware_fingerprint, reason } = req.body;
        if (!license_key || !hardware_fingerprint) {
          return res.status(400).json({
            success: false,
            message: "Missing required fields: license_key, hardware_fingerprint"
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
          message: error instanceof Error ? error.message : "Deactivation error"
        });
      }
    },
    heartbeat: async (req, res) => {
      try {
        const { license_key, hardware_fingerprint } = req.body;
        if (!license_key || !hardware_fingerprint) {
          return res.status(400).json({
            success: false,
            status: "inactive",
            message: "Missing required fields: license_key, hardware_fingerprint"
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
          status: "inactive",
          message: error instanceof Error ? error.message : "Heartbeat error"
        });
      }
    },
    status: async (req, res) => {
      try {
        const licenseKey = req.query.license_key || req.params.licenseKey;
        if (!licenseKey) {
          return res.status(400).json({
            success: false,
            message: "Missing license_key parameter"
          });
        }
        const license = await serverLicenseService.getLicenseInfo(licenseKey);
        if (!license) {
          return res.status(404).json({
            success: false,
            message: "License not found"
          });
        }
        res.json({
          success: true,
          license
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : "Status error"
        });
      }
    }
  };
}

exports.createFeatureMiddleware = createFeatureMiddleware;
exports.createLicenseMiddleware = createLicenseMiddleware;
exports.createLicenseRoutes = createLicenseRoutes;
exports.licenseUtils = licenseUtils;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map