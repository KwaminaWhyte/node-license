import { createHash } from 'crypto';
import * as os from 'os';
import si from 'systeminformation';
import axios, { AxiosError } from 'axios';
import jwt2 from 'jsonwebtoken';

// src/services/HardwareFingerprintService.ts
var DEFAULT_CONFIG = {
  components: {
    hostname: true,
    ipAddress: true,
    macAddress: true,
    cpuInfo: false,
    diskSerial: false,
    platform: true
  },
  tolerance: 10,
  hashAlgorithm: "sha256"
};
var HardwareFingerprintService = class {
  config;
  cachedFingerprint = null;
  cachedSystemInfo = null;
  constructor(config) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      components: {
        ...DEFAULT_CONFIG.components,
        ...config?.components
      }
    };
  }
  /**
   * Generate a hardware fingerprint for the current system
   */
  async generate() {
    if (this.cachedFingerprint) {
      return this.cachedFingerprint;
    }
    const components = await this.collectComponents();
    this.cachedFingerprint = this.hashComponents(components);
    return this.cachedFingerprint;
  }
  /**
   * Generate fingerprint from provided components
   */
  generateFromComponents(components) {
    return this.hashComponents(components);
  }
  /**
   * Compare two fingerprints with tolerance
   */
  compare(fingerprint1, fingerprint2, tolerance) {
    const tol = tolerance ?? this.config.tolerance;
    if (fingerprint1 === fingerprint2) {
      return true;
    }
    if (tol === 0) {
      return false;
    }
    const similarity = this.calculateSimilarity(fingerprint1, fingerprint2);
    return similarity >= 100 - tol;
  }
  /**
   * Get detailed system information
   */
  async getSystemInfo() {
    if (this.cachedSystemInfo) {
      return this.cachedSystemInfo;
    }
    await si.cpu();
    const memInfo = await si.mem();
    this.cachedSystemInfo = {
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpus: os.cpus().length,
      memory: Math.round(memInfo.total / (1024 * 1024 * 1024)),
      // GB
      uptime: Math.round(os.uptime())
    };
    return this.cachedSystemInfo;
  }
  /**
   * Clear cached fingerprint and system info
   */
  clearCache() {
    this.cachedFingerprint = null;
    this.cachedSystemInfo = null;
  }
  /**
   * Get the current configuration
   */
  getConfig() {
    return { ...this.config };
  }
  /**
   * Collect hardware components based on configuration
   */
  async collectComponents() {
    const components = {};
    const { components: enabled } = this.config;
    if (enabled.hostname) {
      components.hostname = os.hostname();
    }
    if (enabled.platform) {
      components.platform = `${os.platform()}-${os.arch()}`;
    }
    if (enabled.ipAddress) {
      components.ipAddress = await this.getPrimaryIpAddress();
    }
    if (enabled.macAddress) {
      components.macAddress = await this.getPrimaryMacAddress();
    }
    if (enabled.cpuInfo) {
      const cpu = await si.cpu();
      components.cpuInfo = `${cpu.manufacturer}-${cpu.brand}-${cpu.cores}`;
    }
    if (enabled.diskSerial) {
      const diskSerial = await this.getDiskSerial();
      if (diskSerial) {
        components.diskSerial = diskSerial;
      }
    }
    return components;
  }
  /**
   * Get primary IP address
   */
  async getPrimaryIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const [, nets] of Object.entries(interfaces)) {
      if (!nets) continue;
      for (const net of nets) {
        if (net.internal || net.family !== "IPv4") continue;
        return net.address;
      }
    }
    return "0.0.0.0";
  }
  /**
   * Get primary MAC address
   */
  async getPrimaryMacAddress() {
    try {
      const networkInterfaces2 = await si.networkInterfaces();
      const interfaces = Array.isArray(networkInterfaces2) ? networkInterfaces2 : [networkInterfaces2];
      for (const iface of interfaces) {
        if (iface.mac && iface.mac !== "00:00:00:00:00:00" && !iface.internal) {
          return iface.mac;
        }
      }
    } catch {
      const interfaces = os.networkInterfaces();
      for (const [, nets] of Object.entries(interfaces)) {
        if (!nets) continue;
        for (const net of nets) {
          if (!net.internal && net.mac && net.mac !== "00:00:00:00:00:00") {
            return net.mac;
          }
        }
      }
    }
    return "00:00:00:00:00:00";
  }
  /**
   * Get disk serial number
   */
  async getDiskSerial() {
    try {
      const diskLayout = await si.diskLayout();
      if (diskLayout.length > 0 && diskLayout[0].serialNum) {
        return diskLayout[0].serialNum;
      }
    } catch {
    }
    return null;
  }
  /**
   * Hash components into fingerprint
   */
  hashComponents(components) {
    const sortedKeys = Object.keys(components).sort();
    const data = sortedKeys.map((key) => `${key}:${components[key]}`).join("|");
    return createHash(this.config.hashAlgorithm).update(data).digest("hex");
  }
  /**
   * Calculate similarity between two fingerprints (0-100)
   */
  calculateSimilarity(fp1, fp2) {
    if (fp1.length !== fp2.length) {
      return 0;
    }
    let matches = 0;
    for (let i = 0; i < fp1.length; i++) {
      if (fp1[i] === fp2[i]) {
        matches++;
      }
    }
    return matches / fp1.length * 100;
  }
};
function createFingerprintService(config) {
  return new HardwareFingerprintService(config);
}

