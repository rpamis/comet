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
import { resolveClassicRunDirectory } from '../../../domains/comet-classic/classic-runtime-paths.js';
import { runNode, CLASSIC_SCRIPT_COMMAND_TIMEOUT } from '../../helpers/comet-test-utils.js';

// SIMULATED Agent executes the actual platform command and submits the observed result.
function runPlatformCheck(
  cwd: string,
  _retiredScript: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
  timeout?: number,
) {
  runNode(cwd, path.join(scriptsDir, 'comet-guard.mjs'), [args[1], args[2]]);
  const divider = args.indexOf('--');
  if (divider < 0) throw new Error('Actual argv required');
  const argv = args.slice(divider + 1);
  const executed = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout,
  });
  if (executed.error || executed.status === null)
    throw executed.error ?? new Error('Platform command has no exit code');
  const recorded = runNode(
    cwd,
    path.join(scriptsDir, 'comet-state.mjs'),
    [
      'record-check',
      args[1],
      args[2],
      '--command',
      JSON.stringify(argv),
      '--exit-code',
      String(executed.status),
    ],
    env,
    timeout,
  );
  expect(recorded.status, recorded.stderr).toBe(0);
  return { ...recorded, status: executed.status };
}

const scriptsDir = path.resolve('assets', 'skills', 'comet', 'scripts');
const classicRuntimeRoot = path.resolve('assets', 'skills', 'comet', 'runtime', 'classic');

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

