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
    expect(source).toContain("'.comet/config.yaml'");
    expect(new Set(source.match(/\.comet\/[A-Za-z0-9._/-]+/gu) ?? [])).toEqual(
      new Set(['.comet/config.yaml', '.comet/current-change.json']),
    );
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

  it('keeps both workflow domains independent below the entry seam', async () => {
    const [nativeSource, classicSource] = await Promise.all([
      combined(
        (await filesUnder(path.resolve('domains', 'comet-native'))).filter((file) =>
          file.endsWith('.ts'),
        ),
      ),
      combined(
        (await filesUnder(path.resolve('domains', 'comet-classic'))).filter((file) =>
          file.endsWith('.ts'),
        ),
      ),
    ]);

    expect(nativeSource).not.toMatch(/\bfrom\s+['"][^'"]*comet-classic[^'"]*['"]/u);
    expect(classicSource).not.toMatch(/\bfrom\s+['"][^'"]*comet-native[^'"]*['"]/u);
    for (const source of [nativeSource, classicSource]) {
      const entryImports = source.match(/\bfrom\s+['"][^'"]*comet-entry[^'"]*['"]/gu) ?? [];
      expect(entryImports.length).toBeGreaterThan(0);
      expect(
        entryImports.every((entry) => /(?:current-selection|hook-adapter|hook-types)/u.test(entry)),
      ).toBe(true);
    }
  });
});
