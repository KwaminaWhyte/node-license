import type { LicenseEvent, LicenseEventListener, LicenseEventType, LicenseInfo } from '../types';

/**
 * License event emitter for handling license-related events
 */
export class LicenseEventEmitter {
  private listeners: Map<LicenseEventType | '*', Set<LicenseEventListener>> = new Map();

  /**
   * Add an event listener
   */
  on(event: LicenseEventType | '*', listener: LicenseEventListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    // Return unsubscribe function
    return () => this.off(event, listener);
  }

  /**
   * Add a one-time event listener
   */
  once(event: LicenseEventType | '*', listener: LicenseEventListener): () => void {
    const wrapper: LicenseEventListener = async (e) => {
      this.off(event, wrapper);
      await listener(e);
    };
    return this.on(event, wrapper);
  }

  /**
   * Remove an event listener
   */
  off(event: LicenseEventType | '*', listener: LicenseEventListener): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
    }
  }

  /**
   * Emit an event
   */
  async emit(
    type: LicenseEventType,
    options?: {
      license?: LicenseInfo;
      message?: string;
      context?: Record<string, unknown>;
    }
  ): Promise<void> {
    const event: LicenseEvent = {
      type,
      timestamp: new Date(),
      license: options?.license,
      message: options?.message,
      context: options?.context,
    };

    // Get specific event listeners
    const specificListeners = this.listeners.get(type) || new Set();

    // Get wildcard listeners
    const wildcardListeners = this.listeners.get('*') || new Set();

    // Combine all listeners
    const allListeners = [...specificListeners, ...wildcardListeners];

    // Execute all listeners
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
  removeAllListeners(event?: LicenseEventType | '*'): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: LicenseEventType | '*'): number {
    return this.listeners.get(event)?.size || 0;
  }
}

// Singleton instance
let eventEmitter: LicenseEventEmitter | null = null;

/**
 * Get the global license event emitter
 */
export function getLicenseEventEmitter(): LicenseEventEmitter {
  if (!eventEmitter) {
    eventEmitter = new LicenseEventEmitter();
  }
  return eventEmitter;
}

/**
 * Create a new license event emitter
 */
export function createLicenseEventEmitter(): LicenseEventEmitter {
  return new LicenseEventEmitter();
}
