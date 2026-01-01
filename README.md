# westel-license

A comprehensive license validation and management package for Node.js applications. This is the Node.js equivalent of the Laravel license package.

## Features

- **Dual-mode architecture**: Works as both a license server and client
- **Hardware fingerprinting**: Generate unique device identifiers
- **JWT-based offline tokens**: Support for offline validation
- **Feature gating**: Control access to features based on license tier
- **Caching**: In-memory and file-based cache adapters
- **Event system**: React to license events (validated, expired, etc.)
- **TypeScript support**: Full type definitions included

## Installation

```bash
npm install westel-license
```

## Quick Start

### Client Mode

```typescript
import { createClient } from 'westel-license';

const license = createClient({
  serverUrl: 'https://license.example.com/api/license',
  licenseKey: 'YOUR-LICENSE-KEY',
  productId: 'your-product-id',
});

// Validate license
const result = await license.validate();
if (result.valid) {
  console.log('License is valid!', result.license);
} else {
  console.log('License invalid:', result.message);
}

// Check features
if (await license.hasFeature('advanced-reports')) {
  // Show advanced reports
}

// Check limits
if (await license.canUseFeature('api-calls', currentUsage)) {
  // Allow API call
}
```

### Server Mode

```typescript
import { createServer, createLicenseRoutes } from 'westel-license';
import express from 'express';

// Create database adapter (implement the DatabaseAdapter interface)
const database = createYourDatabaseAdapter();

const licenseServer = createServer({
  jwtSecret: process.env.LICENSE_JWT_SECRET!,
  database,
  gracePeriodDays: 7,
  offlineValidationDays: 30,
});

// Set up Express routes
const app = express();
const routes = createLicenseRoutes(licenseServer);

app.post('/api/license/validate', routes.validate);
app.post('/api/license/activate', routes.activate);
app.post('/api/license/deactivate', routes.deactivate);
app.post('/api/license/heartbeat', routes.heartbeat);
app.get('/api/license/status/:licenseKey', routes.status);
```

## Usage with Remix

```typescript
// app/services/license.server.ts
import { createClient } from 'westel-license';

export const licenseService = createClient({
  serverUrl: process.env.LICENSE_SERVER_URL!,
  licenseKey: process.env.LICENSE_KEY!,
  productId: process.env.LICENSE_PRODUCT_ID!,
  offlineMode: true,
  cacheTtl: 86400, // 24 hours
});

// app/routes/dashboard.tsx
import { json, redirect } from '@remix-run/node';
import { licenseService } from '~/services/license.server';
import { licenseUtils } from 'westel-license';

export async function loader() {
  const { valid, license, error } = await licenseUtils.checkLicense(licenseService);

  if (!valid) {
    return redirect('/license-required?error=' + encodeURIComponent(error || ''));
  }

  return json({ license });
}
```

## Configuration

### Client Configuration

```typescript
interface ClientConfig {
  serverUrl: string;          // License server URL
  licenseKey: string;         // Your license key
  productId: string;          // Product ID
  cacheTtl?: number;          // Cache TTL in seconds (default: 86400)
  offlineMode?: boolean;      // Enable offline validation (default: true)
  autoFingerprint?: boolean;  // Auto-generate fingerprint (default: true)
  httpTimeout?: number;       // HTTP timeout in ms (default: 10000)
  retry?: {
    enabled: boolean;
    times: number;
    sleepMs: number;
  };
  onFailure?: 'throw' | 'log' | 'silent';
}
```

### Server Configuration

```typescript
interface ServerConfig {
  jwtSecret: string;              // JWT signing secret
  database: DatabaseAdapter;      // Database adapter
  jwtAlgorithm?: string;          // JWT algorithm (default: HS256)
  gracePeriodDays?: number;       // Grace period (default: 7)
  offlineValidationDays?: number; // Offline token validity (default: 30)
  defaultActivationLimit?: number; // Default device limit (default: 5)
}
```

## Hardware Fingerprinting

