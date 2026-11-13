import { resolveWorkspaceRuntimeRootSync } from '../../domains/workflow-contract/workspace-runtime.js';
import { fixtureAcceptanceReview } from '../helpers/native-builder-acceptance-review.js';
import { requireFileSymlink } from '../helpers/file-symlink.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import {
  createFileRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../domains/engine/runtime.js';
import { createNativePortableState } from '../../domains/comet-native/native-portable-state.js';
import { runNativeCli } from '../../domains/comet-native/native-cli.js';
import { createNativePortableChange } from '../../domains/comet-native/native-portable-runtime.js';
import { withNativeMutation } from '../../domains/comet-native/native-mutation.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../domains/comet-native/native-paths.js';
import {
  collectNativeSdkShapeProposal,
  defineNativeWorkflowApplication,
} from '../../domains/comet-native/native-sdk-application.js';
import type { NativePortableState } from '../../domains/comet-native/native-portable-types.js';
import { parseClassicStateDocument } from '../../domains/comet-classic/classic-state.js';
import { runClassicCli } from '../../domains/comet-classic/classic-cli.js';
import { prepareClassicWorkspace } from '../../domains/comet-classic/classic-workspace.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';
import * as taskContext from '../../app/commands/comet-task-context.js';

const repositoryRoot = path.resolve('.');

const workflow = {
  id: 'editorial',
  version: '1',
  entry: 'draft',
  steps: {
    draft: { type: 'invoke_skill', ref: 'writer' },
    review: { type: 'ask_user', proposalFrom: 'draft' },
    publish: { type: 'call_tool', ref: 'publish' },
  },
  transitions: [
    { from: 'draft', to: 'review' },
    { from: 'review', to: 'publish', on: 'approved' },
    { from: 'review', to: 'draft', on: 'rejected' },
  ],
};

