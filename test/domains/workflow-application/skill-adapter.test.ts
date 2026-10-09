import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { inspectApplicationSkill } from '../../../domains/workflow-application/index.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-skill-references-'));
  await fs.writeFile(path.join(root, 'SKILL.md'), '# Skill\nRead [format](FORMAT.md).\n');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it.each(['```md', '~~~md', '````md'])(
  'reads real resources while retaining %s template examples in the fixed content',
  async (opening) => {
    const marker = opening.replace('md', '');
    const template = `# Format\n\n${opening}\n[Ordering](./src/ordering/CONTEXT.md)\n${marker}\n\nUse [real data](data.json).\n`;
    await fs.writeFile(path.join(root, 'FORMAT.md'), template);
    await fs.writeFile(path.join(root, 'data.json'), '{}');
    const inspected = await inspectApplicationSkill(root);
    expect(inspected.files['FORMAT.md']).toBe(template);
    expect(Object.keys(inspected.files).sort()).toEqual(['FORMAT.md', 'SKILL.md', 'data.json']);
    await fs.writeFile(path.join(root, 'FORMAT.md'), template.replace('Ordering', 'Billing'));
    expect((await inspectApplicationSkill(root)).contentHash).not.toBe(inspected.contentHash);
    await fs.rm(path.join(root, 'data.json'));
    await expect(inspectApplicationSkill(root)).rejects.toThrow('资源缺失');
  },
);

it('does not close a template with a different marker, shorter fence, or trailing text', async () => {
  await fs.writeFile(
    path.join(root, 'FORMAT.md'),
    [
      '# Format',
      '````md',
      '~~~',
      '[example](missing-one.md)',
      '```',
      '[example](missing-two.md)',
      '```` trailing text',
      '[example](missing-three.md)',
      '````',
      'Read [required](missing-real.md).',
    ].join('\n'),
  );
  await expect(inspectApplicationSkill(root)).rejects.toThrow('missing-real.md');
});
