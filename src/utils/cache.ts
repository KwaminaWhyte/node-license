import type { CacheAdapter } from '../types';

interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

/**
 * In-memory cache adapter
 */
export class MemoryCacheAdapter implements CacheAdapter {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(cleanupIntervalMs: number = 60000) {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check expiration
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.cache.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  /**
   * Stop the cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * File-based cache adapter (uses JSON files)
 */
export class FileCacheAdapter implements CacheAdapter {
  private cacheDir: string;
  private fs: typeof import('fs/promises') | null = null;
  private path: typeof import('path') | null = null;

  constructor(cacheDir: string = './.license-cache') {
    this.cacheDir = cacheDir;
  }

  private async ensureModules(): Promise<void> {
    if (!this.fs || !this.path) {
      this.fs = await import('fs/promises');
      this.path = await import('path');

      // Ensure cache directory exists
      try {
        await this.fs.mkdir(this.cacheDir, { recursive: true });
      } catch {
        // Directory might already exist
      }
    }
  }

  private getCacheFilePath(key: string): string {
    const safeKey = Buffer.from(key).toString('base64url');
    return this.path!.join(this.cacheDir, `${safeKey}.json`);
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureModules();

    try {
      const filePath = this.getCacheFilePath(key);
      const content = await this.fs!.readFile(filePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);

      // Check expiration
      if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
        await this.delete(key);
        return null;
      }

      return entry.value;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.ensureModules();

    const entry: CacheEntry<T> = {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    };

    const filePath = this.getCacheFilePath(key);
    await this.fs!.writeFile(filePath, JSON.stringify(entry), 'utf-8');
  }

  async delete(key: string): Promise<void> {
    await this.ensureModules();

    try {
      const filePath = this.getCacheFilePath(key);
      await this.fs!.unlink(filePath);
    } catch {
      // File might not exist
    }
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async clear(): Promise<void> {
    await this.ensureModules();

    try {
      const files = await this.fs!.readdir(this.cacheDir);
      await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map((f) => this.fs!.unlink(this.path!.join(this.cacheDir, f)))
      );
    } catch {
      // Directory might not exist
    }
  }
}

/**
 * Create an in-memory cache adapter
 */
export function createMemoryCache(cleanupIntervalMs?: number): MemoryCacheAdapter {
  return new MemoryCacheAdapter(cleanupIntervalMs);
}

/**
 * Create a file-based cache adapter
 */
export function createFileCache(cacheDir?: string): FileCacheAdapter {
  return new FileCacheAdapter(cacheDir);
}
