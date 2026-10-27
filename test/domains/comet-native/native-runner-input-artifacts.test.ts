import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  nativeRunnerInputArtifactPaths,
  registerNativeRunnerInputArtifactLocked,
} from '../../../domains/comet-native/native-runner-input-artifacts.js';
import { nativeCheckInputGate } from '../../../domains/comet-native/native-portable-checks.js';

describe('validated Native Runner input boundaries', () => {
  let root: string;
  const registry = 'native/runner-input-artifacts.json';
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  const gate = () => nativeCheckInputGate({ projectRoot: root, candidateId: 'fixture-candidate' });
  async function register(file: string) {
    await registerNativeRunnerInputArtifactLocked({
      paths: await nativeProjectPaths(root, 'docs'),
      file,
      validateContent: (content) => {
        expect(JSON.parse(content).kind).toBe('dispatch-verifier');
      },
    });
  }
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runner-boundary-')));
    git('init');
    await fs.writeFile(path.join(root, 'source.txt'), 'source');
    git('add', 'source.txt');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'fixture',
    );
    await ensureNativeDirectories(await nativeProjectPaths(root, 'docs'));
  });
  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  it('excludes retained validated payloads while binding other untracked JSON and changed payload bytes', async () => {
    const before = await gate();
    expect(before).not.toBeNull();
    await fs.writeFile(
      path.join(root, 'handoff.json'),
      JSON.stringify({ kind: 'dispatch-verifier', checks: [] }),
    );
    await register('handoff.json');
    expect(await gate()).toBe(before);
    await fs.writeFile(path.join(root, 'ordinary-config.json'), '{"feature":true}');
    expect(await gate()).not.toBe(before);
    await fs.rm(path.join(root, 'ordinary-config.json'));
    await fs.writeFile(
      path.join(root, 'handoff.json'),
      JSON.stringify({ kind: 'dispatch-verifier', checks: [], altered: true }),
    );
    expect(await nativeRunnerInputArtifactPaths(root)).toEqual(new Set());
    expect(await gate()).not.toBe(before);
  });

  it('keeps tracked input files in the candidate even if they were registered before staging', async () => {
    await fs.writeFile(
      path.join(root, 'handoff.json'),
      JSON.stringify({ kind: 'dispatch-verifier', checks: [] }),
    );
    await register('handoff.json');
    git('add', 'handoff.json');
    expect(await nativeRunnerInputArtifactPaths(root)).toEqual(new Set());
    await register('handoff.json');
    expect(await nativeRunnerInputArtifactPaths(root)).toEqual(new Set());
    const before = await gate();
    await fs.writeFile(path.join(root, 'handoff.json'), '{"changed":true}');
    expect(await gate()).not.toBe(before);
  });

  it('recognizes validated request files through a project parent alias without hiding ordinary inputs', async () => {
    const aliasParent = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runner-parent-alias-'));
    try {
      const link = path.join(aliasParent, 'parent');
      await fs.symlink(path.dirname(root), link, process.platform === 'win32' ? 'junction' : 'dir');
      const aliasRoot = path.join(link, path.basename(root));
      const before = await gate();
      await fs.writeFile(
        path.join(root, 'handoff.json'),
        JSON.stringify({ kind: 'dispatch-verifier' }),
      );
      await registerNativeRunnerInputArtifactLocked({
        paths: await nativeProjectPaths(aliasRoot, 'docs'),
        file: path.join(aliasRoot, 'handoff.json'),
        validateContent: (content) => {
          expect(JSON.parse(content).kind).toBe('dispatch-verifier');
        },
      });
      expect(await nativeRunnerInputArtifactPaths(aliasRoot)).toEqual(new Set(['handoff.json']));
      expect(await gate()).toBe(before);
      await fs.writeFile(path.join(root, 'ordinary.json'), '{"changed":true}');
      expect(await gate()).not.toBe(before);
      await fs.rm(path.join(root, 'ordinary.json'));
      git('add', 'handoff.json');
      expect(await nativeRunnerInputArtifactPaths(aliasRoot)).toEqual(new Set());
    } finally {
      await fs.rm(aliasParent, { recursive: true, force: true });
    }
  });

  it('recognizes a read-only inspection in an already validated SDK request file without writing bookkeeping', async () => {
    const file = path.join(root, 'request.json');
    await fs.writeFile(file, JSON.stringify({ operation: 'claim', runId: 'demo' }));
    await registerNativeRunnerInputArtifactLocked({
      paths: await nativeProjectPaths(root, 'docs'),
      file,
      runtimeRunId: 'demo',
      validateContent: () => undefined,
    });
    const registryFile = path.join(resolveWorkspaceRuntimeRootSync(root), registry);
    const before = await fs.readFile(registryFile, 'utf8');
    await fs.writeFile(
      file,
      JSON.stringify({ operation: 'inspect', runId: 'demo', requestId: 'fresh-id' }),
    );
    expect(await nativeRunnerInputArtifactPaths(root)).toEqual(new Set(['request.json']));
    expect(await fs.readFile(registryFile, 'utf8')).toBe(before);
    for (const payload of [
      { operation: 'inspect', runId: 'other' },
      { operation: 'inspect', runId: 'demo', source: 'ordinary input' },
      { feature: true },
    ]) {
      await fs.writeFile(file, JSON.stringify(payload));
      expect(await nativeRunnerInputArtifactPaths(root)).toEqual(new Set());
    }
  });

  it.runIf(process.platform === 'win32')(
    'keeps tracked paths bound when supplied with different casing',
    async () => {
      await fs.writeFile(
        path.join(root, 'handoff.json'),
        JSON.stringify({ kind: 'dispatch-verifier', checks: [] }),
      );
      git('add', 'handoff.json');
      await register('HANDOFF.json');
      expect(await nativeRunnerInputArtifactPaths(root)).toEqual(new Set());
    },
  );

  it.runIf(process.platform === 'win32')(
    'recognizes untracked transport by its actual disk path',
    async () => {
      const before = await gate();
      await fs.writeFile(
        path.join(root, 'handoff.json'),
        JSON.stringify({ kind: 'dispatch-verifier', checks: [] }),
      );
      await register('HANDOFF.json');
      expect(await nativeRunnerInputArtifactPaths(root)).toEqual(new Set(['handoff.json']));
      expect(await gate()).toBe(before);
    },
  );

  it('never registers content whose validation failed', async () => {
    await fs.writeFile(path.join(root, 'invalid.json'), '{}');
    await expect(register('invalid.json')).rejects.toThrow();
    expect(await nativeRunnerInputArtifactPaths(root)).toEqual(new Set());
    await expect(
      fs.lstat(path.join(resolveWorkspaceRuntimeRootSync(root), registry)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not exclude files reached through a directory link or a corrupted registry', async () => {
    await fs.mkdir(path.join(root, 'inputs'));
    await fs.writeFile(
      path.join(root, 'inputs/handoff.json'),
      JSON.stringify({ kind: 'dispatch-verifier', checks: [] }),
    );
    await fs.symlink(
      path.join(root, 'inputs'),
      path.join(root, 'linked-inputs'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(register('linked-inputs/handoff.json')).rejects.toThrow(/symbolic link|junction/u);
    await register('inputs/handoff.json');
    await fs.writeFile(path.join(resolveWorkspaceRuntimeRootSync(root), registry), '{broken');
    expect(await nativeRunnerInputArtifactPaths(root)).toEqual(new Set());
  });
});
