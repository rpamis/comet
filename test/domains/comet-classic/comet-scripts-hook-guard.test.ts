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

async function createChange(tmpDir: string, name: string, yaml: string, tasks = '- [x] done\n') {
  const changeDir = path.join(tmpDir, 'openspec', 'changes', name);
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
    hookGuardScript = path.resolve(scriptsDir, 'comet-hook-guard.mjs');
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
    await writeFile(path.join(tmpDir, '.openspec', 'config.yaml'), 'name: test\n');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'ignore' });
  });

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

    it('allows full-workflow build source writes once design_doc points to a file', async () => {
      await createChange(
        tmpDir,
        'full-build-with-doc',
        [
          'workflow: full',
          'phase: build',
          'design_doc: docs/superpowers/design.md',
          'archived: false',
          '',
        ].join('\n'),
      );
      await writeFile(path.join(tmpDir, 'docs/superpowers/design.md'), '# Design Doc\n');

      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'feature.ts');

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
