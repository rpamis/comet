import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '../../../domains/engine/runtime.js';
import { createRuntimeAction } from '../../../domains/engine/runtime-action.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { projectNativeSdkContinuation } from '../../../domains/comet-native/native-sdk-continuation.js';
import { archiveNativeSdkChange } from '../../../domains/comet-native/native-sdk-archive-command.js';

const mocked = vi.hoisted(() => ({ inspect: vi.fn(), execute: vi.fn(), load: vi.fn() }));
vi.mock('../../../domains/comet-native/native-runtime-ownership.js', () => ({
  inspectNativeSdkRun: mocked.inspect,
  loadOwnedNativeSdkRuntime: mocked.load,
}));
vi.mock('../../../domains/comet-native/native-sdk-status.js', () => ({
  inspectNativeSdkStatus: vi.fn(),
  projectNativeSdkStatus: async (
    options: { projectRoot: string },
    inspected: { run: WorkflowRun; state: ReturnType<typeof createNativePortableState> },
  ) => ({
    run: { revision: inspected.run.revision, status: inspected.run.status },
    ...(await projectNativeSdkContinuation({ ...inspected, projectRoot: options.projectRoot })),
  }),
}));

const options = {
  projectRoot: '/unused-boundary-fixture',
  name: 'archive-boundary',
  dryRun: false,
  recover: false,
  confirmed: false,
};
function archiveAction(
  stepId = 'archive.prepare',
  ref = 'native-archive-preflight',
  type = 'call_tool',
) {
  return createRuntimeAction({
    id: `${options.name}:${stepId}`,
    runId: options.name,
    stepId,
    ref,
    type,
    input: {},
  });
}
function inspection() {
  // 仅构造编排边界的读取快照；这些异常/扩展状态不会写入 Runtime。
  const state: ReturnType<typeof createNativePortableState> = {
    ...createNativePortableState({
      name: options.name,
      language: 'en',
      createdAt: '2026-10-07T00:00:00Z',
      nextAction: 'prepare-shape-confirmation',
    }),
    phase: 'archive' as const,
  };
  state.loop = { ...state.loop, stage: 'archive-ready', next_action: null };
  const run = {
    runId: options.name,
    revision: 7,
    status: 'active',
    workflow: { id: 'comet-native', version: '1', hash: 'fixture' },
    state,
    actions: [archiveAction()],
    waits: [],
    evidenceWaits: [],
    ready: [],
  } as unknown as WorkflowRun;
  return { run, state, artifactRootRef: 'docs', application: null };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocked.load.mockResolvedValue({
    runtime: { execute: mocked.execute },
    executors: [{ id: 'archive-executor', supports: () => true }],
  });
});

