import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

async function filesUnder(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) result.push(target);
    }
  };
  await visit(root);
  return result.sort();
}

async function combined(files: string[]): Promise<string> {
  return (await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).join('\n');
}

describe('Comet Native isolation boundaries', () => {
  it('keeps the Native domain independent from Classic and OpenSpec execution', async () => {
    const files = (await filesUnder(path.resolve('domains', 'comet-native'))).filter((file) =>
      file.endsWith('.ts'),
    );
    const source = await combined(files);

    expect(source).not.toMatch(/\bfrom\s+['"][^'"]*comet-classic[^'"]*['"]/u);
    expect(source).not.toMatch(/spawn(?:Sync)?\([^)]*openspec|execFile(?:Sync)?\([^)]*openspec/iu);
    expect(source).not.toMatch(/openspec[\\/]changes/iu);
    expect(source).not.toMatch(/['"`]\.comet(?:[\\/]|['"`])/u);
  });

  it('ships a self-contained Skill and runtime with no external workflow invocation', async () => {
    const skillFiles = [
      ...(await filesUnder(path.resolve('assets', 'skills', 'comet-native'))),
      ...(await filesUnder(path.resolve('assets', 'skills-zh', 'comet-native'))),
    ].filter((file) => /\.(?:md|mjs)$/u.test(file));
    const source = await combined(skillFiles);

    expect(source).not.toMatch(
      /requiredSkillCalls|openspec|superpowers|grill-me|brainstorming|test-driven-development|subagent-driven-development/iu,
    );
    expect(source).not.toMatch(/comet\s+(?:state|guard|handoff)\b/iu);
  });

  it('does not modify Classic runtime or Skill source relative to origin/master', () => {
    const classicPaths = [
      'domains/comet-classic',
      'assets/skills/comet',
      'assets/skills-zh/comet',
      'assets/skills/comet-open',
      'assets/skills/comet-design',
      'assets/skills/comet-build',
      'assets/skills/comet-verify',
      'assets/skills/comet-archive',
      'assets/skills-zh/comet-open',
      'assets/skills-zh/comet-design',
      'assets/skills-zh/comet-build',
      'assets/skills-zh/comet-verify',
      'assets/skills-zh/comet-archive',
    ];
    const changed = execFileSync(
      'git',
      ['diff', '--name-only', 'origin/master', '--', ...classicPaths],
      { encoding: 'utf8' },
    ).trim();

    expect(changed).toBe('');
  });
});
