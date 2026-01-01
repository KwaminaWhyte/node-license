import { C as CacheAdapter, L as LicenseConfig, a as ClientLicenseService, S as ServerLicenseService, b as ClientConfig, F as FingerprintConfig, c as LoggingConfig, d as ServerConfig } from './index-4xdEUKYz.js';
export { O as ActivationRecord, E as ActivationResult, Q as CreateActivationData, M as DatabaseAdapter, G as DeactivationResult, B as FeatureConfig, x as FeatureMiddlewareOptions, p as FeatureNotAvailableError, y as FeaturesConfig, H as HardwareFingerprintService, I as HeartbeatResult, K as LicenseActivation, o as LicenseActivationLimitError, q as LicenseConfigError, k as LicenseError, X as LicenseEvent, h as LicenseEventEmitter, Y as LicenseEventListener, W as LicenseEventType, m as LicenseExpiredError, A as LicenseInfo, l as LicenseInvalidError, w as LicenseMiddlewareOptions, N as LicenseRecord, v as LicenseRequest, n as LicenseServerError, U as LicenseServiceInterface, z as LicenseStatus, P as ProductInfo, R as ProductRecord, D as StructuredFeature, J as SystemInfo, T as ValidationLogData, V as ValidationResult, f as createClientLicenseService, s as createFeatureMiddleware, e as createFingerprintService, j as createLicenseEventEmitter, r as createLicenseMiddleware, t as createLicenseRoutes, g as createServerLicenseService, i as getLicenseEventEmitter, u as licenseUtils } from './index-4xdEUKYz.js';
import 'express';

/**
 * In-memory cache adapter
 */
declare class MemoryCacheAdapter implements CacheAdapter {
    private cache;
    private cleanupInterval;
    constructor(cleanupIntervalMs?: number);
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
    clear(): Promise<void>;
    /**
     * Stop the cleanup interval
     */
    destroy(): void;
    /**
     * Clean up expired entries
     */
    private cleanup;
}
/**
 * File-based cache adapter (uses JSON files)
 */
declare class FileCacheAdapter implements CacheAdapter {
    private cacheDir;
    private fs;
    private path;
    constructor(cacheDir?: string);
    private ensureModules;
    private getCacheFilePath;
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
    clear(): Promise<void>;
}
/**
 * Create an in-memory cache adapter
 */
declare function createMemoryCache(cleanupIntervalMs?: number): MemoryCacheAdapter;
/**
 * Create a file-based cache adapter
 */
declare function createFileCache(cacheDir?: string): FileCacheAdapter;

/**
 * Create a license service based on configuration
 */
declare function createLicenseService(config: LicenseConfig): ClientLicenseService | ServerLicenseService;
/**
 * Create a client license service (convenience function)
 */
declare function createClient(options: {
    serverUrl: string;
    licenseKey: string;
    productId: string;
} & Partial<ClientConfig>, additionalOptions?: {
    fingerprintConfig?: FingerprintConfig;
    loggingConfig?: LoggingConfig;
}): ClientLicenseService;
/**
 * Create a server license service (convenience function)
 */
declare function createServer(options: {
    jwtSecret: string;
    database: ServerConfig['database'];
} & Partial<ServerConfig>, additionalOptions?: {
    fingerprintConfig?: FingerprintConfig;
    loggingConfig?: LoggingConfig;
}): ServerLicenseService;

export { CacheAdapter, ClientConfig, ClientLicenseService, FileCacheAdapter, FingerprintConfig, LicenseConfig, LoggingConfig, MemoryCacheAdapter, ServerConfig, ServerLicenseService, createClient, createFileCache, createLicenseService, createMemoryCache, createServer };