describe('Native Archive command stop boundaries', () => {
  it('waits on the original running Archive task instead of suggesting another Archive attempt', async () => {
    const current = inspection();
    const running = {
      ...archiveAction('custom.archive.review', 'custom-review'),
      status: 'running' as const,
      claim: { executorId: 'archive-executor', token: 'original-token' },
    };
    current.run.actions.push(running);
    mocked.inspect.mockResolvedValue(current);
    expect((await archiveNativeSdkChange({ ...options, dryRun: true })).data).toMatchObject({
      ready: false,
    });
    const result = await archiveNativeSdkChange(options);
    expect(result.exitCode).toBe(73);
    expect(mocked.execute).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      completedActions: [],
      activeActions: [{ id: running.id, claim: running.claim }],
      continuation: {
        commandArgs: null,
        userCommunication: { agentInstruction: expect.stringContaining('original claimed task') },
      },
    });
  });

  it('still exposes parallel pending Builder work outside Archive while another Action runs', async () => {
    const current = inspection();
    current.state.phase = 'build';
    current.state.loop.stage = 'building';
    current.run.actions = [
      archiveAction('build.builder', 'native-builder', 'handoff'),
      {
        ...archiveAction('custom.builder', 'custom-builder', 'handoff'),
        status: 'running',
        claim: { executorId: 'builder-executor', token: 'original-token' },
      },
    ];
    const projected = await projectNativeSdkContinuation({
      ...current,
      projectRoot: options.projectRoot,
    });
    expect(projected.continuation).toMatchObject({
      action: 'builder-handoff',
      commandArgs: [
        'comet',
        'runtime',
        'dispatch',
        '--application',
        'native',
        '--request',
        '<request-json-file>',
      ],
    });
  });

  it('uses next when multiple pending Actions prevent composite Archive advancement', async () => {
    const current = inspection();
    current.run.actions.push(archiveAction('custom.archive.review', 'custom-review'));
    mocked.inspect.mockResolvedValue(current);
    expect((await archiveNativeSdkChange({ ...options, dryRun: true })).data).toMatchObject({
      ready: false,
    });
    const result = await archiveNativeSdkChange(options);
    expect(result.exitCode).toBe(0);
    expect(mocked.execute).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      completedActions: [],
      pendingAction: { stepId: 'archive.prepare' },
      continuation: { commandArgs: ['comet', 'native', 'next', options.name] },
    });
  });

  it.each(['call_tool', 'invoke_skill'])(
    'leaves an unrecognized %s extension for its own continuation',
    async (type) => {
      const current = inspection();
      current.run.actions = [archiveAction('custom.archive.review', 'custom-review', type)];
      mocked.inspect.mockResolvedValue(current);
      expect((await archiveNativeSdkChange({ ...options, dryRun: true })).data).toMatchObject({
        ready: false,
      });
      const result = await archiveNativeSdkChange(options);
      expect(result.exitCode).toBe(0);
      expect(mocked.execute).not.toHaveBeenCalled();
      if (type === 'call_tool')
        expect(result.data).toMatchObject({
          continuation: { commandArgs: ['comet', 'native', 'next', options.name] },
        });
      else
        expect(result.data).toMatchObject({
          continuation: { disposition: 'blocked', commandArgs: null },
        });
    },
  );

  it.each(['running', 'unknown', 'failed'] as const)(
    'does not replay an original %s Action',
    async (status) => {
      const current = inspection();
      current.run.actions[0] = {
        ...current.run.actions[0],
        status,
        claim: { executorId: 'archive-executor', token: 'original-token' },
      };
      mocked.inspect.mockResolvedValue(current);
      expect((await archiveNativeSdkChange({ ...options, dryRun: true })).data).toMatchObject({
        ready: false,
      });
      expect(await archiveNativeSdkChange(options)).toMatchObject({
        exitCode: 73,
        error: { code: 'blocked' },
      });
      expect(mocked.execute).not.toHaveBeenCalled();
    },
  );

  it.each(['decision', 'evidence'] as const)(
    'preserves the full %s requirement even when another Archive Action is pending',
    async (kind) => {
      const current = inspection();
      const wait = {
        id: 'extension-wait',
        stepId: 'custom.archive.approval',
        status: 'pending',
        proposalHash: 'original-proposal-hash',
        proposal: { consequence: 'Keep the full proposal for the user.' },
        choices: ['approved', 'rejected'],
      };
      if (kind === 'decision') current.run.waits = [wait as never];
      else
        current.run.evidenceWaits = [
          {
            id: 'evidence-wait',
            stepId: 'custom.archive.evidence',
            status: 'pending',
            kind: 'external-evidence',
          } as never,
        ];
      current.state.status = 'done';
      current.state.archived = true;
      current.state.loop = { ...current.state.loop, stage: 'done', next_action: null };
      mocked.inspect.mockResolvedValue(current);
      expect((await archiveNativeSdkChange({ ...options, dryRun: true })).data).toMatchObject({
        ready: false,
      });
      const result = await archiveNativeSdkChange(options);
      expect(mocked.execute).not.toHaveBeenCalled();
      expect(result.data).toMatchObject({
        continuation: {
          disposition: kind === 'decision' ? 'await-user' : 'blocked',
          requiresUserDecision: kind === 'decision',
          commandArgs: null,
        },
      });
      if (kind === 'decision') expect(result.data).toMatchObject({ pendingWaits: [wait] });
      else expect(result.data).toMatchObject({ pendingEvidenceWaits: current.run.evidenceWaits });
    },
  );

  it('stops at an inserted extension after committing the preceding checkpoint', async () => {
    const current = inspection();
    mocked.inspect.mockResolvedValue(current);
    const committed = {
      ...current.run,
      revision: 9,
      actions: [
        { ...current.run.actions[0], status: 'succeeded' },
        archiveAction('custom.archive.review', 'custom-review'),
      ],
    };
    mocked.execute.mockResolvedValue(committed);
    const result = await archiveNativeSdkChange(options);
    expect(mocked.execute).toHaveBeenCalledTimes(1);
    expect(mocked.execute).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 7, actionId: current.run.actions[0].id }),
    );
    expect(result.data).toMatchObject({
      completedActions: [{ stepId: 'archive.prepare', status: 'succeeded' }],
      run: { revision: 9 },
      continuation: { commandArgs: ['comet', 'native', 'next', options.name] },
    });
  });
});
