import { createRequire } from 'node:module';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const extractorRequire = createRequire(require.resolve('@microsoft/api-extractor/package.json'));
const minimatch = extractorRequire('minimatch') as {
  braceExpand(pattern: string): string[];
};

describe('resolved dependency boundaries', () => {
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
