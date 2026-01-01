/**
 * License package configuration
 */
export interface LicenseConfig {
  /** Mode: 'server' or 'client' */
  mode: 'server' | 'client';

  /** Server mode configuration */
  server?: ServerConfig;

  /** Client mode configuration */
  client?: ClientConfig;

  /** Hardware fingerprint configuration */
  fingerprint?: FingerprintConfig;

  /** Feature configuration */
  features?: FeaturesConfig;

  /** Logging configuration */
  logging?: LoggingConfig;
}

export interface ServerConfig {
  /** JWT secret for signing tokens */
  jwtSecret: string;

  /** JWT algorithm (default: HS256) */
  jwtAlgorithm?: 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512';

  /** Grace period in days after expiration */
  gracePeriodDays?: number;

  /** Offline validation validity in days */
  offlineValidationDays?: number;

  /** Default activation limit per license */
  defaultActivationLimit?: number;

  /** API route prefix */
  apiPrefix?: string;

  /** Enable CORS */
  enableCors?: boolean;

  /** CORS allowed origins */
  corsOrigins?: string | string[];

  /** Rate limiting config */
  rateLimiting?: {
    enabled: boolean;
    maxAttempts: number;
    decayMinutes: number;
  };

  /** Database adapter for server mode */
  database?: DatabaseAdapter;
}

export interface ClientConfig {
  /** License server URL */
  serverUrl: string;

  /** License key */
  licenseKey: string;

  /** Product ID */
  productId: string;

  /** Cache TTL in seconds (default: 86400 = 24 hours) */
  cacheTtl?: number;

  /** Enable offline mode */
  offlineMode?: boolean;

  /** Auto-generate hardware fingerprint */
  autoFingerprint?: boolean;

  /** Manual hardware fingerprint */
  hardwareFingerprint?: string;

  /** HTTP timeout in milliseconds */
  httpTimeout?: number;

  /** Retry configuration */
  retry?: {
    enabled: boolean;
    times: number;
    sleepMs: number;
  };

  /** Heartbeat interval in seconds */
  heartbeatInterval?: number;

  /** Failure handling: 'throw', 'log', or 'silent' */
  onFailure?: 'throw' | 'log' | 'silent';

  /** Show grace period warning */
  gracePeriodWarning?: boolean;

  /** Include system info in requests */
  systemInfo?: {
    enabled: boolean;
    includeNodeVersion: boolean;
    includePlatform: boolean;
    includeHostname: boolean;
  };

  /** Cache adapter */
  cache?: CacheAdapter;
}

export interface FingerprintConfig {
  /** Components to include in fingerprint */
  components?: {
    hostname?: boolean;
    ipAddress?: boolean;
    macAddress?: boolean;
    cpuInfo?: boolean;
    diskSerial?: boolean;
    platform?: boolean;
  };

  /** Tolerance for fingerprint comparison (0-100) */
  tolerance?: number;

  /** Hash algorithm */
  hashAlgorithm?: 'sha256' | 'sha512' | 'md5';
}

export interface FeaturesConfig {
  /** Enable feature checking */
  enabled?: boolean;

  /** Default access when feature not found */
  defaultAccess?: boolean;

  /** Cache feature checks */
  cacheChecks?: boolean;
}

export interface LoggingConfig {
  /** Enable logging */
  enabled?: boolean;

  /** Log level */
  level?: 'debug' | 'info' | 'warn' | 'error';

  /** Custom logger function */
  logger?: (level: string, message: string, context?: Record<string, unknown>) => void;
}

/**
 * License status enum
 */
export type LicenseStatus = 'active' | 'inactive' | 'suspended' | 'expired' | 'grace_period';

/**
 * License information
 */
export interface LicenseInfo {
  id: string;
  licenseKey: string;
  status: LicenseStatus;
  activatedAt?: string;
  expiresAt?: string;
  activationLimit: number;
  activationCount: number;
  daysUntilExpiry?: number;
  isExpired: boolean;
  isInGracePeriod: boolean;
  metadata?: Record<string, unknown>;
  product?: ProductInfo;
}

/**
 * Product information
 */
export interface ProductInfo {
  id: string;
  name: string;
  version?: string;
  features: Record<string, FeatureConfig>;
  structuredFeatures?: StructuredFeature[];
}

/**
 * Feature configuration
 */
export interface FeatureConfig {
  enabled: boolean;
  limit?: number;
  quota?: number;
  period?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  metadata?: Record<string, unknown>;
}

/**
 * Structured feature definition
 */
export interface StructuredFeature {
  key: string;
  name: string;
  description?: string;
  type: 'feature' | 'limit' | 'quota';
  configuration: FeatureConfig;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  status: LicenseStatus;
  license?: LicenseInfo;
  offlineToken?: string;
  nextValidation?: string;
  message?: string;
  errors?: string[];
}

/**
 * Activation result
 */
export interface ActivationResult {
  success: boolean;
  message: string;
  license?: LicenseInfo;
  offlineToken?: string;
  errors?: string[];
}

