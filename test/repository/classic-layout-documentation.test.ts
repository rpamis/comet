import { promises as fs } from 'fs';
import { describe, expect, it } from 'vitest';

const documentation = [
  'README.md',
  'README-zh.md',
  'docs/operations/AUTO-TRANSITION.md',
  'docs/operations/CONTEXT-COMPRESSION.md',
] as const;

describe('Classic layout documentation', () => {
  it.each(documentation)('uses the resolved change directory in %s', async (documentPath) => {
    const content = await fs.readFile(documentPath, 'utf8');

    expect(content).toContain('`<classic-change-dir>`');
    expect(content).not.toContain('`openspec/changes/<name>`');
  });
});
