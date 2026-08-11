import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveEvalContext } from '../../../domains/eval/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('standalone eval context', () => {
  it('requires a real Skill package and existing artifact owner', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-context-'));
    temporary.push(root);
    const skill = path.join(root, 'skill');
    await fs.mkdir(skill);

    await expect(
      resolveEvalContext({ skillPath: skill, project: path.join(root, 'missing') }),
    ).rejects.toThrow(`Skill package must contain SKILL.md: ${skill}`);
    await fs.writeFile(path.join(skill, 'SKILL.md'), '# Skill\n', 'utf8');
    await expect(
      resolveEvalContext({ skillPath: skill, project: path.join(root, 'missing') }),
    ).rejects.toThrow(
      `Artifact owner root must be an existing directory: ${path.join(root, 'missing')}`,
    );
  });
});