/**
 * Deactivation result
 */
export interface DeactivationResult {
  success: boolean;
  message: string;
  errors?: string[];
}

/**
 * Heartbeat result
 */
export interface HeartbeatResult {
  success: boolean;
  status: LicenseStatus;
  nextHeartbeat?: string;
  message?: string;
}

/**
 * System information for validation requests
 */
export interface SystemInfo {
  nodeVersion?: string;
  platform?: string;
  arch?: string;
  hostname?: string;
  cpus?: number;
  memory?: number;
  uptime?: number;
}

/**
 * License activation record
 */
export interface LicenseActivation {
  id: string;
  licenseId: string;
  hardwareFingerprint: string;
  ipAddress?: string;
  systemInfo?: SystemInfo;
  activatedAt: string;
  lastCheckedAt?: string;
  isActive: boolean;
}

/**
 * Database adapter interface for server mode
 */
export interface DatabaseAdapter {
  /** Find license by key */
  findLicenseByKey(licenseKey: string): Promise<LicenseRecord | null>;

  /** Find license by ID */
  findLicenseById(id: string): Promise<LicenseRecord | null>;

  /** Find activations for a license */
  findActivations(licenseId: string): Promise<ActivationRecord[]>;

  /** Find activation by fingerprint */
  findActivationByFingerprint(licenseId: string, fingerprint: string): Promise<ActivationRecord | null>;

  /** Create activation */
  createActivation(data: CreateActivationData): Promise<ActivationRecord>;

  /** Update activation */
  updateActivation(id: string, data: Partial<ActivationRecord>): Promise<ActivationRecord>;

  /** Deactivate activation */
  deactivateActivation(id: string): Promise<void>;

  /** Count active activations */
  countActiveActivations(licenseId: string): Promise<number>;

  /** Find product by ID */
  findProductById(productId: string): Promise<ProductRecord | null>;

  /** Log validation attempt */
  logValidation?(data: ValidationLogData): Promise<void>;
}

export interface LicenseRecord {
  id: string;
  licenseKey: string;
  userId?: string;
  productId: string;
  status: LicenseStatus;
  activatedAt?: Date;
  expiresAt?: Date;
  activationLimit: number;
  activationCount: number;
  gracePeriodDays?: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivationRecord {
  id: string;
  licenseId: string;
  hardwareFingerprint: string;
  ipAddress?: string;
  systemInfo?: Record<string, unknown>;
  activatedAt: Date;
  lastCheckedAt?: Date;
  isActive: boolean;
}

export interface CreateActivationData {
  licenseId: string;
  hardwareFingerprint: string;
  ipAddress?: string;
  systemInfo?: Record<string, unknown>;
}

export interface ProductRecord {
  id: string;
  name: string;
  version?: string;
  features: Record<string, FeatureConfig>;
  defaultActivationLimit: number;
  gracePeriodDays: number;
  offlineValidationDays: number;
}

export interface ValidationLogData {
  licenseId?: string;
  licenseKey?: string;
  validationType: 'online' | 'offline' | 'cache';
  result: 'success' | 'failure';
  hardwareFingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
  errorMessage?: string;
  context?: Record<string, unknown>;
}

/**
 * Cache adapter interface
 */
export interface CacheAdapter {
  /** Get cached value */
  get<T>(key: string): Promise<T | null>;

  /** Set cached value */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /** Delete cached value */
  delete(key: string): Promise<void>;

  /** Check if key exists */
  has(key: string): Promise<boolean>;

  /** Clear all cache */
  clear(): Promise<void>;
}

/**
 * License service interface (shared between client and server)
 */
export interface LicenseServiceInterface {
  /** Validate license */
  validate(): Promise<ValidationResult>;

  /** Check if license is valid */
  isValid(): Promise<boolean>;

  /** Get license status */
  getStatus(): Promise<LicenseStatus>;

  /** Check if feature is available */
  hasFeature(featureKey: string): Promise<boolean>;

  /** Check if feature can be used (with limit checking) */
  canUseFeature(featureKey: string, currentUsage?: number): Promise<boolean>;

  /** Get all features */
  getFeatures(): Promise<Record<string, FeatureConfig>>;

  /** Get feature configuration */
  getFeatureConfig(featureKey: string): Promise<FeatureConfig | null>;

  /** Get license info */
  getLicenseInfo(): Promise<LicenseInfo | null>;

  /** Get days until expiry */
  getDaysUntilExpiry(): Promise<number | null>;
}

/**
 * Event types
 */
export type LicenseEventType =
  | 'license:validated'
  | 'license:activated'
  | 'license:deactivated'
  | 'license:expired'
  | 'license:invalid'
  | 'license:grace_period';

/**
 * Event payload
 */
export interface LicenseEvent {
  type: LicenseEventType;
  timestamp: Date;
  license?: LicenseInfo;
  message?: string;
  context?: Record<string, unknown>;
}

/**
 * Event listener
 */
export type LicenseEventListener = (event: LicenseEvent) => void | Promise<void>;