```typescript
import { createFingerprintService } from 'westel-license';

const fingerprint = createFingerprintService({
  components: {
    hostname: true,
    ipAddress: true,
    macAddress: true,
    cpuInfo: false,
    platform: true,
  },
  tolerance: 10, // 0-100, higher = more tolerant
  hashAlgorithm: 'sha256',
});

// Generate fingerprint
const fp = await fingerprint.generate();

// Compare fingerprints
const match = fingerprint.compare(fp1, fp2, 10);

// Get system info
const info = await fingerprint.getSystemInfo();
```

## Events

```typescript
import { getLicenseEventEmitter } from 'westel-license';

const events = getLicenseEventEmitter();

events.on('license:validated', (event) => {
  console.log('License validated:', event.license);
});

events.on('license:expired', (event) => {
  console.log('License expired:', event.message);
});

events.on('license:grace_period', (event) => {
  console.log('License in grace period:', event.license?.daysUntilExpiry);
});

// Listen to all events
events.on('*', (event) => {
  console.log(`Event: ${event.type}`, event);
});
```

## Database Adapter

Implement the `DatabaseAdapter` interface for your database:

```typescript
interface DatabaseAdapter {
  findLicenseByKey(licenseKey: string): Promise<LicenseRecord | null>;
  findLicenseById(id: string): Promise<LicenseRecord | null>;
  findActivations(licenseId: string): Promise<ActivationRecord[]>;
  findActivationByFingerprint(licenseId: string, fingerprint: string): Promise<ActivationRecord | null>;
  createActivation(data: CreateActivationData): Promise<ActivationRecord>;
  updateActivation(id: string, data: Partial<ActivationRecord>): Promise<ActivationRecord>;
  deactivateActivation(id: string): Promise<void>;
  countActiveActivations(licenseId: string): Promise<number>;
  findProductById(productId: string): Promise<ProductRecord | null>;
  logValidation?(data: ValidationLogData): Promise<void>;
}
```

## Express Middleware

```typescript
import { createLicenseMiddleware, createFeatureMiddleware } from 'westel-license/middleware';

// Protect routes with license validation
app.use('/api', createLicenseMiddleware(licenseService, {
  redirectUrl: '/license-required', // Optional: redirect on failure
  skip: (req) => req.path === '/health', // Optional: skip certain paths
}));

// Protect routes with feature check
app.use('/api/reports', createFeatureMiddleware(licenseService, {
  feature: 'advanced-reports',
  redirectUrl: '/upgrade',
}));
```

## Error Handling

```typescript
import {
  LicenseError,
  LicenseInvalidError,
  LicenseExpiredError,
  LicenseServerError,
  FeatureNotAvailableError,
} from 'westel-license';

try {
  await licenseService.validate();
} catch (error) {
  if (error instanceof LicenseExpiredError) {
    console.log('License expired at:', error.expiredAt);
  } else if (error instanceof LicenseInvalidError) {
    console.log('License invalid:', error.message);
  } else if (error instanceof LicenseServerError) {
    console.log('Server error:', error.statusCode, error.response);
  }
}
```

## API Reference

### ClientLicenseService

| Method | Description |
|--------|-------------|
| `validate()` | Validate license (online + offline fallback) |
| `validateOnline()` | Force online validation |
| `validateOffline()` | Force offline validation |
| `isValid()` | Check if license is valid |
| `getStatus()` | Get current license status |
| `refresh()` | Refresh license from server |
| `activate()` | Activate license on device |
| `deactivate(reason?)` | Deactivate license |
| `heartbeat()` | Send heartbeat to server |
| `hasFeature(key)` | Check if feature exists |
| `canUseFeature(key, usage?)` | Check if feature can be used |
| `getFeatures()` | Get all features |
| `getLicenseInfo()` | Get license information |
| `getDaysUntilExpiry()` | Get days until expiry |

### ServerLicenseService

| Method | Description |
|--------|-------------|
| `validateLicense(key, fp, productId, options?)` | Validate license |
| `activateLicense(key, fp, productId, options?)` | Activate license |
| `deactivateLicense(key, fp, reason?)` | Deactivate license |
| `heartbeat(key, fp)` | Process heartbeat |
| `verifyOfflineToken(token, fp)` | Verify offline token |
| `getLicenseInfo(key?)` | Get license info |

## License

MIT
