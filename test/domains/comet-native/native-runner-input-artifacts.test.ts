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
  const registry = '.comet/runtime/native/runner-input-artifacts.json';
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
    await expect(fs.lstat(path.join(root, registry))).rejects.toMatchObject({ code: 'ENOENT' });
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
    await fs.writeFile(path.join(root, registry), '{broken');
    expect(await nativeRunnerInputArtifactPaths(root)).toEqual(new Set());
  });
});
