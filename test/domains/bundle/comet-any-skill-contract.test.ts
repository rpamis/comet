import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve('');

async function readText(relative: string): Promise<string> {
  return fs.readFile(path.resolve(REPO_ROOT, relative), 'utf8');
}

async function readTree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith('.md'))
        result[path.relative(root, target).replace(/\\/gu, '/')] = await fs.readFile(
          target,
          'utf8',
        );
    }
  }
  await visit(root);
  return result;
}

function registeredCommands(cliSource: string): Set<string> {
  const matches = cliSource.matchAll(/\.command\(['"]([\w-]+)(?:\s[^'"]*)?['"]\)/gu);
  const set = new Set<string>();
  for (const match of matches) set.add(match[1]!);
  return set;
}

function referencedCommands(doc: string): string[] {
  const refs: string[] = [];
  for (const match of doc.matchAll(/comet\s+(bundle|creator|publish|skill|eval)\s+([\w-]+)/gu)) {
    refs.push(match[2]!);
  }
  return refs;
}

describe('comet-any skill contract', () => {
  it('never references the non-existent find-skill command (en + zh)', async () => {
    for (const localeRoot of ['assets/skills/comet-any', 'assets/skills-zh/comet-any']) {
      const docs = await readTree(path.resolve(REPO_ROOT, localeRoot));
      for (const [file, content] of Object.entries(docs)) {
        expect(
          content.includes('find-skill'),
          `${localeRoot}/${file} still references find-skill`,
        ).toBe(false);
      }
    }
  });

  it('only references commands that are registered in the CLI', async () => {
    const cliSource = await readText('app/cli/index.ts');
    const registered = registeredCommands(cliSource);
    const docs = await readTree(path.resolve(REPO_ROOT, 'assets/skills/comet-any'));
    const referenced = new Set<string>();
    for (const content of Object.values(docs)) {
      for (const cmd of referencedCommands(content)) referenced.add(cmd);
    }
    const unregistered = [...referenced].filter((cmd) => !registered.has(cmd));
    expect(
      unregistered,
      `comet-any references unregistered commands: ${unregistered.join(', ')}`,
    ).toEqual([]);
  });

  it('documents the full six-script generated package', async () => {
    const bundleAuthoring = await readText('assets/skills/comet-any/reference/bundle-authoring.md');
    for (const script of [
      'workflow-state.mjs',
      'workflow-guard.mjs',
      'workflow-handoff.mjs',
      'comet-plan.mjs',
      'comet-check.mjs',
      'comet-hook-guard.mjs',
    ]) {
      expect(bundleAuthoring, `bundle-authoring.md missing ${script}`).toContain(script);
    }
  });

  it('keeps comet-any guidance on eval evidence, not legacy benchmark commands (en + zh)', async () => {
    for (const localeRoot of ['assets/skills/comet-any', 'assets/skills-zh/comet-any']) {
      const docs = await readTree(path.resolve(REPO_ROOT, localeRoot));
      for (const forbidden of [
        'skill-creator provider',
        'benchmark provider',
        'benchmark-plan',
        'benchmark-record',
      ]) {
        for (const [file, content] of Object.entries(docs)) {
          expect(
            content.toLowerCase(),
            `${localeRoot}/${file} still references ${forbidden}`,
          ).not.toContain(forbidden);
        }
      }
    }
  });

  it('dispatches authoring roles directly without platform capability branches (en + zh)', async () => {
    const localeRoots = ['assets/skills/comet-any', 'assets/skills-zh/comet-any'];
    const forbidden = [
      'platform supports subagents',
      'platform subagent capability',
      'platform does not support model selection',
      "current platform's subagent mechanism",
      '平台支持 subagent',
      '平台 subagent 能力',
      '平台不支持 model 选择',
      '当前平台的 subagent 机制',
      'platform-native custom agent',
    ];

    for (const localeRoot of localeRoots) {
      const docs = await readTree(path.resolve(REPO_ROOT, localeRoot));
      const combined = Object.values(docs).join('\n');
      for (const phrase of forbidden) {
        expect(combined, `${localeRoot} still branches on ${phrase}`).not.toContain(phrase);
      }
    }

    const zh = await readText('assets/skills-zh/comet-any/reference/authoring-subagents.md');
    const en = await readText('assets/skills/comet-any/reference/authoring-subagents.md');
    expect(zh).toContain('主会话按 authoring DAG 为每个 lane 派发全新的 subagent');
    expect(en).toContain('dispatches a fresh subagent for every lane in the authoring DAG');
  });

  it('generator source emits honest review evidence, not a fabricated approval', async () => {
    const packageSource = await readText('domains/factory/package.ts');
    expect(packageSource, 'generator must not fabricate review approval').not.toContain(
      'approved by deterministic workflow contract checks',
    );
    expect(packageSource, 'generator must mark honest evidence source').toContain(
      'deterministic-check-only',
    );
    for (const script of [
      'scripts/comet-plan.mjs',
      'scripts/comet-check.mjs',
      'scripts/comet-hook-guard.mjs',
      'scripts/workflow-state.mjs',
      'scripts/workflow-guard.mjs',
      'scripts/workflow-handoff.mjs',
    ]) {
      expect(packageSource, `generator missing ${script}`).toContain(script);
    }
  });
});
