/**
 * Guard tests — split from comet-scripts.test.ts for maintainability.
 *
 * Tests comet-guard.mjs phase guards: open guard (design.md skip for preset),
 * design guard (design_doc requirement), and build-complete guard (review_mode).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const scriptsDir = path.resolve('assets', 'skills', 'comet', 'scripts');
const classicRuntimeRoot = path.resolve('assets', 'skills', 'comet', 'runtime', 'classic');
const classicSkillRoot = classicRuntimeRoot;

function runNode(
  cwd: string,
  script: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = {},
  timeout?: number,
) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      COMET_RUNTIME_CLASSIC_ROOT: classicRuntimeRoot,
      COMET_CLASSIC_SKILL_ROOT: classicRuntimeRoot,
      ...env,
    },
    timeout,
  });
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function createChange(tmpDir: string, name: string, yaml: string, tasks = '- [x] done\n') {
  const changeDir = path.join(tmpDir, 'openspec', 'changes', name);
  await fs.mkdir(changeDir, { recursive: true });
  await writeFile(path.join(changeDir, '.comet.yaml'), yaml);
  await writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
  await writeFile(path.join(changeDir, 'design.md'), 'design\n');
  await writeFile(path.join(changeDir, 'tasks.md'), tasks);
}

describe('comet guard', () => {
  let tmpDir: string;
  let guardScript: string;
  let stateScript: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-guard-'));
    const tmpScriptsDir = path.join(tmpDir, 'scripts');
    await fs.mkdir(tmpScriptsDir, { recursive: true });
    for (const name of [
      'comet-runtime.mjs',
      'comet-env.mjs',
      'comet-archive.mjs',
      'comet-guard.mjs',
      'comet-handoff.mjs',
      'comet-state.mjs',
      'comet-yaml-validate.mjs',
      'comet-hook-guard.mjs',
    ]) {
      const content = await fs.readFile(path.join(scriptsDir, name), 'utf-8');
      await writeFile(path.join(tmpScriptsDir, name), content.replace(/\r\n/g, '\n'));
    }
    guardScript = path.join(tmpScriptsDir, 'comet-guard.mjs');
    stateScript = path.join(tmpScriptsDir, 'comet-state.mjs');
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
    await writeFile(path.join(tmpDir, '.openspec', 'config.yaml'), 'name: test\n');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'ignore' });
  });

  describe('guard_open skips design.md for hotfix/tweak workflows', () => {
    it('passes open guard for hotfix workflow without design.md', async () => {
      await createChange(
        tmpDir,
        'hotfix-open-guard',
        [
          'workflow: hotfix',
          'phase: open',
          'build_mode: direct',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: null',
          'isolation: branch',
          'verify_mode: light',
          'design_doc: null',
          'plan: null',
          'base_ref: null',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-17',
          'verified_at: null',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );
      await fs.rm(path.join(tmpDir, 'openspec/changes/hotfix-open-guard/design.md'));

      const result = runNode(tmpDir, guardScript, ['hotfix-open-guard', 'open'], {}, 15000);

      expect(result.status, JSON.stringify({ stderr: result.stderr, stdout: result.stdout })).toBe(
        0,
      );
      expect(result.stderr).toContain('ALL CHECKS PASSED');
    });

    it('fails open guard for full workflow without design.md', async () => {
      await createChange(
        tmpDir,
        'full-open-guard',
        [
          'workflow: full',
          'phase: open',
          'build_mode: null',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
          'design_doc: null',
          'plan: null',
          'base_ref: null',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-17',
          'verified_at: null',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );
      await fs.rm(path.join(tmpDir, 'openspec/changes/full-open-guard/design.md'));

      const result = runNode(tmpDir, guardScript, ['full-open-guard', 'open'], {}, 15000);

      expect(
        result.status,
        JSON.stringify({ stderr: result.stderr, stdout: result.stdout }),
      ).not.toBe(0);
      expect(result.stderr).toContain('[FAIL] design.md exists and non-empty');
    });
  });

  describe('design guard requires design_doc for full workflow', () => {
    it('fails design guard for full workflow without design_doc', async () => {
      await createChange(
        tmpDir,
        'no-designdoc',
        [
          'workflow: full',
          'phase: design',
          'build_mode: null',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
          'design_doc: null',
          'plan: null',
          'base_ref: null',
          'verify_result: pending',
          'verification_report: null',
          'branch_status: pending',
          'created_at: 2026-06-04',
          'verified_at: null',
          'archived: false',
          'handoff_context: null',
          'handoff_hash: null',
          '',
        ].join('\n'),
      );

      const result = runNode(tmpDir, guardScript, ['no-designdoc', 'design']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('[FAIL] design_doc is recorded for full workflow');
    });
  });

  describe('build-complete review_mode guard', () => {
    it('blocks build-complete when review_mode is null for full workflow', async () => {
      await createChange(
        tmpDir,
        'no-review-guard',
        [
          'workflow: full',
          'phase: build',
          'build_mode: executing-plans',
          'build_pause: null',
          'tdd_mode: tdd',
          'isolation: branch',
          'verify_mode: light',
          'review_mode: null',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runNode(tmpDir, stateScript, [
        'transition',
        'no-review-guard',
        'build-complete',
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('review_mode must be selected');
    });

    it('allows build-complete when review_mode is off for full workflow', async () => {
      await createChange(
        tmpDir,
        'review-off-guard',
        [
          'workflow: full',
          'phase: build',
          'build_mode: executing-plans',
          'build_pause: null',
          'tdd_mode: tdd',
          'isolation: branch',
          'verify_mode: light',
          'review_mode: off',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runNode(tmpDir, stateScript, [
        'transition',
        'review-off-guard',
        'build-complete',
      ]);

      expect(result.status).toBe(0);
    });

    it('allows build-complete without review_mode for hotfix workflow', async () => {
      await createChange(
        tmpDir,
        'hotfix-guard',
        [
          'workflow: hotfix',
          'phase: build',
          'build_mode: direct',
          'build_pause: null',
          'tdd_mode: direct',
          'isolation: branch',
          'verify_mode: light',
          'review_mode: off',
          'design_doc: null',
          'plan: null',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
      );

      const result = runNode(tmpDir, stateScript, ['transition', 'hotfix-guard', 'build-complete']);

      expect(result.status).toBe(0);
    });
  });
});
