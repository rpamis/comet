import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveClassicStateFile } from '../../../domains/workflow-contract/classic-state-file.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';

const router = path.resolve('assets/skills/comet/scripts/comet-hook-router.mjs');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function fixture(
  layout: 'legacy' | 'docs',
  language: 'en' | 'zh-CN',
  runtime: 'compat' | 'sdk' = 'compat',
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-design-summary-'));
  temporary.push(root);
  const changes = layout === 'docs' ? 'docs/openspec/changes' : 'openspec/changes';
  const change = 'specified-qualified-bonuses';
  const changeDir = path.join(root, changes, change);
  await fs.mkdir(path.join(root, '.comet'), { recursive: true });
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(
    path.join(root, '.comet/config.yaml'),
    `schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: ${layout}\n  language: ${language}\n  document_evidence: strict\n`,
  );
  const cli = (command: string, ...args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [path.resolve(`assets/skills/comet/scripts/comet-${command}.mjs`), '--json', ...args],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
    return JSON.parse(result.stdout);
  };
  if (runtime === 'sdk') {
    const git = spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
    expect(git.status, git.stderr).toBe(0);
  }
  cli('state', 'init', change, 'full', '--runtime', runtime, '--isolation', 'current');
  for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
    await fs.writeFile(
      path.join(changeDir, file),
      file === 'tasks.md'
        ? '- [ ] Preserve existing requirements\n'
        : '# Existing approved requirements\n',
    );
  }
  if (runtime === 'sdk') {
    const preview = cli('guard', change, 'open');
    // SIMULATED test-user approval applies only to this isolated fixture's Open proposal.
    cli('guard', change, 'open', '--apply', '--approval-hash', preview.data.approvalHash);
  } else {
    cli('state', 'transition', change, 'open-complete');
  }
  cli('state', 'select', change);
  const stateFile = await resolveClassicStateFile(changeDir);
  const state = await fs.readFile(stateFile, 'utf8');
  const checkpoint = `${changes}/${change}/.comet/handoff/brainstorm-summary.md`;
  const invoke = (targets: string[], patch = false) => {
    const input = patch
      ? {
          tool_name: 'apply_patch',
          tool_input: `*** Begin Patch\n${targets.map((target) => `*** Add File: ${path.join(root, target)}\n+# Candidate\n`).join('')}*** End Patch\n`,
        }
      : {
          tool_name: 'Write',
          tool_input: { file_path: path.join(root, targets[0]), content: '# Candidate\n' },
        };
    const result = spawnSync(
      process.execPath,
      [router, '--platform', 'github-copilot', '--project-root', root],
      { cwd: root, input: JSON.stringify(input), encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as {
      permissionDecision?: string;
      permissionDecisionReason?: string;
    };
  };
  return { root, changes, change, changeDir, checkpoint, stateFile, state, invoke, cli };
}

describe('Classic Design summary checkpoint', () => {
  it.each([
    ['legacy', 'en'],
    ['legacy', 'zh-CN'],
    ['docs', 'en'],
    ['docs', 'zh-CN'],
  ] as const)(
    'recovers a misplaced summary without advancing Design (%s, %s)',
    async (layout, language) => {
      const f = await fixture(layout, language);
      for (const patch of [false, true]) {
        const denied = f.invoke([`${f.changes}/${f.change}/brainstorm-summary.md`], patch);
        expect(denied.permissionDecision).toBe('deny');
        expect(denied.permissionDecisionReason).toContain(f.checkpoint);
        expect(denied.permissionDecisionReason).not.toContain('source writes are not allowed');
        expect(denied.permissionDecisionReason).not.toContain('--apply');
        expect(denied.permissionDecisionReason).toContain(
          language === 'zh-CN' ? '保留 Design 阶段' : 'keep the Design phase',
        );
        expect(f.invoke([f.checkpoint], patch).permissionDecision).toBeUndefined();
        expect(f.invoke(['src/feature.ts'], patch).permissionDecision).toBe('deny');
      }
      await fs.mkdir(path.dirname(path.join(f.root, f.checkpoint)), { recursive: true });
      await fs.writeFile(path.join(f.root, f.checkpoint), '# Candidate\n');
      expect(f.invoke([f.checkpoint]).permissionDecision).toBeUndefined();
      expect(await fs.readFile(path.join(f.root, f.checkpoint), 'utf8')).toBe('# Candidate\n');
      expect(await fs.readFile(f.stateFile, 'utf8')).toBe(f.state);
    },
  );

  it('rejects mixed implementation patches and foreign or archived summary checkpoints', async () => {
    const f = await fixture('docs', 'zh-CN');
    expect(f.invoke([f.checkpoint, 'src/feature.ts'], true).permissionDecision).toBe('deny');
    const foreign = path.join(f.root, f.changes, 'other');
    await fs.mkdir(foreign, { recursive: true });
    await fs.writeFile(path.join(foreign, '.comet.yaml'), f.state);
    for (const target of [
      `${f.changes}/other/.comet/handoff/brainstorm-summary.md`,
      `${f.changes}/archive/2026-11-15-${f.change}/.comet/handoff/brainstorm-summary.md`,
    ]) {
      expect(f.invoke([target]).permissionDecision).toBe('deny');
    }
    expect(f.invoke([f.checkpoint]).permissionDecision).toBeUndefined();
    expect(await fs.readFile(f.stateFile, 'utf8')).toBe(f.state);
  });

  it('preserves the original SDK Design Wait and approval while saving candidate summaries', async () => {
    const f = await fixture('docs', 'zh-CN', 'sdk');
    f.cli(
      'state',
      'propose-design',
      f.change,
      '--proposal',
      'Candidate: retain existing requirements.',
    );
    const before = (await inspectClassicSdkRun(f.root, f.change, { readOnly: true })).run;
    expect(before.status).toBe('waiting');
    expect(
      f.invoke([`${f.changes}/${f.change}/brainstorm-summary.md`]).permissionDecisionReason,
    ).toContain(f.checkpoint);
    expect(f.invoke([f.checkpoint], true).permissionDecision).toBeUndefined();
    await fs.mkdir(path.dirname(path.join(f.root, f.checkpoint)), { recursive: true });
    await fs.writeFile(path.join(f.root, f.checkpoint), '# Candidate awaiting decision\n');
    expect(f.invoke([f.checkpoint]).permissionDecision).toBeUndefined();
    expect(f.invoke(['src/feature.ts'], true).permissionDecision).toBe('deny');
    const after = (await inspectClassicSdkRun(f.root, f.change, { readOnly: true })).run;
    expect(after).toEqual(before);
  });
});
