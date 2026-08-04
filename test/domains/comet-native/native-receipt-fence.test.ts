import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prepareNativeBuildEvidence } from '../../../domains/comet-native/native-build-evidence.js';
import {
  createNativeChange,
  nativeChangeDir,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';
import { loadNativeVerificationReceiptContext } from '../../../domains/comet-native/native-verification-receipt-runtime.js';

const brief = `# Outcome
Protect automated verification from stale implementation scopes.
# Scope
Bind verification commands to the Build snapshot.
# Non-goals
No unrelated workflow changes.
# Acceptance examples
- A stale scope stops before executing the command.
# Constraints and invariants
Return an Agent-actionable recovery command.
# Decisions
Keep the full workspace fence.
# Open questions
None.
# Verification expectations
Run the focused receipt test.
`;

interface JsonEnvelope {
  command: string | null;
  exitCode: number;
  data?: unknown;
  error?: { code: string; message: string };
}

function json(result: Awaited<ReturnType<typeof runNativeCli>>): JsonEnvelope {
  expect(result.stdout).toBeTruthy();
  return JSON.parse(result.stdout!) as JsonEnvelope;
}

describe('Native verification receipt fence recovery', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let state: NativeChangeState;
  let acceptanceId: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-receipt-fence-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native@example.test'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: projectRoot });
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    paths = await nativeProjectPaths(projectRoot, '.');
    await Promise.all([
      fs.writeFile(path.join(projectRoot, '.gitignore'), 'node_modules/\n.cache/\n'),
      fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const value = 1;\n'),
    ]);
    execFileSync('git', ['add', '.gitignore', 'feature.ts'], { cwd: projectRoot });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: projectRoot, stdio: 'ignore' });

    const created = await createNativeChange({
      paths,
      verificationProtocol: 'legacy-v1',
      name: 'receipt-fence',
      language: 'en',
      now: new Date('2026-08-04T00:00:00.000Z'),
    });
    await fs.writeFile(path.join(nativeChangeDir(paths, created.name), 'brief.md'), brief);
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const value = 2;\n');
    const build = await prepareNativeBuildEvidence({
      paths,
      state: { ...created, phase: 'build', approval: 'implicit' },
      artifactRefs: ['feature.ts'],
      now: new Date('2026-08-04T00:05:00.000Z'),
    });
    state = await writeNativeChange(paths, {
      ...created,
      phase: 'verify',
      approval: 'implicit',
      implementation_scope: build.scopeRef,
    });
    acceptanceId = (await loadNativeVerificationReceiptContext(paths, state)).acceptanceIds[0]!;
    await fs.appendFile(path.join(projectRoot, '.gitignore'), 'coverage/\n');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('stops before command execution and returns a bounded self-healing recovery payload', async () => {
    const sentinel = path.join(projectRoot, 'receipt-command-ran.txt');
    const result = json(
      await runNativeCli([
        'receipt',
        'automated',
        state.name,
        '--acceptance',
        acceptanceId,
        '--json',
        '--project-root',
        projectRoot,
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran')`,
      ]),
    );

    expect(result).toMatchObject({
      command: 'receipt',
      exitCode: 65,
      data: {
        reason: 'implementation-scope-stale',
        commandExecuted: false,
        changedPaths: [{ path: '.gitignore', kind: 'modified' }],
        changedPathCount: 1,
        changedPathsTruncated: false,
        requiredAction: 'return-to-build-and-refresh-implementation-scope',
        nextCommand:
          'comet native next receipt-fence --summary "Implementation changed after Build; return to Build and refresh scope"',
        requiresUserDecision: false,
      },
      error: {
        code: 'implementation-scope-stale',
        message: expect.stringContaining('stopped before command execution'),
      },
    });
    await expect(fs.access(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('routes receipt refresh to Build scope recovery instead of reporting a clean no-op', async () => {
    const result = json(
      await runNativeCli([
        'receipt',
        'refresh',
        state.name,
        '--json',
        '--project-root',
        projectRoot,
      ]),
    );

    expect(result).toMatchObject({
      command: 'receipt',
      exitCode: 65,
      data: {
        reason: 'implementation-scope-stale',
        commandExecuted: false,
        changedPaths: [{ path: '.gitignore', kind: 'modified' }],
        requiredAction: 'return-to-build-and-refresh-implementation-scope',
        requiresUserDecision: false,
      },
      error: { code: 'implementation-scope-stale' },
    });
  });

  it('keeps the post-command fence and reports files changed by the verification command', async () => {
    await fs.writeFile(path.join(projectRoot, '.gitignore'), 'node_modules/\n.cache/\n');
    const feature = path.join(projectRoot, 'feature.ts');
    const result = json(
      await runNativeCli([
        'receipt',
        'automated',
        state.name,
        '--acceptance',
        acceptanceId,
        '--json',
        '--project-root',
        projectRoot,
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(feature)}, 'export const value = 3;\\n')`,
      ]),
    );

    expect(result).toMatchObject({
      exitCode: 1,
      data: {
        receipt: { status: 'blocked' },
        recovery: {
          reason: 'implementation-changed-during-command',
          commandExecuted: true,
          changedPaths: [{ path: 'feature.ts', kind: 'modified' }],
          requiredAction: 'return-to-build-and-refresh-implementation-scope',
          requiresUserDecision: false,
        },
      },
    });
  });

  it('allows verification commands to write ignored cache files', async () => {
    await fs.writeFile(path.join(projectRoot, '.gitignore'), 'node_modules/\n.cache/\n');
    const cache = path.join(projectRoot, '.cache', 'result.txt');
    const result = json(
      await runNativeCli([
        'receipt',
        'automated',
        state.name,
        '--acceptance',
        acceptanceId,
        '--json',
        '--project-root',
        projectRoot,
        '--',
        process.execPath,
        '-e',
        `require('node:fs').mkdirSync(${JSON.stringify(path.dirname(cache))}, {recursive:true}); require('node:fs').writeFileSync(${JSON.stringify(cache)}, 'cache')`,
      ]),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      data: { receipt: { status: 'passed' } },
    });
    expect((result.data as { recovery?: unknown }).recovery).toBeUndefined();
  });
});
