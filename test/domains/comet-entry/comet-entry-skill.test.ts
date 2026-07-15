import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const chineseRoot = path.resolve('assets', 'skills-zh');
const englishRoot = path.resolve('assets', 'skills');

async function readSkill(root: string, name: string): Promise<string> {
  return fs.readFile(path.join(root, name, 'SKILL.md'), 'utf8');
}

describe('Chinese Comet entry Skills', () => {
  it('keeps /comet as a short configuration-only alias', async () => {
    const source = await readSkill(chineseRoot, 'comet');

    expect(source).toContain('name: comet');
    expect(source).toContain('comet workflow resolve . --json');
    expect(source).toContain('comet-entry-runtime.mjs . --json');
    expect(source).toContain('command not found');
    expect(source).toContain('CLI 已启动但返回非零');
    expect(source).toContain('comet.workflow-resolution.v1');
    expect(source).toContain('只接受');
    expect(source).toContain('/comet-native');
    expect(source).toContain('/comet-classic');
    expect(source).toContain('不根据任务');
    expect(source.length).toBeLessThan(2_000);
    expect(source).not.toMatch(/OpenSpec|Superpowers|brainstorming|TDD|\/comet-open/iu);
  });

  it('publishes the existing thick workflow only through /comet-classic', async () => {
    const source = await readSkill(chineseRoot, 'comet-classic');

    expect(source).toContain('name: comet-classic');
    expect(source).toContain('OpenSpec');
    expect(source).toContain('Superpowers');
    expect(source).toContain('comet state select <change-name>');
    expect(source).toContain('/comet-open');
    expect(source).toContain('/comet-build');
    expect(source).toContain('comet/reference/scripts.md');
    expect(source.length).toBeGreaterThan(10_000);
    expect(source).not.toMatch(/\/comet(?![-/])/u);
  });

  it('keeps shared Classic references on the explicit Classic entry', async () => {
    const referenceRoot = path.join(chineseRoot, 'comet', 'reference');
    const files = (await fs.readdir(referenceRoot)).filter((name) => name.endsWith('.md'));
    const source = (
      await Promise.all(files.map((name) => fs.readFile(path.join(referenceRoot, name), 'utf8')))
    ).join('\n');

    expect(source).toContain('/comet-classic');
    expect(source).not.toMatch(/\/comet(?![-/])/u);
  });

  it('keeps Classic child Skills inside the explicit Classic entry', async () => {
    const classicChildren = [
      'comet-open',
      'comet-design',
      'comet-build',
      'comet-verify',
      'comet-archive',
      'comet-hotfix',
      'comet-tweak',
    ];
    const sources = await Promise.all(classicChildren.map((name) => readSkill(chineseRoot, name)));

    for (const source of sources) {
      expect(source).not.toMatch(/\/comet(?![-/])/u);
      expect(source).not.toContain('/comet-native');
    }
  });

  it('publishes the bilingual Classic entry through the shared manifest', async () => {
    const manifest = JSON.parse(await fs.readFile(path.resolve('assets', 'manifest.json'), 'utf8'));

    expect(manifest.skills).toContain('comet-classic/SKILL.md');
  });
});

describe('English Comet entry Skills', () => {
  it('keeps /comet as a short configuration-only alias', async () => {
    const source = await readSkill(englishRoot, 'comet');

    expect(source).toContain('name: comet');
    expect(source).toContain('comet workflow resolve . --json');
    expect(source).toContain('comet-entry-runtime.mjs . --json');
    expect(source).toContain('command not found');
    expect(source).toContain('If the CLI starts but exits nonzero');
    expect(source).toContain('comet.workflow-resolution.v1');
    expect(source).toContain('Only accept');
    expect(source).toContain('/comet-native');
    expect(source).toContain('/comet-classic');
    expect(source).toContain('Do not switch');
    expect(source.length).toBeLessThan(2_000);
    expect(source).not.toMatch(/OpenSpec|Superpowers|brainstorming|TDD|\/comet-open/iu);
  });

  it('publishes the existing thick workflow only through /comet-classic', async () => {
    const source = await readSkill(englishRoot, 'comet-classic');

    expect(source).toContain('name: comet-classic');
    expect(source).toContain('OpenSpec');
    expect(source).toContain('Superpowers');
    expect(source).toContain('comet state select <change-name>');
    expect(source).toContain('/comet-open');
    expect(source).toContain('/comet-build');
    expect(source).toContain('comet/reference/scripts.md');
    expect(source.length).toBeGreaterThan(10_000);
    expect(source).not.toMatch(/\/comet(?![-/])/u);
  });

  it('keeps shared Classic references on the explicit Classic entry', async () => {
    const referenceRoot = path.join(englishRoot, 'comet', 'reference');
    const files = (await fs.readdir(referenceRoot)).filter((name) => name.endsWith('.md'));
    const source = (
      await Promise.all(files.map((name) => fs.readFile(path.join(referenceRoot, name), 'utf8')))
    ).join('\n');

    expect(source).toContain('/comet-classic');
    expect(source).not.toMatch(/\/comet(?![-/])/u);
  });

  it('keeps Classic child Skills inside the explicit Classic entry', async () => {
    const classicChildren = [
      'comet-open',
      'comet-design',
      'comet-build',
      'comet-verify',
      'comet-archive',
      'comet-hotfix',
      'comet-tweak',
    ];
    const sources = await Promise.all(classicChildren.map((name) => readSkill(englishRoot, name)));

    for (const source of sources) {
      expect(source).not.toMatch(/\/comet(?![-/])/u);
      expect(source).not.toContain('/comet-native');
    }
  });
});
