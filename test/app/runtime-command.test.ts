import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import {
  createFileRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../domains/engine/runtime.js';
import { createNativePortableState } from '../../domains/comet-native/native-portable-state.js';
import { runNativeCli } from '../../domains/comet-native/native-cli.js';
import { createNativePortableChange } from '../../domains/comet-native/native-portable-runtime.js';
import { withNativeMutationLock } from '../../domains/comet-native/native-mutation-lock.js';
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
import { withRecoverableFileLock } from '../../platform/fs/plugin-store.js';
import { classicOpenEvidenceReceipt } from '../../domains/comet-classic/classic-sdk-application.js';

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
    expect(started.response).toMatchObject({
      status: 'succeeded',
      data: {
        workflow: { id: 'comet-native', version: '1' },
        actions: [{ stepId: 'shape.prepare', status: 'pending' }],
      },
    });
    const stored = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'native'),
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
            projectRoot,
            '.comet',
            'runtime',
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
    expect(status.stdout).toContain('native-change：');
    expect(status.stdout).toContain('Shape（需求共识）');
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

  it('claims a Classic SDK Action in a linked worktree when dispatched from the primary worktree', async () => {
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
      '.comet.yaml',
    );
    const stateSource = await fs.readFile(stateFile, 'utf8');
    expect(stateSource).toContain('auto_transition: true');
    await fs.writeFile(
      stateFile,
      stateSource.replace('auto_transition: true', 'auto_transition: false'),
    );

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
      { application: 'classic-full', workflow: [], rootDir: undefined },
    );
    expect(claimed.exitCode, JSON.stringify(claimed.response)).toBe(0);
    expect(claimed.response).toMatchObject({
      status: 'succeeded',
      data: { actions: [{ id: action.id, status: 'running' }] },
    });
    await expect(
      fs.access(
        path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic', 'linked-sdk.json'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('claims a Native SDK Action in a linked worktree when dispatched from the primary worktree', async () => {
    const linkedRoot = await initializeNativeLinkedSdk('native-linked');

    const inspected = await dispatch(
      { operation: 'inspect', runId: 'native-linked' },
      { application: 'native', workflow: [], rootDir: undefined, projectRoot: linkedRoot },
    );
    expect(inspected.exitCode, JSON.stringify(inspected.response)).toBe(0);
    if (inspected.response.status !== 'succeeded') throw new Error('Native inspect failed');
    const action = inspected.response.data.actions[0];
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
      { application: 'native', workflow: [], rootDir: undefined },
    );
    expect(claimed.exitCode, JSON.stringify(claimed.response)).toBe(0);
    expect(claimed.response).toMatchObject({
      status: 'succeeded',
      data: { actions: [{ id: action.id, status: 'running' }] },
    });
    await expect(
      fs.access(
        path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'native', 'native-linked.json'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
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
      path.join(projectRoot, '.comet', 'runtime', 'change-owners', 'native', `${name}.json`),
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
    await expect(
      fs.access(path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'other-run.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
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
      fs.access(path.join(projectRoot, '.comet', 'runtime', 'change-owners')),
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
          projectRoot,
          '.comet',
          'runtime',
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
        rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'native'),
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
      workflow: { id: 'comet-native', version: '1' },
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
          projectRoot,
          '.comet',
          'runtime',
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

  it('does not reserve an SDK-owned Native change while the Native mutation lock is held', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await withNativeMutationLock(paths, 'test legacy creation', async () => {
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
      await expect(
        fs.access(
          path.join(
            projectRoot,
            '.comet',
            'runtime',
            'change-owners',
            'native',
            'native-change.json',
          ),
        ),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });
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
            projectRoot,
            '.comet',
            'runtime',
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
      projectRoot,
      '.comet',
      'runtime',
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

  it('refuses to resume an SDK-owned Native change when legacy state appears', async () => {
    const request = {
      operation: 'start',
      runId: 'native-change',
      workflow: { id: 'comet-native', version: '1' },
      input: { name: 'native-change', artifactRootRef: 'docs' },
      initialState: createNativePortableState({
        name: 'native-change',
        language: 'en' as const,
        createdAt: '2026-09-25T00:00:00.000Z',
        nextAction: 'prepare-shape-confirmation' as const,
      }),
    };
    const options = { application: 'native', workflow: [], rootDir: undefined };
    expect((await dispatch(request, options)).response.status).toBe('succeeded');
    const legacyDir = path.join(projectRoot, 'docs', 'comet', 'changes', 'native-change');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'comet-state.yaml'), 'schema: comet.native.v4\n');
    const resumed = await dispatch(request, options);
    expect(resumed.response).toMatchObject({ status: 'failed' });
    const advanced = await dispatch({ operation: 'next', runId: 'native-change' }, options);
    expect(advanced.response).toMatchObject({ status: 'failed' });
  });

  it('executes a Native application check through separate SDK command requests', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const changeDir = path.join(paths.changesDir, 'native-change');
    await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome\nShip this workflow.\n# Scope\nPreserve confirmation.\n# Non-goals\nNone.\n# Acceptance examples\n- The workflow resumes.\n# Constraints and invariants\nKeep compatibility.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nRun focused checks.\n`,
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
        workflow: { id: 'comet-native', version: '1' },
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
    run = await submit(
      run,
      await collectNativeSdkShapeProposal({ paths, state: run.state as NativePortableState }),
      'shape-revalidated',
    );
    run = await submit(
      run,
      {
        summary: 'Implemented the workflow.',
        addressedAcceptanceIds: ['A1'],
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: '2026-09-25T01:00:00.000Z',
        verificationChecks: [
          {
            id: 'focused',
            name: 'Focused check',
            executable: process.execPath,
            argv: ['-e', 'process.stdout.write("sdk-check-ok")'],
            cwdRef: '.',
            timeoutMs: 5_000,
            repeatable: true,
          },
        ],
      },
      'builder',
    );
    const result = await builtIn({
      operation: 'execute',
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
    });
    const checked = succeeded(result);
    expect(checked.actions.at(-2)).toMatchObject({ stepId: 'verify.checks', status: 'succeeded' });
    expect(checked.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    expect(checked.outputs['verify.checks']).toMatchObject({
      value: { checks: [{ id: 'focused', status: 'passed' }] },
    });
    run = await submit(
      checked,
      {
        candidateId: (checked.state as NativePortableState).builder_handoff!.candidate_id,
        verifierExecutionRef: 'verifier-session-1',
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
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.report', status: 'pending' });
    const next = await runNativeCli([
      'next',
      'native-change',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(next.exitCode, next.stderr).toBe(0);
    expect(JSON.parse(next.stdout!)).toMatchObject({
      data: {
        run: {
          waits: expect.arrayContaining([
            expect.objectContaining({ stepId: 'verify.confirm', status: 'pending' }),
          ]),
        },
      },
    });
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
          workflow: { id: `comet-classic-${profile}`, version: '1' },
          input: { changeDir: `openspec/changes/classic-${profile}` },
          initialState: projected.classic,
        },
        { application: `classic-${profile}`, workflow: [], rootDir: undefined },
      );
      expect(started.response).toMatchObject({
        status: 'succeeded',
        data: {
          workflow: { id: `comet-classic-${profile}`, version: '1' },
          actions: [{ stepId: `${profile}.open`, status: 'pending', type: 'invoke_skill' }],
        },
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
          projectRoot,
          '.comet',
          'runtime',
          'change-owners',
          'classic',
          'classic-change.json',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not reserve a Classic SDK owner while the change ownership lock is held', async () => {
    const lock = path.join(
      projectRoot,
      '.comet',
      'runtime',
      'change-owners',
      'classic',
      'classic-change.lock',
    );
    await withRecoverableFileLock(lock, async () => {
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
            projectRoot,
            '.comet',
            'runtime',
            'change-owners',
            'classic',
            'classic-change.json',
          ),
        ),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('does not initialize legacy Classic state while the change ownership lock is held', async () => {
    execFileSync('git', ['init', projectRoot]);
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes'), { recursive: true });
    const lock = path.join(
      projectRoot,
      '.comet',
      'runtime',
      'change-owners',
      'classic',
      'classic-change.lock',
    );
    await withRecoverableFileLock(lock, async () => {
      const result = await runClassicCli(
        ['state', 'init', 'classic-change', 'full', '--runtime', 'compat'],
        undefined,
        {
          projectRoot,
          invocationCwd: projectRoot,
        },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Timed out waiting for file lock');
      await expect(
        fs.access(path.join(projectRoot, 'openspec', 'changes', 'classic-change', '.comet.yaml')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });
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
            projectRoot,
            '.comet',
            'runtime',
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
            projectRoot,
            '.comet',
            'runtime',
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

  it('reopens Classic full Open when approved artifacts drift before SDK revalidation', async () => {
    const changeDirRef = 'openspec/changes/classic-example';
    const changeDir = path.join(projectRoot, ...changeDirRef.split('/'));
    await fs.mkdir(changeDir, { recursive: true });
    for (const name of ['proposal.md', 'design.md', 'tasks.md']) {
      await fs.writeFile(path.join(changeDir, name), `# ${name}\nReady.\n`);
    }
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] Build\n');
    const projected = parseClassicStateDocument({
      workflow: 'full',
      phase: 'open',
      language: 'en',
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
    const builtIn = (request: unknown) =>
      dispatch(request, { application: 'classic-full', workflow: [], rootDir: undefined });
    const started = await builtIn({
      operation: 'start',
      runId: 'classic-example',
      workflow: { id: 'comet-classic-full', version: '1' },
      input: { change: 'classic-example', changeDir: changeDirRef },
      initialState: projected.classic,
    });
    if (started.response.status !== 'succeeded') throw new Error('Classic start failed');
    const action = started.response.data.actions[0];
    const claimed = await builtIn({
      operation: 'claim',
      runId: 'classic-example',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'classic-host',
      claimToken: 'classic-open-claim',
    });
    expect(claimed.response.status, JSON.stringify(claimed.response)).toBe('succeeded');
    const opened = await builtIn({
      operation: 'record-outcome',
      runId: 'classic-example',
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'classic-open-claim',
        outcomeId: 'classic-open-outcome',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });
    if (opened.response.status !== 'succeeded') throw new Error('Classic Open failed');
    const receipt = await classicOpenEvidenceReceipt(projectRoot, changeDirRef);
    const accepted = await builtIn({
      operation: 'record-evidence',
      runId: 'classic-example',
      evidenceId: opened.response.data.evidenceWaits!.at(-1)!.id,
      kind: 'classic-open-artifacts',
      ref: receipt.ref,
      contentHash: receipt.contentHash,
      submissionId: 'classic-open-evidence',
      expectedRevision: opened.response.data.revision,
    });
    expect(accepted.response, JSON.stringify(accepted.response)).toMatchObject({
      status: 'succeeded',
      data: {
        state: { phase: 'open' },
        waits: [
          {
            stepId: 'full.open.confirm',
            status: 'pending',
            proposal: {
              outputs: {
                'full.open.evidence': { contentHash: receipt.contentHash },
              },
            },
          },
        ],
      },
    });
    if (accepted.response.status !== 'succeeded') throw new Error('Open evidence failed');
    const confirmation = accepted.response.data.waits.at(-1)!;
    const approved = await builtIn({
      operation: 'resolve-wait',
      runId: 'classic-example',
      waitId: confirmation.id,
      proposalHash: confirmation.proposalHash,
      decisionId: 'classic-open-approved',
      choice: 'approved',
    });
    expect(approved.response).toMatchObject({
      status: 'succeeded',
      data: { state: { phase: 'open' } },
    });
    if (approved.response.status !== 'succeeded') throw new Error('Open approval failed');
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '# tasks.md\nChanged after approval.\n');
    const revalidation = approved.response.data.actions.at(-1)!;
    const checked = await builtIn({
      operation: 'execute',
      runId: 'classic-example',
      actionId: revalidation.id,
      executorId: 'comet-classic-open-revalidate',
    });
    expect(checked.response).toMatchObject({
      status: 'succeeded',
      data: {
        state: { phase: 'open' },
        actions: [
          expect.anything(),
          { stepId: 'full.open.revalidate', status: 'succeeded' },
          { stepId: 'full.open', status: 'pending' },
        ],
      },
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
      ['comet.js', 'comet-daemon-router.js', 'fast-runtime-router.js'].map((name) =>
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
    execFileSync(
      process.execPath,
      [
        path.join(repositoryRoot, 'node_modules/typescript/bin/tsc'),
        '--outDir',
        path.join(packageRoot, 'dist'),
        '--declaration',
        'false',
        '--declarationMap',
        'false',
        '--sourceMap',
        'false',
      ],
      { cwd: repositoryRoot, stdio: 'pipe' },
    );
    cli = path.join(packageRoot, 'bin/comet.js');
  }, 60_000);

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
        workflow: { id: 'comet-native', version: '1' },
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
      data: { actions: [{ stepId: 'shape.prepare', status: 'pending' }] },
    });
    await fs.writeFile(
      requestFile,
      JSON.stringify({ operation: 'inspect', runId: 'native-cli-example' }),
    );
    const inspected = run(...args);
    expect(inspected.status, inspected.stderr).toBe(0);
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      status: 'succeeded',
      data: { runId: 'native-cli-example', revision: 1 },
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