// src/utils/cache.ts
var MemoryCacheAdapter = class {
  cache = /* @__PURE__ */ new Map();
  cleanupInterval = null;
  constructor(cleanupIntervalMs = 6e4) {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }
  async get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }
  async set(key, value, ttlSeconds) {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1e3 : null;
    this.cache.set(key, { value, expiresAt });
  }
  async delete(key) {
    this.cache.delete(key);
  }
  async has(key) {
    const value = await this.get(key);
    return value !== null;
  }
  async clear() {
    this.cache.clear();
  }
  /**
   * Stop the cleanup interval
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
};
var FileCacheAdapter = class {
  cacheDir;
  fs = null;
  path = null;
  constructor(cacheDir = "./.license-cache") {
    this.cacheDir = cacheDir;
  }
  async ensureModules() {
    if (!this.fs || !this.path) {
      this.fs = await import('fs/promises');
      this.path = await import('path');
      try {
        await this.fs.mkdir(this.cacheDir, { recursive: true });
      } catch {
      }
    }
  }
  getCacheFilePath(key) {
    const safeKey = Buffer.from(key).toString("base64url");
    return this.path.join(this.cacheDir, `${safeKey}.json`);
  }
  async get(key) {
    await this.ensureModules();
    try {
      const filePath = this.getCacheFilePath(key);
      const content = await this.fs.readFile(filePath, "utf-8");
      const entry = JSON.parse(content);
      if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
        await this.delete(key);
        return null;
      }
      return entry.value;
    } catch {
      return null;
    }
  }
  async set(key, value, ttlSeconds) {
    await this.ensureModules();
    const entry = {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1e3 : null
    };
    const filePath = this.getCacheFilePath(key);
    await this.fs.writeFile(filePath, JSON.stringify(entry), "utf-8");
  }
  async delete(key) {
    await this.ensureModules();
    try {
      const filePath = this.getCacheFilePath(key);
      await this.fs.unlink(filePath);
    } catch {
    }
  }
  async has(key) {
    const value = await this.get(key);
    return value !== null;
  }
  async clear() {
    await this.ensureModules();
    try {
      const files = await this.fs.readdir(this.cacheDir);
      await Promise.all(
        files.filter((f) => f.endsWith(".json")).map((f) => this.fs.unlink(this.path.join(this.cacheDir, f)))
      );
    } catch {
    }
  }
};
function createMemoryCache(cleanupIntervalMs) {
  return new MemoryCacheAdapter(cleanupIntervalMs);
}
function createFileCache(cacheDir) {
  return new FileCacheAdapter(cacheDir);
}

// src/events/LicenseEventEmitter.ts
var LicenseEventEmitter = class {
  listeners = /* @__PURE__ */ new Map();
  /**
   * Add an event listener
   */
  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, /* @__PURE__ */ new Set());
    }
    this.listeners.get(event).add(listener);
    return () => this.off(event, listener);
  }
  /**
   * Add a one-time event listener
   */
  once(event, listener) {
    const wrapper = async (e) => {
      this.off(event, wrapper);
      await listener(e);
    };
    return this.on(event, wrapper);
  }
  /**
   * Remove an event listener
   */
  off(event, listener) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
    }
  }
  /**
   * Emit an event
   */
  async emit(type, options) {
    const event = {
      type,
      timestamp: /* @__PURE__ */ new Date(),
      license: options?.license,
      message: options?.message,
      context: options?.context
    };
    const specificListeners = this.listeners.get(type) || /* @__PURE__ */ new Set();
    const wildcardListeners = this.listeners.get("*") || /* @__PURE__ */ new Set();
    const allListeners = [...specificListeners, ...wildcardListeners];
    await Promise.all(
      allListeners.map(async (listener) => {
        try {
          await listener(event);
        } catch (error) {
          console.error(`Error in license event listener for ${type}:`, error);
        }
      })
    );
  }
  /**
   * Remove all listeners for an event or all events
   */
  removeAllListeners(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
  /**
   * Get listener count for an event
   */
  listenerCount(event) {
    return this.listeners.get(event)?.size || 0;
  }
};
var eventEmitter = null;
function getLicenseEventEmitter() {
  if (!eventEmitter) {
    eventEmitter = new LicenseEventEmitter();
  }
  return eventEmitter;
}
function createLicenseEventEmitter() {
  return new LicenseEventEmitter();
}

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
var LicenseExpiredError = class extends LicenseError {
  expiredAt;
  gracePeriodDays;
  constructor(message = "License has expired", options) {
    super(message, "LICENSE_EXPIRED", options?.context);
    this.name = "LicenseExpiredError";
    this.expiredAt = options?.expiredAt;
    this.gracePeriodDays = options?.gracePeriodDays;
  }
};
var LicenseServerError = class extends LicenseError {
  statusCode;
  response;
  constructor(message = "License server error", options) {
    super(message, "LICENSE_SERVER_ERROR", options?.context);
    this.name = "LicenseServerError";
    this.statusCode = options?.statusCode;
    this.response = options?.response;
  }
};
var LicenseActivationLimitError = class extends LicenseError {
  limit;
  current;
  constructor(limit, current, context) {
    super(
      `Activation limit exceeded. Limit: ${limit}, Current: ${current}`,
      "LICENSE_ACTIVATION_LIMIT",
      context
    );
    this.name = "LicenseActivationLimitError";
    this.limit = limit;
    this.current = current;
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
var LicenseConfigError = class extends LicenseError {
  constructor(message, context) {
    super(message, "LICENSE_CONFIG_ERROR", context);
    this.name = "LicenseConfigError";
  }
};

// src/utils/transform.ts
function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
function transformKeys(obj) {
  if (obj === null || obj === void 0) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => transformKeys(item));
  }
  if (typeof obj === "object") {
    const transformed = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = snakeToCamel(key);
      transformed[camelKey] = transformKeys(value);
    }
    return transformed;
  }
  return obj;
}

