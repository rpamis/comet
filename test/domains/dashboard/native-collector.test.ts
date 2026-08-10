import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NATIVE_CHANGE_STATE_FILE } from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { writeNativeLocalExecution } from '../../../domains/comet-native/native-local-execution.js';
import {
  nativePreferredChangeRuntimeDir,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  createNativePortableState,
  parseNativePortableState,
  writeNativePortableState,
} from '../../../domains/comet-native/native-portable-state.js';
import {
  NATIVE_LOCAL_EXECUTION_SCHEMA,
  type NativeLocalExecutionState,
  type NativePortableState,
} from '../../../domains/comet-native/native-portable-types.js';
import {
  collectNativeDashboardChangeDetail,
  collectNativeDashboardChangePage,
  collectNativeDashboardOverview,
  collectNativeDashboardProjection,
} from '../../../domains/dashboard/native-collector.js';

const NOW = '2026-08-09T08:00:00.000Z';
const LEGACY_ARCHIVE_FIXTURE = path.resolve('docs/comet/archive/2026-07-21-classic-config-block');
const text = (value: string) => ({ text: value, truncated: false });

function verifierReadyState(name: string): NativePortableState {
  const base = createNativePortableState({ name, language: 'zh-CN', createdAt: NOW });
  return parseNativePortableState({
    ...base,
    phase: 'verify',
    state_version: 4,
    spec_changes: [{ capability: 'dashboard', operation: 'modify', source: 'specs/dashboard.md' }],
    loop: {
      ...base.loop,
      stage: 'verify-ready',
      iteration: 1,
      attempt: 1,
      previous_unresolved_ids: ['A1'],
      next_action: 'Verifier 复核本轮候选实现。',
    },
    acceptance: [
      {
        id: 'A1',
        source: 'brief.md',
        text: 'Dashboard 展示验收结果。',
        result: 'failed',
        reason: text('缺少阻塞说明。'),
      },
      {
        id: 'A2',
        source: 'specs/dashboard.md',
        text: 'Dashboard 展示循环历史。',
        result: 'passed',
        reason: text('历史已显示。'),
      },
    ],
    builder_handoff: {
      candidate_id: 'candidate-1',
      identity_provider: 'runtime',
      builder_execution_ref: 'builder-1',
      iteration: 1,
      summary: text('Builder 已提交候选实现。'),
      addressed_acceptance_ids: ['A1', 'A2'],
      checks: [{ name: text('focused tests'), result: 'passed', note: null }],
      checks_truncated: false,
      known_limits: [],
      known_limits_truncated: false,
      submitted_at: NOW,
    },
    blockers: [
      {
        owner: 'builder',
        reason: text('缺少阻塞说明。'),
        acceptance_ids: ['A1'],
        resolution_action: 'return-build',
      },
    ],
    verification: {
      candidate_id: 'candidate-1',
      identity_provider: 'runtime',
      verifier_execution_ref: 'verifier-1',
      iteration: 1,
      attempt: 1,
      verdict: 'fail',
      checks: [
        {
          id: 'dashboard-tests',
          name: text('Dashboard focused tests'),
          argv_display: [text('pnpm'), text('vitest')],
          argv_truncated: true,
          cwd_ref: '.',
          status: 'failed',
          exit_code: 1,
          duration_ms: 900,
        },
      ],
      summary: text('一项验收失败。'),
      risks: [text('阻塞原因不够清楚。')],
      risks_truncated: false,
      completed_at: NOW,
    },
    history: [
      {
        goal_cycle: 1,
        iteration: 1,
        attempt: 1,
        outcome: 'fail',
        unresolved_ids: ['A1'],
        summary: text('Verifier 返回 Builder 修复。'),
        completed_at: NOW,
      },
    ],
    verification_result: 'fail',
    verification_report: 'verification.md',
  });
}

function activeShapeState(name: string): NativePortableState {
  return createNativePortableState({
    name,
    language: 'zh-CN',
    createdAt: NOW,
    nextAction: '完善需求简报。',
  });
}

function localExecution(
  projectRoot: string,
  state: NativePortableState,
  stateVersion = state.state_version,
): NativeLocalExecutionState {
  return {
    schema: NATIVE_LOCAL_EXECUTION_SCHEMA,
    change: state.name,
    basedOnStateVersion: stateVersion,
    workspace: { projectRoot, worktreeRoot: projectRoot, branch: null },
    execution: {
      operationId: 'verify-operation',
      stage: 'verifying',
      actor: 'verifier',
      executionId: 'private-execution-id',
      status: 'running',
      startedAt: NOW,
      requestCheckRounds: 1,
    },
    checks: [
      {
        id: 'dashboard-tests',
        name: 'Dashboard focused tests',
        operationId: 'verify-operation',
        status: 'running',
        repeatable: true,
        timeoutMs: 60_000,
        executionCount: 1,
        argv: ['pnpm', 'vitest', '--run'],
        cwd: projectRoot,
        exitCode: null,
        startedAt: NOW,
        completedAt: null,
        log: path.join(projectRoot, '.comet', 'private.log'),
      },
    ],
  };
}