// SIMULATED historical Compat document fixture; no accepted execution receipt is fabricated.
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
    await writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: legacy',
        '',
      ].join('\n'),
    );
    await fs.mkdir(path.join(tmpDir, 'openspec'), { recursive: true });
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'ignore' });
  });

  it('keeps the configured guard active when a standalone OpenSpec root exists', async () => {
    await createChange(
      tmpDir,
      'dual-root',
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
        'created_at: 2026-07-28',
        'verified_at: null',
        'archived: false',
        'handoff_context: null',
        'handoff_hash: null',
        '',
      ].join('\n'),
    );
    await fs.mkdir(path.join(tmpDir, 'docs', 'openspec'), { recursive: true });

    const result = runNode(
      tmpDir,
      guardScript,
      ['dual-root', 'open'],
      {},
      CLASSIC_SCRIPT_COMMAND_TIMEOUT,
    );

    expect(result.status).toBe(0);
    await expect(
      fs.stat(
        path.join(
          await resolveClassicRunDirectory(path.join(tmpDir, 'openspec', 'changes', 'dual-root')),
          '.comet',
        ),
      ),
    ).resolves.toBeDefined();
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

      const result = runNode(
        tmpDir,
        guardScript,
        ['hotfix-open-guard', 'open'],
        {},
        CLASSIC_SCRIPT_COMMAND_TIMEOUT,
      );

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

      const result = runNode(
        tmpDir,
        guardScript,
        ['full-open-guard', 'open'],
        {},
        CLASSIC_SCRIPT_COMMAND_TIMEOUT,
      );

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
          'design_doc: docs/superpowers/specs/review-off-guard.md',
          'plan: null',
          'verify_result: pending',
          'archived: false',
          '',
        ].join('\n'),
        '- [x] done <!-- comet-task:review-off-task -->\n',
      );

      const planPath = 'docs/superpowers/plans/review-off-guard.md';
      await writeFile(
        path.join(tmpDir, planPath),
        '- [x] done <!-- comet-task:review-off-task -->\n',
      );
      await writeFile(
        path.join(tmpDir, 'docs/superpowers/specs/review-off-guard.md'),
        '---\ncomet_change: review-off-guard\nrole: technical-design\ncanonical_spec: openspec\n---\n# Design\n',
      );
      await fs.appendFile(
        path.join(tmpDir, 'openspec', 'changes', 'review-off-guard', '.comet.yaml'),
        'verified_at: null\n',
      );
      const recorded = runNode(tmpDir, stateScript, ['set', 'review-off-guard', 'plan', planPath]);
      expect(recorded.status, recorded.stderr).toBe(0);
      const preparation = runNode(tmpDir, guardScript, ['review-off-guard', 'build']);
      expect(preparation.stderr).toContain('[PASS] review_mode selected');
      expect(preparation.stderr).toContain('[PASS] plan task mapping is valid');
      expect(
        runPlatformCheck(tmpDir, path.join(scriptsDir, 'comet-check.mjs'), [
          'run',
          'review-off-guard',
          'build',
          '--local',
          '--',
          process.execPath,
          '-e',
          'process.exit(0)',
        ]).status,
      ).toBe(0);

      const result = runNode(tmpDir, stateScript, [
        'transition',
        'review-off-guard',
        'build-complete',
      ]);

      expect(result.status, result.stderr).toBe(0);
      expect(
        runNode(tmpDir, stateScript, ['get', 'review-off-guard', 'review_mode']).stdout.trim(),
      ).toBe('off');
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

      await fs.appendFile(
        path.join(tmpDir, 'openspec', 'changes', 'hotfix-guard', '.comet.yaml'),
        'verified_at: null\n',
      );
      runNode(tmpDir, guardScript, ['hotfix-guard', 'build']);
      expect(
        runPlatformCheck(tmpDir, path.join(scriptsDir, 'comet-check.mjs'), [
          'run',
          'hotfix-guard',
          'build',
          '--local',
          '--',
          process.execPath,
          '-e',
          'process.exit(0)',
        ]).status,
      ).toBe(0);

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
      const argv = [process.execPath, '-e', 'process.exit(' + exitCode + ')'];
      const actual = spawnSync(argv[0], argv.slice(1), {
        cwd: tmpDir,
        encoding: 'utf8',
      });
      expect(actual.error).toBeUndefined();
      expect(actual.status).toBe(exitCode);
      return runNode(tmpDir, stateScript, [
        'record-check',
        name,
        scope,
        '--command',
        JSON.stringify(argv),
        '--exit-code',
        String(actual.status),
      ]);
    }

    it('keeps a bound_branch healed during guard --apply', async () => {
      execFileSync('git', ['switch', '-c', 'feat-x'], {
        cwd: tmpDir,
        stdio: 'ignore',
      });
      await createChange(tmpDir, 'apply-heal', buildYaml);
      await writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
      );

      const checked = runPlatformCheck(tmpDir, path.join(scriptsDir, 'comet-check.mjs'), [
        'run',
        'apply-heal',
        'build',
        '--',
        process.execPath,
        '-e',
        'process.exit(0)',
      ]);
      expect(checked.status, checked.stderr).toBe(0);
      // SIMULATED missing branch projection after the real report: --apply must heal it and reread before transition.
      const branchState = path.join(tmpDir, 'openspec/changes/apply-heal/.comet.yaml');
      await fs.writeFile(
        branchState,
        (await fs.readFile(branchState, 'utf8')).replace(
          /^bound_branch:.*$/mu,
          'bound_branch: null',
        ),
      );
      const result = runNode(
        tmpDir,
        guardScript,
        ['apply-heal', 'build', '--apply'],
        {},
        CLASSIC_SCRIPT_COMMAND_TIMEOUT,
      );

      expect(result.status, JSON.stringify({ stderr: result.stderr })).toBe(0);
      expect(result.stderr).toContain('bound_branch lazily set to feat-x');
      expect(result.stderr).toContain('[TRANSITION] build-complete');
      const yaml = await fs.readFile(
        path.join(tmpDir, 'openspec', 'changes', 'apply-heal', '.comet.yaml'),
        'utf-8',
      );
      expect(yaml).toContain('bound_branch: feat-x');
    });

    it('explains how to recover when a commandless build has no recorded evidence', async () => {
      await createChange(tmpDir, 'commandless-build', buildYaml);

      const result = runNode(tmpDir, guardScript, ['commandless-build', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('[FAIL] Build passes');
      expect(result.stderr).toContain('没有本阶段的完整检查报告');
      expect(result.stderr).toContain('Agent 平台');
    });

    it('accepts successful build evidence and prints its source, time, and command', async () => {
      await createChange(tmpDir, 'recorded-build', buildYaml);
      runNode(tmpDir, guardScript, ['recorded-build', 'build']);
      const recorded = runPlatformCheck(tmpDir, path.join(scriptsDir, 'comet-check.mjs'), [
        'run',
        'recorded-build',
        'build',
        '--local',
        '--',
        process.execPath,
        '-e',
        'process.exit(0)',
      ]);
      expect(recorded.status, recorded.stderr).toBe(0);

      const result = runNode(tmpDir, guardScript, ['recorded-build', 'build']);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('[PASS] Build passes');
      expect(result.stderr).toContain('recorded command-check');
      expect(result.stderr).toContain('process.exit(0)');
      expect(result.stderr).toMatch(/2026|2027/u);
    });

    it('accepts successful verify evidence only for the verify scope', async () => {
      await createChange(tmpDir, 'recorded-verify', verifyYaml);
      await writeFile(
        path.join(tmpDir, 'reports', 'verification.md'),
        '# Verification\n\nPassed.\n',
      );
      runNode(tmpDir, guardScript, ['recorded-verify', 'verify']);
      expect(
        runPlatformCheck(tmpDir, path.join(scriptsDir, 'comet-check.mjs'), [
          'run',
          'recorded-verify',
          'verify',
          '--local',
          '--',
          process.execPath,
          '-e',
          'process.exit(0)',
        ]).status,
      ).toBe(0);

      const result = runNode(tmpDir, guardScript, ['recorded-verify', 'verify']);

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('[PASS] Verification passes');
      expect(result.stderr).toContain('process.exit(0)');
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
      expect(result.stderr).toContain('检查未通过，退出码 7');
      expect(result.stderr).not.toContain('[PASS] Verification passes');
    });

    it('does not execute removed build_command or infer verification without a report', async () => {
      await createChange(tmpDir, 'verify-removed-build-command', verifyYaml);
      await writeFile(
        path.join(tmpDir, 'reports', 'verification.md'),
        '# Verification\n\nPassed.\n',
      );
      await writeFile(
        path.join(tmpDir, '.comet', 'config.yaml'),
        [
          'schema: comet.project.v1',
          'default_workflow: classic',
          'workflows: [classic]',
          'classic:',
          '  artifact_layout: legacy',
          'build_command: npm test',
          '',
        ].join('\n'),
      );
      await writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }),
      );

      const result = runNode(tmpDir, guardScript, ['verify-removed-build-command', 'verify']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('没有本阶段的完整检查报告');
      expect(result.stderr).not.toContain('guard auto-ran');
      expect(result.stderr).not.toContain('[PASS] Verification passes');
    });

    it('does not use verify evidence for a commandless build', async () => {
      await createChange(tmpDir, 'cross-scope', buildYaml);
      expect((await recordCheck('cross-scope', 'verify', 'pnpm test', 0)).status).toBe(0);

      const result = runNode(tmpDir, guardScript, ['cross-scope', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('没有本阶段的完整检查报告');
    });

    it('uses the latest same-run evidence even when an older check succeeded', async () => {
      await createChange(tmpDir, 'latest-build', buildYaml);
      expect((await recordCheck('latest-build', 'build', 'pnpm lint', 0)).status).toBe(0);
      expect((await recordCheck('latest-build', 'build', 'pnpm lint', 2)).status).toBe(0);

      const result = runNode(tmpDir, guardScript, ['latest-build', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('检查未通过，退出码 2');
      expect(result.stderr).toContain('检查未通过，退出码 2');
    });

    it('ignores evidence recorded for another change', async () => {
      await createChange(tmpDir, 'target-build', buildYaml);
      await createChange(tmpDir, 'other-build', buildYaml);
      expect((await recordCheck('other-build', 'build', 'pnpm lint', 0)).status).toBe(0);

      const result = runNode(tmpDir, guardScript, ['target-build', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('没有本阶段的完整检查报告');
    });

    it('ignores evidence recorded for another run', async () => {
      const changeDir = path.join(tmpDir, 'openspec', 'changes', 'other-run');
      await createChange(tmpDir, 'other-run', buildYaml);
      expect(runNode(tmpDir, guardScript, ['other-run', 'build']).status).not.toBe(0);
      const runtimeDirectory = await resolveClassicRunDirectory(changeDir);
      const run = JSON.parse(
        await fs.readFile(path.join(runtimeDirectory, '.comet', 'run-state.json'), 'utf8'),
      ) as { trajectoryRef: string };
      // SIMULATED malicious foreign-Run event: never an accepted execution receipt.
      await fs.appendFile(
        path.join(runtimeDirectory, run.trajectoryRef),
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
      expect(result.stderr).toContain('没有本阶段的完整检查报告');
    });

    it('does not let an older successful report override a real platform build failure', async () => {
      await createChange(tmpDir, 'inferred-failure', buildYaml);
      expect((await recordCheck('inferred-failure', 'build', 'pnpm lint', 0)).status).toBe(0);
      await writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ scripts: { build: 'node -e "process.exit(7)"' } }),
      );

      // SIMULATED Agent executes the project script on its platform, not through Guard.
      const actual = spawnSync(process.execPath, ['-e', 'process.exit(7)'], {
        cwd: tmpDir,
        encoding: 'utf8',
      });
      expect(actual.status).toBe(7);
      expect(
        (await recordCheck('inferred-failure', 'build', 'actual platform Node', actual.status!))
          .status,
      ).toBe(0);
      const result = runNode(tmpDir, guardScript, ['inferred-failure', 'build']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toContain('recorded command-check');
    });

    it('does not let COMET_SKIP_BUILD bypass a missing actual platform report', async () => {
      await createChange(tmpDir, 'visible-skip', buildYaml);

      const result = runNode(tmpDir, guardScript, ['visible-skip', 'build'], {
        COMET_SKIP_BUILD: '1',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('没有本阶段的完整检查报告');
      expect(result.stderr).not.toContain('[PASS] Build passes');
    });
  });
});
