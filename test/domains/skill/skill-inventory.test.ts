import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { buildSkillInventory } from '../../../domains/skill/inventory.js';

async function writeSkill(
  root: string,
  name: string,
  description: string,
  extra = '',
): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, 'SKILL.md'),
    `---
name: ${name}
description: ${description}
---

# ${name}

${extra}
`,
  );
}

describe('skill inventory', () => {
  let root: string;
  let projectRoot: string;
  let homeDir: string;
  let builtinRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-skill-inventory-'));
    projectRoot = path.join(root, 'project');
    homeDir = path.join(root, 'home');
    builtinRoot = path.join(root, 'builtin');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('groups scanned Skills into user-facing inventory items', async () => {
    await writeSkill(
      path.join(projectRoot, '.agents', 'skills', 'brainstorming'),
      'brainstorming',
      'Explore intent before implementation.',
    );
    await writeSkill(
      path.join(homeDir, '.agents', 'skills', 'verification-before-completion'),
      'verification-before-completion',
      'Verify evidence before completion.',
    );

    const inventory = await buildSkillInventory({ projectRoot, homeDir, builtinRoot });

    expect(inventory.map((item) => item.name)).toEqual([
      'brainstorming',
      'verification-before-completion',
    ]);
    expect(inventory[0]).toMatchObject({
      capabilityGroup: 'discovery',
      status: 'available',
      recommended: true,
      duplicateInstall: false,
    });
    expect(inventory[1]).toMatchObject({
      capabilityGroup: 'verification',
      status: 'available',
      recommended: true,
    });
  });

  it('marks same-name same-hash installs as duplicate installs', async () => {
    const source = `---
name: reviewing
description: Review code.
---

# reviewing
`;
    await fs.mkdir(path.join(projectRoot, '.agents', 'skills', 'reviewing'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.agents', 'skills', 'reviewing', 'SKILL.md'),
      source,
    );
    await fs.mkdir(path.join(homeDir, '.agents', 'skills', 'reviewing'), { recursive: true });
    await fs.writeFile(path.join(homeDir, '.agents', 'skills', 'reviewing', 'SKILL.md'), source);

    const inventory = await buildSkillInventory({ projectRoot, homeDir, builtinRoot });

    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      name: 'reviewing',
      status: 'available',
      duplicateInstall: true,
    });
    expect(inventory[0].sources).toHaveLength(2);
    expect(inventory[0].hashes).toHaveLength(1);
  });

  it('marks same-name different-hash installs as ambiguous', async () => {
    await writeSkill(
      path.join(projectRoot, '.agents', 'skills', 'reviewing'),
      'reviewing',
      'Project reviewer.',
      'project',
    );
    await writeSkill(
      path.join(homeDir, '.agents', 'skills', 'reviewing'),
      'reviewing',
      'Global reviewer.',
      'global',
    );

    const inventory = await buildSkillInventory({ projectRoot, homeDir, builtinRoot });

    expect(inventory).toEqual([
      expect.objectContaining({
        name: 'reviewing',
        status: 'ambiguous',
        duplicateInstall: false,
        hashes: expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/u)]),
      }),
    ]);
    expect(inventory[0].hashes).toHaveLength(2);
  });
});
