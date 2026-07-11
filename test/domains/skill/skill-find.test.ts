import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { findPreferredSkills, type SkillSearchRoot } from '../../../domains/skill/find.js';

async function writeMarkdownSkill(root: string, name: string, description: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, 'SKILL.md'),
    `---
name: ${name}
description: ${description}
---

# ${name}

Read the nearby reference when needed.
`,
  );
  await fs.mkdir(path.join(root, 'reference'), { recursive: true });
  await fs.writeFile(path.join(root, 'reference', 'notes.md'), `# ${name} notes\n`);
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(root, 'scripts', 'run.mjs'), `console.log('${name}');\n`);
}

async function writeMinimalSkill(root: string, name: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, 'SKILL.md'),
    `---
name: ${name}
description: ${name} description.
---

# ${name}
`,
  );
}

describe('findPreferredSkills', () => {
  let root: string;
  let projectRoot: string;
  let homeDir: string;
  let builtinRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-skill-find-'));
    projectRoot = path.join(root, 'project');
    homeDir = path.join(root, 'home');
    builtinRoot = path.join(root, 'builtin');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(builtinRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('scans all Skill roots when preferences are omitted instead of reading the legacy text preference file', async () => {
    await fs.writeFile(path.join(projectRoot, '.comet', `skills${'.txt'}`), 'ignored-skill\n');
    await writeMarkdownSkill(
      path.join(projectRoot, '.agents', 'skills', 'actual-skill'),
      'actual-skill',
      'Actual project Skill.',
    );

    const result = await findPreferredSkills({
      projectRoot,
      homeDir,
      builtinRoot,
    });

    expect(result.map((skill) => skill.query)).toEqual(['actual-skill']);
    expect(result[0]).toMatchObject({
      preferenceIndex: null,
      status: 'available',
    });
  });

  it('finds real local Skills and preserves preferenceIndex', async () => {
    await writeMarkdownSkill(
      path.join(projectRoot, '.agents', 'skills', 'brainstorming'),
      'brainstorming',
      'Explore intent before implementation.',
    );
    await writeMarkdownSkill(
      path.join(homeDir, '.agents', 'skills', 'writing-plans'),
      'writing-plans',
      'Write implementation plans.',
    );

    const result = await findPreferredSkills({
      projectRoot,
      homeDir,
      builtinRoot,
      preferences: [
        { query: 'brainstorming', preferenceIndex: 0 },
        { query: 'writing-plans', preferenceIndex: 1 },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        query: 'brainstorming',
        preferenceIndex: 0,
        status: 'available',
        sources: [
          expect.objectContaining({
            name: 'brainstorming',
            origin: 'project',
            platform: 'codex',
            description: 'Explore intent before implementation.',
            skillMd: expect.stringContaining('# brainstorming'),
            references: [expect.objectContaining({ path: 'reference/notes.md' })],
            scripts: [expect.objectContaining({ path: 'scripts/run.mjs', sideEffect: 'unknown' })],
            hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        ],
      }),
      expect.objectContaining({
        query: 'writing-plans',
        preferenceIndex: 1,
        status: 'available',
        sources: [expect.objectContaining({ origin: 'global', platform: 'codex' })],
      }),
    ]);
  });

  it('prefers a canonical Codex Skill over a same-named legacy Skill', async () => {
    await writeMinimalSkill(path.join(projectRoot, '.agents', 'skills', 'reviewing'), 'reviewing');
    await writeMinimalSkill(path.join(projectRoot, '.codex', 'skills', 'reviewing'), 'reviewing');

    const result = await findPreferredSkills({ projectRoot, homeDir, builtinRoot });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ query: 'reviewing', status: 'available' });
    expect(result[0].sources).toHaveLength(1);
    expect(result[0].sources[0].root).toBe(
      await fs.realpath(path.join(projectRoot, '.agents', 'skills', 'reviewing')),
    );
  });

  it('reports ambiguous and missing preferences without choosing for the user', async () => {
    await writeMarkdownSkill(
      path.join(projectRoot, '.agents', 'skills', 'reviewing'),
      'reviewing',
      'Project reviewer.',
    );
    await writeMarkdownSkill(
      path.join(homeDir, '.agents', 'skills', 'reviewing'),
      'reviewing',
      'Global reviewer.',
    );

    const result = await findPreferredSkills({
      projectRoot,
      homeDir,
      builtinRoot,
      preferences: [
        { query: 'reviewing', preferenceIndex: 0 },
        { query: 'missing-skill', preferenceIndex: 1 },
      ],
    });

    expect(result[0]).toMatchObject({
      query: 'reviewing',
      preferenceIndex: 0,
      status: 'ambiguous',
    });
    expect(result[0].sources).toHaveLength(2);
    expect(result[1]).toMatchObject({
      query: 'missing-skill',
      preferenceIndex: 1,
      status: 'missing',
      sources: [],
    });
  });

  it('can scan supplied roots when preferences are absent', async () => {
    const customRoot = path.join(root, 'custom-skills');
    await writeMarkdownSkill(path.join(customRoot, 'alpha'), 'alpha', 'Alpha skill.');
    const roots: SkillSearchRoot[] = [{ root: customRoot, origin: 'project', platform: 'custom' }];

    const result = await findPreferredSkills({
      projectRoot,
      homeDir,
      builtinRoot,
      preferences: null,
      extraRoots: roots,
    });

    expect(result).toEqual([
      expect.objectContaining({
        query: 'alpha',
        preferenceIndex: null,
        status: 'available',
      }),
    ]);
  });

  it('reports traversal queries as missing without reading outside roots', async () => {
    await writeMarkdownSkill(
      path.join(projectRoot, '.agents', 'outside'),
      'outside',
      'Must not be discovered through traversal.',
    );

    const result = await findPreferredSkills({
      projectRoot,
      homeDir,
      builtinRoot,
      preferences: [{ query: '../outside', preferenceIndex: 0 }],
    });

    expect(result).toEqual([
      { query: '../outside', preferenceIndex: 0, status: 'missing', sources: [] },
    ]);
  });

  it('does not follow search-root symlinks or junctions to skills outside the root', async (context) => {
    const outside = path.join(root, 'outside-skills', 'linked');
    const link = path.join(projectRoot, '.agents', 'skills', 'linked');
    await writeMarkdownSkill(outside, 'linked', 'Outside linked skill.');
    await fs.mkdir(path.dirname(link), { recursive: true });
    try {
      await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
        context.skip();
      }
      throw error;
    }

    const result = await findPreferredSkills({
      projectRoot,
      homeDir,
      builtinRoot,
      preferences: [{ query: 'linked', preferenceIndex: 0 }],
    });

    expect(result).toEqual([
      { query: 'linked', preferenceIndex: 0, status: 'missing', sources: [] },
    ]);
  });

  it('uses length-framed hashing so embedded NUL content cannot collide with file framing', async () => {
    const first = path.join(root, 'framing-a');
    const second = path.join(root, 'framing-b');
    await writeMinimalSkill(first, 'framing-a');
    await writeMinimalSkill(second, 'framing-b');
    await fs.writeFile(
      path.join(first, 'SKILL.md'),
      await fs.readFile(path.join(second, 'SKILL.md')),
    );
    await fs.writeFile(path.join(first, 'a'), Buffer.from('b\0file\0c\0d'));
    await fs.writeFile(path.join(second, 'a'), Buffer.from('b'));
    await fs.writeFile(path.join(second, 'c'), Buffer.from('d'));

    const result = await findPreferredSkills({
      projectRoot,
      homeDir,
      builtinRoot,
      preferences: [
        { query: first, preferenceIndex: 0 },
        { query: second, preferenceIndex: 1 },
      ],
    });

    expect(result[0].status).toBe('available');
    expect(result[1].status).toBe('available');
    expect(result[0].sources[0].hash).not.toBe(result[1].sources[0].hash);
  });
});
