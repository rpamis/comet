import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';

it('keeps public Skills independent of DSH CLI environment variables in both languages', async () => {
  const manifest = JSON.parse(await readFile('assets/manifest.json', 'utf8'));
  const entries = manifest.skills.filter((file: string) => file.endsWith('/SKILL.md')) as string[];
  expect(entries).toHaveLength(13);
  for (const root of ['assets/skills', 'assets/skills-zh'])
    for (const entry of entries) {
      const file = path.join(root, entry);
      const content = await readFile(file, 'utf8');
      expect(content, file).not.toContain('DSH_COMET_CLI');
      expect(content, file).not.toMatch(/^> Comet CLI[：:]/m);
    }
});
