import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * License package configuration
 */
interface LicenseConfig {
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
interface ServerConfig {
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
interface ClientConfig {
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
interface FingerprintConfig {
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
interface FeaturesConfig {
    /** Enable feature checking */
    enabled?: boolean;
    /** Default access when feature not found */
    defaultAccess?: boolean;
    /** Cache feature checks */
    cacheChecks?: boolean;
}
interface LoggingConfig {
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
type LicenseStatus = 'active' | 'inactive' | 'suspended' | 'expired' | 'grace_period';
/**
 * License information
 */
interface LicenseInfo {
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
interface ProductInfo {
    id: string;
    name: string;
    version?: string;
    features: Record<string, FeatureConfig>;
    structuredFeatures?: StructuredFeature[];
}
/**
 * Feature configuration
 */
interface FeatureConfig {
    enabled: boolean;
    limit?: number;
    quota?: number;
    period?: 'daily' | 'weekly' | 'monthly' | 'yearly';
    metadata?: Record<string, unknown>;
}
/**
 * Structured feature definition
 */
interface StructuredFeature {
    key: string;
    name: string;
    description?: string;
    type: 'feature' | 'limit' | 'quota';
    configuration: FeatureConfig;
}
/**
 * Validation result
 */
interface ValidationResult {
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
interface ActivationResult {
    success: boolean;
    message: string;
    license?: LicenseInfo;
    offlineToken?: string;
    errors?: string[];
}
/**
 * Deactivation result
 */
interface DeactivationResult {
    success: boolean;
    message: string;
    errors?: string[];
}
/**
 * Heartbeat result
 */
interface HeartbeatResult {
    success: boolean;
    status: LicenseStatus;
    nextHeartbeat?: string;
    message?: string;
}
/**
 * System information for validation requests
 */
interface SystemInfo {
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
interface LicenseActivation {
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
interface DatabaseAdapter {
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
interface LicenseRecord {
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
interface ActivationRecord {
    id: string;
    licenseId: string;
    hardwareFingerprint: string;
    ipAddress?: string;
    systemInfo?: Record<string, unknown>;
    activatedAt: Date;
    lastCheckedAt?: Date;
    isActive: boolean;
}
interface CreateActivationData {
    licenseId: string;
    hardwareFingerprint: string;
    ipAddress?: string;
    systemInfo?: Record<string, unknown>;
}
interface ProductRecord {
    id: string;
    name: string;
    version?: string;
    features: Record<string, FeatureConfig>;
    defaultActivationLimit: number;
    gracePeriodDays: number;
    offlineValidationDays: number;
}
interface ValidationLogData {
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
interface CacheAdapter {
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
interface LicenseServiceInterface {
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
type LicenseEventType = 'license:validated' | 'license:activated' | 'license:deactivated' | 'license:expired' | 'license:invalid' | 'license:grace_period';
/**
 * Event payload
 */
interface LicenseEvent {
    type: LicenseEventType;
    timestamp: Date;
    license?: LicenseInfo;
    message?: string;
    context?: Record<string, unknown>;
}
/**
 * Event listener
 */
type LicenseEventListener = (event: LicenseEvent) => void | Promise<void>;

/**
 * Hardware fingerprint service for generating and comparing device fingerprints
 */
declare class HardwareFingerprintService {
    private config;
    private cachedFingerprint;
    private cachedSystemInfo;
    constructor(config?: FingerprintConfig);
    /**
     * Generate a hardware fingerprint for the current system
     */
    generate(): Promise<string>;
    /**
     * Generate fingerprint from provided components
     */
    generateFromComponents(components: Record<string, string>): string;
    /**
     * Compare two fingerprints with tolerance
     */
    compare(fingerprint1: string, fingerprint2: string, tolerance?: number): boolean;
    /**
     * Get detailed system information
     */
    getSystemInfo(): Promise<SystemInfo>;
    /**
     * Clear cached fingerprint and system info
     */
    clearCache(): void;
    /**
     * Get the current configuration
     */
    getConfig(): Required<FingerprintConfig>;
    /**
     * Collect hardware components based on configuration
     */
    private collectComponents;
    /**
     * Get primary IP address
     */
    private getPrimaryIpAddress;
    /**
     * Get primary MAC address
     */
    private getPrimaryMacAddress;
    /**
     * Get disk serial number
     */
    private getDiskSerial;
    /**
     * Hash components into fingerprint
     */
    private hashComponents;
    /**
     * Calculate similarity between two fingerprints (0-100)
     */
    private calculateSimilarity;
}
/**
 * Create a hardware fingerprint service instance
 */
declare function createFingerprintService(config?: FingerprintConfig): HardwareFingerprintService;

/**
 * License event emitter for handling license-related events
 */
declare class LicenseEventEmitter {
    private listeners;
    /**
     * Add an event listener
     */
    on(event: LicenseEventType | '*', listener: LicenseEventListener): () => void;
    /**
     * Add a one-time event listener
     */
    once(event: LicenseEventType | '*', listener: LicenseEventListener): () => void;
    /**
     * Remove an event listener
     */
    off(event: LicenseEventType | '*', listener: LicenseEventListener): void;
    /**
     * Emit an event
     */
    emit(type: LicenseEventType, options?: {
        license?: LicenseInfo;
        message?: string;
        context?: Record<string, unknown>;
    }): Promise<void>;
    /**
     * Remove all listeners for an event or all events
     */
    removeAllListeners(event?: LicenseEventType | '*'): void;
    /**
     * Get listener count for an event
     */
    listenerCount(event: LicenseEventType | '*'): number;
}
/**
 * Get the global license event emitter
 */
declare function getLicenseEventEmitter(): LicenseEventEmitter;
/**
 * Create a new license event emitter
 */
declare function createLicenseEventEmitter(): LicenseEventEmitter;

/**
 * Client license service for validating licenses against a remote server
 */
declare class ClientLicenseService implements LicenseServiceInterface {
    private config;
    private fingerprintService;
    private cache;
    private httpClient;
    private eventEmitter;
    private loggingConfig?;
    constructor(config: ClientConfig, options?: {
        fingerprintConfig?: FingerprintConfig;
        loggingConfig?: LoggingConfig;
        eventEmitter?: LicenseEventEmitter;
    });
    /**
     * Validate license (online first, then offline fallback)
     */
    validate(): Promise<ValidationResult>;
    /**
     * Validate license online against the server
     */
    validateOnline(): Promise<ValidationResult>;
    /**
     * Validate license offline using cached token
     */
    validateOffline(): Promise<ValidationResult>;
    /**
     * Check if license is valid
     */
    isValid(): Promise<boolean>;
    /**
     * Get current license status
     */
    getStatus(): Promise<LicenseStatus>;
    /**
     * Refresh license data from server
     */
    refresh(): Promise<ValidationResult>;
    /**
     * Activate license on current device
     */
    activate(): Promise<ActivationResult>;
    /**
     * Deactivate license on current device
     */
    deactivate(reason?: string): Promise<DeactivationResult>;
    /**
     * Send heartbeat to server
     */
    heartbeat(): Promise<HeartbeatResult>;
    /**
     * Check if a feature is available
     */
    hasFeature(featureKey: string): Promise<boolean>;
    /**
     * Check if a feature can be used (with limit checking)
     */
    canUseFeature(featureKey: string, currentUsage?: number): Promise<boolean>;
    /**
     * Get all features
     */
    getFeatures(): Promise<Record<string, FeatureConfig>>;
    /**
     * Get feature configuration
     */
    getFeatureConfig(featureKey: string): Promise<FeatureConfig | null>;
    /**
     * Get license information
     */
    getLicenseInfo(): Promise<LicenseInfo | null>;
    /**
     * Get days until license expiry
     */
    getDaysUntilExpiry(): Promise<number | null>;
    /**
     * Get hardware fingerprint
     */
    getFingerprint(): Promise<string>;
    /**
     * Get system information
     */
    private getSystemInfo;
    /**
     * Make HTTP request with retry logic
     */
    private makeRequest;
    /**
     * Handle validation failure
     */
    private handleFailure;
    /**
     * Log message
     */
    private log;
    /**
     * Sleep utility
     */
    private sleep;
    /**
     * Get the event emitter
     */
    getEventEmitter(): LicenseEventEmitter;
    /**
     * Get the fingerprint service
     */
    getFingerprintService(): HardwareFingerprintService;
}
/**
 * Create a client license service
 */
declare function createClientLicenseService(config: ClientConfig, options?: {
    fingerprintConfig?: FingerprintConfig;
    loggingConfig?: LoggingConfig;
    eventEmitter?: LicenseEventEmitter;
}): ClientLicenseService;

/**
 * Server license service for managing license validation
 */
declare class ServerLicenseService implements LicenseServiceInterface {
    private config;
    private database;
    private fingerprintService;
    private eventEmitter;
    private loggingConfig?;
    private currentLicenseKey?;
    private currentHardwareFingerprint?;
    private currentProductId?;
    private currentLicense?;
    private currentProduct?;
    constructor(config: ServerConfig, options?: {
        fingerprintConfig?: FingerprintConfig;
        loggingConfig?: LoggingConfig;
        eventEmitter?: LicenseEventEmitter;
    });
    /**
     * Set license parameters for validation
     */
    setLicenseParams(licenseKey: string, hardwareFingerprint: string, productId: string): this;
    /**
     * Validate license
     */
    validate(): Promise<ValidationResult>;
    /**
     * Validate license with full parameters
     */
    validateLicense(licenseKey: string, hardwareFingerprint: string, productId: string, options?: {
        systemInfo?: SystemInfo;
        ipAddress?: string;
        userAgent?: string;
    }): Promise<ValidationResult>;
    /**
     * Activate license
     */
    activateLicense(licenseKey: string, hardwareFingerprint: string, productId: string, options?: {
        systemInfo?: SystemInfo;
        ipAddress?: string;
    }): Promise<ActivationResult>;
    /**
     * Deactivate license
     */
    deactivateLicense(licenseKey: string, hardwareFingerprint: string, reason?: string): Promise<DeactivationResult>;
    /**
     * Handle heartbeat
     */
    heartbeat(licenseKey: string, hardwareFingerprint: string): Promise<HeartbeatResult>;
    /**
     * Verify offline token
     */
    verifyOfflineToken(token: string, hardwareFingerprint: string): ValidationResult;
    /**
     * Get license info
     */
    getLicenseInfo(licenseKey?: string): Promise<LicenseInfo | null>;
    /**
     * Check if license is valid
     */
    isValid(): Promise<boolean>;
    /**
     * Get license status
     */
    getStatus(): Promise<LicenseStatus>;
    /**
     * Check if feature is available
     */
    hasFeature(featureKey: string): Promise<boolean>;
    /**
     * Check if feature can be used
     */
    canUseFeature(featureKey: string, currentUsage?: number): Promise<boolean>;
    /**
     * Get all features
     */
    getFeatures(): Promise<Record<string, FeatureConfig>>;
    /**
     * Get feature configuration
     */
    getFeatureConfig(featureKey: string): Promise<FeatureConfig | null>;
    /**
     * Get days until expiry
     */
    getDaysUntilExpiry(): Promise<number | null>;
    /**
     * Handle activation check and update
     */
    private handleActivation;
    /**
     * Check license expiration
     */
    private checkExpiration;
    /**
     * Generate offline validation token
     */
    private generateOfflineToken;
    /**
     * Format license record to license info
     */
    private formatLicenseInfo;
    /**
     * Calculate next validation time
     */
    private calculateNextValidation;
    /**
     * Log validation attempt
     */
    private logValidation;
    /**
     * Log message
     */
    private log;
    /**
     * Get the event emitter
     */
    getEventEmitter(): LicenseEventEmitter;
    /**
     * Get the fingerprint service
     */
    getFingerprintService(): HardwareFingerprintService;
}
/**
 * Create a server license service
 */
declare function createServerLicenseService(config: ServerConfig, options?: {
    fingerprintConfig?: FingerprintConfig;
    loggingConfig?: LoggingConfig;
    eventEmitter?: LicenseEventEmitter;
}): ServerLicenseService;

/**
 * Base license exception
 */
declare class LicenseError extends Error {
    readonly code: string;
    readonly context?: Record<string, unknown>;
    constructor(message: string, code?: string, context?: Record<string, unknown>);
}
/**
 * License is invalid
 */
declare class LicenseInvalidError extends LicenseError {
    constructor(message?: string, context?: Record<string, unknown>);
}
/**
 * License has expired
 */
declare class LicenseExpiredError extends LicenseError {
    readonly expiredAt?: Date;
    readonly gracePeriodDays?: number;
    constructor(message?: string, options?: {
        expiredAt?: Date;
        gracePeriodDays?: number;
        context?: Record<string, unknown>;
    });
}
/**
 * License server error
 */
declare class LicenseServerError extends LicenseError {
    readonly statusCode?: number;
    readonly response?: unknown;
    constructor(message?: string, options?: {
        statusCode?: number;
        response?: unknown;
        context?: Record<string, unknown>;
    });
}
/**
 * License activation limit exceeded
 */
declare class LicenseActivationLimitError extends LicenseError {
    readonly limit: number;
    readonly current: number;
    constructor(limit: number, current: number, context?: Record<string, unknown>);
}
/**
 * Feature not available
 */
declare class FeatureNotAvailableError extends LicenseError {
    readonly featureKey: string;
    constructor(featureKey: string, context?: Record<string, unknown>);
}
/**
 * Configuration error
 */
declare class LicenseConfigError extends LicenseError {
    constructor(message: string, context?: Record<string, unknown>);
}

/**
 * Extended Express Request with license info
 */
interface LicenseRequest extends Request {
    license?: LicenseInfo;
    licenseValidation?: ValidationResult;
}
/**
 * Options for license middleware
 */
interface LicenseMiddlewareOptions {
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
declare function createLicenseMiddleware(licenseService: ClientLicenseService, options?: LicenseMiddlewareOptions): RequestHandler;
/**
 * Options for feature check middleware
 */
interface FeatureMiddlewareOptions {
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
declare function createFeatureMiddleware(licenseService: ClientLicenseService | ServerLicenseService, options: FeatureMiddlewareOptions): RequestHandler;
/**
 * Remix/generic utilities for license checking
 */
declare const licenseUtils: {
    /**
     * Check license validity (for use in Remix loaders/actions)
     */
    checkLicense(licenseService: ClientLicenseService): Promise<{
        valid: boolean;
        license?: LicenseInfo;
        error?: string;
    }>;
    /**
     * Require valid license (throws on failure)
     */
    requireLicense(licenseService: ClientLicenseService): Promise<LicenseInfo>;
    /**
     * Require specific feature (throws on failure)
     */
    requireFeature(licenseService: ClientLicenseService | ServerLicenseService, featureKey: string, currentUsage?: number): Promise<void>;
    /**
     * Check if feature is available
     */
    checkFeature(licenseService: ClientLicenseService | ServerLicenseService, featureKey: string, currentUsage?: number): Promise<boolean>;
};
/**
 * Server mode: Create Express routes for license API
 */
declare function createLicenseRoutes(serverLicenseService: ServerLicenseService): {
    validate: RequestHandler;
    activate: RequestHandler;
    deactivate: RequestHandler;
    heartbeat: RequestHandler;
    status: RequestHandler;
};

export { type LicenseInfo as A, type FeatureConfig as B, type CacheAdapter as C, type StructuredFeature as D, type ActivationResult as E, type FingerprintConfig as F, type DeactivationResult as G, HardwareFingerprintService as H, type HeartbeatResult as I, type SystemInfo as J, type LicenseActivation as K, type LicenseConfig as L, type DatabaseAdapter as M, type LicenseRecord as N, type ActivationRecord as O, type ProductInfo as P, type CreateActivationData as Q, type ProductRecord as R, ServerLicenseService as S, type ValidationLogData as T, type LicenseServiceInterface as U, type ValidationResult as V, type LicenseEventType as W, type LicenseEvent as X, type LicenseEventListener as Y, ClientLicenseService as a, type ClientConfig as b, type LoggingConfig as c, type ServerConfig as d, createFingerprintService as e, createClientLicenseService as f, createServerLicenseService as g, LicenseEventEmitter as h, getLicenseEventEmitter as i, createLicenseEventEmitter as j, LicenseError as k, LicenseInvalidError as l, LicenseExpiredError as m, LicenseServerError as n, LicenseActivationLimitError as o, FeatureNotAvailableError as p, LicenseConfigError as q, createLicenseMiddleware as r, createFeatureMiddleware as s, createLicenseRoutes as t, licenseUtils as u, type LicenseRequest as v, type LicenseMiddlewareOptions as w, type FeatureMiddlewareOptions as x, type FeaturesConfig as y, type LicenseStatus as z };
