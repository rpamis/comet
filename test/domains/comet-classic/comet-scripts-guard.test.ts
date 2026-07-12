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

  describe('recorded command-check evidence', () => {
    const buildYaml = [
      'workflow: hotfix',
      'phase: build',
      'build_mode: direct',
      'build_pause: null',
      'subagent_dispatch: null',
      'tdd_mode: direct',
      'review_mode: off',
      'isolation: branch',
      'verify_mode: light',
      'design_doc: null',
      'plan: null',
      'base_ref: null',
      'verify_result: pending',
      'verification_report: null',
      'branch_status: pending',
      'created_at: 2026-07-11',
      'verified_at: null',
      'archived: false',
      'auto_transition: true',
      '',
    ].join('\n');

    const verifyYaml = [
      'workflow: hotfix',
      'phase: verify',
      'build_mode: direct',
      'build_pause: null',
      'subagent_dispatch: null',
      'tdd_mode: direct',
      'review_mode: off',
      'isolation: branch',
      'verify_mode: light',
      'design_doc: null',
      'plan: null',
      'base_ref: null',
      'verify_result: pending',
      'verification_report: reports/verification.md',
      'branch_status: handled',
      'created_at: 2026-07-11',
      'verified_at: null',
      'archived: false',
      'auto_transition: true',
      '',
    ].join('\n');

    async function recordCheck(
      name: string,
      scope: 'build' | 'verify',
      command: string,
      exitCode: number,
    ) {
      runNode(tmpDir, guardScript, [name, scope]);
      return runNode(tmpDir, stateScript, [
        'record-check',
        name,
        scope,
        '--command',
        command,
        '--exit-code',
        String(exitCode),
      ]);
    }

    it('explains how to recover when a commandless build has no recorded evidence', async () => {
      await createChange(tmpDir, 'commandless-build', buildYaml);

      const result = runNode(tmpDir, guardScript, ['commandless-build', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('[FAIL] Build passes');
      expect(result.stderr).toContain('No inferred build command or recorded build check');
      expect(result.stderr).toContain(
        'comet state record-check commandless-build build --command "<command>" --exit-code 0',
      );
    });

    it('accepts successful build evidence and prints its source, time, and command', async () => {
      await createChange(tmpDir, 'recorded-build', buildYaml);
      const recorded = await recordCheck('recorded-build', 'build', 'pnpm lint', 0);
      expect(recorded.status, recorded.stderr).toBe(0);

      const result = runNode(tmpDir, guardScript, ['recorded-build', 'build']);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('[PASS] Build passes');
      expect(result.stderr).toContain('recorded command-check');
      expect(result.stderr).toContain('pnpm lint');
      expect(result.stderr).toMatch(/2026|2027/u);
    });

    it('accepts successful verify evidence only for the verify scope', async () => {
      await createChange(tmpDir, 'recorded-verify', verifyYaml);
      await writeFile(
        path.join(tmpDir, 'reports', 'verification.md'),
        '# Verification\n\nPassed.\n',
      );
      expect((await recordCheck('recorded-verify', 'verify', 'pnpm test', 0)).status).toBe(0);

      const result = runNode(tmpDir, guardScript, ['recorded-verify', 'verify']);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('[PASS] Verification passes');
      expect(result.stderr).toContain('pnpm test');
    });

    it('requires recorded verify evidence even when an inferred build succeeds', async () => {
      await createChange(tmpDir, 'verify-not-build', verifyYaml);
      await writeFile(
        path.join(tmpDir, 'reports', 'verification.md'),
        '# Verification\n\nFailed.\n',
      );
      await writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
      );
      expect((await recordCheck('verify-not-build', 'verify', 'pnpm test', 7)).status).toBe(0);

      const result = runNode(tmpDir, guardScript, ['verify-not-build', 'verify']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Latest recorded verify check failed with exit code 7');
      expect(result.stderr).not.toContain('[PASS] Verification passes');
    });

    it('rejects removed build_command before verify inference or evidence consumption', async () => {
      await createChange(tmpDir, 'verify-removed-build-command', verifyYaml);
      await writeFile(
        path.join(tmpDir, 'reports', 'verification.md'),
        '# Verification\n\nPassed.\n',
      );
      await writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'build_command: npm test\n');
      await writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
      );

      const result = runNode(tmpDir, guardScript, ['verify-removed-build-command', 'verify']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('build_command has been removed');
      expect(result.stderr).not.toContain('[PASS] Verification passes');
    });

    it('does not use verify evidence for a commandless build', async () => {
      await createChange(tmpDir, 'cross-scope', buildYaml);
      expect((await recordCheck('cross-scope', 'verify', 'pnpm test', 0)).status).toBe(0);

      const result = runNode(tmpDir, guardScript, ['cross-scope', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('No inferred build command or recorded build check');
    });

    it('uses the latest same-run evidence even when an older check succeeded', async () => {
      await createChange(tmpDir, 'latest-build', buildYaml);
      expect((await recordCheck('latest-build', 'build', 'pnpm lint', 0)).status).toBe(0);
      expect((await recordCheck('latest-build', 'build', 'pnpm lint', 2)).status).toBe(0);

      const result = runNode(tmpDir, guardScript, ['latest-build', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Latest recorded build check failed with exit code 2');
      expect(result.stderr).toContain(
        'comet state record-check latest-build build --command "pnpm lint" --exit-code 0',
      );
    });

    it('ignores evidence recorded for another change', async () => {
      await createChange(tmpDir, 'target-build', buildYaml);
      await createChange(tmpDir, 'other-build', buildYaml);
      expect((await recordCheck('other-build', 'build', 'pnpm lint', 0)).status).toBe(0);

      const result = runNode(tmpDir, guardScript, ['target-build', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('No inferred build command or recorded build check');
    });

    it('ignores evidence recorded for another run', async () => {
      const changeDir = path.join(tmpDir, 'openspec', 'changes', 'other-run');
      await createChange(tmpDir, 'other-run', buildYaml);
      expect(runNode(tmpDir, guardScript, ['other-run', 'build']).status).not.toBe(0);
      const run = JSON.parse(
        await fs.readFile(path.join(changeDir, '.comet', 'run-state.json'), 'utf8'),
      ) as { trajectoryRef: string };
      await fs.appendFile(
        path.join(changeDir, run.trajectoryRef),
        `${JSON.stringify({
          sequence: 999,
          timestamp: '2026-07-11T00:00:00.000Z',
          type: 'command_check_recorded',
          runId: 'another-run',
          data: { scope: 'build', command: 'pnpm lint', exitCode: 0, cwd: '.' },
        })}\n`,
      );

      const result = runNode(tmpDir, guardScript, ['other-run', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('No inferred build command or recorded build check');
    });

    it('does not let successful stored evidence override an inferred npm failure', async () => {
      await createChange(tmpDir, 'inferred-failure', buildYaml);
      expect((await recordCheck('inferred-failure', 'build', 'pnpm lint', 0)).status).toBe(0);
      await writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ scripts: { build: 'node -e "process.exit(7)"' } }),
      );

      const result = runNode(tmpDir, guardScript, ['inferred-failure', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toContain('recorded command-check');
    });

    it('makes COMET_SKIP_BUILD visible instead of reporting an ordinary silent pass', async () => {
      await createChange(tmpDir, 'visible-skip', buildYaml);

      const result = runNode(tmpDir, guardScript, ['visible-skip', 'build'], {
        COMET_SKIP_BUILD: '1',
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('SKIPPED via COMET_SKIP_BUILD=1');
    });
  });
});