describe('Runtime JSON command', () => {
  let root: string;
  let projectRoot: string;
  let invocationCwd: string;
  let workflowFile: string;
  let requestNumber: number;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-command-'));
    projectRoot = path.join(root, 'editorial');
    invocationCwd = path.join(root, 'invocation');
    await Promise.all([fs.mkdir(projectRoot), fs.mkdir(invocationCwd)]);
    workflowFile = path.join(invocationCwd, 'workflow.json');
    await fs.writeFile(workflowFile, JSON.stringify(workflow));
    requestNumber = 0;
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function dispatch(request: unknown, overrides: Record<string, unknown> = {}) {
    const requestFile = path.join(invocationCwd, `request-${++requestNumber}.json`);
    await fs.writeFile(requestFile, JSON.stringify(request));
    return runtimeDispatchCommand(
      {
        request: requestFile,
        workflow: [workflowFile],
        rootDir: '../editorial/store',
        projectRoot: '../editorial',
        ...overrides,
      },
      {
        invocationCwd,
        environment: { COMET_RUNTIME_TEST_SECRET: 'not-persisted', PATH: process.env.PATH },
      },
    );
  }

  function classicStartRequest(changeDir: string) {
    const projected = parseClassicStateDocument({
      workflow: 'full',
      phase: 'open',
      design_doc: null,
      plan: null,
      build_mode: null,
      isolation: null,
      verify_mode: null,
      verify_result: 'pending',
      verified_at: null,
      archived: false,
    });
    if (!projected.classic) throw new Error('Classic fixture was not projected');
    const change = path.posix.basename(changeDir);
    return {
      operation: 'start',
      runId: change,
      workflow: { id: 'comet-classic-full', version: '2' },
      input: { change, changeDir },
      initialState: projected.classic,
    };
  }

  it('delivers Classic claim context to its receiving session without retrieving on status queries', async () => {
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet/config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    const changeDir = 'openspec/changes/classic-context';
    await fs.mkdir(path.join(projectRoot, changeDir), { recursive: true });
    const started = await dispatch(classicStartRequest(changeDir), {
      application: 'classic-full',
      workflow: [],
      rootDir: undefined,
    });
    if (started.response.status !== 'succeeded') throw new Error(JSON.stringify(started.response));
    const action = started.response.data.actions[0];
    const request = path.join(invocationCwd, 'classic-claim.json');
    await fs.writeFile(
      request,
      JSON.stringify({
        operation: 'claim',
        runId: 'classic-context',
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'classic-host',
        sessionId: 'classic-receiver',
        claimToken: 'classic-context-claim',
      }),
    );
    const collect = vi
      .spyOn(taskContext, 'collectCometTaskContextResult')
      .mockResolvedValue({ status: 'available', context: [] });
    try {
      const result = await runtimeDispatchCommand(
        { application: 'classic-full', projectRoot, request },
        { output: 'compact' },
      );
      expect(result.response.status).toBe('succeeded');
      expect(result.cliResponse).toMatchObject({
        data: {
          context: [],
          contextDelivery: { status: 'empty', sessionId: 'classic-receiver', phase: 'open' },
        },
      });
      if (result.response.status !== 'succeeded') throw new Error(JSON.stringify(result.response));
      const fullRun = result.response.data;
      const compact = (result.cliResponse as { data: Record<string, unknown> }).data;
      expect(fullRun.actions).toHaveLength(1);
      expect(compact).toMatchObject({
        runId: fullRun.runId,
        revision: fullRun.revision,
        status: fullRun.status,
        workflow: fullRun.workflow,
        configuration: { phase: 'open' },
        run: { id: fullRun.runId },
      });
      for (const field of [
        'actions',
        'actionContexts',
        'outputs',
        'state',
        'input',
        'waits',
        'definitionHashes',
      ])
        expect(compact).not.toHaveProperty(field);
      expect(
        (
          compact.continuation as {
            current: { actions: Array<{ id: string; contextRequest: { commandArgs: string[] } }> };
          }
        ).current.actions[0],
      ).toMatchObject({
        id: action.id,
        contextRequest: { commandArgs: expect.arrayContaining(['classic-receiver']) },
      });
      expect(collect).toHaveBeenCalledWith(
        projectRoot,
        expect.objectContaining({
          sessionId: 'classic-receiver',
          phase: 'open',
          contextMode: 'incremental',
        }),
        { workflow: 'classic', change: 'classic-context' },
        { timeoutMs: 2000 },
      );
      await fs.writeFile(
        request,
        JSON.stringify({ operation: 'inspect', runId: 'classic-context' }),
      );
      const inspected = await runtimeDispatchCommand(
        { application: 'classic-full', projectRoot, request },
        { output: 'compact' },
      );
      expect(inspected.cliResponse).toBeUndefined();
      expect(inspected.response.status === 'succeeded' && inspected.response.data).toEqual(fullRun);
      await fs.writeFile(request, JSON.stringify({ operation: 'next', runId: 'classic-context' }));
      const detailed = await runtimeDispatchCommand(
        { application: 'classic-full', projectRoot, request, details: true },
        { output: 'compact' },
      );
      expect(detailed.cliResponse).toBeUndefined();
      expect(detailed.response.status === 'succeeded' && detailed.response.data).toEqual(fullRun);
      expect(collect).toHaveBeenCalledTimes(1);
    } finally {
      collect.mockRestore();
    }
  });

  async function expectClassicRejectedWithoutWrites(
    request: unknown,
    reason: RegExp,
    targetProjectRoot = projectRoot,
  ) {
    const requestFile = path.join(invocationCwd, `request-${++requestNumber}.json`);
    await fs.writeFile(requestFile, JSON.stringify(request));
    const writes = (
      [
        'mkdir',
        'writeFile',
        'appendFile',
        'rename',
        'unlink',
        'rm',
        'rmdir',
        'copyFile',
        'symlink',
        'link',
        'truncate',
      ] as const
    ).map((method) => vi.spyOn(fs, method));
    const opens = vi.spyOn(fs, 'open');
    try {
      const result = await runtimeDispatchCommand(
        { request: requestFile, projectRoot: targetProjectRoot, application: 'classic-full' },
        { invocationCwd },
      );
      expect(result.response).toMatchObject({
        status: 'failed',
        error: { message: expect.stringMatching(reason) },
      });
      for (const write of writes) expect(write).not.toHaveBeenCalled();
      const writeFlags =
        fsConstants.O_WRONLY |
        fsConstants.O_RDWR |
        fsConstants.O_CREAT |
        fsConstants.O_TRUNC |
        fsConstants.O_APPEND;
      expect(
        opens.mock.calls.filter(([, flags]) =>
          typeof flags === 'string' ? /[wa+]/u.test(flags) : (flags & writeFlags) !== 0,
        ),
      ).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  }

  async function initializeNativeLinkedSdk(name: string): Promise<string> {
    execFileSync('git', ['init', '-b', 'main', projectRoot]);
    execFileSync('git', ['-C', projectRoot, 'config', 'user.name', 'Comet Test']);
    execFileSync('git', ['-C', projectRoot, 'config', 'user.email', 'comet@example.test']);
    await fs.writeFile(path.join(projectRoot, 'README.md'), '# Native project\n');
    execFileSync('git', ['-C', projectRoot, 'add', '.']);
    execFileSync('git', ['-C', projectRoot, 'commit', '-m', 'initial']);
    const linkedRoot = path.join(root, `${name}-worktree`);
    execFileSync('git', ['-C', projectRoot, 'worktree', 'add', '-b', `comet/${name}`, linkedRoot]);
    const initialized = await runNativeCli([
      'new',
      name,
      '--runtime',
      'sdk',
      '--json',
      '--project-root',
      linkedRoot,
    ]);
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    return linkedRoot;
  }

  it('records receipt results idempotently and rejects stale or mixed identities', async () => {
    const start = await dispatch({
      operation: 'start',
      runId: 'receipt-run',
      workflow: { id: 'editorial', version: '1' },
      input: null,
    });
    if (start.response.status !== 'succeeded') throw Error('start');
    const action = start.response.data.actions[0];
    const claim = await dispatch({
      operation: 'claim',
      runId: 'receipt-run',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'agent',
      sessionId: 'agent-session',
      claimToken: 'receipt-claim',
    });
    expect(claim.exitCode).toBe(0);
    const receipt = Buffer.from(
      JSON.stringify({
        runId: 'receipt-run',
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'receipt-claim',
      }),
    ).toString('base64url');
    const request = {
      operation: 'record-outcome',
      receipt,
      result: { status: 'succeeded', output: { article: 'Done' } },
    };
    const first = await dispatch(request);
    expect(first.exitCode).toBe(0);
    const repeat = await dispatch(request);
    expect(repeat.response).toEqual(expect.objectContaining({ status: 'succeeded' }));
    if (first.response.status !== 'succeeded' || repeat.response.status !== 'succeeded')
      throw Error('outcome');
    expect(repeat.response.data).toEqual(first.response.data);
    const bad = Buffer.from(
      JSON.stringify({
        runId: 'receipt-run',
        actionId: action.id,
        attempt: action.attempt + 1,
        inputHash: action.inputHash,
        claimToken: 'receipt-claim',
      }),
    ).toString('base64url');
    expect((await dispatch({ ...request, receipt: bad })).exitCode).not.toBe(0);
    expect((await dispatch({ ...request, runId: 'another-run' })).exitCode).not.toBe(0);
  });

  it('dispatches an application-declared command through the public JSON interface', async () => {
    await fs.writeFile(
      workflowFile,
      JSON.stringify({
        id: 'command-app',
        version: '1',
        entry: 'prepare',
        commands: { revise: 'revise' },
        steps: {
          prepare: { type: 'call_tool', ref: 'prepare' },
          revise: { type: 'call_tool', ref: 'revise' },
        },
      }),
    );
    const started = await dispatch({
      operation: 'start',
      runId: 'command-change',
      workflow: { id: 'command-app', version: '1' },
      input: null,
    });
    expect(started.response.status).toBe('succeeded');
    if (started.response.status !== 'succeeded') throw new Error('Start failed');
    const missingRevision = await dispatch({
      operation: 'dispatch-command',
      runId: 'command-change',
      commandId: 'revise-1',
      name: 'revise',
      input: { reason: 'changed' },
    });
    expect(missingRevision.response).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_REQUEST' },
    });
    const revised = await dispatch({
      operation: 'dispatch-command',
      runId: 'command-change',
      expectedRevision: started.response.data.revision,
      commandId: 'revise-1',
      name: 'revise',
      input: { reason: 'changed' },
    });
    expect(revised.response).toMatchObject({
      status: 'succeeded',
      data: {
        actions: [
          expect.objectContaining({ stepId: 'prepare', status: 'cancelled' }),
          expect.objectContaining({ stepId: 'revise', status: 'pending' }),
        ],
      },
    });
  });

  it('runs, resumes, approves, and cancels the same instance through independent commands', async () => {
    const cwdBefore = process.cwd();
    const started = await dispatch({
      operation: 'start',
      requestId: 'request-start',
      runId: 'article',
      workflow: { id: 'editorial', version: '1' },
      input: { topic: 'harness' },
    });
    expect(started.exitCode).toBe(0);
    expect(started.response).toMatchObject({
      protocolVersion: 1,
      requestId: 'request-start',
      status: 'succeeded',
      data: { runId: 'article', revision: 1, actions: [{ type: 'invoke_skill' }] },
    });
    if (started.response.status !== 'succeeded') throw new Error('Start failed');
    const action = started.response.data.actions[0];
    const claimed = await dispatch({
      operation: 'claim',
      runId: 'article',
      expectedRevision: 1,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'external-agent',
      sessionId: 'session-1',
      claimToken: 'claim-1',
    });
    expect(claimed.exitCode).toBe(0);
    const outcome = {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'claim-1',
      outcomeId: 'draft-result',
      status: 'succeeded',
      output: { article: 'Draft' },
    };
    const recorded = await dispatch({ operation: 'record-outcome', runId: 'article', outcome });
    expect(recorded.exitCode).toBe(0);
    if (recorded.response.status !== 'succeeded') throw new Error('Record failed');
    const wait = recorded.response.data.waits[0];
    const revised = await dispatch({
      operation: 'revise-wait',
      runId: 'article',
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      proposal: { article: 'Updated draft' },
    });
    expect(revised.exitCode).toBe(0);
    if (revised.response.status !== 'succeeded') throw new Error('Revise failed');
    const newWait = revised.response.data.waits[0];
    const stale = await dispatch({
      operation: 'resolve-wait',
      runId: 'article',
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'approval-stale',
      choice: 'approved',
    });
    expect(stale).toMatchObject({
      exitCode: 65,
      response: { status: 'failed', error: { code: 'STALE_PROPOSAL' } },
    });
    const approved = await dispatch({
      operation: 'resolve-wait',
      runId: 'article',
      waitId: newWait.id,
      proposalHash: newWait.proposalHash,
      decisionId: 'approval-current',
      choice: 'approved',
    });
    expect(approved.exitCode).toBe(0);
    const resumed = await dispatch({ operation: 'next', runId: 'article' });
    expect(resumed.response).toMatchObject({
      status: 'succeeded',
      data: { actions: [expect.anything(), { type: 'call_tool', status: 'pending' }] },
    });
    const cancelled = await dispatch({
      operation: 'cancel',
      runId: 'article',
      reason: 'User requested cancellation',
    });
    expect(cancelled.response).toMatchObject({
      status: 'succeeded',
      data: { status: 'cancelled' },
    });
    const inspected = await dispatch({ operation: 'inspect', runId: 'article' }, { workflow: [] });
    expect(inspected.response).toMatchObject({
      status: 'succeeded',
      data: { status: 'cancelled' },
    });
    const sdk = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({ rootDir: path.join(projectRoot, 'store') }),
      workflows: [],
    });
    expect(await sdk.inspect('article')).toMatchObject({ status: 'cancelled' });
    expect(JSON.stringify(inspected.response)).not.toContain('not-persisted');
    expect(process.cwd()).toBe(cwdBefore);
  });

  it('routes evidence invalidation requests through the public Runtime command', async () => {
    const started = await dispatch({
      operation: 'start',
      runId: 'article',
      workflow: { id: 'editorial', version: '1' },
      input: { topic: 'harness' },
    });
    expect(started.response.status).toBe('succeeded');
    const routed = await dispatch({
      operation: 'invalidate-evidence',
      runId: 'article',
      expectedRevision: 1,
      evidenceId: 'article:1',
      kind: 'proof',
      ref: 'proof.json',
      contentHash: 'a'.repeat(64),
      submissionId: 'stale-proof',
    });
    expect(routed.response).toMatchObject({
      status: 'failed',
      error: { code: 'EVIDENCE_WAIT_NOT_FOUND' },
    });
  });

  it('starts a workflow with per-Run state without changing its JSON definition', async () => {
    await fs.writeFile(
      workflowFile,
      JSON.stringify({
        id: 'per-change',
        version: '1',
        entry: 'open',
        stateSchema: {
          type: 'object',
          required: ['change'],
          properties: { change: { type: 'string' } },
        },
        steps: { open: { type: 'invoke_skill', ref: 'comet-open' } },
      }),
    );
    const started = await dispatch({
      operation: 'start',
      runId: 'per-change-example',
      workflow: { id: 'per-change', version: '1' },
      input: { change: 'example' },
      initialState: { change: 'example' },
    });
    expect(started.response).toMatchObject({
      status: 'succeeded',
      data: { state: { change: 'example' } },
    });
    const inspected = await dispatch({ operation: 'inspect', runId: 'per-change-example' });
    expect(inspected.response).toMatchObject({
      status: 'succeeded',
      data: { state: { change: 'example' } },
    });
  });

  it('starts and resumes the built-in Native application in the project SDK store', async () => {
    const started = await dispatch(
      {
        operation: 'start',
        runId: 'native-change',
        workflow: { id: 'comet-native', version: '4' },
        input: { name: 'native-change', artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name: 'native-change',
          language: 'en',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(started.response).toMatchObject({
      status: 'succeeded',
      data: {
        workflow: { id: 'comet-native', version: '4' },
        actions: [{ stepId: 'shape.prepare', status: 'pending' }],
      },
    });
    const stored = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'native'),
      }),
      workflows: [],
    });
    expect(await stored.inspect('native-change')).toMatchObject({ revision: 1 });
    const resumed = await dispatch(
      { operation: 'inspect', runId: 'native-change' },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(resumed.response).toMatchObject({
      status: 'succeeded',
      data: { runId: 'native-change', revision: 1 },
    });
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(
            resolveWorkspaceRuntimeRootSync(projectRoot),
            'change-owners',
            'native',
            'native-change.json',
          ),
          'utf8',
        ),
      ),
    ).toEqual({
      schema: 'comet.change-owner.v1',
      workflow: 'native',
      change: 'native-change',
      format: 'sdk',
      application: 'native',
      runId: 'native-change',
    });
  });

  it('shows an SDK-owned Native change through the normal status command without creating legacy state', async () => {
    const started = await dispatch(
      {
        operation: 'start',
        runId: 'native-change',
        workflow: { id: 'comet-native', version: '1' },
        input: { name: 'native-change', artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name: 'native-change',
          language: 'en',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(started.response.status).toBe('succeeded');

    const result = await runNativeCli([
      'status',
      'native-change',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(result.exitCode, result.stdout).toBe(0);
    const output = JSON.parse(result.stdout ?? '{}') as { data?: Record<string, unknown> };
    expect(output.data).toMatchObject({
      schema: 'comet.native.sdk-status.v1',
      name: 'native-change',
      phase: 'shape',
      status: 'active',
      run: { id: 'native-change', revision: 1, actions: [{ stepId: 'shape.prepare' }] },
    });
    await expect(
      fs.access(
        path.join(projectRoot, 'docs', 'comet', 'changes', 'native-change', 'comet-state.yaml'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('lists SDK-owned Native changes when the project has no legacy Native config', async () => {
    const started = await dispatch(
      {
        operation: 'start',
        runId: 'native-change',
        workflow: { id: 'comet-native', version: '1' },
        input: { name: 'native-change', artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name: 'native-change',
          language: 'en',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(started.response.status).toBe('succeeded');

    const listed = await runNativeCli(['status', '--project-root', projectRoot, '--json']);
    expect(listed.exitCode, listed.stdout).toBe(0);
    const output = JSON.parse(listed.stdout ?? '{}') as {
      data: { total: number; items: Array<{ name: string; schema: string }> };
    };
    expect(output.data.total).toBe(1);
    expect(output.data.items).toMatchObject([
      { name: 'native-change', schema: 'comet.native.sdk-status.v1' },
    ]);
  });

  it('renders SDK-owned Native status in the change language', async () => {
    const started = await dispatch(
      {
        operation: 'start',
        runId: 'native-change',
        workflow: { id: 'comet-native', version: '1' },
        input: { name: 'native-change', artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name: 'native-change',
          language: 'zh-CN',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(started.response.status).toBe('succeeded');

    const status = await runNativeCli(['status', 'native-change', '--project-root', projectRoot]);
    expect(status.exitCode, status.stdout).toBe(0);
    expect(status.stdout).toContain('native-change');
    expect(status.stdout).toContain('Shape（需求共识）');
    expect(status.stdout).toContain('NEXT: comet native next native-change');
    expect(status.stdout).not.toContain('Use the Native SDK Run');
  });

  it('lists SDK-owned and legacy Native changes on the same status page', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const legacy = await runNativeCli([
      'new',
      'legacy-change',
      '--runtime',
      'compat',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(legacy.exitCode).toBe(0);
    const started = await dispatch(
      {
        operation: 'start',
        runId: 'sdk-change',
        workflow: { id: 'comet-native', version: '1' },
        input: { name: 'sdk-change', artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name: 'sdk-change',
          language: 'en',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(started.response.status).toBe('succeeded');

    const listed = await runNativeCli(['status', '--project-root', projectRoot, '--json']);
    expect(listed.exitCode).toBe(0);
    const output = JSON.parse(listed.stdout ?? '{}') as {
      data: { total: number; items: Array<{ name: string; schema: string }> };
    };
    expect(output.data.total).toBe(2);
    expect(output.data.items.map(({ name, schema }) => ({ name, schema }))).toEqual([
      { name: 'legacy-change', schema: 'comet.native.status.v2' },
      { name: 'sdk-change', schema: 'comet.native.sdk-status.v1' },
    ]);
  });

  it('keeps Native and Classic SDK Runs with the same change name independent', async () => {
    const native = await dispatch(
      {
        operation: 'start',
        runId: 'shared-change',
        workflow: { id: 'comet-native', version: '1' },
        input: { name: 'shared-change', artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name: 'shared-change',
          language: 'en',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(native.response).toMatchObject({
      status: 'succeeded',
      data: { runId: 'shared-change', workflow: { id: 'comet-native' } },
    });

    const projected = parseClassicStateDocument({
      workflow: 'full',
      phase: 'open',
      design_doc: null,
      plan: null,
      build_mode: null,
      isolation: null,
      verify_mode: null,
      verify_result: 'pending',
      verified_at: null,
      archived: false,
    });
    if (!projected.classic) throw new Error('Classic fixture was not projected');
    const classic = await dispatch(
      {
        operation: 'start',
        runId: 'shared-change',
        workflow: { id: 'comet-classic-full', version: '1' },
        input: { change: 'shared-change', changeDir: 'openspec/changes/shared-change' },
        initialState: projected.classic,
      },
      { application: 'classic-full', workflow: [], rootDir: undefined },
    );
    expect(classic.response).toMatchObject({
      status: 'succeeded',
      data: { runId: 'shared-change', workflow: { id: 'comet-classic-full' } },
    });

    const resumedNative = await dispatch(
      { operation: 'inspect', runId: 'shared-change' },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    const resumedClassic = await dispatch(
      { operation: 'inspect', runId: 'shared-change' },
      { application: 'classic-full', workflow: [], rootDir: undefined },
    );
    expect(resumedNative.response).toMatchObject({
      status: 'succeeded',
      data: { workflow: { id: 'comet-native' } },
    });
    expect(resumedClassic.response, JSON.stringify(resumedClassic.response)).toMatchObject({
      status: 'succeeded',
      data: { workflow: { id: 'comet-classic-full' } },
    });
  });

  it('claims a Classic SDK Action only in the explicitly selected linked worktree', async () => {
    execFileSync('git', ['init', '-b', 'main', projectRoot]);
    execFileSync('git', ['-C', projectRoot, 'config', 'user.name', 'Comet Test']);
    execFileSync('git', ['-C', projectRoot, 'config', 'user.email', 'comet@example.test']);
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'openspec', 'changes', '.gitkeep'), '');
    await fs.writeFile(path.join(projectRoot, 'README.md'), '# Classic project\n');
    execFileSync('git', ['-C', projectRoot, 'add', '.']);
    execFileSync('git', ['-C', projectRoot, 'commit', '-m', 'initial']);
    const prepared = await prepareClassicWorkspace({
      projectRoot,
      name: 'linked-sdk',
      isolation: 'worktree',
    });
    const initialized = await runClassicCli(
      ['state', 'init', 'linked-sdk', 'full', '--isolation', 'worktree', '--runtime', 'sdk'],
      undefined,
      { projectRoot: prepared.projectRoot, invocationCwd: prepared.projectRoot },
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);

    const stateFile = path.join(
      prepared.projectRoot,
      'openspec',
      'changes',
      'linked-sdk',
      'comet-state.yaml',
    );
    const stateSource = await fs.readFile(stateFile, 'utf8');
    expect(stateSource).toContain('auto_transition: true');
    await fs.writeFile(
      stateFile,
      stateSource.replace('auto_transition: true', 'auto_transition: false'),
    );

    const unimported = await dispatch(
      { operation: 'inspect', runId: 'linked-sdk' },
      {
        application: 'classic-full',
        workflow: [],
        rootDir: undefined,
        projectRoot: prepared.projectRoot,
      },
    );
    expect(unimported.response).toMatchObject({
      status: 'failed',
      error: { message: expect.stringContaining('comet state next') },
    });
    expect(await fs.readFile(stateFile, 'utf8')).toBe(
      stateSource.replace('auto_transition: true', 'auto_transition: false'),
    );
    const synchronized = await runClassicCli(['state', 'next', 'linked-sdk', '--json'], undefined, {
      projectRoot: prepared.projectRoot,
      invocationCwd: prepared.projectRoot,
    });
    expect(synchronized.exitCode, synchronized.stdout).toBe(0);

    const inspected = await dispatch(
      { operation: 'inspect', runId: 'linked-sdk' },
      {
        application: 'classic-full',
        workflow: [],
        rootDir: undefined,
        projectRoot: prepared.projectRoot,
      },
    );
    expect(inspected.exitCode, inspected.response).toBe(0);
    if (inspected.response.status !== 'succeeded') throw new Error('Classic inspect failed');
    expect(inspected.response.data.state).toMatchObject({ autoTransition: false });
    const action = inspected.response.data.actions[0];
    const primary = await dispatch(
      {
        operation: 'claim',
        runId: 'linked-sdk',
        expectedRevision: inspected.response.data.revision,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'classic-host',
        claimToken: 'wrong-primary-claim',
      },
      { application: 'classic-full', workflow: [], rootDir: undefined },
    );
    expect(primary.response.status).toBe('failed');
    const stillLinked = await dispatch(
      { operation: 'inspect', runId: 'linked-sdk' },
      {
        application: 'classic-full',
        workflow: [],
        rootDir: undefined,
        projectRoot: prepared.projectRoot,
      },
    );
    expect(stillLinked.response.status === 'succeeded' && stillLinked.response.data).toEqual(
      inspected.response.data,
    );
    const claimed = await dispatch(
      {
        operation: 'claim',
        runId: 'linked-sdk',
        expectedRevision: inspected.response.data.revision,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'classic-host',
        claimToken: 'linked-sdk-open',
      },
      {
        application: 'classic-full',
        workflow: [],
        rootDir: undefined,
        projectRoot: prepared.projectRoot,
      },
    );
    expect(claimed.exitCode, JSON.stringify(claimed.response)).toBe(0);
    expect(claimed.response).toMatchObject({
      status: 'succeeded',
      data: { actions: [{ id: action.id, status: 'running' }] },
    });
    expect(
      await createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'classic'),
      }).read('linked-sdk'),
    ).toBeNull();
  });

  it('claims a Native SDK Action only in the explicitly selected linked worktree', async () => {
    const linkedRoot = await initializeNativeLinkedSdk('native-linked');

    const inspected = await dispatch(
      { operation: 'inspect', runId: 'native-linked' },
      { application: 'native', workflow: [], rootDir: undefined, projectRoot: linkedRoot },
    );
    expect(inspected.exitCode, JSON.stringify(inspected.response)).toBe(0);
    if (inspected.response.status !== 'succeeded') throw new Error('Native inspect failed');
    const action = inspected.response.data.actions[0];
    const primary = await dispatch(
      {
        operation: 'claim',
        runId: 'native-linked',
        expectedRevision: inspected.response.data.revision,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'native-host',
        claimToken: 'wrong-primary-claim',
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(primary.response.status).toBe('failed');
    const stillLinked = await dispatch(
      { operation: 'inspect', runId: 'native-linked' },
      { application: 'native', workflow: [], rootDir: undefined, projectRoot: linkedRoot },
    );
    expect(stillLinked.response.status === 'succeeded' && stillLinked.response.data).toEqual(
      inspected.response.data,
    );
    const claimed = await dispatch(
      {
        operation: 'claim',
        runId: 'native-linked',
        expectedRevision: inspected.response.data.revision,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'native-host',
        claimToken: 'native-linked-shape',
      },
      { application: 'native', workflow: [], rootDir: undefined, projectRoot: linkedRoot },
    );
    expect(claimed.exitCode, JSON.stringify(claimed.response)).toBe(0);
    expect(claimed.response).toMatchObject({
      status: 'succeeded',
      data: { actions: [{ id: action.id, status: 'running' }] },
    });
    expect(
      await createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'native'),
      }).read('native-linked'),
    ).toBeNull();
  });

  it('does not claim a linked Native SDK Action over an unregistered local legacy change', async () => {
    const name = 'native-collision';
    const linkedRoot = await initializeNativeLinkedSdk(name);
    const legacy = await runNativeCli([
      'new',
      name,
      '--runtime',
      'compat',
      '--json',
      '--project-root',
      projectRoot,
    ]);
    expect(legacy.exitCode, legacy.stderr).toBe(0);
    await fs.unlink(
      path.join(
        resolveWorkspaceRuntimeRootSync(projectRoot),
        'change-owners',
        'native',
        `${name}.json`,
      ),
    );
    const inspected = await dispatch(
      { operation: 'inspect', runId: name },
      { application: 'native', workflow: [], rootDir: undefined, projectRoot: linkedRoot },
    );
    expect(inspected.exitCode, JSON.stringify(inspected.response)).toBe(0);
    if (inspected.response.status !== 'succeeded') throw new Error('Native inspect failed');
    const action = inspected.response.data.actions[0];

    const claimed = await dispatch(
      {
        operation: 'claim',
        runId: name,
        expectedRevision: inspected.response.data.revision,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'native-host',
        claimToken: 'should-not-claim-remote',
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(claimed.response).toMatchObject({ status: 'failed' });
    const linkedAfter = await dispatch(
      { operation: 'inspect', runId: name },
      { application: 'native', workflow: [], rootDir: undefined, projectRoot: linkedRoot },
    );
    expect(linkedAfter.response).toMatchObject({
      status: 'succeeded',
      data: { actions: [{ id: action.id, status: 'pending' }] },
    });
  });

  it('rejects an SDK Run whose id does not identify the bound Native change', async () => {
    const result = await dispatch(
      {
        operation: 'start',
        runId: 'other-run',
        workflow: { id: 'comet-native', version: '1' },
        input: { name: 'native-change', artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name: 'native-change',
          language: 'en',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(result.response).toMatchObject({ status: 'failed' });
    expect(
      await createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'native'),
      }).read('other-run'),
    ).toBeNull();
  });

  it('requires an explicit change ID before reserving a built-in SDK owner', async () => {
    const result = await dispatch(
      {
        operation: 'start',
        workflow: { id: 'comet-native', version: '1' },
        input: { artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name: 'native-change',
          language: 'en',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(result.response).toMatchObject({ status: 'failed', error: { code: 'INVALID_REQUEST' } });
    await expect(
      fs.access(path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'change-owners')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not reserve a Native SDK owner when the Run initial state is invalid', async () => {
    const result = await dispatch(
      {
        operation: 'start',
        runId: 'native-change',
        workflow: { id: 'comet-native', version: '1' },
        input: { name: 'native-change', artifactRootRef: 'docs' },
        initialState: {},
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(result.response).toMatchObject({
      status: 'failed',
      error: { code: 'INITIAL_STATE_INVALID' },
    });
    await expect(
      fs.access(
        path.join(
          resolveWorkspaceRuntimeRootSync(projectRoot),
          'change-owners',
          'native',
          'native-change.json',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a Native Run that exists without a matching change owner', async () => {
    const application = defineNativeWorkflowApplication();
    const stored = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'native'),
      }),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      validators: application.validators,
      stateValidators: application.stateValidators,
      commandValidators: application.commandValidators,
      executors: application.executors,
    });
    const request = {
      operation: 'start',
      runId: 'native-change',
      workflow: { id: 'comet-native', version: '4' },
      input: { name: 'native-change', artifactRootRef: 'docs' },
      initialState: createNativePortableState({
        name: 'native-change',
        language: 'en',
        createdAt: '2026-09-25T00:00:00.000Z',
        nextAction: 'prepare-shape-confirmation',
      }),
    };
    await stored.start(request);

    const result = await dispatch(request, {
      application: 'native',
      workflow: [],
      rootDir: undefined,
    });
    expect(result.response).toMatchObject({ status: 'failed' });
    await expect(
      fs.access(
        path.join(
          resolveWorkspaceRuntimeRootSync(projectRoot),
          'change-owners',
          'native',
          'native-change.json',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('prevents the legacy Native new command from creating state for an SDK-owned change', async () => {
    const started = await dispatch(
      {
        operation: 'start',
        runId: 'native-change',
        workflow: { id: 'comet-native', version: '1' },
        input: { name: 'native-change', artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name: 'native-change',
          language: 'en',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(started.response.status).toBe('succeeded');
    const legacy = await runNativeCli([
      'new',
      'native-change',
      '--runtime',
      'compat',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(legacy.exitCode).not.toBe(0);
    expect(legacy.stdout).toContain('SDK Run');
    const advanced = await runNativeCli([
      'next',
      'native-change',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(advanced.exitCode).not.toBe(0);
    expect(advanced.stdout).toContain('SDK Run');
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await expect(
      createNativePortableChange({ paths, name: 'native-change', language: 'en' }),
    ).rejects.toThrow('SDK Run');
  });

  it('starts a Native SDK Run through a serial mutation without replacing its existing owner or state', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const lock = path.join(paths.runtimeDir, 'locks', 'native-change.lock');
    const retired = 'SIMULATED obsolete lock metadata; no writer is running.\n';
    await fs.mkdir(path.dirname(lock), { recursive: true });
    await fs.writeFile(lock, retired);
    const request = {
      operation: 'start',
      runId: 'native-change',
      workflow: { id: 'comet-native', version: '4' },
      input: { name: 'native-change', artifactRootRef: 'docs' },
      initialState: createNativePortableState({
        name: 'native-change',
        language: 'en',
        createdAt: '2026-09-25T00:00:00.000Z',
        nextAction: 'prepare-shape-confirmation',
      }),
    };
    const options = { application: 'native', workflow: [], rootDir: undefined };
    const started = await withNativeMutation(paths, () => dispatch(request, options));
    expect(started.response.status, JSON.stringify(started.response)).toBe('succeeded');
    const runtimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
    const ownerFile = path.join(runtimeRoot, 'change-owners/native/native-change.json');
    const owner = await fs.readFile(ownerFile, 'utf8');
    expect(JSON.parse(owner)).toEqual({
      schema: 'comet.change-owner.v1',
      workflow: 'native',
      change: 'native-change',
      format: 'sdk',
      application: 'native',
      runId: 'native-change',
    });
    const store = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(runtimeRoot, 'sdk-runs/native'),
    });
    const original = await store.read('native-change');
    expect(original?.workflow.version).toBe('4');
    const storeRoot = path.join(runtimeRoot, 'sdk-runs/native');
    const checkpoint = (await fs.readdir(storeRoot, { recursive: true })).find(
      (entry) => path.basename(entry) === 'checkpoint.json',
    );
    expect(checkpoint).toBeDefined();
    const checkpointFile = path.join(storeRoot, checkpoint!);
    const checkpointBytes = await fs.readFile(checkpointFile);
    const stateFile = path.join(paths.changesDir, 'native-change', 'comet-state.yaml');
    const stateBytes = () =>
      fs.readFile(stateFile).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    const state = await stateBytes();
    const repeated = await dispatch(request, options);
    expect(repeated.response.status).toBe('succeeded');
    if (repeated.response.status !== 'succeeded')
      throw new Error(JSON.stringify(repeated.response));
    expect(repeated.response.data).toEqual(original);
    const conflict = await dispatch(
      { ...request, input: { ...request.input, task: 'SIMULATED different task' } },
      options,
    );
    expect(conflict.response).toMatchObject({ status: 'failed', error: { code: 'RUN_CONFLICT' } });
    expect(await store.read('native-change')).toEqual(original);
    expect(await fs.readFile(checkpointFile)).toEqual(checkpointBytes);
    expect(await fs.readFile(ownerFile, 'utf8')).toBe(owner);
    expect(await stateBytes()).toEqual(state);
    expect(await fs.readFile(lock, 'utf8')).toBe(retired);
  });

  it('does not claim an existing legacy Native change for a new SDK Run', async () => {
    const legacy = await runNativeCli([
      'new',
      'native-change',
      '--runtime',
      'compat',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(legacy.exitCode).toBe(0);
    const result = await dispatch(
      {
        operation: 'start',
        runId: 'native-change',
        workflow: { id: 'comet-native', version: '1' },
        input: { name: 'native-change', artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name: 'native-change',
          language: 'en',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      },
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(result.response).toMatchObject({ status: 'failed' });
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(
            resolveWorkspaceRuntimeRootSync(projectRoot),
            'change-owners',
            'native',
            'native-change.json',
          ),
          'utf8',
        ),
      ),
    ).toEqual({
      schema: 'comet.change-owner.v1',
      workflow: 'native',
      change: 'native-change',
      format: 'compat',
    });
  });

  it('restores legacy ownership before continuing a pre-existing Native change', async () => {
    const created = await runNativeCli([
      'new',
      'native-change',
      '--runtime',
      'compat',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(created.exitCode).toBe(0);
    const ownerFile = path.join(
      resolveWorkspaceRuntimeRootSync(projectRoot),
      'change-owners',
      'native',
      'native-change.json',
    );
    await fs.unlink(ownerFile);

    await runNativeCli(['next', 'native-change', '--project-root', projectRoot, '--json']);
    expect(JSON.parse(await fs.readFile(ownerFile, 'utf8'))).toEqual({
      schema: 'comet.change-owner.v1',
      workflow: 'native',
      change: 'native-change',
      format: 'compat',
    });
  });

  it('preserves the authoritative SDK Native Run when raw legacy state appears', async () => {
    const request = {
      operation: 'start',
      runId: 'native-change',
      workflow: { id: 'comet-native', version: '4' },
      input: { name: 'native-change', artifactRootRef: 'docs' },
      initialState: createNativePortableState({
        name: 'native-change',
        language: 'en' as const,
        createdAt: '2026-09-25T00:00:00.000Z',
        nextAction: 'prepare-shape-confirmation' as const,
      }),
    };
    const options = { application: 'native', workflow: [], rootDir: undefined };
    const started = await dispatch(request, options);
    expect(started.response.status).toBe('succeeded');
    if (started.response.status !== 'succeeded') throw Error('start failed');
    const original = started.response.data;
    const store = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'native'),
    });
    const legacyDir = path.join(projectRoot, 'docs', 'comet', 'changes', 'native-change');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'comet-state.yaml'), 'schema: comet.native.v4\n');
    const raw = await fs.readFile(path.join(legacyDir, 'comet-state.yaml'), 'utf8');
    const rawInspection = await dispatch({ operation: 'inspect', runId: 'native-change' }, options);
    expect(rawInspection.response).toMatchObject({ status: 'succeeded', data: original });
    expect(await store.read('native-change')).toEqual(original);
    expect(await fs.readFile(path.join(legacyDir, 'comet-state.yaml'), 'utf8')).toBe(raw);
    const advanced = await dispatch({ operation: 'next', runId: 'native-change' }, options);
    expect(advanced.response).toMatchObject({ status: 'succeeded' });
    expect(await store.read('native-change')).toEqual(original);
    expect(advanced.response.status === 'succeeded' && advanced.response.data).toEqual(original);
  });

  it('records an actual platform check through separate Native SDK requests and preserves approval', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const changeDir = path.join(paths.changesDir, 'native-change');
    await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome\nShip this workflow.\n# Scope\nPreserve confirmation.\n## Directory structure\n### Modified\n- src/ — preserve workflow confirmation and recovery.\n# Non-goals\nNone.\n# Acceptance examples\n- The workflow resumes.\n# Constraints and invariants\nKeep compatibility.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nRun focused checks.\n`,
    );
    await fs.writeFile(
      path.join(changeDir, 'specs', 'workflow', 'spec.md'),
      '# Workflow\nThe workflow resumes after confirmation.\n',
    );
    const builtIn = (request: unknown) =>
      dispatch(request, { application: 'native', workflow: [], rootDir: undefined });
    const succeeded = (response: Awaited<ReturnType<typeof builtIn>>): WorkflowRun => {
      if (response.response.status !== 'succeeded') {
        throw new Error(JSON.stringify(response.response.error));
      }
      return response.response.data;
    };
    const submit = async (run: WorkflowRun, output: unknown, id: string) => {
      const action = run.actions.at(-1)!;
      succeeded(
        await builtIn({
          operation: 'claim',
          runId: run.runId,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: 'native-host',
          ...(id === 'builder'
            ? { sessionId: 'builder-session-1' }
            : id === 'verifier'
              ? { sessionId: 'verifier-session-1' }
              : {}),
          claimToken: `claim-${id}`,
        }),
      );
      return succeeded(
        await builtIn({
          operation: 'record-outcome',
          runId: run.runId,
          outcome: {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken: `claim-${id}`,
            outcomeId: `outcome-${id}`,
            status: 'succeeded',
            output,
          },
        }),
      );
    };
    let run = succeeded(
      await builtIn({
        operation: 'start',
        runId: 'native-change',
        workflow: { id: 'comet-native', version: '4' },
        input: { name: 'native-change', artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name: 'native-change',
          language: 'en',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      }),
    );
    run = await submit(
      run,
      await collectNativeSdkShapeProposal({ paths, state: run.state as NativePortableState }),
      'shape',
    );
    const wait = run.waits.at(-1)!;
    run = succeeded(
      await builtIn({
        operation: 'resolve-wait',
        runId: run.runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'shape-approved',
        choice: 'approved',
      }),
    );
    const shapeApproval = run.waits.find((entry) => entry.id === wait.id)!;
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'pending' });
    const actual = spawnSync(
      process.execPath,
      [
        '-e',
        "require('node:fs').appendFileSync('platform-count','once\\n');process.stdout.write('sdk-check-ok')",
      ],
      { cwd: projectRoot, encoding: 'utf8', windowsHide: true },
    );
    expect(actual.status).toBe(0);
    expect(actual.stdout).toBe('sdk-check-ok');
    await fs.writeFile(path.join(projectRoot, 'platform-check.log'), actual.stdout + actual.stderr);
    const reports = [
      {
        name: 'Focused check',
        result: 'passed',
        note: 'Actual Agent-platform Node exit 0; stdout sdk-check-ok in platform-check.log. SIMULATED Agent protocol.',
      },
    ];
    run = await submit(
      run,
      {
        summary: 'Implemented the workflow.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: reports,
        knownLimits: [],
        review: null,
        submittedAt: '2026-09-25T01:00:00.000Z',
      },
      'builder',
    );
    const checked = run;
    const unavailable = await builtIn({
      operation: 'execute',
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
    });
    expect(unavailable.response.status).toBe('failed');
    expect(succeeded(await builtIn({ operation: 'inspect', runId: run.runId }))).toEqual(checked);
    expect(checked.actions.some((action) => action.stepId === 'verify.checks')).toBe(false);
    expect(checked.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    expect(checked.outputs['build.builder'].value).toMatchObject({ checks: reports });
    run = await submit(
      checked,
      {
        candidateId: (checked.state as NativePortableState).builder_handoff!.candidate_id,
        verifierExecutionRef: 'verifier-session-1',
        checks: reports,
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'The workflow resumes.' }],
            risks: [],
            summary: 'The independent Verifier passed the current candidate.',
          },
        },
      },
      'verifier',
    );
    expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
    const next = await runNativeCli([
      'next',
      'native-change',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(next.exitCode, next.stderr).toBe(0);
    const pending = succeeded(await builtIn({ operation: 'inspect', runId: run.runId }));
    expect(pending.waits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stepId: 'verify.confirm', status: 'pending' }),
      ]),
    );
    expect(pending.waits.find((entry) => entry.id === shapeApproval.id)).toEqual(shapeApproval);
    expect(pending.outputs['archive.finalize']).toBeUndefined();
    const approval = pending.waits.find(
      (entry) => entry.stepId === 'verify.confirm' && entry.status === 'pending',
    )!;
    expect(
      (
        await builtIn({
          operation: 'resolve-wait',
          runId: run.runId,
          waitId: approval.id,
          proposalHash: '0'.repeat(64),
          decisionId: 'SIMULATED-wrong-approval',
          choice: 'approved',
        })
      ).response.status,
    ).toBe('failed');
    expect(succeeded(await builtIn({ operation: 'inspect', runId: run.runId }))).toEqual(pending);
    expect(await fs.readFile(path.join(projectRoot, 'platform-count'), 'utf8')).toBe('once\n');
    expect(await fs.readFile(path.join(projectRoot, 'platform-check.log'), 'utf8')).toBe(
      'sdk-check-ok',
    );
  });

  it.each(['full', 'hotfix', 'tweak'] as const)(
    'starts the built-in Classic %s application with its own workflow',
    async (profile) => {
      const projected = parseClassicStateDocument({
        workflow: profile,
        phase: 'open',
        design_doc: null,
        plan: null,
        build_mode: null,
        isolation: null,
        verify_mode: null,
        verify_result: 'pending',
        verified_at: null,
        archived: false,
      });
      if (!projected.classic) throw new Error('Classic fixture was not projected');
      const started = await dispatch(
        {
          operation: 'start',
          runId: `classic-${profile}`,
          workflow: { id: `comet-classic-${profile}`, version: '2' },
          input: { changeDir: `openspec/changes/classic-${profile}` },
          initialState: projected.classic,
        },
        { application: `classic-${profile}`, workflow: [], rootDir: undefined },
      );
      expect(started.response).toMatchObject({
        status: 'succeeded',
        data: {
          workflow: { id: `comet-classic-${profile}`, version: '2' },
          actions: [{ stepId: `${profile}.open`, status: 'pending', type: 'invoke_skill' }],
        },
      });
    },
  );

  it.for(
    ['openspec', 'docs/openspec'].flatMap((base) =>
      ['double-file', 'double-dangling-symlink', 'single-symlink'].map((kind) => ({
        base,
        kind,
      })),
    ),
  )('rejects Classic $base $kind before raw start writes', async ({ base, kind }, context) => {
    if (kind !== 'double-file') await requireFileSymlink(context);
    const changeDirRef = `${base}/changes/classic-change`;
    const directory = path.join(projectRoot, changeDirRef);
    const modern = path.join(directory, 'comet-state.yaml');
    const legacy = path.join(directory, '.comet.yaml');
    await fs.mkdir(directory, { recursive: true });
    if (kind === 'single-symlink') {
      const outside = path.join(root, 'saved-state.yaml');
      await fs.writeFile(outside, 'workflow: full\nphase: open\n');
      await fs.symlink(outside, modern);
    } else {
      await fs.writeFile(modern, 'workflow: full\nphase: open\n');
      if (kind === 'double-file') await fs.copyFile(modern, legacy);
      else await fs.symlink(path.join(root, 'missing-state.yaml'), legacy);
    }
    await expectClassicRejectedWithoutWrites(
      classicStartRequest(changeDirRef),
      kind === 'single-symlink' ? /regular file/u : /ambiguous/u,
    );
    await expect(fs.lstat(resolveWorkspaceRuntimeRootSync(projectRoot))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.lstat(path.join(projectRoot, '.comet', 'runtime'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each(['classic-change', '2026-10-11-classic-change'])(
    'rejects conflicting Classic archive %s before raw start writes',
    async (archiveName) => {
      const directory = path.join(projectRoot, 'openspec', 'changes', 'archive', archiveName);
      await fs.mkdir(directory, { recursive: true });
      for (const file of ['comet-state.yaml', '.comet.yaml']) {
        await fs.writeFile(path.join(directory, file), 'workflow: full\nphase: archive\n');
      }
      await expectClassicRejectedWithoutWrites(
        classicStartRequest('openspec/changes/classic-change'),
        /ambiguous/u,
      );
      await expect(fs.lstat(resolveWorkspaceRuntimeRootSync(projectRoot))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('rejects conflicting Classic state files before raw inspect writes', async () => {
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    const changeDirRef = 'openspec/changes/classic-change';
    const directory = path.join(projectRoot, changeDirRef);
    await fs.mkdir(directory, { recursive: true });
    const started = await dispatch(classicStartRequest(changeDirRef), {
      application: 'classic-full',
      workflow: [],
      rootDir: undefined,
    });
    expect(started.response.status, JSON.stringify(started.response)).toBe('succeeded');
    const synchronized = await runClassicCli(
      ['state', 'next', 'classic-change', '--json'],
      undefined,
      { projectRoot, invocationCwd: projectRoot },
    );
    expect(synchronized.exitCode, synchronized.stdout).toBe(0);
    const inspected = await dispatch(
      { operation: 'inspect', runId: 'classic-change' },
      { application: 'classic-full', workflow: [], rootDir: undefined },
    );
    expect(inspected.response.status, JSON.stringify(inspected.response)).toBe('succeeded');
    const modern = path.join(directory, 'comet-state.yaml');
    const source = await fs.readFile(modern, 'utf8');
    await fs.copyFile(modern, path.join(directory, '.comet.yaml'));
    const backing = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'classic'),
    });
    const before = await backing.read('classic-change');
    await expectClassicRejectedWithoutWrites(
      { operation: 'inspect', runId: 'classic-change' },
      /ambiguous/u,
    );
    expect(await backing.read('classic-change')).toEqual(before);
    expect(await fs.readFile(modern, 'utf8')).toBe(source);
    expect(await fs.readFile(path.join(directory, '.comet.yaml'), 'utf8')).toBe(source);
  });

  it.each([false, true])(
    'rejects an explicitly selected linked Classic conflict before any Runtime writes (primary config=%s)',
    async (configuredPrimary) => {
      execFileSync('git', ['init', '-b', 'main', projectRoot]);
      execFileSync('git', ['-C', projectRoot, 'config', 'user.name', 'Comet Test']);
      execFileSync('git', ['-C', projectRoot, 'config', 'user.email', 'comet@example.test']);
      await fs.writeFile(path.join(projectRoot, 'README.md'), '# Classic project\n');
      execFileSync('git', ['-C', projectRoot, 'add', '.']);
      execFileSync('git', ['-C', projectRoot, 'commit', '-m', 'initial']);
      const linkedRoot = path.join(root, 'linked-unsafe-worktree');
      const branch = 'comet/linked-unsafe';
      execFileSync('git', ['-C', projectRoot, 'worktree', 'add', '-b', branch, linkedRoot]);
      if (configuredPrimary) {
        await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
        await fs.writeFile(
          path.join(projectRoot, '.comet', 'config.yaml'),
          'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
        );
        await fs.mkdir(path.join(projectRoot, 'openspec', 'changes'), { recursive: true });
      }
      await fs.mkdir(path.join(linkedRoot, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(linkedRoot, '.comet', 'config.yaml'),
        'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
      );
      await fs.mkdir(path.join(linkedRoot, 'openspec', 'changes', 'linked-unsafe'), {
        recursive: true,
      });
      const request = classicStartRequest('openspec/changes/linked-unsafe');
      request.initialState.isolation = 'worktree';
      request.initialState.boundBranch = branch;
      const started = await dispatch(request, {
        application: 'classic-full',
        workflow: [],
        rootDir: undefined,
        projectRoot: linkedRoot,
      });
      expect(started.response.status, JSON.stringify(started.response)).toBe('succeeded');
      const alternate = path.join(linkedRoot, 'docs', 'openspec', 'changes', 'linked-unsafe');
      await fs.mkdir(alternate, { recursive: true });
      for (const file of ['comet-state.yaml', '.comet.yaml']) {
        await fs.writeFile(path.join(alternate, file), 'workflow: full\nphase: open\n');
      }
      const runtimeRoot = resolveWorkspaceRuntimeRootSync(linkedRoot);
      const ownerFile = path.join(runtimeRoot, 'change-owners', 'classic', 'linked-unsafe.json');
      const owner = await fs.readFile(ownerFile, 'utf8');
      await expectClassicRejectedWithoutWrites(
        { operation: 'inspect', runId: 'linked-unsafe' },
        /ambiguous/u,
        linkedRoot,
      );
      expect(await fs.readFile(ownerFile, 'utf8')).toBe(owner);
      await expect(fs.lstat(resolveWorkspaceRuntimeRootSync(projectRoot))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('prevents the legacy Classic state command from initializing an SDK-owned change', async () => {
    const projected = parseClassicStateDocument({
      workflow: 'full',
      phase: 'open',
      design_doc: null,
      plan: null,
      build_mode: null,
      isolation: null,
      verify_mode: null,
      verify_result: 'pending',
      verified_at: null,
      archived: false,
    });
    if (!projected.classic) throw new Error('Classic fixture was not projected');
    const started = await dispatch(
      {
        operation: 'start',
        runId: 'classic-change',
        workflow: { id: 'comet-classic-full', version: '1' },
        input: { changeDir: 'openspec/changes/classic-change' },
        initialState: projected.classic,
      },
      { application: 'classic-full', workflow: [], rootDir: undefined },
    );
    expect(started.response.status).toBe('succeeded');
    const legacy = await runClassicCli(
      ['state', 'init', 'classic-change', 'full', '--runtime', 'compat'],
      undefined,
      {
        projectRoot,
        invocationCwd: projectRoot,
      },
    );
    expect(legacy.exitCode).not.toBe(0);
    expect(legacy.stderr).toContain('SDK Run');
  });

  it('does not claim an existing legacy Classic change for a new SDK Run', async () => {
    const changeDir = path.join(projectRoot, 'openspec', 'changes', 'classic-change');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, '.comet.yaml'), 'workflow: full\nphase: open\n');
    const projected = parseClassicStateDocument({
      workflow: 'full',
      phase: 'open',
      design_doc: null,
      plan: null,
      build_mode: null,
      isolation: null,
      verify_mode: null,
      verify_result: 'pending',
      verified_at: null,
      archived: false,
    });
    if (!projected.classic) throw new Error('Classic fixture was not projected');
    const result = await dispatch(
      {
        operation: 'start',
        runId: 'classic-change',
        workflow: { id: 'comet-classic-full', version: '1' },
        input: { changeDir: 'openspec/changes/classic-change' },
        initialState: projected.classic,
      },
      { application: 'classic-full', workflow: [], rootDir: undefined },
    );
    expect(result.response).toMatchObject({ status: 'failed' });
    await expect(
      fs.access(
        path.join(
          resolveWorkspaceRuntimeRootSync(projectRoot),
          'change-owners',
          'classic',
          'classic-change.json',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('ignores retired Classic ownership lock files without replacing an existing SDK owner or Run', async () => {
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet/config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    const runtimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
    const ownerFile = path.join(runtimeRoot, 'change-owners/classic/classic-change.json');
    const lock = path.join(runtimeRoot, 'change-owners/classic/classic-change.lock');
    const retired = 'SIMULATED obsolete lock metadata; no writer is running.\n';
    await fs.mkdir(path.dirname(lock), { recursive: true });
    await fs.writeFile(lock, retired);
    const request = classicStartRequest('openspec/changes/classic-change');
    const options = { application: 'classic-full', workflow: [], rootDir: undefined };
    const started = await dispatch(request, options);
    expect(started.response.status, JSON.stringify(started.response)).toBe('succeeded');
    const owner = await fs.readFile(ownerFile, 'utf8');
    expect(JSON.parse(owner)).toEqual({
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'classic-change',
      format: 'sdk',
      application: 'classic-full',
      runId: 'classic-change',
    });
    const backing = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(runtimeRoot, 'sdk-runs/classic'),
    });
    const original = await backing.read('classic-change');
    expect(original?.workflow.version).toBe('2');
    const repeated = await dispatch(request, options);
    expect(repeated.response.status).toBe('succeeded');
    if (repeated.response.status !== 'succeeded')
      throw new Error(JSON.stringify(repeated.response));
    expect(repeated.response.data).toEqual(original);
    const conflicting = await dispatch(
      { ...request, input: { ...request.input, goal: 'SIMULATED different user request' } },
      options,
    );
    expect(conflicting.response).toMatchObject({
      status: 'failed',
      error: { code: 'RUN_CONFLICT' },
    });
    expect(await backing.read('classic-change')).toEqual(original);
    expect(await fs.readFile(ownerFile, 'utf8')).toBe(owner);
    expect(await fs.readFile(lock, 'utf8')).toBe(retired);
  });

  it('initializes legacy Classic despite obsolete lock files and rejects a duplicate without replacing its owner or state', async () => {
    execFileSync('git', ['init', projectRoot]);
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet/config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    await fs.mkdir(path.join(projectRoot, 'openspec/changes'), { recursive: true });
    const runtimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
    const ownerFile = path.join(runtimeRoot, 'change-owners/classic/classic-change.json');
    const lock = path.join(runtimeRoot, 'change-owners/classic/classic-change.lock');
    const retired = 'SIMULATED obsolete lock metadata; no writer is running.\n';
    await fs.mkdir(path.dirname(lock), { recursive: true });
    await fs.writeFile(lock, retired);
    const init = () =>
      runClassicCli(['state', 'init', 'classic-change', 'full', '--runtime', 'compat'], undefined, {
        projectRoot,
        invocationCwd: projectRoot,
      });
    const started = await init();
    expect(started.exitCode, started.stderr).toBe(0);
    const owner = await fs.readFile(ownerFile, 'utf8');
    expect(JSON.parse(owner)).toEqual({
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'classic-change',
      format: 'compat',
    });
    const file = path.join(projectRoot, 'openspec/changes/classic-change/.comet.yaml');
    const original = await fs.readFile(file, 'utf8');
    expect((await init()).exitCode).not.toBe(0);
    expect(await fs.readFile(ownerFile, 'utf8')).toBe(owner);
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    expect(await fs.readFile(lock, 'utf8')).toBe(retired);
  });

  it('records legacy ownership when Classic state init creates a change', async () => {
    execFileSync('git', ['init', projectRoot]);
    execFileSync('git', ['-C', projectRoot, 'config', 'user.name', 'Comet Test']);
    execFileSync('git', ['-C', projectRoot, 'config', 'user.email', 'comet@example.test']);
    execFileSync('git', ['-C', projectRoot, 'commit', '--allow-empty', '-m', 'initial']);
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes'), { recursive: true });

    const result = await runClassicCli(
      ['state', 'init', 'classic-change', 'full', '--runtime', 'compat'],
      undefined,
      {
        projectRoot,
        invocationCwd: projectRoot,
      },
    );
    expect(result.exitCode).toBe(0);
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(
            resolveWorkspaceRuntimeRootSync(projectRoot),
            'change-owners',
            'classic',
            'classic-change.json',
          ),
          'utf8',
        ),
      ),
    ).toEqual({
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'classic-change',
      format: 'compat',
    });
  });

  it('records legacy ownership when reading a pre-existing Classic change', async () => {
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    const changeDir = path.join(projectRoot, 'openspec', 'changes', 'classic-change');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, '.comet.yaml'), 'workflow: full\nphase: open\n');

    const first = await runClassicCli(['state', 'get', 'classic-change', 'phase'], undefined, {
      projectRoot,
      invocationCwd: projectRoot,
    });
    expect(first.exitCode, first.stderr).toBe(0);
    expect(first.stdout).toBe('open\n');
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(
            resolveWorkspaceRuntimeRootSync(projectRoot),
            'change-owners',
            'classic',
            'classic-change.json',
          ),
          'utf8',
        ),
      ),
    ).toEqual({
      schema: 'comet.change-owner.v1',
      workflow: 'classic',
      change: 'classic-change',
      format: 'compat',
    });
  });

  it('deduplicates an identical result and returns a stable revision conflict', async () => {
    const started = await dispatch({
      operation: 'start',
      runId: 'article',
      workflow: { id: 'editorial', version: '1' },
      input: null,
    });
    if (started.response.status !== 'succeeded') throw new Error('Start failed');
    const action = started.response.data.actions[0];
    await dispatch({
      operation: 'claim',
      runId: 'article',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'agent',
      claimToken: 'claim',
    });
    const request = {
      operation: 'record-outcome',
      runId: 'article',
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'claim',
        outcomeId: 'result',
        status: 'succeeded',
        output: { article: 'Draft' },
      },
    };
    const first = await dispatch(request);
    const repeated = await dispatch(request);
    if (first.response.status !== 'succeeded' || repeated.response.status !== 'succeeded')
      throw new Error('Record failed');
    expect(repeated.response.data.revision).toBe(first.response.data.revision);
    const stale = await dispatch({ operation: 'next', runId: 'article', expectedRevision: 1 });
    expect(stale).toMatchObject({
      exitCode: 65,
      response: { error: { code: 'REVISION_CONFLICT' } },
    });
  });

  it('requires explicit reconciliation before retrying an unknown Action through the CLI', async () => {
    const started = await dispatch({
      operation: 'start',
      runId: 'article-recovery',
      workflow: { id: 'editorial', version: '1' },
      input: { topic: 'recovery' },
    });
    if (started.response.status !== 'succeeded') throw new Error('Start failed');
    const action = started.response.data.actions[0];
    const claimed = await dispatch({
      operation: 'claim',
      runId: started.response.data.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'external-agent',
      claimToken: 'claim-unknown',
    });
    expect(claimed.exitCode).toBe(0);

    const unknown = await dispatch({
      operation: 'mark-unknown',
      runId: started.response.data.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'The host disconnected after dispatch',
    });
    expect(unknown.response).toMatchObject({
      status: 'succeeded',
      data: { actions: [{ status: 'unknown', attempt: 1 }] },
    });

    const unsafeRetry = await dispatch({
      operation: 'retry',
      runId: started.response.data.runId,
      actionId: action.id,
      attempt: action.attempt,
    });
    expect(unsafeRetry).toMatchObject({
      exitCode: 65,
      response: { status: 'failed', error: { code: 'RECONCILIATION_REQUIRED' } },
    });

    const retried = await dispatch({
      operation: 'retry',
      runId: started.response.data.runId,
      actionId: action.id,
      attempt: action.attempt,
      reconciliation: {
        resolution: 'not-executed',
        evidence: { providerStatus: 'not-found' },
      },
    });
    expect(retried.response).toMatchObject({
      status: 'succeeded',
      data: { status: 'running', actions: [{ status: 'pending', attempt: 2 }] },
    });
  });

  it.each([
    ['unknown operation', { operation: 'delete', runId: 'article' }],
    ['missing run identity', { operation: 'inspect' }],
    [
      'unknown caller context',
      { operation: 'inspect', runId: 'article', context: { environment: { SECRET: 'x' } } },
    ],
    ['malformed revision', { operation: 'next', runId: 'article', expectedRevision: '1' }],
    ['malformed outcome', { operation: 'record-outcome', runId: 'article', outcome: {} }],
  ])('rejects %s with a machine-readable usage error', async (_name, request) => {
    const result = await dispatch(request);
    expect(result).toMatchObject({
      exitCode: 64,
      response: { status: 'failed', error: { code: 'INVALID_REQUEST' } },
    });
    expect(result.response.requestId).toEqual(expect.any(String));
  });

  it('isolates simultaneous invocations with different project and storage roots', async () => {
    const [first, second] = await Promise.all([
      dispatch({
        operation: 'start',
        runId: 'same-id',
        workflow: { id: 'editorial', version: '1' },
        input: 'A',
      }),
      dispatch(
        {
          operation: 'start',
          runId: 'same-id',
          workflow: { id: 'editorial', version: '1' },
          input: 'B',
        },
        { rootDir: '../other/store', projectRoot: '../other' },
      ),
    ]);
    expect(first.response).toMatchObject({ status: 'succeeded', data: { input: 'A' } });
    expect(second.response).toMatchObject({ status: 'succeeded', data: { input: 'B' } });
  });
});

describe('Runtime through the real CLI', () => {
  let packageRoot: string;
  let cli: string;
  let projectRoot: string;
  let requestFile: string;
  let workflowFile: string;

  beforeAll(async () => {
    packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-cli-'));
    await fs.mkdir(path.join(packageRoot, 'bin'));
    await Promise.all(
      ['comet.js', 'comet-daemon-route.js', 'comet-daemon-router.js', 'fast-runtime-router.js'].map(
        (name) =>
          fs.copyFile(path.join(repositoryRoot, 'bin', name), path.join(packageRoot, 'bin', name)),
      ),
    );
    await fs.copyFile(
      path.join(repositoryRoot, 'package.json'),
      path.join(packageRoot, 'package.json'),
    );
    await fs.symlink(
      path.join(repositoryRoot, 'node_modules'),
      path.join(packageRoot, 'node_modules'),
      'junction',
    );
    await ensureCliBuilt(repositoryRoot);
    await fs.cp(path.join(repositoryRoot, 'dist'), path.join(packageRoot, 'dist'), {
      recursive: true,
      filter: async (source) => {
        if (source === path.join(repositoryRoot, 'dist', 'domains', 'dashboard', 'web'))
          return false;
        return source.endsWith('.js') || (await fs.stat(source)).isDirectory();
      },
    });
    cli = path.join(packageRoot, 'bin/comet.js');
  }, 180_000);

  afterAll(async () => {
    if (packageRoot) await fs.rm(packageRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-cli-project-'));
    requestFile = path.join(projectRoot, 'request.json');
    workflowFile = path.join(projectRoot, 'workflow.json');
    await fs.writeFile(workflowFile, JSON.stringify(workflow));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  function run(...args: string[]) {
    return spawnSync(process.execPath, [cli, ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        COMET_DAEMON: '0',
        HOME: projectRoot,
        USERPROFILE: projectRoot,
        COMET_NO_HINTS: '1',
      },
    });
  }

  it('dispatches and inspects a persisted run in separate CLI processes', async () => {
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        operation: 'start',
        requestId: 'cli-start',
        runId: 'article',
        workflow: { id: 'editorial', version: '1' },
        input: { topic: 'orchestration' },
      }),
    );
    const args = [
      'runtime',
      'dispatch',
      '--request',
      requestFile,
      '--workflow',
      workflowFile,
      '--root-dir',
      'store',
      '--project-root',
      projectRoot,
      '--json',
    ];
    const start = run(...args);
    expect(start.status, start.stderr).toBe(0);
    expect(start.stderr).toBe('');
    expect(JSON.parse(start.stdout)).toMatchObject({
      status: 'succeeded',
      data: { runId: 'article', revision: 1 },
    });
    await fs.writeFile(requestFile, JSON.stringify({ operation: 'inspect', runId: 'article' }));
    const inspected = run(...args);
    expect(inspected.status, inspected.stderr).toBe(0);
    const snapshot = JSON.parse(inspected.stdout);
    expect(snapshot).toMatchObject({
      status: 'succeeded',
      data: { runId: 'article', actions: [{ type: 'invoke_skill' }] },
    });

    const action = snapshot.data.actions[0];
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        operation: 'claim',
        runId: 'article',
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'external-agent',
        claimToken: 'cli-claim',
      }),
    );
    expect(run(...args).status).toBe(0);
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        operation: 'mark-unknown',
        runId: 'article',
        actionId: action.id,
        attempt: action.attempt,
        reason: 'The process stopped after dispatch',
      }),
    );
    expect(run(...args).status).toBe(0);

    await fs.writeFile(
      requestFile,
      JSON.stringify({ operation: 'retry', runId: 'article', actionId: action.id, attempt: 1 }),
    );
    const unsafeRetry = run(...args);
    expect(unsafeRetry.status).toBe(65);
    expect(JSON.parse(unsafeRetry.stdout)).toMatchObject({
      status: 'failed',
      error: { code: 'RECONCILIATION_REQUIRED' },
    });

    await fs.writeFile(
      requestFile,
      JSON.stringify({
        operation: 'retry',
        runId: 'article',
        actionId: action.id,
        attempt: 1,
        reconciliation: { resolution: 'not-executed', evidence: { lookup: 'not-found' } },
      }),
    );
    const retry = run(...args);
    expect(retry.status, retry.stderr).toBe(0);
    await fs.writeFile(requestFile, JSON.stringify({ operation: 'inspect', runId: 'article' }));
    const recovered = run(...args);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      status: 'succeeded',
      data: { actions: [{ status: 'pending', attempt: 2 }] },
    });
  });

  it('runs the built-in Native application through the real CLI without a workflow file', async () => {
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        operation: 'start',
        runId: 'native-cli-example',
        workflow: { id: 'comet-native', version: '4' },
        input: { name: 'native-cli-example', artifactRootRef: 'docs' },
        initialState: createNativePortableState({
          name: 'native-cli-example',
          language: 'en',
          createdAt: '2026-09-25T00:00:00.000Z',
          nextAction: 'prepare-shape-confirmation',
        }),
      }),
    );
    const args = [
      'runtime',
      'dispatch',
      '--request',
      requestFile,
      '--application',
      'native',
      '--project-root',
      projectRoot,
      '--json',
    ];
    const start = run(...args);
    expect(start.status, start.stderr).toBe(0);
    expect(JSON.parse(start.stdout)).toMatchObject({
      status: 'succeeded',
      data: {
        runId: 'native-cli-example',
        workflow: { id: 'comet-native', version: '4' },
        continuation: { action: 'prepare-shape-confirmation' },
        inspection: { request: { operation: 'inspect', runId: 'native-cli-example' } },
      },
    });
    expect(JSON.parse(start.stdout).data.actions).toBeUndefined();
    await fs.writeFile(
      requestFile,
      JSON.stringify({ operation: 'inspect', runId: 'native-cli-example' }),
    );
    const inspected = run(...args);
    expect(inspected.status, inspected.stderr).toBe(0);
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      status: 'succeeded',
      data: {
        runId: 'native-cli-example',
        revision: 1,
        workflow: { id: 'comet-native', version: '4' },
        actions: [{ stepId: 'shape.prepare', status: 'pending' }],
      },
    });
  });

  it('returns structured JSON for malformed files and CLI usage errors', async () => {
    await fs.writeFile(requestFile, '{bad json');
    const malformed = run(
      'runtime',
      'dispatch',
      '--request',
      requestFile,
      '--root-dir',
      'store',
      '--json',
    );
    expect(malformed.status).toBe(64);
    expect(JSON.parse(malformed.stdout)).toMatchObject({
      status: 'failed',
      error: { code: 'REQUEST_JSON_INVALID' },
    });
    const missing = run('runtime', 'dispatch', '--root-dir', 'store', '--json');
    expect(missing.status).toBe(64);
    expect(JSON.parse(missing.stdout)).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('keeps existing Skill commands discoverable alongside the new Runtime help', () => {
    for (const args of [
      ['runtime', '--help'],
      ['help', 'runtime'],
    ]) {
      const result = run(...args);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('dispatch');
    }
    const oldSkill = run('skill', '--help');
    expect(oldSkill.status, oldSkill.stderr).toBe(0);
    expect(oldSkill.stdout).toContain('run');
    expect(oldSkill.stdout).toContain('continue');
    expect(oldSkill.stdout).toContain('check');
  });
});
