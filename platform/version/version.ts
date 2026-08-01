import { existsSync, readFileSync } from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

function readCurrentVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const relativePath of ['../../package.json', '../../../package.json']) {
    const candidate = path.resolve(here, relativePath);
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string };
      if (typeof pkg.version === 'string') return pkg.version;
    }
  }
  throw new Error('Unable to locate package.json for current version');
}

// Resolved lazily on first use so that importing this module (which every CLI
// invocation does via commander's `.version()`) no longer opens and parses
// package.json at module load. The value is stable for the process lifetime,
// so a single memoized read is sufficient.
let cachedVersion: string | null = null;

const PACKAGE_NAME = '@rpamis/comet';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

export interface VersionCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  checked: boolean;
}

/**
 * Compare two semver version strings.
 * Returns a positive number if a > b, negative if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const parseParts = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((part) => {
        const numeric = parseInt(part, 10);
        return Number.isNaN(numeric) ? 0 : numeric;
      });

  const partsA = parseParts(a);
  const partsB = parseParts(b);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) {
      return numA - numB;
    }
  }

  return 0;
}

/**
 * Get the current installed Comet version from package.json.
 */
export function getCurrentVersion(): string {
  if (cachedVersion === null) {
    cachedVersion = readCurrentVersion();
  }
  return cachedVersion;
}

/**
 * Fetch the latest version from the npm registry.
 * Returns null if the registry is unreachable or the request fails.
 */
export function getLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const request = https.get(REGISTRY_URL, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }

      let data = '';
      res.on('data', (chunk: string) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { version?: string };
          resolve(typeof parsed.version === 'string' ? parsed.version : null);
        } catch {
          resolve(null);
        }
      });
    });

    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
  });
}

/**
 * Check for available updates.
 * Silently returns a "not checked" result if the registry is unreachable.
 */
export async function checkForUpdate(): Promise<VersionCheckResult> {
  const currentVersion = getCurrentVersion();
  const latestVersion = await getLatestVersion();

  if (latestVersion === null) {
    return {
      currentVersion,
      latestVersion: null,
      hasUpdate: false,
      checked: false,
    };
  }

  return {
    currentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    checked: true,
  };
}

/**
 * Format and print version info to the console.
 * Used by `comet init` and `comet update` at the start of command output.
 */
export async function printVersionInfo(
  log: (message: string) => void,
): Promise<VersionCheckResult> {
  const result = await checkForUpdate();

  log(`  Comet v${result.currentVersion}`);

  if (!result.checked) {
    // Registry unreachable — skip silently per requirement #6
    return result;
  }

  if (result.hasUpdate) {
    log(
      `  New version v${result.latestVersion} available. Run 'npm update -g ${PACKAGE_NAME}' to upgrade.`,
    );
  } else {
    log(`  You are on the latest version.`);
  }

  return result;
}
