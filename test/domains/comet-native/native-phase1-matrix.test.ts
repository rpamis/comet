import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'fs';
import { execFileSync } from 'node:child_process';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeChangeDir } from '../../../domains/comet-native/native-change.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { readProjectConfig } from '../../../domains/comet-native/native-config.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import { storedNativeChangeFixture } from '../../helpers/native-change-document.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  moveNativeRoot,
  recoverNativeRootMove,
} from '../../../domains/comet-native/native-root-move.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

interface JsonEnvelope {
  exitCode: number;
  data?: unknown;
  error?: { code: string; message: string };
}

function json(result: Awaited<ReturnType<typeof runNativeCli>>): JsonEnvelope {
  expect(result.stdout).toBeTruthy();
  return JSON.parse(result.stdout!) as JsonEnvelope;
}

async function initialize(projectRoot: string, artifactRoot = '.'): Promise<NativeProjectPaths> {
  const result = await runNativeCli([
    'init',
    '--root',
    artifactRoot,
    '--project-root',
    projectRoot,
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  return nativeProjectPaths(projectRoot, artifactRoot);
}

describe('Comet Native Phase 1 behavior matrix', () => {
  const projects: string[] = [];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      projects.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    );
  });

  async function project(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-matrix-'));
    projects.push(root);
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    return root;
  }

  it('supports both project/comet and docs/comet without creating Classic trees', async () => {
    const defaultProject = await project();
    const docsProject = await project();

    expect((await initialize(defaultProject)).nativeRoot).toBe(path.join(defaultProject, 'comet'));
    expect((await initialize(docsProject, 'docs')).nativeRoot).toBe(
      path.join(docsProject, 'docs', 'comet'),
    );
    for (const root of [defaultProject, docsProject]) {
      await expect(fs.access(path.join(root, '.comet', 'config.yaml'))).resolves.toBeUndefined();
      await expect(fs.access(path.join(root, 'openspec'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  });

  it('continues and rolls back interrupted artifact-root moves from pending config', async () => {
    const projectRoot = await project();
    const paths = await initialize(projectRoot);
    await fs.mkdir(path.join(paths.specsDir, 'example'), { recursive: true });
    await fs.writeFile(path.join(paths.specsDir, 'example', 'spec.md'), 'example\n');

    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          afterRootMoveStage(stage) {
            if (stage === 'ready') throw new Error('interrupt root continue');
          },
        },
      }),
    ).rejects.toThrow('interrupt root continue');
    expect((await readProjectConfig(projectRoot))?.native.pending_root_move?.stage).toBe('ready');
    expect(
      (await recoverNativeRootMove({ projectRoot, strategy: 'continue' })).config.native
        .artifact_root,
    ).toBe('docs');

    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'artifacts',
        hooks: {
          afterRootMoveStage(stage) {
            if (stage === 'ready') throw new Error('interrupt root rollback');
          },
        },
      }),
    ).rejects.toThrow('interrupt root rollback');
    expect(
      (await recoverNativeRootMove({ projectRoot, strategy: 'rollback' })).config.native
        .artifact_root,
    ).toBe('docs');
    expect(
      await fs.readFile(
        path.join(projectRoot, 'docs', 'comet', 'specs', 'example', 'spec.md'),
        'utf8',
      ),
    ).toBe('example\n');
  });

  it('fails closed for malformed config/state and never scans an openspec fixture', async () => {
    const projectRoot = await project();
    const paths = await initialize(projectRoot);
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes', 'should-not-read'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectRoot, 'openspec', 'changes', 'should-not-read', 'secret.md'),
      'not Native state\n',
    );
    await storedNativeChangeFixture({
      paths,
      name: 'malformed-state',
      language: 'en',
      verificationProtocol: 'legacy-v1',
    });
    await fs.writeFile(
      path.join(nativeChangeDir(paths, 'malformed-state'), 'comet-state.yaml'),
      'schema: comet.native.v1\nphase: [broken\n',
    );

    const observed: string[] = [];
    for (const method of ['readFile', 'readdir', 'access', 'realpath', 'lstat', 'stat'] as const) {
      const original = fs[method].bind(fs) as (...args: unknown[]) => unknown;
      vi.spyOn(fs, method).mockImplementation(((...args: unknown[]) => {
        if (typeof args[0] === 'string') observed.push(path.resolve(args[0]));
        return original(...args);
      }) as never);
    }
    const status = json(
      await runNativeCli(['status', 'malformed-state', '--json', '--project-root', projectRoot]),
    );
    expect(status).toMatchObject({ exitCode: 0, data: { phase: 'invalid' } });
    expect(
      (
        await runNativeCli([
          'next',
          'malformed-state',
          '--summary',
          'must fail closed',
          '--project-root',
          projectRoot,
        ])
      ).exitCode,
    ).toBe(65);
    expect((await nativeDoctorCommand([], projectRoot)).data).toMatchObject({ healthy: false });
    expect(observed.some((target) => target.includes(`${path.sep}openspec${path.sep}`))).toBe(
      false,
    );
    vi.restoreAllMocks();

    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, '.comet', 'config.yaml'), 'native: [broken\n');
    const configResult = await runNativeCli(['status', '--json', '--project-root', projectRoot]);
    expect(configResult.exitCode).toBe(65);
    expect(json(configResult).error?.code).toBe('invalid-data');
  });
});
