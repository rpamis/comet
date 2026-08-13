import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('coverage configuration', () => {
  it('keeps line-oriented source-coverage gates at 80 percent', async () => {
    const config = await readFile(path.resolve('vitest.config.ts'), 'utf8');

    for (const metric of ['functions', 'lines', 'statements']) {
      expect(config).toMatch(new RegExp(`${metric}: 80`, 'u'));
    }
    expect(config).toMatch(/branches: 75/u);
  });
});
