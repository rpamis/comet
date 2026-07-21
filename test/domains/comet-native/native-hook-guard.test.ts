import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  createNativeChange,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import {
  inspectNativeHookGuard,
  parseNativeHookRequest,
  type NativeHookRequest,
} from '../../../domains/comet-native/native-hook-guard.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { selectNativeChange } from '../../../domains/comet-native/native-selection.js';

describe('Native phase Hook guard', () => {
  let projectRoot: string;

  const writeRequest = (...targets: string[]): NativeHookRequest => ({
    intent: targets.length > 0 ? 'write' : 'unknown',
    targets,
  });

  const nonWriteRequest = (): NativeHookRequest => ({ intent: 'non-write', targets: [] });

  async function activeChange(phase: 'shape' | 'build' | 'verify' | 'archive', name: string) {
    const paths = await nativeProjectPaths(projectRoot, '.');
    await ensureNativeDirectories(paths);
    const state = await createNativeChange({ paths, name, language: 'en' });
    state.phase = phase;
    await writeNativeChange(paths, state);
    return { paths, state };
  }

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-hook-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('normalizes Claude-compatible and native Hook payloads with every write target', () => {
    expect(
      parseNativeHookRequest(
        JSON.stringify({
          tool_name: 'Edit',
          tool_input: { file_path: 'src/index.ts', paths: ['src/a.ts', 'src/b.ts'] },
        }),
      ),
    ).toEqual({ intent: 'write', targets: ['src/index.ts', 'src/a.ts', 'src/b.ts'] });

    expect(
      parseNativeHookRequest(
        JSON.stringify({
          toolName: 'edit',
          toolArgs: JSON.stringify({ filePath: 'src/copilot.ts' }),
        }),
      ),
    ).toEqual({ intent: 'write', targets: ['src/copilot.ts'] });
  });

  it('extracts every target from apply_patch headers', () => {
    expect(
      parseNativeHookRequest(
        JSON.stringify({
          toolName: 'apply_patch',
          toolArgs: {
            patch: [
              '*** Begin Patch',
              '*** Update File: src/existing.ts',
              '*** Add File: src/new.ts',
              '*** Delete File: src/old.ts',
              '*** End Patch',
            ].join('\n'),
          },
        }),
      ),
    ).toEqual({
      intent: 'write',
      targets: ['src/existing.ts', 'src/new.ts', 'src/old.ts'],
    });
  });

  it('distinguishes explicit non-write tools from unknown write payloads', () => {
    expect(parseNativeHookRequest(JSON.stringify({ toolName: 'view', toolArgs: {} }))).toEqual({
      intent: 'non-write',
      targets: [],
    });
    expect(parseNativeHookRequest(JSON.stringify({ tool_name: 'Write', tool_input: {} }))).toEqual({
      intent: 'unknown',
      targets: [],
    });
    expect(parseNativeHookRequest('{broken')).toEqual({ intent: 'unknown', targets: [] });
    expect(parseNativeHookRequest('')).toEqual({ intent: 'unknown', targets: [] });
  });

  it.each([
    ['shape', false],
    ['build', true],
    ['verify', false],
    ['archive', false],
  ] as const)('%s applies the ordinary project write boundary', async (phase, allowed) => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await activeChange(phase, `guard-${phase}`);

    await expect(
      inspectNativeHookGuard(projectRoot, writeRequest('src/index.ts')),
    ).resolves.toMatchObject({
      allowed,
      phase,
      change: `guard-${phase}`,
    });
  });

  it.each(['shape', 'verify', 'archive'] as const)(
    '%s fails closed when a write target cannot be recovered',
    async (phase) => {
      await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
      await activeChange(phase, `unknown-${phase}`);

      await expect(inspectNativeHookGuard(projectRoot, writeRequest())).resolves.toMatchObject({
        allowed: false,
        phase,
        reason: expect.stringContaining('target could not be determined'),
      });
    },
  );

  it('allows explicit non-write tools during a guarded phase', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await activeChange('shape', 'read-during-shape');

    await expect(inspectNativeHookGuard(projectRoot, nonWriteRequest())).resolves.toMatchObject({
      allowed: true,
      reason: 'Hook event is not a write',
    });
  });

  it('returns a structured Copilot denial without relying on exit code 2', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await activeChange('shape', 'copilot-shape');
    const previousFilePath = process.env.FILE_PATH;
    process.env.FILE_PATH = 'src/index.ts';
    try {
      const result = await runNativeCli([
        'hook-guard',
        '--hook-output',
        'copilot',
        '--project-root',
        projectRoot,
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout ?? '')).toEqual({
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('only allowed in build'),
      });
    } finally {
      if (previousFilePath === undefined) delete process.env.FILE_PATH;
      else process.env.FILE_PATH = previousFilePath;
    }
  });

  it('allows Native artifacts and projects without an active change', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));

    await expect(
      inspectNativeHookGuard(projectRoot, writeRequest('docs/comet/changes/example/brief.md')),
    ).resolves.toMatchObject({ allowed: true, reason: 'Native control artifact write' });
    await expect(
      inspectNativeHookGuard(projectRoot, writeRequest('src/index.ts')),
    ).resolves.toMatchObject({ allowed: true, reason: 'No Native changes exist' });
  });

  it('allows control-only writes but blocks mixed control and implementation targets', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    await createNativeChange({ paths, name: 'guard-control', language: 'en' });

    await expect(
      inspectNativeHookGuard(
        projectRoot,
        writeRequest('.comet/config.yaml', 'docs/comet/changes/guard-control/brief.md'),
      ),
    ).resolves.toMatchObject({ allowed: true, reason: 'Native control artifact write' });
    await expect(
      inspectNativeHookGuard(
        projectRoot,
        writeRequest('docs/comet/changes/guard-control/brief.md', 'src/index.ts'),
      ),
    ).resolves.toMatchObject({ allowed: false, phase: 'shape' });
  });

  it.each(['.github/workflows/ci.yml', '.husky/pre-commit', '.env', '.gitignore'])(
    'guards dot-prefixed project write %s',
    async (target) => {
      await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
      await activeChange('shape', 'guard-dotfiles');

      await expect(
        inspectNativeHookGuard(projectRoot, writeRequest(target)),
      ).resolves.toMatchObject({ allowed: false, phase: 'shape' });
    },
  );

  it('does not guard a Classic-only project', async () => {
    const config = defaultProjectConfig('.');
    config.default_workflow = 'classic';
    config.workflows = ['classic'];
    await writeProjectConfig(projectRoot, config);

    await expect(
      inspectNativeHookGuard(projectRoot, writeRequest('src/index.ts')),
    ).resolves.toMatchObject({ allowed: true, reason: 'Native workflow is not enabled' });
  });

  it('blocks writes when multiple active changes have no valid selection', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await activeChange('build', 'build-change');
    await activeChange('shape', 'shape-change');

    await expect(
      inspectNativeHookGuard(projectRoot, writeRequest('src/index.ts')),
    ).resolves.toMatchObject({
      allowed: false,
      reason: expect.stringContaining('select the change'),
    });
  });

  it('uses the selected change when multiple Native changes are active', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    await ensureNativeDirectories(paths);
    await createNativeChange({ paths, name: 'shape-change', language: 'en' });
    const buildChange = await createNativeChange({
      paths,
      name: 'build-change',
      language: 'en',
    });
    buildChange.phase = 'build';
    await writeNativeChange(paths, buildChange);
    await selectNativeChange(paths, 'build-change');

    await expect(
      inspectNativeHookGuard(projectRoot, writeRequest('src/index.ts')),
    ).resolves.toMatchObject({ allowed: true, phase: 'build', change: 'build-change' });
  });
});