describe('Native Dashboard v2 collector', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-dashboard-collector-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function enableNative() {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    return nativeProjectPaths(projectRoot, 'docs');
  }

  async function writeActiveState(state: NativePortableState): Promise<string> {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, state.name);
    await fs.mkdir(changeDir, { recursive: true });
    await writeNativePortableState(path.join(changeDir, NATIVE_CHANGE_STATE_FILE), state);
    await fs.writeFile(path.join(changeDir, 'brief.md'), '# Brief\nDashboard v2.\n');
    return changeDir;
  }

  it('does not create Native state when the project has no Comet config', async () => {
    await expect(collectNativeDashboardProjection(projectRoot)).resolves.toBeNull();
    await expect(fs.access(path.join(projectRoot, 'docs'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not re-enter the removed v1 inspection and hashing pipelines', async () => {
    const source = await fs.readFile(path.resolve('domains/dashboard/native-collector.ts'), 'utf8');

    expect(source).toContain('readNativePortableState');
    expect(source).toContain('readNativeLocalExecution');
    for (const removedDependency of [
      'inspectNativeArchivePreflight',
      'collectNativeContractFiles',
      'readNativeVerificationEvidence',
      'readNativeImplementationScope',
      'inspectNativeConflictRadar',
      'inspectNativeStatus',
      'listNativeStatusPage',
      'canonicalHash',
    ]) {
      expect(source).not.toContain(removedDependency);
    }
  });

  it('collects the overview from directories without parsing their state files', async () => {
    const paths = await enableNative();
    const invalidDir = path.join(paths.changesDir, 'invalid-state');
    await fs.mkdir(invalidDir, { recursive: true });
    await fs.writeFile(path.join(invalidDir, NATIVE_CHANGE_STATE_FILE), 'not: portable\n');
    await fs.mkdir(path.join(paths.archiveDir, '2026-08-09-old-archive'), { recursive: true });

    await expect(
      collectNativeDashboardOverview(projectRoot, { now: new Date(NOW) }),
    ).resolves.toEqual({
      schema: 'comet.dashboard.native.v2',
      generatedAt: NOW,
      totalChangeCount: 2,
      activeChangeCount: 1,
      archivedChangeCount: 1,
      visibleChangeCount: 0,
      omittedChangeCount: 2,
      changesTruncated: true,
      changes: [],
    });
  });

  it('reads portable YAML and applies only a matching local execution overlay', async () => {
    const paths = await enableNative();
    const state = verifierReadyState('dashboard-v2');
    const changeDir = await writeActiveState(state);
    await fs.mkdir(path.join(changeDir, 'specs'), { recursive: true });
    await fs.writeFile(path.join(changeDir, 'specs', 'dashboard.md'), '# Dashboard spec\n');
    await fs.writeFile(path.join(changeDir, 'verification.md'), '# Verification\nFailed.\n');
    const localFile = path.join(nativePreferredChangeRuntimeDir(paths, state.name), 'state.json');
    await writeNativeLocalExecution(localFile, localExecution(projectRoot, state));
    const yamlBefore = await fs.readFile(path.join(changeDir, NATIVE_CHANGE_STATE_FILE), 'utf8');
    const localBefore = await fs.readFile(localFile, 'utf8');

    const page = await collectNativeDashboardChangePage(projectRoot, {
      status: 'active',
      limit: 5,
    });
    expect(page).toMatchObject({
      total: 1,
      nextCursor: null,
      items: [
        {
          name: 'dashboard-v2',
          stateVersion: 4,
          loop: { stage: 'verify-ready', iteration: 1, attempt: 1, actor: 'verifier' },
          acceptance: { total: 2, passed: 1, failed: 1, blocked: 0, pending: 0 },
          verificationResult: 'fail',
          localExecution: { status: 'running', reason: 'current', actor: 'verifier' },
        },
      ],
    });

    const detail = await collectNativeDashboardChangeDetail(projectRoot, {
      status: 'active',
      name: state.name,
    });
    expect(detail).toMatchObject({
      specs: { total: 1, modify: 1 },
      checks: [{ id: 'dashboard-tests', status: 'failed' }],
      blockers: [{ owner: 'builder', acceptanceIds: ['A1'] }],
      history: [{ iteration: 1, attempt: 1, outcome: 'fail' }],
      artifacts: [
        { key: 'comet-state.yaml', exists: true },
        { key: 'brief', exists: true },
        { key: 'spec-dashboard', exists: true },
        { key: 'verification', exists: true },
      ],
    });
    expect(detail?.acceptanceItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'A1', result: 'failed' })]),
    );
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain('private-execution-id');
    expect(serialized).not.toContain(path.join(projectRoot, '.comet', 'private.log'));
    await expect(fs.readFile(path.join(changeDir, NATIVE_CHANGE_STATE_FILE), 'utf8')).resolves.toBe(
      yamlBefore,
    );
    await expect(fs.readFile(localFile, 'utf8')).resolves.toBe(localBefore);
  });

  it('previews a large artifact from a fixed 48 KiB read budget', async () => {
    await enableNative();
    const state = activeShapeState('large-preview');
    const changeDir = await writeActiveState(state);
    const size = 2 * 1024 * 1024;
    const briefFile = path.join(changeDir, 'brief.md');
    await fs.writeFile(briefFile, Buffer.alloc(size, 0x61));

    const originalOpen = fs.open.bind(fs);
    let bytesRead = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (path.resolve(args[0].toString()) !== briefFile) return handle;
      const originalRead = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await originalRead(...readArgs);
        bytesRead += result.bytesRead;
        return result;
      };
      return handle;
    });

    const detail = await collectNativeDashboardChangeDetail(projectRoot, {
      status: 'active',
      name: state.name,
    });

    const briefArtifact = detail?.artifacts.find((artifact) => artifact.key === 'brief');
    expect(briefArtifact).toEqual(
      expect.objectContaining({ key: 'brief', exists: true, size, truncated: true }),
    );
    expect(briefArtifact?.content).toHaveLength(48 * 1024);
    expect(briefArtifact?.content).toMatch(/^a+$/u);
    expect(bytesRead).toBe(48 * 1024);
  });

  it('ignores a stale local execution overlay and exposes a recoverable YAML stage', async () => {
    const paths = await enableNative();
    const state = verifierReadyState('stale-overlay');
    await writeActiveState(state);
    const localFile = path.join(nativePreferredChangeRuntimeDir(paths, state.name), 'state.json');
    await writeNativeLocalExecution(localFile, localExecution(projectRoot, state, 3));

    const detail = await collectNativeDashboardChangeDetail(projectRoot, {
      status: 'active',
      name: state.name,
    });
    expect(detail?.loop?.actor).toBeNull();
    expect(detail?.localExecution).toMatchObject({
      status: 'absent',
      reason: 'version-mismatch',
      checks: [],
      recoverableFromStage: 'verify-ready',
    });
  });

  it('keeps legacy Native archives visible through an explicit read-only adapter', async () => {
    const paths = await enableNative();
    await fs.mkdir(paths.archiveDir, { recursive: true });
    await fs.cp(
      LEGACY_ARCHIVE_FIXTURE,
      path.join(paths.archiveDir, '2026-07-21-classic-config-block'),
      { recursive: true },
    );

    const page = await collectNativeDashboardChangePage(projectRoot, {
      status: 'archived',
      limit: 5,
    });
    expect(page.items[0]).toMatchObject({
      name: 'classic-config-block',
      status: 'archived',
      legacy: true,
      migration: { status: 'legacy-read-only' },
      localExecution: { reason: 'archived' },
    });
    const detail = await collectNativeDashboardChangeDetail(projectRoot, {
      status: 'archived',
      name: 'classic-config-block',
      archiveName: '2026-07-21-classic-config-block',
    });
    expect(detail).toMatchObject({
      legacy: true,
      loop: null,
      acceptance: null,
      checks: [],
      blockers: [],
      history: [],
    });
  });

  it('paginates with a stateless non-hash cursor and rejects it after the list changes', async () => {
    await enableNative();
    await Promise.all(
      ['alpha-change', 'bravo-change', 'charlie-change'].map((name) =>
        writeActiveState(activeShapeState(name)),
      ),
    );
    const first = await collectNativeDashboardChangePage(projectRoot, {
      status: 'active',
      limit: 1,
    });
    expect(first.items.map(({ name }) => name)).toEqual(['alpha-change']);
    expect(first.nextCursor).toMatch(/^native-dashboard-v2\./u);
    expect(first.nextCursor).not.toMatch(/[a-f0-9]{64}/u);

    const second = await collectNativeDashboardChangePage(projectRoot, {
      status: 'active',
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items.map(({ name }) => name)).toEqual(['bravo-change']);

    await writeActiveState(activeShapeState('delta-change'));
    await expect(
      collectNativeDashboardChangePage(projectRoot, {
        status: 'active',
        limit: 1,
        cursor: first.nextCursor!,
      }),
    ).rejects.toThrow('Stale Native Dashboard change cursor');
  });

  it('validates the requested page limit', async () => {
    await enableNative();
    await expect(
      collectNativeDashboardChangePage(projectRoot, { status: 'active', limit: 51 }),
    ).rejects.toThrow('between 1 and 50');
  });
});
