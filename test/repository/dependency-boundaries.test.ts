import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { parse as parseToml } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const require = createRequire(import.meta.url);
const extractorRequire = createRequire(require.resolve('@microsoft/api-extractor/package.json'));
const minimatch = extractorRequire('minimatch') as {
  braceExpand(pattern: string): string[];
  Minimatch: new (
    pattern: string,
    options: { optimizationLevel: number; braceExpandMax?: number },
  ) => { set: unknown[]; match(path: string): boolean };
};

const readRepositoryFile = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function expectPatchedVersions(versions: string[], minimum: string) {
  expect(versions.length).toBeGreaterThan(0);
  for (const version of versions) {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const actual = version.split('.').map(Number);
    const required = minimum.split('.').map(Number);
    const difference = actual
      .map((part, index) => part - required[index])
      .find((part) => part !== 0);
    expect(difference ?? 0, `${version} must be at least ${minimum}`).toBeGreaterThanOrEqual(0);
  }
}

describe('resolved dependency boundaries', () => {
  it('bounds optimized glob expansion while preserving ordinary matches', () => {
    // GHSA-g3hv-75wg-m249: repeated **/.. segments must honor the expansion limit.
    const expanded = new minimatch.Minimatch(Array(8).fill('**/../a/b').join('/'), {
      optimizationLevel: 2,
      braceExpandMax: 64,
    });
    expect(expanded.set.length).toBeLessThanOrEqual(64);
    const ordinary = new minimatch.Minimatch('**/../a/b/**/../c/d', { optimizationLevel: 2 });
    expect(ordinary.match('../a/b/../c/d')).toBe(true);
    expect(ordinary.match('x/a/b/y/c/d')).toBe(true);
    expect(ordinary.match('x/a/b/y/c/no')).toBe(false);
  });

  it('excludes vulnerable minimatch versions from both Node lockfiles', () => {
    const npm = JSON.parse(readRepositoryFile('package-lock.json')) as {
      packages: Record<string, { version?: string }>;
    };
    const pnpm = parseYaml(readRepositoryFile('pnpm-lock.yaml')) as {
      packages: Record<string, unknown>;
    };
    expectPatchedVersions(
      Object.entries(npm.packages)
        .filter(
          ([path]) => path.endsWith('/node_modules/minimatch') || path === 'node_modules/minimatch',
        )
        .map(([, entry]) => entry.version!),
      '11.0.1',
    );
    expectPatchedVersions(
      Object.keys(pnpm.packages)
        .filter((key) => key.startsWith('minimatch@'))
        .map((key) => key.slice('minimatch@'.length)),
      '11.0.1',
    );
  });

  it.each([
    ['opentelemetry-api', '1.45.2'],
    ['langgraph', '1.2.14'],
    ['langgraph-sdk', '0.4.6'],
  ])('excludes vulnerable %s versions from the Python lockfile', (name, minimum) => {
    const lock = parseToml(readRepositoryFile('eval/uv.lock')) as unknown as {
      package: { name: string; version: string }[];
    };
    expectPatchedVersions(
      lock.package.filter((entry) => entry.name === name).map((entry) => entry.version),
      minimum,
    );
  });

  it('resolves percent-encoded host references to the same JSON Schema', () => {
    // GHSA-hrr3-gc8f-f4qj: hostname normalization must precede reference lookup.
    const ajv = new Ajv();
    ajv.addSchema({ $id: '//a.com/schema', type: 'string' });

    const validate = ajv.compile({ $ref: '//%41.com/schema' });

    expect(validate('accepted')).toBe(true);
    expect(validate(42)).toBe(false);
  });

  it('bounds deeply nested API report glob expansion without stack exhaustion', () => {
    // GHSA-qhr7-859c-m2p7: output-count limits alone do not bound recursion.
    const nested = '{'.repeat(4000) + 'a,b' + '}'.repeat(4000);

    expect(() => minimatch.braceExpand(nested)).not.toThrow();
    expect(minimatch.braceExpand('src/{a,b}.ts')).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
