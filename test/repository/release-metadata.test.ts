import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repositoryRoot = path.resolve('.');

describe('release metadata', () => {
  it('keeps package, lockfile, and asset manifest versions aligned', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { version: string };
    const packageLock = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'),
    ) as { version: string; packages: { '': { version: string } } };
    const assetsManifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'assets', 'manifest.json'), 'utf8'),
    ) as { version: string };

    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[''].version).toBe(packageJson.version);
    expect(assetsManifest.version).toBe(packageJson.version);
  });

  it('keeps direct dependency specifiers aligned in both lockfiles', () => {
    type DependencyGroups = Record<string, Record<string, string>>;
    const packageJson = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ) as DependencyGroups;
    const packageLock = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'),
    ) as { packages: { '': DependencyGroups } };
    const pnpmLock = parse(readFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml'), 'utf8')) as {
      importers: { '.': Record<string, Record<string, { specifier: string }>> };
    };

    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const expected = packageJson[group] ?? {};
      expect(packageLock.packages[''][group] ?? {}).toEqual(expected);
      expect(
        Object.fromEntries(
          Object.entries(pnpmLock.importers['.'][group] ?? {}).map(([name, entry]) => [
            name,
            entry.specifier,
          ]),
        ),
      ).toEqual(expected);
    }
  });

  it('locks es-module-lexer as the same production dependency in both lockfiles', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const packageLock = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'),
    ) as { packages: Record<string, { version: string; integrity: string; dev?: boolean }> };
    const pnpmLock = parse(readFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml'), 'utf8')) as {
      importers: { '.': { dependencies: Record<string, { version: string }> } };
      packages: Record<string, { resolution: { integrity: string } }>;
    };
    const version = packageJson.dependencies['es-module-lexer'];
    const npmEntry = packageLock.packages['node_modules/es-module-lexer'];

    expect(npmEntry.version).toBe(version);
    expect(npmEntry.dev).not.toBe(true);
    expect(pnpmLock.importers['.'].dependencies['es-module-lexer'].version).toBe(version);
    expect(npmEntry.integrity).toBe(
      pnpmLock.packages[`es-module-lexer@${version}`].resolution.integrity,
    );
  });

  it('keeps the rc.1 changelog scoped after beta.19', () => {
    const changelog = readFileSync(path.join(repositoryRoot, 'CHANGELOG.md'), 'utf8');
    const rcStart = changelog.indexOf("## What's Changed [0.4.0-rc.1]");
    const beta19Start = changelog.indexOf("## What's Changed [0.4.0-beta.19]");
    const beta18Start = changelog.indexOf("## What's Changed [0.4.0-beta.18]");

    expect(rcStart).toBeGreaterThan(-1);
    expect(beta19Start).toBeGreaterThan(rcStart);
    expect(beta18Start).toBeGreaterThan(beta19Start);

    const rcSection = changelog.slice(rcStart, beta19Start);
    const beta19Section = changelog.slice(beta19Start, beta18Start);
    expect(rcSection).toContain('Dashboard workspace');
    expect(rcSection).not.toContain('Grok platform support');
    expect(rcSection).not.toContain('Beta20 package metadata');
    expect(beta19Section).toContain('Grok platform support');
  });
});
