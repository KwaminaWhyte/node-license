import { createHash } from 'crypto';
import * as os from 'os';
import si from 'systeminformation';
import type { FingerprintConfig, SystemInfo } from '../types';

/**
 * Default fingerprint configuration
 */
const DEFAULT_CONFIG: Required<FingerprintConfig> = {
  components: {
    hostname: true,
    ipAddress: true,
    macAddress: true,
    cpuInfo: false,
    diskSerial: false,
    platform: true,
  },
  tolerance: 10,
  hashAlgorithm: 'sha256',
};

/**
 * Hardware fingerprint service for generating and comparing device fingerprints
 */
export class HardwareFingerprintService {
  private config: Required<FingerprintConfig>;
  private cachedFingerprint: string | null = null;
  private cachedSystemInfo: SystemInfo | null = null;

  constructor(config?: FingerprintConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      components: {
        ...DEFAULT_CONFIG.components,
        ...config?.components,
      },
    };
  }

  /**
   * Generate a hardware fingerprint for the current system
   */
  async generate(): Promise<string> {
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
  generateFromComponents(components: Record<string, string>): string {
    return this.hashComponents(components);
  }

  /**
   * Compare two fingerprints with tolerance
   */
  compare(
    fingerprint1: string,
    fingerprint2: string,
    tolerance?: number
  ): boolean {
    const tol = tolerance ?? this.config.tolerance;

    // Exact match
    if (fingerprint1 === fingerprint2) {
      return true;
    }

    // If tolerance is 0, only exact matches pass
    if (tol === 0) {
      return false;
    }

    // Calculate similarity percentage
    const similarity = this.calculateSimilarity(fingerprint1, fingerprint2);
    return similarity >= (100 - tol);
  }

  /**
   * Get detailed system information
   */
  async getSystemInfo(): Promise<SystemInfo> {
    if (this.cachedSystemInfo) {
      return this.cachedSystemInfo;
    }

    const cpuInfo = await si.cpu();
    const memInfo = await si.mem();

    this.cachedSystemInfo = {
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpus: os.cpus().length,
      memory: Math.round(memInfo.total / (1024 * 1024 * 1024)), // GB
      uptime: Math.round(os.uptime()),
    };

    return this.cachedSystemInfo;
  }

  /**
   * Clear cached fingerprint and system info
   */
  clearCache(): void {
    this.cachedFingerprint = null;
    this.cachedSystemInfo = null;
  }

  /**
   * Get the current configuration
   */
  getConfig(): Required<FingerprintConfig> {
    return { ...this.config };
  }

  /**
   * Collect hardware components based on configuration
   */
  private async collectComponents(): Promise<Record<string, string>> {
    const components: Record<string, string> = {};
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
  private async getPrimaryIpAddress(): Promise<string> {
    const interfaces = os.networkInterfaces();

    for (const [, nets] of Object.entries(interfaces)) {
      if (!nets) continue;

      for (const net of nets) {
        // Skip internal and non-IPv4 addresses
        if (net.internal || net.family !== 'IPv4') continue;
        return net.address;
      }
    }

    return '0.0.0.0';
  }

  /**
   * Get primary MAC address
   */
  private async getPrimaryMacAddress(): Promise<string> {
    try {
      const networkInterfaces = await si.networkInterfaces();
      const interfaces = Array.isArray(networkInterfaces)
        ? networkInterfaces
        : [networkInterfaces];

      for (const iface of interfaces) {
        if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
          return iface.mac;
        }
      }
    } catch {
      // Fallback to Node.js native
      const interfaces = os.networkInterfaces();
      for (const [, nets] of Object.entries(interfaces)) {
        if (!nets) continue;
        for (const net of nets) {
          if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
            return net.mac;
          }
        }
      }
    }

    return '00:00:00:00:00:00';
  }

  /**
   * Get disk serial number
   */
  private async getDiskSerial(): Promise<string | null> {
    try {
      const diskLayout = await si.diskLayout();
      if (diskLayout.length > 0 && diskLayout[0].serialNum) {
        return diskLayout[0].serialNum;
      }
    } catch {
      // Disk serial might not be available on all systems
    }
    return null;
  }

  /**
   * Hash components into fingerprint
   */
  private hashComponents(components: Record<string, string>): string {
    // Sort keys for consistent hashing
    const sortedKeys = Object.keys(components).sort();
    const data = sortedKeys.map((key) => `${key}:${components[key]}`).join('|');

    return createHash(this.config.hashAlgorithm)
      .update(data)
      .digest('hex');
  }

  /**
   * Calculate similarity between two fingerprints (0-100)
   */
  private calculateSimilarity(fp1: string, fp2: string): number {
    if (fp1.length !== fp2.length) {
      return 0;
    }

    let matches = 0;
    for (let i = 0; i < fp1.length; i++) {
      if (fp1[i] === fp2[i]) {
        matches++;
      }
    }

    return (matches / fp1.length) * 100;
  }
}

/**
 * Create a hardware fingerprint service instance
 */
export function createFingerprintService(config?: FingerprintConfig): HardwareFingerprintService {
  return new HardwareFingerprintService(config);
}
