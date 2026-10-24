import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectCometHook } from '../../../domains/comet-entry/hook-router.js';
import { configuredHookWritePath } from '../../../domains/workflow-contract/hook-write-policy.js';
import { resolveWorkspaceRuntimeRoot } from '../../../domains/workflow-contract/workspace-runtime.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
const cases = (
  ['project-local', 'external', 'native-owned', 'classic-owned', 'runtime', 'git'] as const
).flatMap((destination) =>
  (['root', 'nested'] as const).map((placement) => ({ destination, placement })),
);

it.each(cases)(
  'handles an allowlisted $placement symlink to $destination without confusing ownership',
  async ({ destination, placement }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-allow-symlink-'));
    roots.push(root);
    const home = path.join(root, 'home');
    await fs.mkdir(home);
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('COMET_DATA_DIR', path.join(home, '.comet'));
    const projectRoot = path.join(root, 'project');
    const config = defaultProjectConfig('docs');
    config.workflows = ['native', 'classic'];
    config.classic = { artifact_layout: 'docs' };
    config.hook = { allow_paths: ['team-rules'] };
    await fs.mkdir(projectRoot);
    await writeProjectConfig(projectRoot, config);
    const target = {
      'project-local': path.join(projectRoot, 'local-rules'),
      external: path.join(root, 'shared-rules'),
      'native-owned': path.join(projectRoot, 'docs', 'comet', 'changes', 'first'),
      'classic-owned': path.join(projectRoot, 'docs', 'openspec', 'changes', 'first'),
      runtime: await resolveWorkspaceRuntimeRoot(projectRoot),
      git: path.join(projectRoot, '.git'),
    }[destination];
    if (destination === 'runtime') {
      expect(path.relative(projectRoot, target).startsWith(`..${path.sep}`)).toBe(true);
      expect(path.relative(home, target).startsWith(`..${path.sep}`)).toBe(false);
    }
    await fs.mkdir(target, { recursive: true });
    const alias = path.join(
      projectRoot,
      'team-rules',
      ...(placement === 'nested' ? ['linked'] : []),
    );
    await fs.mkdir(path.dirname(alias), { recursive: true });
    await fs.symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const requestedFile = path.join(alias, 'missing-directory', 'new-rule.md');
    const inspectNative = vi.fn();
    const inspectClassic = vi.fn();
    const decision = await inspectCometHook(
      projectRoot,
      {
        intent: 'write',
        targets: [requestedFile],
        toolName: 'Write',
      },
      {
        listNative: async () => [
          { workflow: 'native', name: 'first', phase: 'shape' as const },
          { workflow: 'native', name: 'second', phase: 'build' as const },
        ],
        listClassic: async () => [],
        inspectNative,
        inspectClassic,
      },
    );
    if (destination === 'project-local' || destination === 'external') {
      expect(decision).toMatchObject({ allowed: true });
      expect(decision.reason).toContain(
        destination === 'external' ? 'outside the guarded project' : 'configured Hook allow paths',
      );
      if (destination === 'external') {
        expect(await configuredHookWritePath(projectRoot, requestedFile)).toBeNull();
      }
    } else {
      expect(decision.allowed).toBe(false);
      if (destination === 'runtime') expect(decision.reason).toContain('Runtime-owned files');
    }
    expect(inspectNative).not.toHaveBeenCalled();
    expect(inspectClassic).not.toHaveBeenCalled();
    await expect(
      fs.stat(path.join(target, 'missing-directory', 'new-rule.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

const danglingCases = (
  [
    'project-local',
    'external',
    'native-owned',
    'classic-owned',
    'runtime',
    'git',
    'control',
  ] as const
).flatMap((destination) =>
  (['absolute', 'relative', 'chain'] as const).map((link) => ({ destination, link })),
);

it.each(danglingCases)(
  'resolves a dangling $link file link to $destination before deciding the Hook allowance',
  async ({ destination, link }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-dangling-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    const dataRoot = path.join(root, 'data');
    vi.stubEnv('COMET_DATA_DIR', dataRoot);
    const config = defaultProjectConfig('docs');
    config.workflows = ['native', 'classic'];
    config.classic = { artifact_layout: 'docs' };
    config.hook = { allow_paths: ['team-rules'] };
    await fs.mkdir(projectRoot);
    await writeProjectConfig(projectRoot, config);
    const runtimeRoot = await resolveWorkspaceRuntimeRoot(projectRoot);
    const targetDirectory = {
      'project-local': path.join(projectRoot, 'local-rules'),
      external: path.join(root, 'shared-rules'),
      'native-owned': path.join(projectRoot, 'docs', 'comet', 'changes', 'first'),
      'classic-owned': path.join(projectRoot, 'docs', 'openspec', 'changes', 'first'),
      runtime: runtimeRoot,
      git: path.join(projectRoot, '.git'),
      control: path.join(projectRoot, '.comet'),
    }[destination];
    await fs.mkdir(targetDirectory, { recursive: true });
    const target = path.join(targetDirectory, 'new-state.json');
    const alias = path.join(projectRoot, 'team-rules', 'rule.json');
    await fs.mkdir(path.dirname(alias), { recursive: true });
    if (link === 'chain') {
      const middle = path.join(projectRoot, 'middle-link.json');
      await fs.symlink(path.relative(path.dirname(middle), target), middle, 'file');
      await fs.symlink(path.relative(path.dirname(alias), middle), alias, 'file');
    } else {
      await fs.symlink(
        link === 'relative' ? path.relative(path.dirname(alias), target) : target,
        alias,
        'file',
      );
    }
    const reserved = [
      runtimeRoot,
      path.join(projectRoot, 'docs', 'comet'),
      path.join(projectRoot, 'docs', 'openspec'),
    ];
    const allowance = await configuredHookWritePath(projectRoot, alias, reserved);
    const decision = await inspectCometHook(
      projectRoot,
      {
        intent: 'write',
        targets: [alias],
        toolName: 'Write',
      },
      {
        listNative: async () => [
          { workflow: 'native', name: 'first', phase: 'shape' as const },
          { workflow: 'native', name: 'second', phase: 'build' as const },
        ],
        listClassic: async () => [],
        inspectNative: async () => {
          throw new Error('unselected workflow guard must not execute');
        },
        inspectClassic: async () => {
          throw new Error('unselected workflow guard must not execute');
        },
      },
    );
    if (destination === 'project-local' || destination === 'external') {
      expect(decision.allowed).toBe(true);
      if (destination === 'external') {
        expect(allowance).toBeNull();
        expect(decision.reason).toContain('outside the guarded project');
      } else {
        expect(allowance).toContain('configured Hook allow path');
      }
      await fs.writeFile(alias, 'user rule');
      expect(await fs.readFile(target, 'utf8')).toBe('user rule');
    } else {
      expect(allowance).toBeNull();
      expect(decision.allowed).toBe(false);
      if (destination === 'runtime') expect(decision.reason).toContain('Runtime-owned files');
      await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  },
);

it.each(['cycle', 'over-depth'] as const)(
  'fails closed for an allowlisted %s link chain without hanging',
  async (mode) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-link-bound-'));
    roots.push(root);
    vi.stubEnv('COMET_DATA_DIR', path.join(root, 'data'));
    const projectRoot = path.join(root, 'project');
    const config = defaultProjectConfig('docs');
    config.hook = { allow_paths: ['team-rules'] };
    await fs.mkdir(projectRoot);
    await writeProjectConfig(projectRoot, config);
    const directory = path.join(projectRoot, 'team-rules');
    await fs.mkdir(directory);
    const length = mode === 'cycle' ? 2 : 45;
    for (let index = 0; index < length; index++) {
      const destination = mode === 'cycle' ? `link-${(index + 1) % length}` : `link-${index + 1}`;
      await fs.symlink(destination, path.join(directory, `link-${index}`), 'file');
    }
    const alias = path.join(directory, 'link-0');
    await expect(configuredHookWritePath(projectRoot, alias)).rejects.toThrow();
    const decision = await inspectCometHook(projectRoot, {
      intent: 'write',
      targets: [alias],
      toolName: 'Write',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('scope could not be determined safely');
  },
);

it.each(['target', 'cwd'] as const)(
  'keeps physical parent traversal in the raw Hook %s from escaping into Runtime',
  async (mode) => {
    const { parseCometHookRequest } = await import('../../../platform/process/hook-adapter.js');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-parent-traversal-'));
    roots.push(root);
    vi.stubEnv('COMET_DATA_DIR', path.join(root, 'data'));
    const projectRoot = path.join(root, 'project');
    const config = defaultProjectConfig('docs');
    config.workflows = ['native', 'classic'];
    config.classic = { artifact_layout: 'docs' };
    config.hook = { allow_paths: ['team-rules'] };
    await fs.mkdir(projectRoot);
    await writeProjectConfig(projectRoot, config);
    const runtimeRoot = await resolveWorkspaceRuntimeRoot(projectRoot);
    await fs.mkdir(path.join(runtimeRoot, 'subdir'));
    const alias = path.join(projectRoot, 'team-rules', 'link');
    await fs.mkdir(path.dirname(alias));
    await fs.symlink(
      path.join(runtimeRoot, 'subdir'),
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const rawParent = `${alias}${path.sep}..`;
    const rawTarget = `${rawParent}${path.sep}new-runtime-state.json`;
    const request = parseCometHookRequest(
      JSON.stringify({
        tool_name: 'Write',
        ...(mode === 'cwd' ? { cwd: rawParent } : {}),
        tool_input: {
          file_path: mode === 'target' ? rawTarget : 'new-runtime-state.json',
          content: 'unexpected runtime creation',
        },
      }),
    );
    if (mode === 'cwd') {
      expect(request.cwd).toBe(path.resolve(rawParent));
      expect(request.rawCwd).toBe(rawParent);
    } else expect(request.targets).toEqual([rawTarget]);
    await expect(configuredHookWritePath(projectRoot, rawTarget, [runtimeRoot])).rejects.toThrow(
      '规范物理路径',
    );
    const decision = await inspectCometHook(projectRoot, request, {
      listNative: async () => [
        { workflow: 'native', name: 'first', phase: 'shape' as const },
        { workflow: 'native', name: 'second', phase: 'build' as const },
      ],
      listClassic: async () => [],
      inspectNative: async () => {
        throw new Error('unselected guard must not execute');
      },
      inspectClassic: async () => {
        throw new Error('unselected guard must not execute');
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('规范物理路径');
    await expect(fs.stat(path.join(runtimeRoot, 'new-runtime-state.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await fs.writeFile(rawTarget, 'physical traversal proof');
    expect(await fs.readFile(path.join(runtimeRoot, 'new-runtime-state.json'), 'utf8')).toBe(
      'physical traversal proof',
    );
  },
);

it.each(['project-local', 'external'] as const)(
  'preserves a normal parent traversal to a missing %s rule without symlinks',
  async (destination) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-ordinary-parent-'));
    roots.push(root);
    vi.stubEnv('COMET_DATA_DIR', path.join(root, 'data'));
    const projectRoot = path.join(root, 'project');
    const config = defaultProjectConfig('docs');
    config.hook = { allow_paths: ['team-rules'] };
    await fs.mkdir(projectRoot);
    await writeProjectConfig(projectRoot, config);
    await fs.mkdir(path.join(projectRoot, 'team-rules', 'drafts'), { recursive: true });
    const target =
      destination === 'project-local'
        ? `${projectRoot}${path.sep}team-rules${path.sep}drafts${path.sep}..${path.sep}new.md`
        : `${projectRoot}${path.sep}..${path.sep}new.md`;
    const decision = await inspectCometHook(
      projectRoot,
      {
        intent: 'write',
        targets: [target],
        toolName: 'Write',
      },
      {
        listNative: async () => [
          { workflow: 'native', name: 'first', phase: 'shape' as const },
          { workflow: 'native', name: 'second', phase: 'build' as const },
        ],
        listClassic: async () => [],
        inspectNative: vi.fn(),
        inspectClassic: vi.fn(),
      },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain(
      destination === 'external' ? 'outside the guarded project' : 'configured Hook allow paths',
    );
    await fs.writeFile(target, 'ordinary rule');
    expect(await fs.readFile(path.resolve(target), 'utf8')).toBe('ordinary rule');
  },
);
