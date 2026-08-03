/**
 * Hook guard tests — split from comet-scripts.test.ts for maintainability.
 *
 * Tests the PreToolUse hook guard (comet-hook-guard.mjs) that blocks or allows
 * source writes based on the current change's phase and workflow.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const scriptsDir = path.resolve('assets', 'skills', 'comet', 'scripts');
const classicRuntimeRoot = path.resolve('assets', 'skills', 'comet', 'runtime', 'classic');
const classicSkillRoot = classicRuntimeRoot;

function posixPath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/');
}

function runNode(cwd: string, script: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      COMET_RUNTIME_CLASSIC_ROOT: classicRuntimeRoot,
      COMET_CLASSIC_SKILL_ROOT: classicRuntimeRoot,
      ...env,
    },
  });
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function runHookGuard(
  cwd: string,
  script: string,
  stdin: string,
  env: NodeJS.ProcessEnv = {},
  args: string[] = [],
) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    input: stdin,
    env: {
      ...process.env,
      COMET_RUNTIME_CLASSIC_ROOT: classicRuntimeRoot,
      COMET_CLASSIC_SKILL_ROOT: classicRuntimeRoot,
      ...env,
    },
  });
}

function hookStdin(filePath: string): string {
  return JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: '// test' },
  });
}

async function createChange(
  tmpDir: string,
  name: string,
  yaml: string,
  tasks = '- [x] done\n',
  artifactLayout: 'legacy' | 'docs' = 'legacy',
) {
  const changeDir = path.join(
    tmpDir,
    ...(artifactLayout === 'docs' ? ['docs', 'openspec'] : ['openspec']),
    'changes',
    name,
  );
  await fs.mkdir(changeDir, { recursive: true });
  await writeFile(path.join(changeDir, '.comet.yaml'), yaml);
  await writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
  await writeFile(path.join(changeDir, 'design.md'), 'design\n');
  await writeFile(path.join(changeDir, 'tasks.md'), tasks);
}

describe('hook guard', () => {
  let tmpDir: string;
  let hookGuardScript: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-guard-'));
    await prepareClassicLegacyProject(tmpDir);
    hookGuardScript = path.resolve(scriptsDir, 'comet-hook-guard.mjs');
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
    await writeFile(path.join(tmpDir, '.openspec', 'config.yaml'), 'name: test\n');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'ignore' });
  });

  it('derives all governed Superpowers artifact directories from the Classic layout resolver', async () => {
    const source = await fs.readFile(
      path.resolve('domains', 'comet-classic', 'classic-hook-guard.ts'),
      'utf8',
    );

    expect(source).toContain('layout.superpowersRoot');
    expect(source).toContain('layout.superpowersSpecsDir');
    expect(source).toContain('layout.superpowersPlansDir');
    expect(source).toContain('layout.superpowersReportsDir');
    expect(source).not.toMatch(/prefix:\s*['"]docs\/superpowers\//u);
    expect(source).not.toMatch(/startsWith\(['"]docs\/superpowers\//u);
  });

  it.each(['legacy', 'docs'] as const)(
    'governs a resolved Superpowers design artifact in the %s layout',
    async (artifactLayout) => {
      if (artifactLayout === 'docs') {
        await fs.rm(path.join(tmpDir, 'openspec'), { recursive: true, force: true });
        await writeFile(
          path.join(tmpDir, '.comet', 'config.yaml'),
          [
            'schema: comet.project.v1',
            'default_workflow: classic',
            'workflows: [classic]',
            'classic:',
            '  artifact_layout: docs',
            '',
          ].join('\n'),
        );
        await writeFile(
          path.join(tmpDir, 'docs', 'openspec', 'config.yaml'),
          'schema: spec-driven\n',
        );
      }
      await createChange(
        tmpDir,
        'layout-design',
        [
          'workflow: full',
          'phase: design',
          'context_compression: off',
          'build_mode: null',
          'build_pause: null',
          'subagent_dispatch: null',
          'tdd_mode: null',
          'isolation: null',
          'verify_mode: null',
          'base_ref: null',
          'design_doc: null',
          'plan: null',
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
        '- [x] done\n',
        artifactLayout,
      );
      const targetFile = path.join(tmpDir, 'docs', 'superpowers', 'specs', 'layout-design.md');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain('(phase: design, superpowers)');
    },
    20_000,
  );

  describe('blocks source writes during non-build phases', () => {
    it('blocks source writes during open phase', async () => {
      await createChange(tmpDir, 'test-open', 'phase: open\narchived: false\n');

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'new-feature.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('BLOCKED');
    }, 20_000);

    it('uses project root when the hook runs from a git submodule directory', async () => {
      await createChange(tmpDir, 'submodule-open', 'phase: open\narchived: false\n');

      const submoduleDir = path.join(tmpDir, 'front');
      const srcDir = path.join(submoduleDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'new-feature.ts');

      const result = runHookGuard(submoduleDir, hookGuardScript, hookStdin(targetFile), {}, [
        '--project-root',
        tmpDir,
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('BLOCKED');
      expect(result.stderr).toContain('Target file: front/src/new-feature.ts');
    }, 20_000);
  });

  describe('allows source writes during build phase', () => {
    it('allows preset-workflow build source writes when design_doc is null', async () => {
      await createChange(
        tmpDir,
        'hotfix-build-no-doc',
        ['workflow: hotfix', 'phase: build', 'design_doc: null', 'archived: false', ''].join('\n'),
      );

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'fix.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);

    it('blocks full-workflow build source writes until a plan is recorded', async () => {
      await createChange(
        tmpDir,
        'full-build-without-plan',
        [
          'workflow: full',
          'phase: build',
          'build_mode: executing-plans',
          'isolation: branch',
          'verify_mode: null',
          'design_doc: docs/superpowers/design.md',
          'plan: null',
          'verify_result: pending',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );
      await writeFile(path.join(tmpDir, 'docs/superpowers/design.md'), '# Design Doc\n');

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'feature.ts');

      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('ERROR_CODE: classic-build-plan-missing');
      expect(result.stderr).toContain('CHANGE: full-build-without-plan');
      expect(result.stderr).toContain('TARGET: src/feature.ts');
      expect(result.stderr).toContain(
        'comet state set full-build-without-plan plan <repository-relative-plan-path>',
      );
      expect(result.stderr).toContain('comet state check full-build-without-plan build --recover');
      expect(result.stderr).toContain('SUCCESS:');
      expect(result.stderr).toContain('RETRY:');
    }, 20_000);

    it('allows full-workflow build source writes once design_doc and plan are ready', async () => {
      await createChange(
        tmpDir,
        'full-build-ready',
        [
          'workflow: full',
          'phase: build',
          'build_mode: executing-plans',
          'isolation: branch',
          'verify_mode: null',
          'design_doc: docs/superpowers/design.md',
          'plan: docs/superpowers/plans/ready.md',
          'verify_result: pending',
          'verified_at: null',
          'archived: false',
          '',
        ].join('\n'),
      );
      await writeFile(path.join(tmpDir, 'docs/superpowers/design.md'), '# Design Doc\n');
      await writeFile(
        path.join(tmpDir, 'docs/superpowers/plans/ready.md'),
        '- [ ] implementation task\n',
      );

      const targetFile = path.join(tmpDir, 'src', 'feature.ts');
      const result = runHookGuard(tmpDir, hookGuardScript, hookStdin(targetFile));

      expect(result.status).toBe(0);
    }, 20_000);
  });

  describe('Edit tool governance', () => {
    it('blocks source edits during open phase same as Write', async () => {
      await createChange(tmpDir, 'edit-block-open', 'phase: open\narchived: false\n');

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'new-feature.ts');

      const editStdin = JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: targetFile, old_string: 'old', new_string: 'new' },
      });

      const result = runHookGuard(tmpDir, hookGuardScript, editStdin);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('BLOCKED');
    }, 20_000);

    it('allows source edits during build phase', async () => {
      await createChange(
        tmpDir,
        'edit-allow-build',
        ['workflow: hotfix', 'phase: build', 'design_doc: null', 'archived: false', ''].join('\n'),
      );

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'fix.ts');

      const editStdin = JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: targetFile, old_string: 'bug', new_string: 'fix' },
      });

      const result = runHookGuard(tmpDir, hookGuardScript, editStdin);

      expect(result.status).toBe(0);
    }, 20_000);
  });
});
