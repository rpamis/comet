import { promises as fs } from 'fs';
import { describe, expect, it } from 'vitest';

describe('package scripts', () => {
  it('runs the prepublish build without invoking pnpm from the npm lifecycle', async () => {
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    const prepublishOnly = packageJson.scripts?.prepublishOnly;

    expect(prepublishOnly).toBe('node scripts/release/prepublish-check.js && node build.js');
    expect(prepublishOnly).not.toContain('pnpm');
  });

  it('routes prepare through the release prepare helper', async () => {
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.prepare).toBe('node scripts/release/prepare.js');
  });

  it('exposes independent Classic, Native, and entry resolver runtime builders', async () => {
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const buildSource = await fs.readFile('build.js', 'utf8');

    expect(packageJson.scripts?.['build:classic-runtime']).toBe(
      'node scripts/build/build-classic-runtime.mjs',
    );
    expect(packageJson.scripts?.['build:native-runtime']).toBe(
      'node scripts/build/build-native-runtime.mjs',
    );
    expect(packageJson.scripts?.['build:entry-runtime']).toBe(
      'node scripts/build/build-entry-runtime.mjs',
    );
    expect(buildSource.indexOf('buildClassicRuntime();')).toBeLessThan(
      buildSource.indexOf('buildNativeRuntime();'),
    );
    expect(buildSource.indexOf('buildNativeRuntime();')).toBeLessThan(
      buildSource.indexOf('buildEntryRuntime();'),
    );
    expect(buildSource.indexOf('buildEntryRuntime();')).toBeLessThan(
      buildSource.indexOf("runTsc(['--version']);"),
    );
  });
});