// src/services/ClientLicenseService.ts
var CACHE_KEYS = {
  LICENSE: "license:data",
  OFFLINE_TOKEN: "license:offline_token",
  VALIDATION: "license:validation",
  FEATURES: "license:features",
  LAST_HEARTBEAT: "license:last_heartbeat"
};
var DEFAULT_CLIENT_CONFIG = {
  cacheTtl: 86400,
  // 24 hours
  offlineMode: true,
  autoFingerprint: true,
  httpTimeout: 1e4,
  // 10 seconds
  retry: {
    enabled: true,
    times: 3,
    sleepMs: 1e3
  },
  heartbeatInterval: 86400,
  // 24 hours
  onFailure: "throw",
  gracePeriodWarning: true,
  systemInfo: {
    enabled: true,
    includeNodeVersion: true,
    includePlatform: true,
    includeHostname: true
  }
};
var ClientLicenseService = class {
  config;
  fingerprintService;
  cache;
  httpClient;
  eventEmitter;
  loggingConfig;
  constructor(config, options) {
    this.config = { ...DEFAULT_CLIENT_CONFIG, ...config };
    this.fingerprintService = new HardwareFingerprintService(options?.fingerprintConfig);
    this.cache = config.cache || new MemoryCacheAdapter();
    this.eventEmitter = options?.eventEmitter || getLicenseEventEmitter();
    this.loggingConfig = options?.loggingConfig;
    this.httpClient = axios.create({
      baseURL: this.config.serverUrl,
      timeout: this.config.httpTimeout,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    });
  }
  /**
   * Validate license (online first, then offline fallback)
   */
  async validate() {
    try {
      return await this.validateOnline();
    } catch (error) {
      if (this.config.offlineMode) {
        this.log("info", "Online validation failed, trying offline validation", {
          error: error instanceof Error ? error.message : String(error)
        });
        return await this.validateOffline();
      }
      return this.handleFailure(error);
    }
  }
  /**
   * Validate license online against the server
   */
  async validateOnline() {
    const fingerprint = await this.getFingerprint();
    const systemInfo = await this.getSystemInfo();
    const payload = {
      license_key: this.config.licenseKey,
      hardware_fingerprint: fingerprint,
      product_id: this.config.productId,
      system_info: systemInfo
    };
    const response = await this.makeRequest("POST", "/validate", payload);
    await this.cache.set(CACHE_KEYS.VALIDATION, response, this.config.cacheTtl);
    if (response.license) {
      await this.cache.set(CACHE_KEYS.LICENSE, response.license, this.config.cacheTtl);
    }
    if (response.offlineToken) {
      await this.cache.set(CACHE_KEYS.OFFLINE_TOKEN, response.offlineToken);
    }
    const responseWithFeatures = response;
    if (responseWithFeatures.features && Object.keys(responseWithFeatures.features).length > 0) {
      await this.cache.set(CACHE_KEYS.FEATURES, responseWithFeatures.features, this.config.cacheTtl);
    }
    if (response.valid) {
      await this.eventEmitter.emit("license:validated", {
        license: response.license,
        message: "License validated successfully"
      });
      if (response.status === "grace_period" && this.config.gracePeriodWarning) {
        await this.eventEmitter.emit("license:grace_period", {
          license: response.license,
          message: "License is in grace period"
        });
      }
    } else {
      if (response.status === "expired") {
        await this.eventEmitter.emit("license:expired", {
          license: response.license,
          message: response.message || "License has expired"
        });
      } else {
        await this.eventEmitter.emit("license:invalid", {
          license: response.license,
          message: response.message || "License is invalid"
        });
      }
    }
    return response;
  }
  /**
   * Validate license offline using cached token
   */
  async validateOffline() {
    const offlineToken = await this.cache.get(CACHE_KEYS.OFFLINE_TOKEN);
    if (offlineToken) {
      try {
        const decoded = jwt2.decode(offlineToken);
        if (decoded) {
          if (decoded.exp && decoded.exp * 1e3 < Date.now()) {
            this.log("warn", "Offline token has expired");
          } else {
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
                  message: "Validated using offline token"
                };
              }
            }
          }
        }
      } catch (error) {
        this.log("warn", "Failed to validate offline token", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    const cachedValidation = await this.cache.get(CACHE_KEYS.VALIDATION);
    if (cachedValidation && cachedValidation.valid) {
      return {
        ...cachedValidation,
        message: "Validated using cached data"
      };
    }
    const cachedLicense = await this.cache.get(CACHE_KEYS.LICENSE);
    if (cachedLicense && !cachedLicense.isExpired) {
      return {
        valid: true,
        status: cachedLicense.status,
        license: cachedLicense,
        message: "Validated using cached license data"
      };
    }
    return {
      valid: false,
      status: "inactive",
      message: "No valid cached data available for offline validation"
    };
  }
  /**
   * Check if license is valid
   */
  async isValid() {
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
  async getStatus() {
    const result = await this.validate();
    return result.status;
  }
  /**
   * Refresh license data from server
   */
  async refresh() {
    await this.cache.delete(CACHE_KEYS.VALIDATION);
    await this.cache.delete(CACHE_KEYS.LICENSE);
    return await this.validateOnline();
  }
  /**
   * Activate license on current device
   */
  async activate() {
    const fingerprint = await this.getFingerprint();
    const systemInfo = await this.getSystemInfo();
    const payload = {
      license_key: this.config.licenseKey,
      hardware_fingerprint: fingerprint,
      product_id: this.config.productId,
      system_info: systemInfo
    };
    const response = await this.makeRequest("POST", "/activate", payload);
    if (response.success) {
      if (response.license) {
        await this.cache.set(CACHE_KEYS.LICENSE, response.license, this.config.cacheTtl);
      }
      if (response.offlineToken) {
        await this.cache.set(CACHE_KEYS.OFFLINE_TOKEN, response.offlineToken);
      }
      await this.eventEmitter.emit("license:activated", {
        license: response.license,
        message: "License activated successfully"
      });
    }
    return response;
  }
  /**
   * Deactivate license on current device
   */
  async deactivate(reason) {
    const fingerprint = await this.getFingerprint();
    const payload = {
      license_key: this.config.licenseKey,
      hardware_fingerprint: fingerprint,
      reason
    };
    const response = await this.makeRequest("POST", "/deactivate", payload);
    if (response.success) {
      await this.cache.delete(CACHE_KEYS.LICENSE);
      await this.cache.delete(CACHE_KEYS.VALIDATION);
      await this.cache.delete(CACHE_KEYS.OFFLINE_TOKEN);
      await this.eventEmitter.emit("license:deactivated", {
        message: reason || "License deactivated"
      });
    }
    return response;
  }
  /**
   * Send heartbeat to server
   */
  async heartbeat() {
    const fingerprint = await this.getFingerprint();
    const payload = {
      license_key: this.config.licenseKey,
      hardware_fingerprint: fingerprint
    };
    const response = await this.makeRequest("POST", "/heartbeat", payload);
    if (response.success) {
      await this.cache.set(CACHE_KEYS.LAST_HEARTBEAT, Date.now());
    }
    return response;
  }
  /**
   * Check if a feature is available
   */
  async hasFeature(featureKey) {
    const features = await this.getFeatures();
    const feature = features[featureKey];
    return feature?.enabled ?? false;
  }
  /**
   * Check if a feature can be used (with limit checking)
   */
  async canUseFeature(featureKey, currentUsage) {
    const feature = await this.getFeatureConfig(featureKey);
    if (!feature || !feature.enabled) {
      return false;
    }
    if (feature.limit !== void 0 && currentUsage !== void 0) {
      return currentUsage < feature.limit;
    }
    return true;
  }
  /**
   * Get all features
   */
  async getFeatures() {
    const cached = await this.cache.get(CACHE_KEYS.FEATURES);
    if (cached && typeof cached === "object" && !Array.isArray(cached)) {
      return cached;
    }
    const validation = await this.cache.get(CACHE_KEYS.VALIDATION);
    let features = {};
    const structuredFeatures = validation?.structuredFeatures || validation?.structured_features;
    if (structuredFeatures) {
      for (const category of Object.values(structuredFeatures)) {
        for (const feature of category) {
          const config = Array.isArray(feature.configuration) ? {} : feature.configuration;
          features[feature.key] = {
            enabled: true,
            limit: config?.limit,
            quota: config?.quota
          };
        }
      }
    }
    if (Object.keys(features).length === 0 && validation?.features) {
      if (Array.isArray(validation.features)) {
        for (const key of validation.features) {
          features[key] = { enabled: true };
        }
      } else if (typeof validation.features === "object") {
        features = validation.features;
      }
    }
    if (Object.keys(features).length === 0) {
      const license = await this.getLicenseInfo();
      const productFeatures = license?.product?.features;
      if (productFeatures) {
        if (Array.isArray(productFeatures)) {
          for (const key of productFeatures) {
            features[key] = { enabled: true };
          }
        } else if (typeof productFeatures === "object") {
          features = productFeatures;
        }
      }
    }
    if (Object.keys(features).length > 0) {
      await this.cache.set(CACHE_KEYS.FEATURES, features, this.config.cacheTtl);
    }
    return features;
  }
  /**
   * Get feature configuration
   */
  async getFeatureConfig(featureKey) {
    const features = await this.getFeatures();
    return features[featureKey] || null;
  }
  /**
   * Get license information
   */
  async getLicenseInfo() {
    const cached = await this.cache.get(CACHE_KEYS.LICENSE);
    if (cached) {
      return cached;
    }
    const result = await this.validate();
    return result.license || null;
  }
  /**
   * Get days until license expiry
   */
  async getDaysUntilExpiry() {
    const license = await this.getLicenseInfo();
    return license?.daysUntilExpiry ?? null;
  }
  /**
   * Get hardware fingerprint
   */
  async getFingerprint() {
    if (this.config.hardwareFingerprint) {
      return this.config.hardwareFingerprint;
    }
    if (this.config.autoFingerprint) {
      return await this.fingerprintService.generate();
    }
    throw new LicenseError("No hardware fingerprint configured", "NO_FINGERPRINT");
  }
  /**
   * Get system information
   */
  async getSystemInfo() {
    if (!this.config.systemInfo?.enabled) {
      return void 0;
    }
    const info = {};
    if (this.config.systemInfo.includeNodeVersion) {
      info.nodeVersion = process.version;
    }
    if (this.config.systemInfo.includePlatform) {
      const os2 = await import('os');
      info.platform = os2.platform();
      info.arch = os2.arch();
    }
    if (this.config.systemInfo.includeHostname) {
      const os2 = await import('os');
      info.hostname = os2.hostname();
    }
    return info;
  }
  /**
   * Make HTTP request with retry logic
   */
  async makeRequest(method, endpoint, data) {
    const maxRetries = this.config.retry?.enabled ? this.config.retry.times : 1;
    const sleepMs = this.config.retry?.sleepMs || 1e3;
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.httpClient.request({
          method,
          url: endpoint,
          data
        });
        return transformKeys(response.data);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          this.log("warn", `Request failed (attempt ${attempt}/${maxRetries}), retrying...`, {
            endpoint,
            error: lastError.message
          });
          await this.sleep(sleepMs);
        }
      }
    }
    if (lastError instanceof AxiosError) {
      throw new LicenseServerError(
        lastError.response?.data?.message || lastError.message,
        {
          statusCode: lastError.response?.status,
          response: lastError.response?.data
        }
      );
    }
    throw new LicenseServerError(lastError?.message || "Unknown error");
  }
  /**
   * Handle validation failure
   */
  handleFailure(error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    switch (this.config.onFailure) {
      case "throw":
        if (error instanceof LicenseError) {
          throw error;
        }
        throw new LicenseInvalidError(errorMessage);
      case "log":
        this.log("error", "License validation failed", { error: errorMessage });
        return {
          valid: false,
          status: "inactive",
          message: errorMessage
        };
      case "silent":
      default:
        return {
          valid: false,
          status: "inactive",
          message: errorMessage
        };
    }
  }
  /**
   * Log message
   */
  log(level, message, context) {
    if (!this.loggingConfig?.enabled) {
      return;
    }
    const levels = ["debug", "info", "warn", "error"];
    const configLevel = this.loggingConfig.level || "info";
    if (levels.indexOf(level) < levels.indexOf(configLevel)) {
      return;
    }
    if (this.loggingConfig.logger) {
      this.loggingConfig.logger(level, message, context);
    } else {
      const logFn = console[level] || console.log;
      logFn(`[License] ${message}`, context || "");
    }
  }
  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  /**
   * Get the event emitter
   */
  getEventEmitter() {
    return this.eventEmitter;
  }
  /**
   * Get the fingerprint service
   */
  getFingerprintService() {
    return this.fingerprintService;
  }
};
function createClientLicenseService(config, options) {
  return new ClientLicenseService(config, options);
}
var DEFAULT_SERVER_CONFIG = {
  jwtAlgorithm: "HS256",
  gracePeriodDays: 7,
  offlineValidationDays: 30,
  defaultActivationLimit: 5,
  apiPrefix: "api/license",
  enableCors: true,
  corsOrigins: "*",
  rateLimiting: {
    enabled: true,
    maxAttempts: 60,
    decayMinutes: 1
  }
};
var ServerLicenseService = class {
  config;
  database;
  fingerprintService;
  eventEmitter;
  loggingConfig;
  // Current license context
  currentLicenseKey;
  currentHardwareFingerprint;
  currentProductId;
  currentLicense;
  currentProduct;
  constructor(config, options) {
    if (!config.database) {
      throw new LicenseConfigError("Database adapter is required for server mode");
    }
    if (!config.jwtSecret) {
      throw new LicenseConfigError("JWT secret is required for server mode");
    }
    this.config = { ...DEFAULT_SERVER_CONFIG, ...config };
    this.database = config.database;
    this.fingerprintService = new HardwareFingerprintService(options?.fingerprintConfig);
    this.eventEmitter = options?.eventEmitter || getLicenseEventEmitter();
    this.loggingConfig = options?.loggingConfig;
  }
  /**
   * Set license parameters for validation
   */
  setLicenseParams(licenseKey, hardwareFingerprint, productId) {
    this.currentLicenseKey = licenseKey;
    this.currentHardwareFingerprint = hardwareFingerprint;
    this.currentProductId = productId;
    this.currentLicense = void 0;
    this.currentProduct = void 0;
    return this;
  }
  /**
   * Validate license
   */
  async validate() {
    return this.validateLicense(
      this.currentLicenseKey,
      this.currentHardwareFingerprint,
      this.currentProductId
    );
  }
  /**
   * Validate license with full parameters
   */
  async validateLicense(licenseKey, hardwareFingerprint, productId, options) {
    const license = await this.database.findLicenseByKey(licenseKey);
    if (!license) {
      await this.logValidation(licenseKey, "online", "failure", hardwareFingerprint, {
        error: "License not found",
        ipAddress: options?.ipAddress
      });
      await this.eventEmitter.emit("license:invalid", {
        message: "License not found",
        context: { licenseKey }
      });
      return {
        valid: false,
        status: "inactive",
        message: "License not found",
        errors: ["LICENSE_NOT_FOUND"]
      };
    }
    if (license.productId !== productId) {
      await this.logValidation(licenseKey, "online", "failure", hardwareFingerprint, {
        error: "Product mismatch",
        ipAddress: options?.ipAddress
      });
      return {
        valid: false,
        status: "inactive",
        message: "License is not valid for this product",
        errors: ["PRODUCT_MISMATCH"]
      };
    }
    const product = await this.database.findProductById(productId);
    if (license.status === "suspended") {
      await this.eventEmitter.emit("license:invalid", {
        license: this.formatLicenseInfo(license, product),
        message: "License is suspended"
      });
      return {
        valid: false,
        status: "suspended",
        license: this.formatLicenseInfo(license, product),
        message: "License is suspended",
        errors: ["LICENSE_SUSPENDED"]
      };
    }
    if (license.status === "inactive") {
      return {
        valid: false,
        status: "inactive",
        license: this.formatLicenseInfo(license, product),
        message: "License is inactive",
        errors: ["LICENSE_INACTIVE"]
      };
    }
    const expirationResult = this.checkExpiration(license, product);
    if (!expirationResult.valid && !expirationResult.inGracePeriod) {
      await this.eventEmitter.emit("license:expired", {
        license: this.formatLicenseInfo(license, product),
        message: "License has expired"
      });
      return {
        valid: false,
        status: "expired",
        license: this.formatLicenseInfo(license, product),
        message: "License has expired",
        errors: ["LICENSE_EXPIRED"]
      };
    }
    const activationResult = await this.handleActivation(
      license,
      hardwareFingerprint,
      options?.systemInfo,
      options?.ipAddress
    );
    if (!activationResult.success) {
      return {
        valid: false,
        status: "active",
        license: this.formatLicenseInfo(license, product),
        message: activationResult.message,
        errors: activationResult.errors
      };
    }
    const offlineToken = this.generateOfflineToken(license, hardwareFingerprint, product);
    await this.logValidation(licenseKey, "online", "success", hardwareFingerprint, {
      ipAddress: options?.ipAddress
    });
    const licenseInfo = this.formatLicenseInfo(license, product);
    await this.eventEmitter.emit("license:validated", {
      license: licenseInfo,
      message: "License validated successfully"
    });
    if (expirationResult.inGracePeriod) {
      await this.eventEmitter.emit("license:grace_period", {
        license: licenseInfo,
        message: `License is in grace period (${expirationResult.daysRemaining} days remaining)`
      });
    }
    return {
      valid: true,
      status: expirationResult.inGracePeriod ? "grace_period" : "active",
      license: licenseInfo,
      offlineToken,
      nextValidation: this.calculateNextValidation(),
      message: expirationResult.inGracePeriod ? `License is in grace period` : "License is valid"
    };
  }
  /**
   * Activate license
   */
  async activateLicense(licenseKey, hardwareFingerprint, productId, options) {
    const license = await this.database.findLicenseByKey(licenseKey);
    if (!license) {
      return {
        success: false,
        message: "License not found",
        errors: ["LICENSE_NOT_FOUND"]
      };
    }
    if (license.productId !== productId) {
      return {
        success: false,
        message: "License is not valid for this product",
        errors: ["PRODUCT_MISMATCH"]
      };
    }
    if (license.status !== "active" && license.status !== "inactive") {
      return {
        success: false,
        message: `License cannot be activated (status: ${license.status})`,
        errors: ["INVALID_STATUS"]
      };
    }
    const activeCount = await this.database.countActiveActivations(license.id);
    const limit = license.activationLimit || this.config.defaultActivationLimit;
    const existingActivation = await this.database.findActivationByFingerprint(
      license.id,
      hardwareFingerprint
    );
    if (existingActivation && existingActivation.isActive) {
      const product2 = await this.database.findProductById(productId);
      const licenseInfo2 = this.formatLicenseInfo(license, product2);
      const offlineToken2 = this.generateOfflineToken(license, hardwareFingerprint, product2);
      return {
        success: true,
        message: "License is already activated on this device",
        license: licenseInfo2,
        offlineToken: offlineToken2
      };
    }
    if (!existingActivation && activeCount >= limit) {
      return {
        success: false,
        message: `Activation limit exceeded (${activeCount}/${limit})`,
        errors: ["ACTIVATION_LIMIT_EXCEEDED"]
      };
    }
    if (existingActivation) {
      await this.database.updateActivation(existingActivation.id, {
        isActive: true,
        lastCheckedAt: /* @__PURE__ */ new Date(),
        systemInfo: options?.systemInfo,
        ipAddress: options?.ipAddress
      });
    } else {
      await this.database.createActivation({
        licenseId: license.id,
        hardwareFingerprint,
        systemInfo: options?.systemInfo,
        ipAddress: options?.ipAddress
      });
    }
    const product = await this.database.findProductById(productId);
    const licenseInfo = this.formatLicenseInfo(license, product);
    const offlineToken = this.generateOfflineToken(license, hardwareFingerprint, product);
    await this.eventEmitter.emit("license:activated", {
      license: licenseInfo,
      message: "License activated successfully",
      context: { hardwareFingerprint }
    });
    return {
      success: true,
      message: "License activated successfully",
      license: licenseInfo,
      offlineToken
    };
  }
  /**
   * Deactivate license
   */
  async deactivateLicense(licenseKey, hardwareFingerprint, reason) {
    const license = await this.database.findLicenseByKey(licenseKey);
    if (!license) {
      return {
        success: false,
        message: "License not found",
        errors: ["LICENSE_NOT_FOUND"]
      };
    }
    const activation = await this.database.findActivationByFingerprint(
      license.id,
      hardwareFingerprint
    );
    if (!activation) {
      return {
        success: false,
        message: "No activation found for this device",
        errors: ["ACTIVATION_NOT_FOUND"]
      };
    }
    await this.database.deactivateActivation(activation.id);
    await this.eventEmitter.emit("license:deactivated", {
      message: reason || "License deactivated",
      context: { licenseKey, hardwareFingerprint }
    });
    return {
      success: true,
      message: "License deactivated successfully"
    };
  }
  /**
   * Handle heartbeat
   */
  async heartbeat(licenseKey, hardwareFingerprint) {
    const license = await this.database.findLicenseByKey(licenseKey);
    if (!license) {
      return {
        success: false,
        status: "inactive",
        message: "License not found"
      };
    }
    const activation = await this.database.findActivationByFingerprint(
      license.id,
      hardwareFingerprint
    );
    if (activation && activation.isActive) {
      await this.database.updateActivation(activation.id, {
        lastCheckedAt: /* @__PURE__ */ new Date()
      });
    }
    const expirationResult = this.checkExpiration(license);
    return {
      success: true,
      status: expirationResult.inGracePeriod ? "grace_period" : license.status,
      nextHeartbeat: this.calculateNextValidation()
    };
  }
  /**
   * Verify offline token
   */
  verifyOfflineToken(token, hardwareFingerprint) {
    try {
      const decoded = jwt2.verify(token, this.config.jwtSecret, {
        algorithms: [this.config.jwtAlgorithm]
      });
      const matches = this.fingerprintService.compare(
        hardwareFingerprint,
        decoded.hardware_fingerprint
      );
      if (!matches) {
        return {
          valid: false,
          status: "inactive",
          message: "Hardware fingerprint mismatch",
          errors: ["FINGERPRINT_MISMATCH"]
        };
      }
      return {
        valid: true,
        status: decoded.license.status,
        license: decoded.license,
        message: "Offline token verified"
      };
    } catch (error) {
      return {
        valid: false,
        status: "inactive",
        message: error instanceof Error ? error.message : "Invalid offline token",
        errors: ["INVALID_TOKEN"]
      };
    }
  }
  /**
   * Get license info
   */
  async getLicenseInfo(licenseKey) {
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
  async isValid() {
    if (!this.currentLicenseKey) return false;
    const result = await this.validate();
    return result.valid;
  }
  /**
   * Get license status
   */
  async getStatus() {
    const info = await this.getLicenseInfo();
    return info?.status || "inactive";
  }
  /**
   * Check if feature is available
   */
  async hasFeature(featureKey) {
    const features = await this.getFeatures();
    return features[featureKey]?.enabled ?? false;
  }
  /**
   * Check if feature can be used
   */
  async canUseFeature(featureKey, currentUsage) {
    const feature = await this.getFeatureConfig(featureKey);
    if (!feature || !feature.enabled) {
      return false;
    }
    if (feature.limit !== void 0 && currentUsage !== void 0) {
      return currentUsage < feature.limit;
    }
    return true;
  }
  /**
   * Get all features
   */
  async getFeatures() {
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
  async getFeatureConfig(featureKey) {
    const features = await this.getFeatures();
    return features[featureKey] || null;
  }
  /**
   * Get days until expiry
   */
  async getDaysUntilExpiry() {
    const info = await this.getLicenseInfo();
    return info?.daysUntilExpiry ?? null;
  }
  /**
   * Handle activation check and update
   */
  async handleActivation(license, hardwareFingerprint, systemInfo, ipAddress) {
    const activeCount = await this.database.countActiveActivations(license.id);
    const limit = license.activationLimit || this.config.defaultActivationLimit;
    const existingActivation = await this.database.findActivationByFingerprint(
      license.id,
      hardwareFingerprint
    );
    if (existingActivation) {
      await this.database.updateActivation(existingActivation.id, {
        lastCheckedAt: /* @__PURE__ */ new Date(),
        systemInfo,
        ipAddress
      });
      if (!existingActivation.isActive) {
        if (activeCount >= limit) {
          return {
            success: false,
            message: `Activation limit exceeded (${activeCount}/${limit})`,
            errors: ["ACTIVATION_LIMIT_EXCEEDED"]
          };
        }
        await this.database.updateActivation(existingActivation.id, {
          isActive: true
        });
      }
      return { success: true };
    }
    if (activeCount >= limit) {
      return {
        success: false,
        message: `Activation limit exceeded (${activeCount}/${limit})`,
        errors: ["ACTIVATION_LIMIT_EXCEEDED"]
      };
    }
    await this.database.createActivation({
      licenseId: license.id,
      hardwareFingerprint,
      systemInfo,
      ipAddress
    });
    return { success: true };
  }
  /**
   * Check license expiration
   */
  checkExpiration(license, product) {
    if (!license.expiresAt) {
      return { valid: true, inGracePeriod: false };
    }
    const now = /* @__PURE__ */ new Date();
    const expiresAt = new Date(license.expiresAt);
    if (now < expiresAt) {
      const daysRemaining = Math.ceil(
        (expiresAt.getTime() - now.getTime()) / (1e3 * 60 * 60 * 24)
      );
      return { valid: true, inGracePeriod: false, daysRemaining };
    }
    const graceDays = license.gracePeriodDays ?? product?.gracePeriodDays ?? this.config.gracePeriodDays;
    const graceEndDate = new Date(expiresAt);
    graceEndDate.setDate(graceEndDate.getDate() + graceDays);
    if (now < graceEndDate) {
      const daysRemaining = Math.ceil(
        (graceEndDate.getTime() - now.getTime()) / (1e3 * 60 * 60 * 24)
      );
      return { valid: true, inGracePeriod: true, daysRemaining };
    }
    return { valid: false, inGracePeriod: false };
  }
  /**
   * Generate offline validation token
   */
  generateOfflineToken(license, hardwareFingerprint, product) {
    const offlineDays = product?.offlineValidationDays ?? this.config.offlineValidationDays;
    const payload = {
      license: this.formatLicenseInfo(license, product),
      hardware_fingerprint: hardwareFingerprint,
      product_id: license.productId
    };
    return jwt2.sign(payload, this.config.jwtSecret, {
      algorithm: this.config.jwtAlgorithm,
      expiresIn: `${offlineDays}d`
    });
  }
  /**
   * Format license record to license info
   */
  formatLicenseInfo(license, product) {
    const now = /* @__PURE__ */ new Date();
    const expiresAt = license.expiresAt ? new Date(license.expiresAt) : void 0;
    const isExpired = expiresAt ? now > expiresAt : false;
    let daysUntilExpiry;
    if (expiresAt && !isExpired) {
      daysUntilExpiry = Math.ceil(
        (expiresAt.getTime() - now.getTime()) / (1e3 * 60 * 60 * 24)
      );
    }
    const graceDays = license.gracePeriodDays ?? product?.gracePeriodDays ?? this.config.gracePeriodDays;
    let isInGracePeriod = false;
    if (isExpired && expiresAt) {
      const graceEndDate = new Date(expiresAt);
      graceEndDate.setDate(graceEndDate.getDate() + graceDays);
      isInGracePeriod = now < graceEndDate;
    }
    return {
      id: license.id,
      licenseKey: license.licenseKey,
      status: license.status,
      activatedAt: license.activatedAt?.toISOString(),
      expiresAt: license.expiresAt?.toISOString(),
      activationLimit: license.activationLimit,
      activationCount: license.activationCount,
      daysUntilExpiry,
      isExpired,
      isInGracePeriod,
      metadata: license.metadata,
      product: product ? {
        id: product.id,
        name: product.name,
        version: product.version,
        features: product.features
      } : void 0
    };
  }
  /**
   * Calculate next validation time
   */
  calculateNextValidation() {
    const next = /* @__PURE__ */ new Date();
    next.setHours(next.getHours() + 24);
    return next.toISOString();
  }
  /**
   * Log validation attempt
   */
  async logValidation(licenseKey, validationType, result, hardwareFingerprint, context) {
    if (this.database.logValidation) {
      try {
        await this.database.logValidation({
          licenseKey,
          validationType,
          result,
          hardwareFingerprint,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          errorMessage: context?.error,
          context
        });
      } catch (error) {
        this.log("error", "Failed to log validation", { error });
      }
    }
  }
  /**
   * Log message
   */
  log(level, message, context) {
    if (!this.loggingConfig?.enabled) {
      return;
    }
    if (this.loggingConfig.logger) {
      this.loggingConfig.logger(level, message, context);
    } else {
      const logFn = console[level] || console.log;
      logFn(`[License Server] ${message}`, context || "");
    }
  }
  /**
   * Get the event emitter
   */
  getEventEmitter() {
    return this.eventEmitter;
  }
  /**
   * Get the fingerprint service
   */
  getFingerprintService() {
    return this.fingerprintService;
  }
};
function createServerLicenseService(config, options) {
  return new ServerLicenseService(config, options);
}

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

// src/index.ts
function createLicenseService(config) {
  const eventEmitter2 = createLicenseEventEmitter();
  if (config.mode === "server") {
    if (!config.server) {
      throw new Error("Server configuration is required for server mode");
    }
    return new ServerLicenseService(config.server, {
      fingerprintConfig: config.fingerprint,
      loggingConfig: config.logging,
      eventEmitter: eventEmitter2
    });
  }
  if (!config.client) {
    throw new Error("Client configuration is required for client mode");
  }
  return new ClientLicenseService(config.client, {
    fingerprintConfig: config.fingerprint,
    loggingConfig: config.logging,
    eventEmitter: eventEmitter2
  });
}
function createClient(options, additionalOptions) {
  return new ClientLicenseService(options, additionalOptions);
}
function createServer(options, additionalOptions) {
  return new ServerLicenseService(options, additionalOptions);
}

export { ClientLicenseService, FeatureNotAvailableError, FileCacheAdapter, HardwareFingerprintService, LicenseActivationLimitError, LicenseConfigError, LicenseError, LicenseEventEmitter, LicenseExpiredError, LicenseInvalidError, LicenseServerError, MemoryCacheAdapter, ServerLicenseService, createClient, createClientLicenseService, createFeatureMiddleware, createFileCache, createFingerprintService, createLicenseEventEmitter, createLicenseMiddleware, createLicenseRoutes, createLicenseService, createMemoryCache, createServer, createServerLicenseService, getLicenseEventEmitter, licenseUtils };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map