import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('coverage configuration', () => {
  it('keeps every source-coverage gate at 75 percent', async () => {
    const config = await readFile(path.resolve('vitest.config.ts'), 'utf8');

    for (const metric of ['branches', 'functions', 'lines', 'statements']) {
      expect(config).toMatch(new RegExp(`${metric}: 75`, 'u'));
    }
  });
});
