import { resolveWorkspaceRuntimeRoot } from '../../../domains/workflow-contract/workspace-runtime.js';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { classicStateCommand } from '../../../domains/comet-classic/classic-state-command.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  createNativeChange,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { selectNativeChange } from '../../../domains/comet-native/native-selection.js';

const router = path.resolve('assets', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs');

describe('packaged Hook Router worktree isolation', () => {
  let primary: string;
  let secondary: string;

  beforeEach(async () => {
    const tmpRoot = await fs.realpath(os.tmpdir());
    primary = await fs.mkdtemp(path.join(tmpRoot, 'comet-router-runtime-primary-'));
    secondary = path.join(
      tmpRoot,
      `comet-router-runtime-secondary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const git = (...args: string[]) =>
      spawnSync('git', ['-C', primary, ...args], { encoding: 'utf8', timeout: 20_000 });
    expect(git('init', '-b', 'master').status).toBe(0);
    expect(git('config', 'user.email', 'router@example.com').status).toBe(0);
    expect(git('config', 'user.name', 'Router Test').status).toBe(0);
    expect(git('config', 'commit.gpgsign', 'false').status).toBe(0);
    await fs.writeFile(path.join(primary, 'README.md'), '# worktree\n');
    expect(git('add', 'README.md').status).toBe(0);
    expect(git('commit', '-m', 'initial').status).toBe(0);
    expect(git('worktree', 'add', secondary, '-b', 'feature/router-runtime').status).toBe(0);
  });

  afterEach(async () => {
    spawnSync('git', ['-C', primary, 'worktree', 'remove', '--force', secondary], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    await fs.rm(secondary, { recursive: true, force: true });
    await fs.rm(primary, { recursive: true, force: true });
  });

  async function configureChange(
    projectRoot: string,
    name: string,
    phase: 'shape' | 'build',
  ): Promise<void> {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    await ensureNativeDirectories(paths);
    const change = await createNativeChange({
      paths,
      name,
      language: 'en',
      verificationProtocol: 'legacy-v1',
    });
    change.phase = phase;
    await writeNativeChange(paths, change);
    await selectNativeChange(paths, name);
  }

  it.each(['project', 'global'] as const)(
    'blocks direct Runtime writes through the %s Router with no selected change',
    async (scope) => {
      const routerArgs = [
        router,
        '--platform',
        'codex',
        ...(scope === 'project' ? ['--project-root', primary] : []),
      ];
      const runtimeRoot = await resolveWorkspaceRuntimeRoot(primary);
      await fs.rm(path.join(primary, '.comet'), { recursive: true, force: true });
      for (const ref of [
        'native/changes/example/state.json',
        'sdk-runs/classic/run.json',
        'applications/custom/run.json',
      ]) {
        const result = spawnSync(process.execPath, routerArgs, {
          cwd: primary,
          input: JSON.stringify({
            tool_name: 'Write',
            cwd: primary,
            tool_input: { file_path: path.join(runtimeRoot, ref) },
          }),
          encoding: 'utf8',
          timeout: 20_000,
        });
        expect(result.status, result.stderr).toBe(2);
        expect(result.stderr).toContain('Runtime-owned');
      }
      const linkedRoot = await resolveWorkspaceRuntimeRoot(secondary);
      await fs.rm(path.join(secondary, '.comet'), { recursive: true, force: true });
      const linked = spawnSync(process.execPath, routerArgs, {
        cwd: primary,
        input: JSON.stringify({
          tool_name: 'Write',
          cwd: secondary,
          tool_input: { file_path: path.join(linkedRoot, 'native/state.json') },
        }),
        encoding: 'utf8',
        timeout: 20_000,
      });
      expect(linked.status, linked.stderr).toBe(2);
      expect(linked.stderr).toContain('Runtime-owned');
    },
  );

  it.each([
    ['primary', 'runtime'],
    ['primary', 'project-subdirectory'],
    ['linked', 'runtime'],
    ['linked', 'project-subdirectory'],
  ])(
    'blocks relative Runtime writes from the %s %s cwd without selection',
    async (owner, cwdKind) => {
      const projectRoot = owner === 'primary' ? primary : secondary;
      const runtimeRoot = await resolveWorkspaceRuntimeRoot(projectRoot);
      const cwd = cwdKind === 'runtime' ? runtimeRoot : path.join(projectRoot, 'nested');
      await fs.mkdir(cwd, { recursive: true });
      const result = spawnSync(
        process.execPath,
        [router, '--platform', 'codex', '--project-root', primary],
        {
          cwd: primary,
          input: JSON.stringify({
            tool_name: 'Write',
            cwd,
            tool_input: {
              file_path: path.relative(
                cwd,
                path.join(runtimeRoot, 'native/changes/example/checkpoint.json'),
              ),
            },
          }),
          encoding: 'utf8',
          timeout: 20_000,
        },
      );
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain('Runtime-owned');
    },
  );

  it('keeps the explicit relative base when Runtime belongs to a nested linked worktree', async () => {
    const nestedSecondary = path.join(primary, 'nested', 'worktree');
    await fs.mkdir(path.dirname(nestedSecondary), { recursive: true });
    const moved = spawnSync(
      'git',
      ['-C', primary, 'worktree', 'move', secondary, nestedSecondary],
      {
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    expect(moved.status, moved.stderr).toBe(0);
    secondary = nestedSecondary;
    const runtimeRoot = await resolveWorkspaceRuntimeRoot(secondary);
    const result = spawnSync(
      process.execPath,
      [router, '--platform', 'codex', '--project-root', primary],
      {
        cwd: primary,
        input: JSON.stringify({
          tool_name: 'Write',
          tool_input: {
            file_path: path.relative(primary, path.join(runtimeRoot, 'native/checkpoint.json')),
          },
        }),
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('Runtime-owned');
  });

  it('uses the linked worktree state even when the installed command still names the primary root', async () => {
    await configureChange(primary, 'primary-shape', 'shape');
    await configureChange(secondary, 'secondary-build', 'build');
    const payload = JSON.stringify({
      tool_name: 'Write',
      cwd: secondary,
      tool_input: { file_path: 'src/app.ts' },
    });

    const linked = spawnSync(
      process.execPath,
      [router, '--platform', 'codex', '--project-root', primary],
      { cwd: primary, input: payload, encoding: 'utf8', timeout: 20_000 },
    );
    const primaryRequest = spawnSync(
      process.execPath,
      [router, '--platform', 'codex', '--project-root', primary],
      {
        cwd: primary,
        input: JSON.stringify({
          tool_name: 'Write',
          cwd: primary,
          tool_input: { file_path: 'src/app.ts' },
        }),
        encoding: 'utf8',
        timeout: 20_000,
      },
    );

    expect(linked.status, linked.stderr).toBe(0);
    expect(primaryRequest.status).toBe(2);
    expect(primaryRequest.stderr).toContain('primary-shape');
  });

  it('uses the host working directory for a legacy global Router invocation', async () => {
    await configureChange(primary, 'primary-shape', 'shape');
    const payload = JSON.stringify({
      tool_name: 'Write',
      cwd: secondary,
      tool_input: { file_path: 'src/app.ts' },
    });

    const result = spawnSync(process.execPath, [router, '--platform', 'codex'], {
      cwd: primary,
      input: payload,
      encoding: 'utf8',
      timeout: 20_000,
    });

    expect(result.status, result.stderr).toBe(0);
  });

  it('keeps a legacy global Router neutral when the host omits its working directory', async () => {
    await configureChange(primary, 'primary-shape', 'shape');
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/app.ts',
      '@@',
      '-old',
      '+new',
      '*** End Patch',
    ].join('\n');

    const result = spawnSync(process.execPath, [router, '--platform', 'codex'], {
      cwd: primary,
      input: patch,
      encoding: 'utf8',
      timeout: 20_000,
    });

    expect(result.status, result.stderr).toBe(0);
  });

  it('enforces Native Shape for raw Codex apply_patch input', async () => {
    await configureChange(primary, 'raw-patch-shape', 'shape');
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/app.ts',
      '@@',
      '-old',
      '+new',
      '*** End Patch',
    ].join('\n');

    const result = spawnSync(
      process.execPath,
      [router, '--platform', 'codex', '--project-root', primary],
      { cwd: primary, input: patch, encoding: 'utf8', timeout: 20_000 },
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('raw-patch-shape');
    expect(result.stderr).toContain('only allowed in Build');
  });

  it('routes a linked worktree SDK Native change through the packaged Hook', async () => {
    const created = await runNativeCli([
      'new',
      'sdk-linked',
      '--runtime',
      'sdk',
      '--project-root',
      secondary,
      '--json',
    ]);
    expect(created.exitCode, created.stderr).toBe(0);
    const payload = JSON.stringify({
      tool_name: 'Write',
      cwd: secondary,
      tool_input: { file_path: 'src/app.ts' },
    });

    const result = spawnSync(
      process.execPath,
      [router, '--platform', 'codex', '--project-root', primary],
      { cwd: primary, input: payload, encoding: 'utf8', timeout: 20_000 },
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('sdk-linked');
  });

  it('routes a linked worktree SDK Classic change through the packaged Hook', async () => {
    await fs.mkdir(path.join(secondary, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(secondary, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    await fs.mkdir(path.join(secondary, 'openspec', 'changes'), { recursive: true });
    const created = await classicStateCommand(
      ['init', 'sdk-classic-linked', 'hotfix', '--runtime', 'sdk', '--isolation', 'current'],
      { json: false, invocationCwd: secondary, projectRoot: secondary },
    );
    expect(created.exitCode, created.stderr).toBe(0);

    const result = spawnSync(
      process.execPath,
      [router, '--platform', 'codex', '--project-root', primary],
      {
        cwd: primary,
        input: JSON.stringify({
          tool_name: 'Write',
          cwd: secondary,
          tool_input: { file_path: 'src/app.ts' },
        }),
        encoding: 'utf8',
        timeout: 20_000,
      },
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('sdk-classic-linked');
  });

  it('executes Native artifact attribution and recovery through the packaged Router', async () => {
    await writeProjectConfig(primary, defaultProjectConfig('docs'));
    const unregistered = spawnSync(
      process.execPath,
      [router, '--platform', 'codex', '--project-root', primary],
      {
        cwd: primary,
        input: JSON.stringify({
          tool_name: 'Write',
          cwd: primary,
          tool_input: { file_path: 'docs/comet/changes/new-change/brief.md' },
        }),
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    const unownedLookalike = spawnSync(
      process.execPath,
      [router, '--platform', 'codex', '--project-root', primary],
      {
        cwd: primary,
        input: JSON.stringify({
          tool_name: 'Write',
          cwd: primary,
          tool_input: { file_path: '.comet/comet/changes/fake/brief.md' },
        }),
        encoding: 'utf8',
        timeout: 20_000,
      },
    );

    expect(unregistered.status).toBe(2);
    expect(unregistered.stderr).toContain('comet native new new-change');
    expect(unregistered.stderr).toContain('data.artifacts.briefPath');
    expect(unownedLookalike.status, unownedLookalike.stderr).toBe(0);
  });

  it.each(['trae', 'trae-cn', 'dsh'] as const)(
    'enforces Native Shape for %s write payloads through the packaged router',
    async (platform) => {
      await configureChange(primary, `${platform}-shape`, 'shape');
      const payload = JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: `src/${platform}.ts` },
      });

      const result = spawnSync(
        process.execPath,
        [router, '--platform', platform, '--project-root', primary],
        { cwd: primary, input: payload, encoding: 'utf8', timeout: 20_000 },
      );

      if (platform === 'dsh') {
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout).hookSpecificOutput).toMatchObject({
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: expect.stringContaining('only allowed in Build'),
        });
        expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toContain(
          `${platform}-shape`,
        );
      } else {
        expect(result.status, result.stderr).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain(`${platform}-shape`);
        expect(result.stderr).toContain('only allowed in Build');
      }
    },
  );

  it.each(['trae', 'trae-cn', 'dsh'] as const)(
    'allows %s write payloads through the packaged router during Native Build',
    async (platform) => {
      await configureChange(primary, `${platform}-build`, 'build');
      const payload = JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: `src/${platform}.ts` },
      });

      const result = spawnSync(
        process.execPath,
        [router, '--platform', platform, '--project-root', primary],
        { cwd: primary, input: payload, encoding: 'utf8', timeout: 20_000 },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    },
  );
});
