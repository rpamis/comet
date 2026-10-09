import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  COMET_RESUME_PROBE_SCHEMA_VERSION,
  resolveCometEntryResumeProbe,
} from '../../../domains/comet-entry/resume-probe.js';
import {
  readChangeRuntimeOwner,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';
import {
  createFileRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { readNativeLocalExecution } from '../../../domains/comet-native/native-local-execution.js';
import { defineNativeWorkflowApplication } from '../../../domains/comet-native/native-sdk-application.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { readNativeSelectionRecord } from '../../../domains/comet-native/native-selection.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
import {
  createNativeSdkRuntime,
  inspectNativeSdkRun,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import {
  nativeLocalExecutionFile,
  nativePortableStateFile,
  returnNativePortableChangeToShape,
} from '../../../domains/comet-native/native-portable-runtime.js';

interface JsonEnvelope {
  command: string | null;
  exitCode: number;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

function json(result: Awaited<ReturnType<typeof runNativeCli>>): JsonEnvelope {
  expect(result.stdout).toBeTruthy();
  return JSON.parse(result.stdout!) as JsonEnvelope;
}

function inputTemplate(result: JsonEnvelope, name: string): Record<string, unknown> {
  const continuation = result.data?.continuation as {
    inputOptions: Array<{ name: string; template: Record<string, unknown> }>;
  };
  const option = continuation.inputOptions.find((option) => option.name === name);
  expect(option).toBeDefined();
  expect(Array.isArray(option!.template)).toBe(false);
  return structuredClone(option!.template);
}

describe('Native v4 public CLI surface', () => {
  let projectRoot: string;
  let runnerInputSequence: number;
  let confirmedAcceptanceIds: string[];
  const projectArgs = () => ['--project-root', projectRoot] as const;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-v4-cli-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    runnerInputSequence = 0;
    confirmedAcceptanceIds = [];
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('creates an SDK-owned Native change with its portable state file', async () => {
    const created = json(
      await runNativeCli(['new', 'sdk-change', '--runtime', 'sdk', '--json', ...projectArgs()]),
    );
    expect(created.exitCode, created.error?.message).toBe(0);
    expect(created.data).toMatchObject({
      name: 'sdk-change',
      phase: 'shape',
      run: { revision: 1, actions: [{ stepId: 'shape.prepare' }] },
    });
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    expect(
      await fs.readFile(path.join(paths.changesDir, 'sdk-change', 'brief.md'), 'utf8'),
    ).toContain('# Outcome');
    expect(await readNativeSelectionRecord(paths)).toMatchObject({ change: 'sdk-change' });
    expect(await fs.readFile(nativePortableStateFile(paths, 'sdk-change'), 'utf8')).toContain(
      'schema: comet.native.v4',
    );
    expect(await fs.readFile(nativePortableStateFile(paths, 'sdk-change'), 'utf8')).toContain(
      'phase: shape',
    );
    const status = json(await runNativeCli(['status', 'sdk-change', '--json', ...projectArgs()]));
    expect(status.exitCode, status.error?.message).toBe(0);
    const sdk = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'native'),
      }),
      workflows: [],
    });
    expect(await sdk.inspect('sdk-change')).toMatchObject({
      revision: 1,
      workflow: { id: 'comet-native' },
    });
  });

  it('lists a new SDK change once on the unnamed status page', async () => {
    const created = json(await runNativeCli(['new', 'page-sdk', '--json', ...projectArgs()]));
    expect(created.exitCode, created.error?.message).toBe(0);

    const page = json(await runNativeCli(['status', '--json', ...projectArgs()]));
    expect(page, page.error?.message).toMatchObject({
      exitCode: 0,
      data: {
        total: 1,
        items: [{ name: 'page-sdk', phase: 'shape', run: { revision: 1 } }],
      },
    });
  });

  it('does not reinterpret a legacy Archive as SDK recovery', async () => {
    const created = json(
      await runNativeCli([
        'new',
        'legacy-recovery',
        '--runtime',
        'compat',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(created.exitCode, created.error?.message).toBe(0);
    const recovery = json(
      await runNativeCli(['archive', 'legacy-recovery', '--recover', '--json', ...projectArgs()]),
    );
    expect(recovery.exitCode).not.toBe(0);
    expect(recovery.error?.message).toMatch(/only available for SDK-owned/);
  });

  it('uses compat for the previous Runtime option without accepting an unpublished legacy alias', async () => {
    const created = json(
      await runNativeCli([
        'new',
        'compat-change',
        '--runtime',
        'compat',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(created.exitCode, created.error?.message).toBe(0);
    const rejected = json(
      await runNativeCli([
        'new',
        'legacy-alias',
        '--runtime',
        'legacy',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(rejected.exitCode).not.toBe(0);
  });

  it('creates an SDK Run when Native new omits the runtime option', async () => {
    const created = json(await runNativeCli(['new', 'default-sdk', '--json', ...projectArgs()]));
    expect(created.exitCode, created.error?.message).toBe(0);
    expect(created.data).toMatchObject({
      name: 'default-sdk',
      run: { revision: 1, actions: [{ stepId: 'shape.prepare' }] },
    });
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    expect(await fs.readFile(nativePortableStateFile(paths, 'default-sdk'), 'utf8')).toContain(
      'state_version: 1',
    );
    expect((await inspectNativeSdkRun(projectRoot, 'default-sdk')).run.workflow.id).toBe(
      'comet-native',
    );
  });

  it('diagnoses an untouched copied SDK change read-only and restores it explicitly', async () => {
    const created = json(await runNativeCli(['new', 'portable-sdk', '--json', ...projectArgs()]));
    expect(created.exitCode, created.error?.message).toBe(0);

    const restoredRoot = path.join(projectRoot, 'restored-project');
    await fs.mkdir(path.join(restoredRoot, '.comet'), { recursive: true });
    await fs.cp(
      path.join(projectRoot, '.comet', 'config.yaml'),
      path.join(restoredRoot, '.comet', 'config.yaml'),
    );
    await fs.cp(path.join(projectRoot, 'docs'), path.join(restoredRoot, 'docs'), {
      recursive: true,
    });
    execFileSync('git', ['init'], { cwd: restoredRoot, stdio: 'ignore' });

    const readOnlyStatus = json(
      await runNativeCli(['status', 'portable-sdk', '--json', '--project-root', restoredRoot]),
    );
    expect(readOnlyStatus.exitCode).not.toBe(0);
    expect(readOnlyStatus.error?.message).toContain('checkpoint recovery');
    expect(await readChangeRuntimeOwner(restoredRoot, 'native', 'portable-sdk')).toBeNull();
    const repaired = json(
      await runNativeCli([
        'doctor',
        'portable-sdk',
        '--repair',
        '--confirmed',
        '--json',
        '--project-root',
        restoredRoot,
      ]),
    );
    expect(repaired.exitCode, repaired.error?.message).toBe(0);
    expect(repaired.data?.repaired).toBe(true);
    const namedStatus = json(
      await runNativeCli(['status', 'portable-sdk', '--json', '--project-root', restoredRoot]),
    );
    expect(namedStatus, namedStatus.error?.message).toMatchObject({
      exitCode: 0,
      data: { name: 'portable-sdk', phase: 'shape' },
    });
    const page = json(await runNativeCli(['status', '--json', '--project-root', restoredRoot]));
    expect(page.data.items).toEqual([
      expect.objectContaining({
        name: 'portable-sdk',
        phase: 'shape',
      }),
    ]);
    expect(await readChangeRuntimeOwner(restoredRoot, 'native', 'portable-sdk')).toMatchObject({
      format: 'sdk',
    });

    const diagnosed = json(
      await runNativeCli(['doctor', 'portable-sdk', '--json', '--project-root', restoredRoot]),
    );
    expect(diagnosed.data).toMatchObject({
      healthy: true,
      repaired: false,
    });

    const resumed = json(
      await runNativeCli(['next', 'portable-sdk', '--json', '--project-root', restoredRoot]),
    );
    expect(resumed.error?.message).toMatch(/Native shape document checks failed/);
    const status = json(
      await runNativeCli(['status', 'portable-sdk', '--json', '--project-root', restoredRoot]),
    );
    expect(status, status.error?.message).toMatchObject({
      exitCode: 0,
      data: {
        name: 'portable-sdk',
        phase: 'shape',
        run: { actions: [{ stepId: 'shape.prepare' }] },
      },
    });
  });

  it('does not silently convert an existing pristine Native change after local records are lost', async () => {
    const created = json(
      await runNativeCli([
        'new',
        'portable-original',
        '--runtime',
        'compat',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(created.exitCode, created.error?.message).toBe(0);

    const restoredRoot = path.join(projectRoot, 'restored-original');
    await fs.mkdir(path.join(restoredRoot, '.comet'), { recursive: true });
    await fs.cp(
      path.join(projectRoot, '.comet', 'config.yaml'),
      path.join(restoredRoot, '.comet', 'config.yaml'),
    );
    await fs.cp(path.join(projectRoot, 'docs'), path.join(restoredRoot, 'docs'), {
      recursive: true,
    });
    execFileSync('git', ['init'], { cwd: restoredRoot, stdio: 'ignore' });

    await runNativeCli(['next', 'portable-original', '--json', '--project-root', restoredRoot]);
    expect(await readChangeRuntimeOwner(restoredRoot, 'native', 'portable-original')).toMatchObject(
      {
        format: 'compat',
      },
    );
  });

  it('selects an untouched SDK change from its portable state in a fresh checkout', async () => {
    const created = json(await runNativeCli(['new', 'selectable-sdk', '--json', ...projectArgs()]));
    expect(created.exitCode, created.error?.message).toBe(0);

    const restoredRoot = path.join(projectRoot, 'restored-selectable');
    await fs.mkdir(path.join(restoredRoot, '.comet'), { recursive: true });
    await fs.cp(
      path.join(projectRoot, '.comet', 'config.yaml'),
      path.join(restoredRoot, '.comet', 'config.yaml'),
    );
    await fs.cp(path.join(projectRoot, 'docs'), path.join(restoredRoot, 'docs'), {
      recursive: true,
    });
    execFileSync('git', ['init'], { cwd: restoredRoot, stdio: 'ignore' });

    const selected = json(
      await runNativeCli(['select', 'selectable-sdk', '--json', '--project-root', restoredRoot]),
    );
    expect(selected.exitCode, selected.error?.message).toBe(0);
    expect(selected.data).toMatchObject({
      selected: 'selectable-sdk',
      schema: 'comet.native.sdk-status.v1',
      name: 'selectable-sdk',
      phase: 'shape',
    });
    expect(await readChangeRuntimeOwner(restoredRoot, 'native', 'selectable-sdk')).toMatchObject({
      format: 'sdk',
    });
  });

  it('diagnoses a progressed Native change whose portable state outlived its Run history', async () => {
    const created = json(await runNativeCli(['new', 'progressed-sdk', '--json', ...projectArgs()]));
    expect(created.exitCode, created.error?.message).toBe(0);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'progressed-sdk');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome
Keep the work recoverable.
# Scope
Update the relevant behavior.
# Non-goals
No unrelated changes.
# Acceptance examples
- The work can resume safely.
# Constraints and invariants
Preserve existing files.
# Decisions
Use the existing workflow.
# Open questions
None.
# Verification expectations
Run the focused checks.
`,
    );
    await fs.mkdir(path.join(changeDir, 'specs', 'recovery'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'recovery', 'spec.md'),
      '# Recovery\nThe workflow preserves its existing work.\n',
    );
    const advanced = json(
      await runNativeCli(['next', 'progressed-sdk', '--json', ...projectArgs()]),
    );
    expect(advanced.exitCode, advanced.error?.message).toBe(0);
    const originalRun = (await inspectNativeSdkRun(projectRoot, 'progressed-sdk')).run;
    const checkpoint = parse(await fs.readFile(path.join(changeDir, 'comet-state.yaml'), 'utf8'));
    expect(checkpoint.run_checkpoint.run.actions[0].claim.token).toMatch(/^portable-/u);
    expect(checkpoint.run_checkpoint.run.actions[0].claim.token).not.toBe(
      originalRun.actions[0].claim?.token,
    );

    const restoredRoot = path.join(projectRoot, 'restored-progressed');
    await fs.mkdir(path.join(restoredRoot, '.comet'), { recursive: true });
    await fs.cp(
      path.join(projectRoot, '.comet', 'config.yaml'),
      path.join(restoredRoot, '.comet', 'config.yaml'),
    );
    await fs.cp(path.join(projectRoot, 'docs'), path.join(restoredRoot, 'docs'), {
      recursive: true,
    });
    execFileSync('git', ['init'], { cwd: restoredRoot, stdio: 'ignore' });

    const diagnosed = json(
      await runNativeCli(['doctor', 'progressed-sdk', '--json', '--project-root', restoredRoot]),
    );
    expect(diagnosed.data).toMatchObject({
      healthy: false,
      repaired: false,
      findings: [{ code: 'sdk-run-recoverable' }],
    });
    const readOnlyStatus = json(
      await runNativeCli(['status', 'progressed-sdk', '--json', '--project-root', restoredRoot]),
    );
    expect(readOnlyStatus.exitCode).not.toBe(0);
    expect(readOnlyStatus.error?.message).toContain('checkpoint recovery');
    expect(await readChangeRuntimeOwner(restoredRoot, 'native', 'progressed-sdk')).toBeNull();
    const repaired = json(
      await runNativeCli([
        'doctor',
        'progressed-sdk',
        '--repair',
        '--confirmed',
        '--json',
        '--project-root',
        restoredRoot,
      ]),
    );
    expect(repaired.exitCode, repaired.error?.message).toBe(0);
    expect(repaired.data?.repaired).toBe(true);
    const status = json(
      await runNativeCli(['status', 'progressed-sdk', '--json', '--project-root', restoredRoot]),
    );
    expect(status, status.error?.message).toMatchObject({
      exitCode: 0,
      data: { name: 'progressed-sdk', phase: 'shape' },
    });
    const page = json(await runNativeCli(['status', '--json', '--project-root', restoredRoot]));
    expect(page, page.error?.message).toMatchObject({
      exitCode: 0,
      data: {
        items: [
          {
            name: 'progressed-sdk',
            phase: 'shape',
          },
        ],
      },
    });
    expect(await readChangeRuntimeOwner(restoredRoot, 'native', 'progressed-sdk')).toMatchObject({
      format: 'sdk',
    });
    const restoredPaths = await nativeProjectPaths(restoredRoot, 'docs');
    expect(
      await fs.readFile(path.join(restoredPaths.changesDir, 'progressed-sdk', 'brief.md'), 'utf8'),
    ).toContain('Keep the work recoverable');
    const restoredState = await fs.readFile(
      nativePortableStateFile(restoredPaths, 'progressed-sdk'),
      'utf8',
    );
    expect(restoredState).toContain('phase: shape');
    expect(restoredState).toContain('status: await-user');
    expect(
      (await inspectNativeSdkRun(restoredRoot, 'progressed-sdk')).run.actions.map(
        (action) => action.id,
      ),
    ).toEqual(originalRun.actions.map((action) => action.id));
    const resumed = json(
      await runNativeCli(['next', 'progressed-sdk', '--json', '--project-root', restoredRoot]),
    );
    expect(resumed.exitCode, resumed.error?.message).toBe(0);
  });

  it('resumes confirmed SDK Build from a copied portable state without local Run history', async () => {
    expect(
      json(await runNativeCli(['new', 'portable-build', '--json', ...projectArgs()])).exitCode,
    ).toBe(0);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'portable-build');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome
Keep completed work.
# Scope
Implement the requested behavior.
# Non-goals
No unrelated work.
# Acceptance examples
- The copied change resumes at Build.
# Constraints and invariants
Preserve the implementation.
# Decisions
Use the confirmed workflow.
# Open questions
None.
# Verification expectations
Run the focused checks.
`,
    );
    await fs.mkdir(path.join(changeDir, 'specs', 'recovery'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'recovery', 'spec.md'),
      '# Recovery\nThe change resumes at its confirmed stable boundary.\n',
    );
    const prepared = json(
      await runNativeCli(['next', 'portable-build', '--json', ...projectArgs()]),
    );
    expect(prepared.exitCode, prepared.error?.message).toBe(0);
    const confirmed = json(
      await runNativeCli([
        'next',
        'portable-build',
        '--confirmed',
        '--summary',
        'User approved the Shape.',
        '--expected-state-version',
        String(prepared.data?.stateVersion),
        '--expected-action',
        'confirm-shape',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(confirmed, confirmed.error?.message).toMatchObject({
      exitCode: 0,
      data: { phase: 'build' },
    });
    expect(
      parse(await fs.readFile(path.join(changeDir, 'comet-state.yaml'), 'utf8')).run_checkpoint,
    ).toBeDefined();
    await fs.writeFile(path.join(projectRoot, 'implementation.txt'), 'completed source work\n');

    const restoredRoot = path.join(projectRoot, 'copied-build');
    await fs.mkdir(path.join(restoredRoot, '.comet'), { recursive: true });
    await fs.cp(
      path.join(projectRoot, '.comet', 'config.yaml'),
      path.join(restoredRoot, '.comet', 'config.yaml'),
    );
    await fs.cp(path.join(projectRoot, 'docs'), path.join(restoredRoot, 'docs'), {
      recursive: true,
    });
    await fs.cp(
      path.join(projectRoot, 'implementation.txt'),
      path.join(restoredRoot, 'implementation.txt'),
    );
    execFileSync('git', ['init'], { cwd: restoredRoot, stdio: 'ignore' });

    const probe = await resolveCometEntryResumeProbe(restoredRoot, {
      schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
      utterance: '继续 portable-build',
      locale: 'zh-CN',
      agent_context: { non_trivial_work: true, already_in_comet_flow: false },
    });
    expect(probe).toMatchObject({
      action: 'auto_resume',
      changeName: 'portable-build',
      phase: 'build',
    });
    expect(await readChangeRuntimeOwner(restoredRoot, 'native', 'portable-build')).toBeNull();

    const readOnlyStatus = json(
      await runNativeCli(['status', 'portable-build', '--json', '--project-root', restoredRoot]),
    );
    expect(readOnlyStatus.exitCode).not.toBe(0);
    expect(readOnlyStatus.error?.message).toContain('checkpoint recovery');
    expect(await readChangeRuntimeOwner(restoredRoot, 'native', 'portable-build')).toBeNull();
    const repaired = json(
      await runNativeCli([
        'doctor',
        'portable-build',
        '--repair',
        '--confirmed',
        '--json',
        '--project-root',
        restoredRoot,
      ]),
    );
    expect(repaired.exitCode, repaired.error?.message).toBe(0);
    expect(repaired.data?.repaired).toBe(true);
    const resumed = json(
      await runNativeCli(['status', 'portable-build', '--json', '--project-root', restoredRoot]),
    );
    expect(resumed, resumed.error?.message).toMatchObject({
      exitCode: 0,
      data: { phase: 'build' },
    });
    expect(resumed.data?.run.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stepId: 'build.builder', status: 'pending' }),
      ]),
    );
    expect(await fs.readFile(path.join(restoredRoot, 'implementation.txt'), 'utf8')).toBe(
      'completed source work\n',
    );
  });

  it('rejects a changed portable Run checkpoint before creating Native ownership', async () => {
    expect(
      json(await runNativeCli(['new', 'changed-checkpoint', '--json', ...projectArgs()])).exitCode,
    ).toBe(0);
    const restoredRoot = path.join(projectRoot, 'copied-changed-checkpoint');
    await fs.mkdir(path.join(restoredRoot, '.comet'), { recursive: true });
    await fs.cp(
      path.join(projectRoot, '.comet', 'config.yaml'),
      path.join(restoredRoot, '.comet', 'config.yaml'),
    );
    await fs.cp(path.join(projectRoot, 'docs'), path.join(restoredRoot, 'docs'), {
      recursive: true,
    });
    execFileSync('git', ['init'], { cwd: restoredRoot, stdio: 'ignore' });
    const paths = await nativeProjectPaths(restoredRoot, 'docs');
    const file = nativePortableStateFile(paths, 'changed-checkpoint');
    const state = parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    (state.run_checkpoint as Record<string, unknown>).hash = '0'.repeat(64);
    await fs.writeFile(file, `# comet-execution: managed-run\n${stringify(state)}`);

    const status = json(
      await runNativeCli([
        'status',
        'changed-checkpoint',
        '--json',
        '--project-root',
        restoredRoot,
      ]),
    );
    expect(status.exitCode).not.toBe(0);
    expect(status.error?.message).toMatch(/checkpoint/iu);
    expect(await readChangeRuntimeOwner(restoredRoot, 'native', 'changed-checkpoint')).toBeNull();
  });

  it('restores when ownership was published but the Native Run commit was interrupted', async () => {
    expect(
      json(await runNativeCli(['new', 'owner-gap', '--json', ...projectArgs()])).exitCode,
    ).toBe(0);
    const restoredRoot = path.join(projectRoot, 'restored-owner-gap');
    await fs.mkdir(path.join(restoredRoot, '.comet'), { recursive: true });
    await fs.cp(
      path.join(projectRoot, '.comet', 'config.yaml'),
      path.join(restoredRoot, '.comet', 'config.yaml'),
    );
    await fs.cp(path.join(projectRoot, 'docs'), path.join(restoredRoot, 'docs'), {
      recursive: true,
    });
    execFileSync('git', ['init'], { cwd: restoredRoot, stdio: 'ignore' });
    const owner = await readChangeRuntimeOwner(projectRoot, 'native', 'owner-gap');
    if (owner?.format !== 'sdk') throw new Error('Expected SDK ownership');
    await registerSdkChangeOwner(restoredRoot, owner);

    const recovered = json(
      await runNativeCli([
        'doctor',
        'owner-gap',
        '--repair',
        '--confirmed',
        '--json',
        '--project-root',
        restoredRoot,
      ]),
    );
    expect(recovered.exitCode, recovered.error?.message).toBe(0);
    expect((await inspectNativeSdkRun(restoredRoot, 'owner-gap')).run.actions[0].stepId).toBe(
      'shape.prepare',
    );
  });

  it('diagnoses a default SDK change while retaining its state file', async () => {
    const created = json(await runNativeCli(['new', 'sdk-doctor', '--json', ...projectArgs()]));
    expect(created.exitCode).toBe(0);
    const diagnosed = json(
      await runNativeCli(['doctor', 'sdk-doctor', '--json', ...projectArgs()]),
    );
    expect(diagnosed, diagnosed.error?.message).toMatchObject({
      exitCode: 0,
      data: {
        workflow: 'native-sdk',
        runtimeFormat: 'sdk',
        change: 'sdk-doctor',
        healthy: true,
        repaired: false,
        run: { status: 'running' },
      },
    });
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    expect(await fs.readFile(nativePortableStateFile(paths, 'sdk-doctor'), 'utf8')).toContain(
      'phase: shape',
    );
  });

  it('requires workspace isolation before creating a second current-workspace SDK change', async () => {
    const first = json(
      await runNativeCli(['new', 'first-sdk', '--runtime', 'sdk', '--json', ...projectArgs()]),
    );
    expect(first.exitCode).toBe(0);
    const second = json(
      await runNativeCli(['new', 'second-sdk', '--runtime', 'sdk', '--json', ...projectArgs()]),
    );
    expect(second, second.error?.message).toMatchObject({
      exitCode: 73,
      error: { code: 'workspace-isolation-required' },
    });
    await expect(
      fs.access(
        path.join(projectRoot, '.comet', 'runtime', 'change-owners', 'native', 'second-sdk.json'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps an active SDK Run isolated when its artifact directory is missing', async () => {
    const first = json(
      await runNativeCli(['new', 'first-sdk', '--runtime', 'sdk', '--json', ...projectArgs()]),
    );
    expect(first.exitCode).toBe(0);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await fs.rename(
      path.join(paths.changesDir, 'first-sdk'),
      path.join(projectRoot, 'interrupted-first-sdk-artifacts'),
    );

    const second = json(
      await runNativeCli(['new', 'second-sdk', '--runtime', 'sdk', '--json', ...projectArgs()]),
    );
    expect(second, second.error?.message).toMatchObject({
      exitCode: 73,
      error: { code: 'workspace-isolation-required' },
    });
    await expect(
      fs.access(
        path.join(projectRoot, '.comet', 'runtime', 'change-owners', 'native', 'second-sdk.json'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('advances an SDK-owned change through the public Native next command', async () => {
    const created = json(
      await runNativeCli(['new', 'sdk-shape', '--runtime', 'sdk', '--json', ...projectArgs()]),
    );
    expect(created.exitCode).toBe(0);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'sdk-shape');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome
Ship the selected workflow.
# Scope
Preserve the selected workflow.
# Non-goals
None.
# Acceptance examples
- The selected workflow resumes.
# Constraints and invariants
Preserve existing compatibility.
# Decisions
None.
# Open questions
None.
# Verification expectations
Run focused Native checks.
`,
    );
    await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'workflow', 'spec.md'),
      '# Workflow\nThe selected workflow resumes without losing confirmed work.\n',
    );

    const advanced = json(await runNativeCli(['next', 'sdk-shape', '--json', ...projectArgs()]));
    expect(advanced, advanced.error?.message).toMatchObject({
      exitCode: 0,
      data: {
        change: 'sdk-shape',
        run: { waits: [{ stepId: 'shape.confirm', status: 'pending' }] },
      },
    });
    expect(await fs.readFile(nativePortableStateFile(paths, 'sdk-shape'), 'utf8')).toContain(
      'state_version: 2',
    );
  });

  it.each([
    'normal',
    'recover-finalize',
    'resume-builder',
    'cross-device',
    'cross-device-tampered',
  ] as const)(
    'routes Shape confirmation and Runtime checks while retaining portable state (%s)',
    async (archiveMode) => {
      const created = json(
        await runNativeCli(['new', 'sdk-confirm', '--runtime', 'sdk', '--json', ...projectArgs()]),
      );
      expect(created.exitCode).toBe(0);
      const paths = await nativeProjectPaths(projectRoot, 'docs');
      const changeDir = path.join(paths.changesDir, 'sdk-confirm');
      await fs.writeFile(
        path.join(changeDir, 'brief.md'),
        `# Outcome
Ship the selected workflow.
# Scope
Preserve the selected workflow.
# Non-goals
None.
# Acceptance examples
- The selected workflow resumes.
# Constraints and invariants
Preserve existing compatibility.
# Decisions
None.
# Open questions
None.
# Verification expectations
Run focused Native checks.
`,
      );
      await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'specs', 'workflow', 'spec.md'),
        '# Workflow\nThe selected workflow resumes without losing confirmed work.\n',
      );
      const prepared = json(
        await runNativeCli(['next', 'sdk-confirm', '--json', ...projectArgs()]),
      );
      expect(prepared).toMatchObject({
        exitCode: 0,
        data: {
          stateVersion: 2,
          continuation: { action: 'confirm-shape', disposition: 'await-user' },
        },
      });

      const confirmed = json(
        await runNativeCli([
          'next',
          'sdk-confirm',
          '--confirmed',
          '--summary',
          'User approved the Shape.',
          '--expected-state-version',
          '2',
          '--expected-action',
          'confirm-shape',
          '--json',
          ...projectArgs(),
        ]),
      );
      expect(confirmed, confirmed.error?.message).toMatchObject({
        exitCode: 0,
        data: {
          phase: 'build',
          run: {
            actions: expect.arrayContaining([
              expect.objectContaining({ stepId: 'build.builder', status: 'pending' }),
            ]),
          },
        },
      });
      expect(await fs.readFile(nativePortableStateFile(paths, 'sdk-confirm'), 'utf8')).toContain(
        'phase: build',
      );
      const builderNext = json(
        await runNativeCli(['next', 'sdk-confirm', '--json', ...projectArgs()]),
      );
      expect(builderNext, builderNext.error?.message).toMatchObject({
        exitCode: 0,
        data: {
          phase: 'build',
          pendingAction: { stepId: 'build.builder', mechanism: 'runtime-dispatch' },
          run: {
            actions: expect.arrayContaining([
              expect.objectContaining({ stepId: 'build.builder', status: 'pending' }),
            ]),
          },
        },
      });
      expect(builderNext.data).toHaveProperty('continuation.commandArgs', [
        'comet',
        'runtime',
        'dispatch',
        '--application',
        'native',
        '--request',
        '<request-json-file>',
        '--project-root',
        projectRoot,
        '--json',
      ]);

      const { run } = await inspectNativeSdkRun(projectRoot, 'sdk-confirm');
      let builder = run.actions.at(-1)!;
      const runtime = createNativeSdkRuntime(projectRoot);
      if (archiveMode === 'resume-builder') {
        const partialFile = path.join(projectRoot, 'partial-builder.txt');
        await fs.writeFile(partialFile, 'partial implementation\n');
        const failureContext = { requestId: 'builder-partial-failure', projectRoot };
        await runtime.claim({
          runId: run.runId,
          actionId: builder.id,
          attempt: builder.attempt,
          inputHash: builder.inputHash,
          executorId: 'native-host',
          sessionId: 'builder-partial-failure',
          claimToken: 'builder-partial-failure',
          context: failureContext,
        });
        const failed = await runtime.recordOutcome({
          runId: run.runId,
          outcome: {
            actionId: builder.id,
            attempt: builder.attempt,
            inputHash: builder.inputHash,
            claimToken: 'builder-partial-failure',
            outcomeId: 'builder-partial-failure',
            status: 'failed',
            output: { summary: 'Builder stopped after a partial implementation.' },
          },
          context: failureContext,
        });
        const wait = failed.waits.at(-1)!;
        expect(wait).toMatchObject({ stepId: 'build.resume', status: 'pending' });
        const preview = json(
          await runNativeCli(['next', 'sdk-confirm', '--json', ...projectArgs()]),
        );
        expect(preview, preview.error?.message).toMatchObject({
          exitCode: 0,
          data: {
            pendingBuilderDecisions: [
              {
                waitId: wait.id,
                proposalHash: wait.proposalHash,
                commandArgs: expect.arrayContaining([
                  '--continue-builder',
                  '--proposal-hash',
                  wait.proposalHash,
                  '--expected-action',
                  'continue-builder',
                ]),
              },
            ],
          },
        });
        const decisionArgs = [
          'next',
          'sdk-confirm',
          '--continue-builder',
          '--summary',
          'Continue from the inspected partial implementation.',
          '--proposal-hash',
          wait.proposalHash,
          '--expected-state-version',
          String((failed.state as NativePortableState).state_version),
          '--expected-action',
          'continue-builder',
          '--json',
          ...projectArgs(),
        ];
        const wrongHashArgs = [...decisionArgs];
        wrongHashArgs[wrongHashArgs.indexOf('--proposal-hash') + 1] = '0'.repeat(64);
        const wrongHash = json(await runNativeCli(wrongHashArgs));
        expect(wrongHash).toMatchObject({ exitCode: 73, error: { code: 'conflict' } });
        expect(
          (await inspectNativeSdkRun(projectRoot, 'sdk-confirm')).run.waits.at(-1),
        ).toMatchObject({
          id: wait.id,
          status: 'pending',
        });
        const resumed = json(await runNativeCli(decisionArgs));
        expect(resumed, resumed.error?.message).toMatchObject({
          exitCode: 0,
          data: {
            pendingAction: { stepId: 'build.builder' },
            run: {
              actions: expect.arrayContaining([
                expect.objectContaining({ id: builder.id, status: 'failed' }),
                expect.objectContaining({ stepId: 'build.builder', status: 'pending' }),
              ]),
            },
          },
        });
        expect(await fs.readFile(partialFile, 'utf8')).toBe('partial implementation\n');
        const stale = json(await runNativeCli(decisionArgs));
        expect(stale).toMatchObject({ exitCode: 73, error: { code: 'conflict' } });
        builder = (await inspectNativeSdkRun(projectRoot, 'sdk-confirm')).run.actions.at(-1)!;
        await fs.unlink(partialFile);
      }
      const context = { requestId: 'builder-result', projectRoot };
      const claimed = await runtime.claim({
        runId: run.runId,
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        executorId: 'native-host',
        sessionId: 'builder-session-1',
        claimToken: 'builder-claim',
        context,
      });
      const claim = claimed.actions.find((action) => action.id === builder.id)!.claim!;
      await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: builder.id,
          attempt: builder.attempt,
          inputHash: builder.inputHash,
          claimToken: claim.token,
          outcomeId: 'builder-result',
          status: 'succeeded',
          output: {
            summary: 'Implemented the workflow.',
            addressedAcceptanceIds: ['A1'],
            acceptanceReview: fixtureAcceptanceReview(['A1']),
            checks: [],
            knownLimits: [],
            review: null,
            submittedAt: new Date().toISOString(),
            verificationChecks: [
              {
                id: 'focused',
                name: 'Focused check',
                executable: process.execPath,
                argv: ['-e', 'process.exit(0)'],
                cwdRef: '.',
                timeoutMs: 5_000,
                repeatable: true,
              },
            ],
          },
        },
        context,
      });
      const checked = json(await runNativeCli(['next', 'sdk-confirm', '--json', ...projectArgs()]));
      expect(checked, checked.error?.message).toMatchObject({
        exitCode: 0,
        data: {
          phase: 'verify',
          run: {
            actions: expect.arrayContaining([
              expect.objectContaining({ stepId: 'verify.checks', status: 'succeeded' }),
              expect.objectContaining({ stepId: 'verify.verifier', status: 'pending' }),
            ]),
          },
        },
      });
      let checkedRun = (await inspectNativeSdkRun(projectRoot, 'sdk-confirm')).run;
      for (let index = 1; index <= 3; index += 1) {
        const failedAction = checkedRun.actions.at(-1)!;
        const failedContext = { requestId: `verifier-host-failure-${index}`, projectRoot };
        const failedClaimed = await runtime.claim({
          runId: checkedRun.runId,
          actionId: failedAction.id,
          attempt: failedAction.attempt,
          inputHash: failedAction.inputHash,
          executorId: 'native-host',
          sessionId: `failed-verifier-session-${index}`,
          claimToken: `failed-verifier-claim-${index}`,
          context: failedContext,
        });
        checkedRun = await runtime.recordOutcome({
          runId: checkedRun.runId,
          outcome: {
            actionId: failedAction.id,
            attempt: failedAction.attempt,
            inputHash: failedAction.inputHash,
            claimToken: failedClaimed.actions.find((action) => action.id === failedAction.id)!
              .claim!.token,
            outcomeId: `verifier-host-failure-${index}`,
            status: 'failed',
            output: { summary: 'The host confirmed the Verifier task failed.' },
          },
          context: failedContext,
        });
      }
      const retryWait = checkedRun.waits.at(-1)!;
      const retryStateVersion = (checkedRun.state as NativePortableState).state_version;
      const retryArgs = [
        'next',
        'sdk-confirm',
        '--retry-verifier',
        '--summary',
        'Retry the independent Verifier after confirmed host failures.',
        '--expected-state-version',
        String(retryStateVersion),
        '--expected-action',
        'retry-verifier',
        '--proposal-hash',
      ];
      const staleRetry = json(
        await runNativeCli([...retryArgs, 'stale', '--json', ...projectArgs()]),
      );
      expect(staleRetry.exitCode).toBe(73);
      const retry = json(
        await runNativeCli([...retryArgs, retryWait.proposalHash, '--json', ...projectArgs()]),
      );
      expect(retry, retry.error?.message).toMatchObject({
        exitCode: 0,
        data: {
          run: {
            actions: expect.arrayContaining([
              expect.objectContaining({ stepId: 'verify.verifier', status: 'pending' }),
            ]),
          },
        },
      });
      checkedRun = (await inspectNativeSdkRun(projectRoot, 'sdk-confirm')).run;
      const verifier = checkedRun.actions.at(-1)!;
      const verifierContext = { requestId: 'verifier-result', projectRoot };
      const verifierClaimed = await runtime.claim({
        runId: checkedRun.runId,
        actionId: verifier.id,
        attempt: verifier.attempt,
        inputHash: verifier.inputHash,
        executorId: 'native-host',
        sessionId: 'verifier-session-1',
        claimToken: 'verifier-claim',
        context: verifierContext,
      });
      await runtime.recordOutcome({
        runId: checkedRun.runId,
        outcome: {
          actionId: verifier.id,
          attempt: verifier.attempt,
          inputHash: verifier.inputHash,
          claimToken: verifierClaimed.actions.find((action) => action.id === verifier.id)!.claim!
            .token,
          outcomeId: 'verifier-result',
          status: 'succeeded',
          output: {
            candidateId: (checkedRun.state as NativePortableState).builder_handoff!.candidate_id,
            verifierExecutionRef: 'verifier-session-1',
            response: {
              kind: 'final-result',
              result: {
                iteration: 1,
                attempt: (checkedRun.state as NativePortableState).loop.attempt,
                verdict: 'pass',
                acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified the workflow.' }],
                risks: [],
                summary: 'All acceptance scenarios passed.',
              },
            },
          },
        },
        context: verifierContext,
      });
      const reported = json(
        await runNativeCli(['next', 'sdk-confirm', '--json', ...projectArgs()]),
      );
      expect(reported, reported.error?.message).toMatchObject({
        exitCode: 0,
        data: {
          phase: 'verify',
          run: {
            waits: expect.arrayContaining([
              expect.objectContaining({ stepId: 'verify.confirm', status: 'pending' }),
            ]),
          },
        },
      });
      const reportRun = (await inspectNativeSdkRun(projectRoot, 'sdk-confirm')).run;
      const reportWait = reportRun.waits.at(-1)!;
      const verifyStateVersion = (reportRun.state as NativePortableState).state_version;
      const reportedContinuation = reported.data!.continuation as {
        commandAlternatives: Array<{ name: string; commandArgs: string[] }>;
      };
      const reportedAccept = reportedContinuation.commandAlternatives.find(
        (alternative) => alternative.name === 'accept-result',
      )!;
      expect(reportedAccept.commandArgs).toEqual([
        'comet',
        'native',
        'next',
        'sdk-confirm',
        '--accept-result',
        '--summary',
        '<summary>',
        '--proposal-hash',
        reportWait.proposalHash,
        '--expected-state-version',
        String(verifyStateVersion),
        '--expected-action',
        'accept-result',
        '--project-root',
        projectRoot,
        '--json',
      ]);
      const statusAtDecision = json(
        await runNativeCli(['status', 'sdk-confirm', '--json', ...projectArgs()]),
      );
      const showAtDecision = json(
        await runNativeCli(['show', 'sdk-confirm', '--json', ...projectArgs()]),
      );
      expect(statusAtDecision.data!.continuation).toEqual(reportedContinuation);
      expect(showAtDecision.data!.continuation).toEqual(reportedContinuation);
      const decisionArgs = [
        'next',
        'sdk-confirm',
        '--accept-result',
        '--summary',
        'User accepted the independently verified result.',
        '--expected-state-version',
        String(verifyStateVersion),
        '--expected-action',
        'accept-result',
        '--proposal-hash',
      ];
      const stale = json(
        await runNativeCli([...decisionArgs, 'stale', '--json', ...projectArgs()]),
      );
      expect(stale.exitCode).toBe(73);
      expect(
        (await inspectNativeSdkRun(projectRoot, 'sdk-confirm')).run.waits.at(-1),
      ).toMatchObject({
        id: reportWait.id,
        status: 'pending',
      });
      const accepted = json(
        await runNativeCli(
          reportedAccept.commandArgs
            .slice(2)
            .map((argument) =>
              argument === '<summary>'
                ? 'User accepted the independently verified result.'
                : argument,
            ),
        ),
      );
      expect(accepted, accepted.error?.message).toMatchObject({
        exitCode: 0,
        data: {
          phase: 'archive',
          continuation: {
            disposition: 'continue',
            requiresUserDecision: false,
            commandArgs: [
              'comet',
              'native',
              'archive',
              'sdk-confirm',
              '--project-root',
              projectRoot,
              '--json',
            ],
          },
          run: {
            actions: expect.arrayContaining([
              expect.objectContaining({ stepId: 'verify.revalidate', status: 'succeeded' }),
              expect.objectContaining({ stepId: 'archive.prepare', status: 'pending' }),
            ]),
          },
        },
      });
      const archivePreview = json(
        await runNativeCli(['archive', 'sdk-confirm', '--dry-run', '--json', ...projectArgs()]),
      );
      expect(archivePreview, archivePreview.error?.message).toMatchObject({
        exitCode: 0,
        data: { runtimeFormat: 'sdk', ready: true, pendingAction: { stepId: 'archive.prepare' } },
      });
      const prematureRecovery = json(
        await runNativeCli(['archive', 'sdk-confirm', '--recover', '--json', ...projectArgs()]),
      );
      expect(prematureRecovery).toMatchObject({
        exitCode: 73,
        error: { code: 'conflict' },
      });
      const ambiguousRecovery = json(
        await runNativeCli([
          'archive',
          'sdk-confirm',
          '--recover',
          '--dry-run',
          '--json',
          ...projectArgs(),
        ]),
      );
      expect(ambiguousRecovery.exitCode).not.toBe(0);
      expect(ambiguousRecovery.error?.message).toMatch(/cannot be used together/);
      expect(
        (await inspectNativeSdkRun(projectRoot, 'sdk-confirm')).run.actions.at(-1),
      ).toMatchObject({
        stepId: 'archive.prepare',
        status: 'pending',
      });
      let finalized: JsonEnvelope;
      let finalRoot = projectRoot;
      if (archiveMode === 'normal') {
        finalized = json(
          await runNativeCli(['archive', 'sdk-confirm', '--json', ...projectArgs()]),
        );
        expect(finalized, finalized.error?.message).toMatchObject({
          exitCode: 0,
          data: {
            completedActions: [
              { stepId: 'archive.prepare', status: 'succeeded' },
              { stepId: 'archive.execute', status: 'succeeded' },
              { stepId: 'archive.finalize', status: 'succeeded' },
            ],
            run: { status: 'completed' },
          },
        });
      } else {
        // 恢复场景通过原 Runtime 契约停在收尾前，保留真实的独立检查点。
        for (const executorId of ['comet-native-archive-preflight', 'comet-native-archive-apply']) {
          const checkpoint = (await inspectNativeSdkRun(projectRoot, 'sdk-confirm')).run;
          await runtime.execute({
            runId: checkpoint.runId,
            expectedRevision: checkpoint.revision,
            actionId: checkpoint.actions.at(-1)!.id,
            executorId,
            context: { requestId: `prepare-recovery-${executorId}`, projectRoot },
          });
        }
        const pending = (await inspectNativeSdkRun(projectRoot, 'sdk-confirm')).run;
        const action = pending.actions.at(-1)!;
        const context = { requestId: 'archive-finalize-crash', projectRoot };
        const claimed = await runtime.claim({
          runId: pending.runId,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: 'comet-native-archive-finalize',
          claimToken: 'archive-finalize-owner',
          context,
        });
        const executor = defineNativeWorkflowApplication().executors.find(
          (entry) => entry.id === 'comet-native-archive-finalize',
        )!;
        await executor.execute(claimed.actions.at(-1)!, context, claimed);
        await runtime.markUnknown({
          runId: pending.runId,
          actionId: action.id,
          attempt: action.attempt,
          reason: 'Host stopped after moving the Archive',
        });
        if (archiveMode === 'cross-device' || archiveMode === 'cross-device-tampered') {
          finalRoot = path.join(projectRoot, 'archive-copy');
          await fs.mkdir(path.join(finalRoot, '.comet'), { recursive: true });
          await fs.cp(
            path.join(projectRoot, '.comet', 'config.yaml'),
            path.join(finalRoot, '.comet', 'config.yaml'),
          );
          await fs.cp(path.join(projectRoot, 'docs'), path.join(finalRoot, 'docs'), {
            recursive: true,
          });
          if (archiveMode === 'cross-device-tampered') {
            const copiedPaths = await nativeProjectPaths(finalRoot, 'docs');
            const archivedName = (await fs.readdir(copiedPaths.archiveDir)).find((name) =>
              name.endsWith('-sdk-confirm'),
            )!;
            const stateFile = path.join(copiedPaths.archiveDir, archivedName, 'comet-state.yaml');
            const copied = parse(await fs.readFile(stateFile, 'utf8')) as Record<string, unknown>;
            (copied.archive_receipt as { specs: unknown[] }).specs = [];
            await fs.writeFile(stateFile, `# comet-execution: managed-run\n${stringify(copied)}`);
          }
          execFileSync('git', ['init'], { cwd: finalRoot, stdio: 'ignore' });
        }
        finalized = json(
          await runNativeCli([
            'archive',
            'sdk-confirm',
            '--recover',
            '--json',
            '--project-root',
            finalRoot,
          ]),
        );
        if (archiveMode === 'cross-device-tampered') {
          expect(finalized.exitCode).not.toBe(0);
          expect(finalized.error?.message).toMatch(/receipt|Spec/i);
          return;
        }
        expect(finalized.exitCode, finalized.error?.message).toBe(0);
        expect(finalized.data).toMatchObject({
          recoveredAction: { id: action.id, stepId: 'archive.finalize' },
        });
      }
      expect(finalized, finalized.error?.message).toMatchObject({
        exitCode: 0,
        data: { status: 'done', run: { status: 'completed' } },
      });
      const finalPaths = await nativeProjectPaths(finalRoot, 'docs');
      await expect(
        fs.access(nativePortableStateFile(finalPaths, 'sdk-confirm')),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
      const archiveNames = await fs.readdir(finalPaths.archiveDir);
      const archiveName = archiveNames.find((name) => name.endsWith('-sdk-confirm'));
      expect(archiveName).toBeDefined();
      expect(
        await fs.readFile(
          path.join(finalPaths.archiveDir, archiveName!, 'comet-state.yaml'),
          'utf8',
        ),
      ).toContain('archived: true');
    },
  );

  it('routes a public requirements revision from SDK Verify back to Shape', async () => {
    const created = json(await runNativeCli(['new', 'sdk-revise', '--json', ...projectArgs()]));
    expect(created.exitCode).toBe(0);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'sdk-revise');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome
Ship the selected workflow.
# Scope
Preserve the selected workflow.
# Non-goals
None.
# Acceptance examples
- The selected workflow resumes.
# Constraints and invariants
Preserve existing compatibility.
# Decisions
None.
# Open questions
None.
# Verification expectations
Run focused Native checks.
`,
    );
    await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'workflow', 'spec.md'),
      '# Workflow\nThe selected workflow resumes without losing confirmed work.\n',
    );
    expect(
      json(await runNativeCli(['next', 'sdk-revise', '--json', ...projectArgs()])).exitCode,
    ).toBe(0);
    const prepared = await inspectNativeSdkRun(projectRoot, 'sdk-revise');
    const confirmed = json(
      await runNativeCli([
        'next',
        'sdk-revise',
        '--confirmed',
        '--summary',
        'User approved Shape.',
        '--expected-state-version',
        String(prepared.state.state_version),
        '--expected-action',
        'confirm-shape',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(confirmed.exitCode).toBe(0);
    const { run } = await inspectNativeSdkRun(projectRoot, 'sdk-revise');
    const builder = run.actions.at(-1)!;
    const runtime = createNativeSdkRuntime(projectRoot);
    const context = { requestId: 'sdk-revise-builder', projectRoot };
    const claimed = await runtime.claim({
      runId: run.runId,
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      executorId: 'native-host',
      sessionId: 'sdk-revise-builder-session',
      claimToken: 'sdk-revise-builder-claim',
      context,
    });
    await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        claimToken: claimed.actions.find((action) => action.id === builder.id)!.claim!.token,
        outcomeId: 'sdk-revise-builder-result',
        status: 'succeeded',
        output: {
          summary: 'Implemented the workflow.',
          addressedAcceptanceIds: ['A1'],
          acceptanceReview: fixtureAcceptanceReview(['A1']),
          checks: [],
          knownLimits: [],
          review: null,
          submittedAt: new Date().toISOString(),
          verificationChecks: [],
        },
      },
      context,
    });
    expect(
      json(await runNativeCli(['next', 'sdk-revise', '--json', ...projectArgs()])).exitCode,
    ).toBe(0);
    const verifying = await inspectNativeSdkRun(projectRoot, 'sdk-revise');
    expect(verifying.state.phase).toBe('verify');
    const revised = json(
      await runNativeCli([
        'next',
        'sdk-revise',
        '--revise-requirements',
        '--summary',
        'The acceptance criteria changed.',
        '--expected-state-version',
        String(verifying.state.state_version),
        '--expected-action',
        'revise-requirements',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(revised, revised.error?.message).toMatchObject({
      exitCode: 0,
      data: {
        phase: 'shape',
        run: {
          actions: expect.arrayContaining([
            expect.objectContaining({ stepId: 'shape.prepare', status: 'pending' }),
          ]),
        },
      },
    });
    expect((await inspectNativeSdkRun(projectRoot, 'sdk-revise')).state.phase).toBe('shape');
  });

  it('keeps the SDK Shape approval pending when documents drift before confirmation', async () => {
    const created = json(
      await runNativeCli(['new', 'sdk-stale', '--runtime', 'sdk', '--json', ...projectArgs()]),
    );
    expect(created.exitCode).toBe(0);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'sdk-stale');
    const brief = `# Outcome
Ship the selected workflow.
# Scope
Preserve the selected workflow.
# Non-goals
None.
# Acceptance examples
- The selected workflow resumes.
# Constraints and invariants
Preserve existing compatibility.
# Decisions
None.
# Open questions
None.
# Verification expectations
Run focused Native checks.
`;
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'workflow', 'spec.md'),
      '# Workflow\nThe selected workflow resumes without losing confirmed work.\n',
    );
    const prepared = json(await runNativeCli(['next', 'sdk-stale', '--json', ...projectArgs()]));
    expect(prepared.exitCode).toBe(0);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      brief.replace('Ship the selected workflow.', 'Ship a different workflow.'),
    );

    const confirmed = json(
      await runNativeCli([
        'next',
        'sdk-stale',
        '--confirmed',
        '--summary',
        'User approved the earlier Shape.',
        '--expected-state-version',
        '2',
        '--expected-action',
        'confirm-shape',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(confirmed, confirmed.error?.message).toMatchObject({
      exitCode: 73,
      error: { code: 'conflict' },
    });
    const status = json(await runNativeCli(['status', 'sdk-stale', '--json', ...projectArgs()]));
    expect(status).toMatchObject({
      exitCode: 0,
      data: {
        run: { waits: [expect.objectContaining({ stepId: 'shape.confirm', status: 'pending' })] },
      },
    });
  });

  it('returns all ready Supervisor Child Actions after the public SDK Shape confirmation', async () => {
    const created = json(
      await runNativeCli(['new', 'sdk-supervisor', '--runtime', 'sdk', '--json', ...projectArgs()]),
    );
    expect(created.exitCode).toBe(0);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'sdk-supervisor');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      `# Outcome
Ship the selected workflow.
# Scope
Preserve the selected workflow.
# Non-goals
None.
# Acceptance examples
- The selected workflow resumes.
# Constraints and invariants
Preserve existing compatibility.
# Decisions
Supervisor Change.
- Child api
- Child ui
# Open questions
None.
# Verification expectations
Run focused Native checks.
`,
    );
    await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'workflow', 'spec.md'),
      '# Workflow\nThe selected workflow resumes without losing confirmed work.\n',
    );
    await fs.writeFile(
      path.join(changeDir, 'children.yaml'),
      `schema: comet.native.children.v2
children:
  - name: api
    summary: Build the API
    depends_on: []
  - name: ui
    summary: Build the UI
    depends_on: []
`,
    );
    const prepared = json(
      await runNativeCli(['next', 'sdk-supervisor', '--json', ...projectArgs()]),
    );
    expect(prepared, prepared.error?.message).toMatchObject({
      exitCode: 0,
      data: { run: { waits: [{ stepId: 'supervisor.shape.confirm', status: 'pending' }] } },
    });
    const continuation = prepared.data?.continuation as {
      commandAlternatives: Array<{ name: string; commandArgs: string[] }>;
    };
    expect(continuation.commandAlternatives.map(({ name }) => name)).toEqual([
      'multi-session',
      'single-session',
      'revise-requirements',
    ]);
    expect(continuation.commandAlternatives[0]?.commandArgs).toEqual(
      expect.arrayContaining([
        '--confirmed',
        '--coordination-mode',
        'multi-session',
        '--expected-action',
        'confirm-shape',
      ]),
    );
    expect(continuation.commandAlternatives[1]?.commandArgs).toEqual(
      expect.arrayContaining(['--coordination-mode', 'single-session']),
    );
    const confirmed = json(
      await runNativeCli([
        'next',
        'sdk-supervisor',
        '--confirmed',
        '--coordination-mode',
        'multi-session',
        '--summary',
        'User approved both child tasks and multi-session coordination.',
        '--expected-state-version',
        '2',
        '--expected-action',
        'confirm-shape',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(confirmed, confirmed.error?.message).toMatchObject({
      exitCode: 0,
      data: {
        phase: 'build',
        pendingAction: { stepId: 'supervisor.prepare' },
      },
    });
    expect((await inspectNativeSdkRun(projectRoot, 'sdk-supervisor')).state.coordination_mode).toBe(
      'multi-session',
    );
    execFileSync('git', ['add', '-A'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.com',
        'commit',
        '-m',
        'baseline',
      ],
      { cwd: projectRoot, stdio: 'ignore' },
    );
    const integration = json(
      await runNativeCli(['next', 'sdk-supervisor', '--json', ...projectArgs()]),
    );
    expect(integration, integration.error?.message).toMatchObject({
      exitCode: 0,
      data: {
        pendingActions: [
          { stepId: 'supervisor.child.prepare', mechanism: 'runtime-dispatch' },
          { stepId: 'supervisor.child.prepare', mechanism: 'runtime-dispatch' },
        ],
      },
    });
    const firstChild = json(
      await runNativeCli(['next', 'sdk-supervisor', '--json', ...projectArgs()]),
    );
    expect(firstChild, firstChild.error?.message).toMatchObject({
      exitCode: 0,
      data: {
        pendingActions: [
          { stepId: 'supervisor.child.prepare', mechanism: 'runtime-dispatch' },
          { stepId: 'supervisor.child.builder', mechanism: 'runtime-dispatch' },
        ],
      },
    });
  });

  it('shows the joint SDK Supervisor confirmation command in public help', async () => {
    const help = await runNativeCli(['next', '--help', ...projectArgs()]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain(
      'comet native next <sdk-change> --confirmed --coordination-mode multi-session|single-session',
    );
  });

  it('rejects compat Git finish options before changing an SDK Run', async () => {
    const name = 'sdk-git-options';
    const created = json(await runNativeCli(['new', name, '--json', ...projectArgs()]));
    expect(created.exitCode).toBe(0);
    const before = (await inspectNativeSdkRun(projectRoot, name)).run;
    for (const [command, options] of [
      ['archive', ['--commit-message', 'feat: 中文提交\n\n详情']],
      ['archive', ['--merge-message', 'Merge workflow']],
      [
        'next',
        [
          '--accept-result',
          '--finish',
          'keep',
          '--summary',
          'Approved.',
          '--proposal-hash',
          'test',
          '--expected-state-version',
          '1',
          '--expected-action',
          'accept-result',
        ],
      ],
    ] as const) {
      const rejected = json(
        await runNativeCli([command, name, ...options, '--json', ...projectArgs()]),
      );
      expect(rejected).toMatchObject({ exitCode: 64, error: { code: 'usage' } });
      expect((await inspectNativeSdkRun(projectRoot, name)).run.revision).toBe(before.revision);
    }
  });

  it('rejects legacy-only options combined with an SDK confirmation', async () => {
    const created = json(
      await runNativeCli(['new', 'sdk-options', '--runtime', 'sdk', '--json', ...projectArgs()]),
    );
    expect(created.exitCode).toBe(0);
    const result = json(
      await runNativeCli([
        'next',
        'sdk-options',
        '--confirmed',
        '--summary',
        'Approved.',
        '--expected-state-version',
        '1',
        '--expected-action',
        'confirm-shape',
        '--max-parallel',
        '3',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(result).toMatchObject({ exitCode: 64, error: { code: 'usage' } });
  });

  async function runnerStep(name: string, input: unknown): Promise<JsonEnvelope> {
    runnerInputSequence += 1;
    let payload = input;
    if (
      input &&
      typeof input === 'object' &&
      (input as { kind?: string }).kind &&
      ['verifier-execution-error', 'verifier-unavailable'].includes(
        (input as { kind: string }).kind,
      ) &&
      !('stateVersion' in input)
    ) {
      const current = json(await runNativeCli(['show', name, '--json', ...projectArgs()]));
      const state = current.data?.state as {
        state_version: number;
        loop: { iteration: number; attempt: number };
      };
      const local = await readNativeLocalExecution(
        nativeLocalExecutionFile(await nativeProjectPaths(projectRoot, 'docs'), name),
      );
      payload = {
        ...(input as Record<string, unknown>),
        stateVersion: state.state_version,
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        verifierExecutionRef: local?.execution?.executionId,
      };
    }
    if (
      input &&
      typeof input === 'object' &&
      (input as { kind?: string }).kind === 'verifier-response' &&
      !('candidateId' in input)
    ) {
      const current = json(await runNativeCli(['show', name, '--json', ...projectArgs()]));
      const state = current.data?.state as {
        builder_handoff: { candidate_id: string };
      };
      const local = await readNativeLocalExecution(
        nativeLocalExecutionFile(await nativeProjectPaths(projectRoot, 'docs'), name),
      );
      payload = {
        ...(input as Record<string, unknown>),
        candidateId: state.builder_handoff.candidate_id,
        verifierExecutionRef: local?.execution?.executionId,
      };
    }
    const file = path.join(projectRoot, `.native-runner-input-${runnerInputSequence}.json`);
    await fs.writeFile(file, JSON.stringify(payload));
    try {
      return json(
        await runNativeCli(['next', name, '--runner-input', file, '--json', ...projectArgs()]),
      );
    } finally {
      await fs.rm(file, { force: true });
    }
  }

  async function prepareBuild(
    name: string,
    acceptance: string[] = ['First behavior works.'],
    language: 'en' | 'zh-CN' = 'en',
  ) {
    await runNativeCli([
      'new',
      name,
      '--language',
      language,
      '--runtime',
      'compat',
      ...projectArgs(),
    ]);
    const brief = `# Outcome
Ship the requested behavior.
# Scope
Keep the implementation focused.
## Directory structure
### Created
None.
### Modified
None.
### Deleted
None.
### Not created
None.
# Non-goals
No unrelated changes.
# Acceptance examples
${acceptance.map((entry) => `- ${entry}`).join('\n')}
# Constraints and invariants
Preserve existing behavior.
# Decisions
Use the smallest implementation.
# Open questions
None.
# Verification expectations
Run applicable focused checks.
`;
    const changeDir = path.join(projectRoot, 'docs', 'comet', 'changes', name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    await fs.mkdir(path.join(changeDir, 'specs', 'fixture'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'fixture', 'spec.md'),
      '# Fixture target\n\nThis document binds the Native Runtime loop fixture.\n',
    );
    const prepared = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'Shape is ready for confirmation',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(prepared).toMatchObject({
      exitCode: 0,
      data: {
        state: { phase: 'shape', status: 'await-user' },
        continuation: {
          disposition: 'await-user',
          requiresUserDecision: true,
          action: 'confirm-shape',
          commandArgs: null,
          userCommunication: { required: true },
        },
      },
    });
    const preparedState = prepared.data?.state as { state_version: number };
    const confirmed = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'Shared understanding confirmed',
        '--confirmed',
        '--expected-state-version',
        String(preparedState.state_version),
        '--expected-action',
        'confirm-shape',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(confirmed).toMatchObject({ exitCode: 0, data: { state: { phase: 'build' } } });
    confirmedAcceptanceIds = acceptance.map((_, index) => `A${index + 1}`);
    expect(confirmed.data?.state).toMatchObject({
      acceptance: { total: acceptance.length, pending: acceptance.length },
    });
    expect(confirmed.data?.state).not.toHaveProperty('builder_handoff');
    expect(confirmed.data?.state).not.toHaveProperty('history');
    expect(JSON.stringify(confirmed.data?.state)).not.toContain(acceptance[0]);
    return confirmed;
  }

  function builderHandoff(addressedAcceptanceIds: string[]) {
    return {
      kind: 'builder-handoff',
      summary: 'Implemented the confirmed behavior.',
      addressed_acceptance_ids: addressedAcceptanceIds,
      acceptance_review: fixtureAcceptanceReview(confirmedAcceptanceIds),
      checks: [],
      known_limits: [],
      review: {
        status: 'passed',
        summary: 'A read-only reviewer found no blocking issues.',
        reviewer_execution_ref: `reviewer-${runnerInputSequence + 1}`,
      },
    };
  }

  function finalResponse(iteration: number, attempt: number, acceptanceIds: string[]) {
    return {
      kind: 'verifier-response',
      response: {
        kind: 'final-result',
        result: {
          iteration,
          attempt,
          verdict: 'pass',
          acceptance: acceptanceIds.map((id) => ({
            id,
            result: 'passed',
            reason: `Observed ${id}.`,
          })),
          risks: [],
          summary: 'All acceptance criteria were independently reviewed.',
        },
      },
    };
  }

  it('distinguishes SDK Run actions from legacy continuations in Native help', async () => {
    const root = await runNativeCli(['--help']);
    const next = await runNativeCli(['next', '--help']);
    const archive = await runNativeCli(['archive', '--help']);
    const status = await runNativeCli(['status', '--help']);

    expect(root.stdout).toContain('skill-coordinated');
    expect(root.stdout).toContain('Agent Quick Start:');
    expect(root.stdout).toContain('comet native status --json');
    expect(root.stdout).toContain('agent.continuation.commandArgs');
    expect(root.stdout).toContain('agent.workspace.cwd');
    expect(root.stdout).toContain('comet runtime dispatch --application native');
    expect(root.stdout).toContain('inputOptions');
    expect(next.stdout).toContain('SDK-owned changes return the current Run Action or Wait');
    expect(next.stdout).toContain('continuation.inputOptions');
    expect(next.stdout).toContain('userCommunication');
    expect(next.stdout).toContain('--runner-input <file>');
    expect(next.stdout).toContain('--validate-only');
    expect(next.stdout).toContain('retry-checks');
    expect(next.stdout).toContain('verification_checks');
    expect(next.stdout).toContain('a passing plan returns the Verifier dispatch immediately');
    expect(next.stdout).toContain('saved evidence still match');
    expect(next.stdout).toContain('--coordination-mode multi-session|single-session');
    expect(next.stdout).toContain('not trusted identity attestation');
    expect(next.stdout).toContain('--proposal-hash <hash>');
    expect(next.stdout).toContain('--retry-verifier');
    expect(next.stdout).toContain('--continue-builder');
    expect(next.stdout).toContain('--resolve-verifier-blocker');
    expect(next.stdout).toContain('--accept-result');
    expect(next.stdout).toContain('--revise-implementation');
    expect(next.stdout).toContain('--revise-requirements');
    expect(next.stdout).toContain('renewing a pending Shape proposal');
    expect(next.stdout).toContain('ordinary Builder explicitly failed');
    expect(next.stdout).toContain('The new Shape still requires explicit approval');
    expect(next.stdout).not.toContain('--return-to-shape');
    expect(next.stdout).toContain('verifier-unavailable');
    expect(archive.stdout).toContain('does not repeat verification');
    expect(status.stdout).toContain('local execution availability');
    expect(status.stdout).toContain('readyChildren');
    expect(next.stdout).toContain('Supervisor task fields');
    expect(next.stdout).toContain('supervisor-checks');
    expect(next.stdout).toContain('receiptRef');
    expect(next.stdout).toContain('every task acceptance ID must appear exactly once');
    for (const output of [root.stdout!, next.stdout!, archive.stdout!, status.stdout!]) {
      expect(output).not.toMatch(
        /checkpoint|preflight|sha256|--result|--report|--acceptance-cursor|comet native (?:receipt|evidence)\b/iu,
      );
    }
    expect([root.stdout!, next.stdout!].join('\n')).not.toMatch(
      /runner-attested|host-attested|trusted Runner operations/iu,
    );

    const retiredSpec = json(await runNativeCli(['spec', 'rebase', '--help', '--json']));
    expect(retiredSpec).toMatchObject({ exitCode: 64, error: { code: 'usage' } });
  });

  it('explains the SDK default and explicit compat option in Native new help', async () => {
    const help = await runNativeCli(['new', '--help']);
    expect(help.stdout).toContain('defaults to sdk');
    expect(help.stdout).toContain('--runtime compat|sdk');
  });

  it('prepares the complete Supervisor Shape before requesting a joint user decision', async () => {
    const name = 'recorded-supervisor';
    await runNativeCli([
      'new',
      name,
      '--language',
      'zh-CN',
      '--runtime',
      'compat',
      ...projectArgs(),
    ]);
    await fs.writeFile(
      path.join(projectRoot, 'docs', 'comet', 'changes', name, 'brief.md'),
      `# 决策

- 已明确选择 Supervisor Change，因为存在两个独立结果。
- Child 1 负责第一个结果；Child 2 负责第二个结果。

# 待解决问题
- [blocking] CONFIRM: 等待用户确认。
`,
    );

    const result = json(await runNativeCli(['status', name, '--json', ...projectArgs()]));

    expect(result.data?.continuation).toMatchObject({
      disposition: 'continue',
      requiresUserDecision: false,
      action: 'prepare-shape-confirmation',
      requiredInputs: ['summary'],
      userCommunication: { required: false, suggestedReply: null },
    });
    expect(result.data?.continuation.userCommunication.agentInstruction).toContain(
      'prepare-shape-confirmation',
    );
    expect(result.data?.continuation.userCommunication.agentInstruction).not.toContain(
      '--confirmed',
    );
  });

  it.each([
    { name: 'compact-recovery-default', runnerInput: false },
    { name: 'compact-recovery-runner', runnerInput: true },
  ])('keeps successful $name next output compact', async ({ name, runnerInput }) => {
    await prepareBuild(name, ['Recovery output stays compact.']);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await fs.writeFile(nativeLocalExecutionFile(paths, name), '{invalid-json');

    const recovered = runnerInput
      ? await runnerStep(name, builderHandoff(['A1']))
      : json(
          await runNativeCli([
            'next',
            name,
            '--summary',
            'Resume after recovery',
            '--json',
            ...projectArgs(),
          ]),
        );

    expect(recovered.error).toBeUndefined();
    expect(recovered).toMatchObject({
      exitCode: 0,
      data: {
        state: { phase: 'build' },
        recovery: { action: 'resume-stable-boundary', reason: 'invalid' },
        continuation: { action: 'builder-handoff' },
      },
    });
    expect(recovered.data?.state).not.toHaveProperty('builder_handoff');
    expect(recovered.data?.state).not.toHaveProperty('history');
    expect(recovered.data?.recovery).not.toHaveProperty('state');
    expect(recovered.data?.recovery).not.toHaveProperty('local');
  });

  it('returns v4 continuations and rejects retired Agent-authored verification inputs', async () => {
    const created = json(
      await runNativeCli([
        'new',
        'surface-test',
        '--runtime',
        'compat',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(created).toMatchObject({
      command: 'new',
      exitCode: 0,
      data: {
        schema: 'comet.native.v4',
        continuation: {
          schema: 'comet.native.continuation.v2',
          action: 'prepare-shape-confirmation',
          runnerAction: { kind: 'none' },
        },
      },
    });

    for (const command of ['show', 'status', 'doctor']) {
      const result = json(
        await runNativeCli([command, 'surface-test', '--json', ...projectArgs()]),
      );
      expect(result.exitCode).toBe(0);
      expect(result.data).toMatchObject({
        continuation: {
          schema: 'comet.native.continuation.v2',
          action: 'prepare-shape-confirmation',
          runnerAction: { kind: 'none' },
        },
      });
    }

    const removed = json(
      await runNativeCli([
        'spec',
        'remove',
        'surface-test',
        'legacy-capability',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(removed).toMatchObject({
      exitCode: 0,
      data: {
        continuation: {
          schema: 'comet.native.continuation.v2',
          action: 'prepare-shape-confirmation',
          runnerAction: { kind: 'none' },
        },
      },
    });

    const archive = json(
      await runNativeCli(['archive', 'surface-test', '--dry-run', '--json', ...projectArgs()]),
    );
    expect(archive).toMatchObject({
      exitCode: 0,
      data: {
        ready: false,
        continuation: { runnerAction: { kind: 'none' } },
      },
    });

    for (const args of [
      ['next', 'surface-test', '--summary', 'self reported', '--result', 'pass'],
      ['archive', 'surface-test', '--expect-preflight', 'a'.repeat(64)],
    ]) {
      const result = json(await runNativeCli([...args, '--json', ...projectArgs()]));
      expect(result).toMatchObject({ exitCode: 64, error: { code: 'usage' } });
    }

    const portableStrategy = json(
      await runNativeCli([
        'doctor',
        'surface-test',
        '--strategy',
        'continue',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(portableStrategy).toMatchObject({
      exitCode: 64,
      error: {
        code: 'usage',
        message: '--strategy is only available to the legacy transaction doctor',
      },
    });

    const projectRepair = json(
      await runNativeCli(['doctor', '--repair', '--json', ...projectArgs()]),
    );
    expect(projectRepair).toMatchObject({
      exitCode: 0,
      data: { healthy: true, workflow: 'native-portable', repaired: true },
    });

    for (const command of ['checkpoint', 'check', 'evidence', 'receipt']) {
      const result = json(await runNativeCli([command, '--json', ...projectArgs()]));
      const expectedMessage =
        command === 'check' ? 'change name is required' : `Unknown Native command: ${command}`;
      expect(result).toMatchObject({
        command,
        exitCode: 64,
        error: { code: 'usage', message: expectedMessage },
      });
    }
  });

  it.each([
    '{invalid-json',
    JSON.stringify({ kind: 'unsupported-future-protocol' }),
    JSON.stringify({ kind: 'dispatch-verifier', checks: [] }),
  ])('rejects invalid Runner input before recovering Shape drift: %s', async (input) => {
    const name = 'invalid-input-before-recovery';
    await prepareBuild(name);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const stateFile = nativePortableStateFile(paths, name);
    const localFile = nativeLocalExecutionFile(paths, name);
    const stateBefore = await fs.readFile(stateFile, 'utf8');
    const localBefore = await fs.readFile(localFile, 'utf8');
    await fs.appendFile(
      path.join(projectRoot, 'docs/comet/changes', name, 'brief.md'),
      '\nChanged requirements.\n',
    );
    const inputFile = path.join(projectRoot, 'invalid-input.json');
    await fs.writeFile(inputFile, input);
    const result = json(
      await runNativeCli(['next', name, '--runner-input', inputFile, '--json', ...projectArgs()]),
    );
    expect(result.exitCode).not.toBe(0);
    await expect(fs.readFile(stateFile, 'utf8')).resolves.toBe(stateBefore);
    await expect(fs.readFile(localFile, 'utf8')).resolves.toBe(localBefore);
  });

  it('validates Runner input without mutating the state or local execution overlay', async () => {
    const name = 'validate-only-boundary';
    await prepareBuild(name);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const stateFile = nativePortableStateFile(paths, name);
    const localFile = nativeLocalExecutionFile(paths, name);
    const stateBefore = await fs.readFile(stateFile, 'utf8');
    const localBefore = await fs.readFile(localFile, 'utf8');
    const inputFile = path.join(projectRoot, 'validate-only-input.json');
    await fs.writeFile(
      inputFile,
      JSON.stringify({
        kind: 'builder-handoff',
        summary: 'Validated candidate input.',
        addressed_acceptance_ids: ['A1'],
        acceptance_review: fixtureAcceptanceReview(['A1']),
        checks: [],
        known_limits: [],
      }),
    );

    try {
      const result = json(
        await runNativeCli([
          'next',
          name,
          '--runner-input',
          inputFile,
          '--validate-only',
          '--json',
          ...projectArgs(),
        ]),
      );
      expect(result).toMatchObject({
        exitCode: 0,
        data: { validation: { valid: true, kind: 'builder-handoff' } },
      });
      await expect(fs.readFile(stateFile, 'utf8')).resolves.toBe(stateBefore);
      await expect(fs.readFile(localFile, 'utf8')).resolves.toBe(localBefore);
    } finally {
      await fs.rm(inputFile, { force: true });
    }
  });

  it('validates the current Runner boundary and check executables before reservation', async () => {
    const name = 'validate-only-check-plan';
    await prepareBuild(name);
    const handedOff = await runnerStep(name, {
      kind: 'builder-handoff',
      summary: 'Implemented the confirmed behavior.',
      addressed_acceptance_ids: ['A1'],
      acceptance_review: fixtureAcceptanceReview(['A1']),
      checks: [],
      known_limits: [],
    });
    expect(handedOff).toMatchObject({ exitCode: 0, data: { state: { phase: 'verify' } } });

    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const stateFile = nativePortableStateFile(paths, name);
    const localFile = nativeLocalExecutionFile(paths, name);
    const stateBefore = await fs.readFile(stateFile, 'utf8');
    const localBefore = await fs.readFile(localFile, 'utf8');
    const inputFile = path.join(projectRoot, 'validate-only-check-plan.json');
    await fs.writeFile(
      inputFile,
      JSON.stringify({
        kind: 'dispatch-verifier',
        checks: [
          {
            id: 'missing-command',
            name: 'Missing command',
            executable: path.join(projectRoot, 'bin', 'does-not-exist'),
            argv: [],
            cwdRef: '.',
            timeoutMs: 1000,
            repeatable: true,
          },
        ],
      }),
    );

    try {
      const result = json(
        await runNativeCli([
          'next',
          name,
          '--runner-input',
          inputFile,
          '--validate-only',
          '--json',
          ...projectArgs(),
        ]),
      );
      expect(result).toMatchObject({
        exitCode: 65,
        error: { code: 'invalid-data', message: expect.stringContaining('/checks/0') },
      });
      await expect(fs.readFile(stateFile, 'utf8')).resolves.toBe(stateBefore);
      await expect(fs.readFile(localFile, 'utf8')).resolves.toBe(localBefore);
    } finally {
      await fs.rm(inputFile, { force: true });
    }
  });

  it('rejects user-decision flags when combined with another public transition flag', async () => {
    await prepareBuild('revise-requirements-mutual-exclusion');

    const result = json(
      await runNativeCli([
        'next',
        'revise-requirements-mutual-exclusion',
        '--summary',
        'Ambiguous user decision',
        '--revise-requirements',
        '--revise-implementation',
        '--json',
        ...projectArgs(),
      ]),
    );

    expect(result).toMatchObject({
      exitCode: 64,
      error: {
        code: 'usage',
        message: expect.stringContaining('--revise-requirements'),
      },
    });
  });

  it('rejects caller-supplied identity, provider, execution, and candidate bindings', async () => {
    await prepareBuild('reject-forged-runner-fields');
    for (const forged of [
      { identity: { provider: 'forged-host', execution_ref: 'forged-builder' } },
      { provider: 'forged-host' },
      { execution_ref: 'forged-builder' },
      { candidate_id: 'forged-candidate' },
    ]) {
      const result = await runnerStep('reject-forged-runner-fields', {
        ...builderHandoff(['A1']),
        ...forged,
      });
      expect(result).toMatchObject({
        exitCode: 65,
        error: { code: 'invalid-data', message: expect.stringContaining('fields are invalid') },
      });
    }

    const withoutReview = { ...builderHandoff(['A1']) } as Record<string, unknown>;
    delete withoutReview.review;
    const missingReview = await runnerStep('reject-forged-runner-fields', withoutReview);
    expect(missingReview).toMatchObject({
      exitCode: 0,
      data: { state: { phase: 'verify' } },
    });

    expect(
      json(
        await runNativeCli(['status', 'reject-forged-runner-fields', '--json', ...projectArgs()]),
      ).data,
    ).toMatchObject({ phase: 'verify', loop: { attempt: 0 } });
  });

  it('drives a complete skill-coordinated CLI loop to Archive with an explicit empty check plan', async () => {
    const name = 'skill-coordinated-loop';
    const readyForBuilder = await prepareBuild(
      name,
      ['First behavior works.', 'Second behavior works.'],
      'zh-CN',
    );
    expect(readyForBuilder).toMatchObject({
      data: {
        continuation: {
          action: 'builder-handoff',
          inputOptions: [
            {
              flag: '--runner-input',
              valueKind: 'json-file',
              template: {
                kind: 'builder-handoff',
                summary: '<summary>',
                addressed_acceptance_ids: ['A1', 'A2'],
                known_limits: [],
              },
            },
          ],
        },
      },
    });

    const built = await runnerStep(name, {
      ...builderHandoff(['A1', 'A2']),
      checks: [{ name: 'Focused tests', result: 'passed', note: 'Existing command output' }],
      known_limits: ['Host Hook not exercised'],
    });
    expect(built).toMatchObject({
      exitCode: 0,
      data: {
        coordination: 'skill-coordinated',
        state: {
          phase: 'verify',
          loop: { iteration: 1, attempt: 0 },
        },
        continuation: {
          action: 'dispatch-verifier',
          commandArgs: ['comet', 'native', 'next', name, '--runner-input', '<temporary-json-file>'],
        },
      },
    });
    expect(built.data).not.toHaveProperty('runnerAssurance');

    const dispatched = await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    expect(dispatched).toMatchObject({
      exitCode: 0,
      data: {
        coordination: 'skill-coordinated',
        checks: [],
        state: { phase: 'verify', loop: { iteration: 1, attempt: 1 } },
        verifierDispatch: {
          coordination: 'skill-coordinated',
          change: name,
          candidateId: expect.any(String),
          iteration: 1,
          attempt: 1,
          projectRoot,
          verificationRoot: projectRoot,
          changeDir: path.join(projectRoot, 'docs', 'comet', 'changes', name),
          supervisorStateRef: null,
          briefRef: 'brief.md',
          specRefs: [{ capability: 'fixture', operation: 'create', ref: 'specs/fixture/spec.md' }],
          acceptanceCount: 2,
          scopeCount: 2,
          scopeIds: ['A1', 'A2'],
          detailsPageArgs: [
            'comet',
            'native',
            'status',
            name,
            '--details',
            '--json',
            '--project-root',
            projectRoot,
          ],
          builderReview: {
            status: 'passed',
            summary: { text: 'A read-only reviewer found no blocking issues.' },
          },
          runtimeChecks: [],
          builderReportedChecks: [{ name: { text: 'Focused tests' }, result: 'passed' }],
          builderKnownLimits: [{ text: 'Host Hook not exercised' }],
          evidenceInstruction: expect.stringMatching(/scopeIds.*exactly once/iu),
          responseInstruction: expect.stringMatching(/scopeIds.*no other acceptance IDs/iu),
        },
      },
    });
    const dispatch = (dispatched.data as { verifierDispatch: Record<string, unknown> })
      .verifierDispatch;
    expect(JSON.stringify(dispatch)).not.toMatch(/identity|provider/iu);
    expect(dispatch.acceptance).toEqual([
      { id: 'A1', source: 'brief.md', text: 'First behavior works.' },
      { id: 'A2', source: 'brief.md', text: 'Second behavior works.' },
    ]);
    expect(dispatch.startupInput).toEqual({
      kind: 'verifier-started',
      candidateId: dispatch.candidateId,
      verifierExecutionRef: dispatch.verifierExecutionRef,
    });
    expect(dispatch).not.toHaveProperty('builderHandoff');
    expect(dispatch).toMatchObject({
      stateVersion: expect.any(Number),
      verifierExecutionRef: expect.stringContaining('skill-coordinated:verifier:'),
    });
    const responseInputs = (
      dispatched.data as {
        continuation: { inputOptions: Array<{ template: unknown }> };
      }
    ).continuation.inputOptions;
    expect(responseInputs).toHaveLength(4);
    for (const option of responseInputs) {
      expect(Array.isArray(option.template)).toBe(false);
      expect(option).toMatchObject({ exclusiveGroup: 'runner-input', name: expect.any(String) });
    }
    expect(JSON.stringify(responseInputs)).toContain('request-checks');
    expect(JSON.stringify(responseInputs)).toContain('final-result');
    expect(JSON.stringify(responseInputs)).toContain('verifier-execution-error');
    expect(JSON.stringify(responseInputs)).toContain(String(dispatch.verifierExecutionRef));
    expect(JSON.stringify(responseInputs)).not.toMatch(/identity|provider/iu);

    const forgedCandidate = await runnerStep(name, {
      ...finalResponse(1, 1, ['A1', 'A2']),
      candidate_id: 'caller-selected-candidate',
    });
    expect(forgedCandidate).toMatchObject({
      exitCode: 65,
      error: { message: expect.stringContaining('fields are invalid') },
    });

    const finalTemplate = inputTemplate(dispatched, 'final-result');
    const responseTemplate = finalTemplate.response as {
      kind: string;
      result: Record<string, unknown>;
    };
    const awaitingConfirmation = await runnerStep(name, {
      ...finalTemplate,
      response: {
        ...responseTemplate,
        result: {
          ...responseTemplate.result,
          verdict: 'pass',
          acceptance: ['A1', 'A2'].map((id) => ({
            id,
            result: 'passed',
            reason: `Observed ${id}.`,
          })),
          summary: 'Reviewed all criteria.',
        },
      },
    });
    expect(awaitingConfirmation).toMatchObject({
      exitCode: 0,
      data: {
        coordination: 'skill-coordinated',
        state: {
          phase: 'verify',
          status: 'await-user',
          verification_result: 'pass',
          blockers: [
            {
              owner: 'user',
              resolution_action: 'await-user',
              reason: expect.stringContaining('cannot prove'),
            },
          ],
          loop: {
            stage: 'await-user',
            iteration: 1,
            attempt: 1,
            next_action: 'confirm-skill-coordinated-pass',
          },
        },
        verifierDispatch: null,
        continuation: {
          disposition: 'await-user',
          action: 'confirm-skill-coordinated-pass',
          commandArgs: null,
          requiredInputs: ['summary', 'user-decision'],
          inputOptions: [expect.objectContaining({ name: 'summary', flag: '--summary' })],
          commandAlternatives: expect.arrayContaining([
            expect.objectContaining({
              name: 'accept-result',
              stateVersion: expect.any(Number),
              expectedAction: 'accept-result',
              commandArgs: expect.arrayContaining(['--accept-result']),
              requiredInputs: ['summary', 'user-decision'],
            }),
            expect.objectContaining({
              name: 'revise-implementation',
              stateVersion: expect.any(Number),
              expectedAction: 'revise-implementation',
              commandArgs: expect.arrayContaining(['--revise-implementation']),
              requiredInputs: ['summary', 'user-decision'],
            }),
            expect.objectContaining({
              name: 'revise-requirements',
              stateVersion: expect.any(Number),
              expectedAction: 'revise-requirements',
              commandArgs: expect.arrayContaining(['--revise-requirements']),
              requiredInputs: ['summary', 'user-decision'],
            }),
          ]),
        },
      },
    });
    expect(awaitingConfirmation.data).not.toHaveProperty('response');
    expect(awaitingConfirmation.data).not.toHaveProperty('supervisorState');
    expect(JSON.stringify(awaitingConfirmation.data)).not.toContain('Observed A1.');
    expect(JSON.stringify(awaitingConfirmation.data)).not.toContain('Observed A2.');
    const pendingReport = await fs.readFile(
      path.join(projectRoot, 'docs', 'comet', 'changes', name, 'verification.md'),
      'utf8',
    );
    expect(pendingReport).toContain('结果: **验收通过，需要你确认**');
    expect(pendingReport).toContain('验证情况: **已完成检查，但需要你确认验证结果**');

    const confirmed = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'User accepts the Skill-coordinated verification boundary',
        '--accept-result',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(confirmed).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'archive',
          status: 'active',
          blockers: [],
          loop: { stage: 'archive-ready', next_action: 'archive' },
        },
        continuation: { action: 'archive' },
      },
    });
    expect(
      await fs.readFile(
        path.join(projectRoot, 'docs', 'comet', 'changes', name, 'verification.md'),
        'utf8',
      ),
    ).toContain('结果: **验收通过，可归档**');
  });

  it('runs one full verification for a repaired candidate without a duplicate final pass', async () => {
    const name = 'scoped-repair-verification';
    const counter = path.join(projectRoot, 'repair-check-count.txt');
    const checkPlan = {
      kind: 'dispatch-verifier',
      checks: [
        {
          id: 'focused-check',
          name: 'Focused check',
          executable: process.execPath,
          argv: [
            '-e',
            "const fs=require('node:fs');const f=process.argv[1];let n=0;try{n=Number(fs.readFileSync(f,'utf8'))}catch{}fs.writeFileSync(f,String(n+1))",
            counter,
          ],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    };
    await prepareBuild(name, ['First behavior works.', 'Second behavior works.']);
    await runnerStep(name, builderHandoff(['A1', 'A2']));
    await runnerStep(name, checkPlan);
    const failed = await runnerStep(name, {
      kind: 'verifier-response',
      response: {
        kind: 'final-result',
        result: {
          iteration: 1,
          attempt: 1,
          verdict: 'fail',
          acceptance: [
            { id: 'A1', result: 'passed', reason: 'Observed A1.' },
            { id: 'A2', result: 'failed', reason: 'A2 still fails.' },
          ],
          risks: [],
          summary: 'A2 needs repair.',
        },
      },
    });
    expect(failed.data?.state).toMatchObject({
      phase: 'build',
      loop: { stage: 'repairing', previous_unresolved_ids: ['A2'] },
    });

    await runnerStep(name, builderHandoff(['A2']));
    const repairDispatch = await runnerStep(name, checkPlan);
    expect(
      (repairDispatch.data as { verifierDispatch: { scopeIds: string[] } }).verifierDispatch
        .scopeIds,
    ).toEqual(['A1', 'A2']);
    expect(await fs.readFile(counter, 'utf8')).toBe('2');
    const repairPass = await runnerStep(name, finalResponse(2, 1, ['A1', 'A2']));
    expect(repairPass.data?.state).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
      loop: { next_action: 'confirm-skill-coordinated-pass' },
    });
    expect(await fs.readFile(counter, 'utf8')).toBe('2');
  });

  it('rejects a Verifier response bound to the pre-repair candidate before mutation', async () => {
    const name = 'stale-response-after-repair';
    await prepareBuild(name, ['First behavior works.', 'Second behavior works.']);
    await runnerStep(name, builderHandoff(['A1', 'A2']));
    const firstDispatch = await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    const firstBinding = (
      firstDispatch.data as {
        verifierDispatch: { candidateId: string; verifierExecutionRef: string };
      }
    ).verifierDispatch;
    await runnerStep(name, {
      kind: 'verifier-response',
      response: {
        kind: 'final-result',
        result: {
          iteration: 1,
          attempt: 1,
          verdict: 'fail',
          acceptance: [
            { id: 'A1', result: 'passed', reason: 'Observed A1.' },
            { id: 'A2', result: 'failed', reason: 'A2 still fails.' },
          ],
          risks: [],
          summary: 'A2 needs repair.',
        },
      },
    });
    await runnerStep(name, builderHandoff(['A2']));
    const repairDispatch = await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    const repairBinding = (
      repairDispatch.data as {
        verifierDispatch: { candidateId: string; verifierExecutionRef: string };
      }
    ).verifierDispatch;
    expect(repairBinding.candidateId).not.toBe(firstBinding.candidateId);

    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const stateFile = nativePortableStateFile(paths, name);
    const localFile = nativeLocalExecutionFile(paths, name);
    const stateBefore = await fs.readFile(stateFile, 'utf8');
    const localBefore = await fs.readFile(localFile, 'utf8');
    const stale = await runnerStep(name, {
      kind: 'verifier-response',
      candidateId: firstBinding.candidateId,
      verifierExecutionRef: firstBinding.verifierExecutionRef,
      response: {
        kind: 'final-result',
        result: {
          iteration: 2,
          attempt: 1,
          verdict: 'pass',
          acceptance: [
            { id: 'A1', result: 'passed', reason: 'Observed A1.' },
            { id: 'A2', result: 'passed', reason: 'Observed A2.' },
          ],
          risks: [],
          summary: 'Stale response must not be accepted.',
        },
      },
    });
    expect(stale).toMatchObject({
      exitCode: 65,
      error: { message: expect.stringContaining('stale for the current candidate or execution') },
    });
    await expect(fs.readFile(stateFile, 'utf8')).resolves.toBe(stateBefore);
    await expect(fs.readFile(localFile, 'utf8')).resolves.toBe(localBefore);
    expect(repairBinding.verifierExecutionRef).not.toBe(firstBinding.verifierExecutionRef);
  });

  it('revises requirements after a rejected skill-coordinated pass and starts a fresh candidate cycle', async () => {
    const name = 'skill-pass-revise-requirements';
    await prepareBuild(name, ['Original behavior works.']);
    await runnerStep(name, builderHandoff(['A1']));
    const oldCandidateId = (
      json(await runNativeCli(['show', name, '--json', ...projectArgs()])).data as {
        state: { builder_handoff: { candidate_id: string } };
      }
    ).state.builder_handoff.candidate_id;
    await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    const awaitingPassDecision = await runnerStep(name, finalResponse(1, 1, ['A1']));
    expect(awaitingPassDecision.data?.continuation).toMatchObject({
      disposition: 'await-user',
      requiresUserDecision: true,
      userCommunication: {
        required: true,
        message: expect.any(String),
        suggestedReply: expect.any(String),
      },
    });
    const oldAcceptResultAlternative = (
      awaitingPassDecision.data as {
        continuation: {
          commandAlternatives: Array<{ name: string; commandArgs: string[] }>;
        };
      }
    ).continuation.commandAlternatives.find(({ name }) => name === 'accept-result');
    expect(oldAcceptResultAlternative).toMatchObject({
      name: 'accept-result',
      commandArgs: expect.arrayContaining([
        '--accept-result',
        '--expected-state-version',
        '--expected-action',
        'accept-result',
      ]),
    });

    const returned = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'User-visible acceptance criteria changed',
        '--revise-requirements',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(returned).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'shape',
          status: 'active',
          acceptance: { total: 0 },
          blockers: [],
          verification_result: 'pending',
          loop: {
            stage: 'shape',
            goal_cycle: 2,
            iteration: 0,
            attempt: 0,
            next_action: 'prepare-shape-confirmation',
          },
        },
        continuation: { action: 'prepare-shape-confirmation' },
      },
    });

    const staleAcceptResult = json(
      await runNativeCli([
        ...oldAcceptResultAlternative!.commandArgs
          .slice(2)
          .map((value) =>
            value === '<summary>' ? 'Delayed confirmation for an obsolete pass' : value,
          ),
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(staleAcceptResult).toMatchObject({
      exitCode: 65,
      error: { message: expect.stringContaining('Native continuation is stale') },
    });
    expect(json(await runNativeCli(['show', name, '--json', ...projectArgs()])).data).toMatchObject(
      {
        state: {
          phase: 'shape',
          status: 'active',
          acceptance: [],
          builder_handoff: null,
          loop: { next_action: 'prepare-shape-confirmation' },
        },
      },
    );

    const staleArchive = json(
      await runNativeCli(['archive', name, '--dry-run', '--json', ...projectArgs()]),
    );
    expect(staleArchive).toMatchObject({
      exitCode: 0,
      data: {
        ready: false,
        continuation: { action: 'prepare-shape-confirmation' },
      },
    });

    const brief = `# Outcome
Ship the updated requested behavior.
# Scope
Keep the implementation focused.
## Directory structure
### Created
None.
### Modified
None.
### Deleted
None.
### Not created
None.
# Non-goals
No unrelated changes.
# Acceptance examples
- Updated behavior works.
# Constraints and invariants
Preserve existing behavior.
# Decisions
User rejected the previous pass because the acceptance criteria changed.
# Open questions
None.
# Verification expectations
Run applicable focused checks.
`;
    await fs.writeFile(path.join(projectRoot, 'docs', 'comet', 'changes', name, 'brief.md'), brief);
    const updatedPrepared = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'Updated Shape is ready for confirmation',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(updatedPrepared).toMatchObject({
      exitCode: 0,
      data: { state: { phase: 'shape', status: 'await-user' } },
    });
    const updatedPreparedState = updatedPrepared.data?.state as { state_version: number };
    const reconfirmed = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'Updated Shape confirmed',
        '--confirmed',
        '--expected-state-version',
        String(updatedPreparedState.state_version),
        '--expected-action',
        'confirm-shape',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(reconfirmed).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'build',
          acceptance: { total: 1, pending: 1 },
          loop: { goal_cycle: 2, iteration: 1 },
        },
      },
    });

    const rebuilt = await runnerStep(name, builderHandoff(['A1']));
    expect(rebuilt).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'verify',
          verification_result: 'pending',
        },
      },
    });
    const newCandidateId = (
      json(await runNativeCli(['show', name, '--json', ...projectArgs()])).data as {
        state: { builder_handoff: { candidate_id: string } };
      }
    ).state.builder_handoff.candidate_id;
    expect(newCandidateId).not.toBe(oldCandidateId);
  });

  it('revises requirements from Archive-ready and invalidates the accepted result', async () => {
    const name = 'archive-ready-revise-requirements';
    await prepareBuild(name, ['Original behavior works.']);
    await runnerStep(name, builderHandoff(['A1']));
    await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    await runnerStep(name, finalResponse(1, 1, ['A1']));

    const accepted = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'User accepts the current verification result',
        '--accept-result',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(accepted).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'archive',
          status: 'active',
          verification_result: 'pass',
          loop: { stage: 'archive-ready', next_action: 'archive' },
        },
        continuation: { action: 'archive' },
      },
    });

    const archiveStateVersion = (accepted.data as { state: { state_version: number } }).state
      .state_version;
    const returned = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'User-visible acceptance criteria changed',
        '--revise-requirements',
        '--expected-state-version',
        String(archiveStateVersion),
        '--expected-action',
        'revise-requirements',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(returned).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'shape',
          status: 'active',
          acceptance: { total: 0, pending: 0, failed: 0, blocked: 0 },
          blockers: [],
          verification_result: 'pending',
          loop: {
            stage: 'shape',
            goal_cycle: 2,
            iteration: 0,
            attempt: 0,
            next_action: 'prepare-shape-confirmation',
          },
        },
        continuation: { action: 'prepare-shape-confirmation' },
      },
    });

    const archiveContinuation = accepted.data as {
      continuation: {
        action: string;
        commandAlternatives?: Array<{
          name: string;
          expectedAction: string;
          commandArgs: string[];
        }>;
      };
    };
    expect(archiveContinuation.continuation).toMatchObject({
      action: 'archive',
      commandAlternatives: expect.arrayContaining([
        expect.objectContaining({
          name: 'revise-requirements',
          expectedAction: 'revise-requirements',
          commandArgs: expect.arrayContaining([
            '--revise-requirements',
            '--expected-state-version',
            String(archiveStateVersion),
            '--expected-action',
            'revise-requirements',
          ]),
        }),
      ]),
    });

    const staleRevision = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'Delayed revision for an obsolete Archive-ready result',
        '--revise-requirements',
        '--expected-state-version',
        String(archiveStateVersion),
        '--expected-action',
        'revise-requirements',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(staleRevision).toMatchObject({
      exitCode: 65,
      error: { message: expect.stringContaining('Native continuation is stale') },
    });
  });

  it.each([
    { name: 'verifier-unavailable-empty', withCheck: false },
    { name: 'verifier-unavailable-checked', withCheck: true },
  ])(
    'requires user confirmation for degraded semantic verification ($name)',
    async ({ name, withCheck }) => {
      await prepareBuild(name, ['First behavior works.'], 'zh-CN');
      await runnerStep(name, builderHandoff(['A1']));
      const checks = withCheck
        ? [
            {
              id: 'runtime-pass',
              name: 'Runtime pass',
              executable: process.execPath,
              argv: ['-e', 'process.exit(0)'],
              cwdRef: '.',
              timeoutMs: 10_000,
              repeatable: true,
            },
          ]
        : [];
      const dispatched = await runnerStep(name, { kind: 'dispatch-verifier', checks });

      const forged = await runnerStep(name, {
        kind: 'verifier-unavailable',
        summary: 'No independent Agent execution is available.',
        provider: 'caller-selected-provider',
      });
      expect(forged).toMatchObject({
        exitCode: 65,
        error: { message: expect.stringContaining('fields are invalid') },
      });

      const unavailable = await runnerStep(name, {
        ...inputTemplate(dispatched, 'verifier-unavailable'),
        summary: 'This platform cannot start an independent Agent execution.',
      });
      expect(unavailable).toMatchObject({
        exitCode: 0,
        data: {
          coordination: 'skill-coordinated',
          state: {
            phase: 'verify',
            status: 'await-user',
            verification_result: 'blocked',
            blockers: [
              {
                owner: 'user',
                resolution_action: 'confirm-verifier-unavailable',
              },
            ],
            loop: { next_action: 'confirm-verifier-unavailable' },
          },
          continuation: {
            disposition: 'await-user',
            action: 'confirm-verifier-unavailable',
            commandArgs: null,
            requiredInputs: ['summary', 'user-decision'],
            commandAlternatives: expect.arrayContaining([
              expect.objectContaining({
                name: 'retry-verifier',
                expectedAction: 'retry-verifier',
                commandArgs: expect.arrayContaining(['--retry-verifier']),
              }),
              expect.objectContaining({
                name: 'confirm-verifier-unavailable',
                expectedAction: 'confirm-verifier-unavailable',
                commandArgs: expect.arrayContaining(['--confirmed']),
              }),
            ]),
            userCommunication: {
              required: true,
              message:
                '独立验收当前不可用，但你的代码和已经完成的检查都已安全保留。你可以直接重新尝试独立验收，也可以明确接受只有自动检查的结果。',
              suggestedReply: '重新尝试独立验收',
              agentInstruction:
                '只向用户转述 message 和 suggestedReply，并等待用户选择。用户要求重试时执行 commandAlternatives 中的 retry-verifier；只有用户明确接受降级结果时才执行 confirm-verifier-unavailable。不要把“继续”视为接受降级结果，也不要要求用户处理文件、进程、服务或回调。',
            },
          },
        },
      });
      const reportFile = path.join(
        projectRoot,
        'docs',
        'comet',
        'changes',
        name,
        'verification.md',
      );
      const pendingReport = await fs.readFile(reportFile, 'utf8');
      expect(pendingReport).toContain('结果: **无法完成完整验证，只完成了自动检查**');
      expect(pendingReport).toContain('验证情况: **无法完成完整验证，只完成了自动检查**');
      expect(pendingReport).not.toContain('验证情况: **已完成独立验证**');

      const confirmed = json(
        await runNativeCli([
          'next',
          name,
          '--summary',
          'User accepts completion with degraded semantic assurance',
          '--confirmed',
          '--json',
          ...projectArgs(),
        ]),
      );
      expect(confirmed).toMatchObject({
        exitCode: 0,
        data: {
          state: {
            phase: 'archive',
            status: 'active',
            verification_result: 'pass',
            acceptance: { total: 1, passed: 1 },
            loop: { stage: 'archive-ready', next_action: 'archive' },
          },
        },
      });
      const confirmedReport = await fs.readFile(reportFile, 'utf8');
      expect(confirmedReport).toContain('结果: **验收通过，可归档**');
      expect(confirmedReport).toContain('验证情况: **你已确认接受不完整验证结果**');
      expect(confirmedReport).not.toContain('验证情况: **已完成独立验证**');
    },
  );

  it('retries an unavailable Verifier with the same candidate and completed checks', async () => {
    const name = 'retry-unavailable-verifier';
    const counter = path.join(projectRoot, 'unavailable-retry-check-count.txt');
    const check = {
      id: 'runtime-pass',
      name: 'Runtime pass',
      executable: process.execPath,
      argv: ['-e', `require('fs').appendFileSync(${JSON.stringify(counter)}, 'run\\n')`],
      cwdRef: '.',
      timeoutMs: 10_000,
      repeatable: true,
    };
    await prepareBuild(name, ['First behavior works.'], 'zh-CN');
    await runnerStep(name, builderHandoff(['A1']));
    const firstDispatch = await runnerStep(name, { kind: 'dispatch-verifier', checks: [check] });
    const firstCandidate = (firstDispatch.data as { verifierDispatch: { candidateId: string } })
      .verifierDispatch.candidateId;
    const unavailable = await runnerStep(name, {
      kind: 'verifier-unavailable',
      summary: 'The platform temporarily could not start an independent Agent.',
    });
    const unavailableStateVersion = (unavailable.data?.state as { state_version: number })
      .state_version;

    const retried = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'Retry independent verification',
        '--retry-verifier',
        '--expected-state-version',
        String(unavailableStateVersion),
        '--expected-action',
        'retry-verifier',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(retried).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'verify',
          status: 'active',
          verification_result: 'pending',
          loop: {
            stage: 'verify-ready',
            retry_epoch: 1,
            next_action: 'dispatch-new-verifier',
          },
        },
        continuation: { action: 'dispatch-verifier' },
      },
    });

    const secondDispatch = await runnerStep(name, { kind: 'dispatch-verifier', checks: [check] });
    expect(secondDispatch).toMatchObject({
      exitCode: 0,
      data: {
        checks: [expect.objectContaining({ id: 'runtime-pass', status: 'passed' })],
        verifierDispatch: { candidateId: firstCandidate, attempt: 2 },
      },
    });
    await expect(fs.readFile(counter, 'utf8')).resolves.toBe('run\n');
  });

  it('dispatches after handoff checks and reuses them for the same Verifier', async () => {
    const name = 'handoff-runtime-check-reuse';
    const counter = path.join(projectRoot, '.comet', 'runtime', 'handoff-check-count.txt');
    const verificationCheck = {
      id: 'runtime-pass',
      name: 'Runtime pass',
      executable: process.execPath,
      argv: ['-e', `require('fs').appendFileSync(${JSON.stringify(counter)}, 'run\\n')`],
      cwdRef: '.',
      timeoutMs: 10_000,
      repeatable: true,
    };
    await prepareBuild(name, ['First behavior works.'], 'zh-CN');

    const checked = await runnerStep(name, {
      ...builderHandoff(['A1']),
      verification_checks: [verificationCheck],
    });

    expect(checked).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'verify',
          status: 'active',
          loop: { stage: 'verify-ready', next_action: 'await-verifier-result' },
        },
        checks: [expect.objectContaining({ id: 'runtime-pass', status: 'passed' })],
        runtimeCheckExecution: { disposition: 'executed' },
        continuation: {
          action: 'await-verifier',
        },
        verifierDispatch: { runtimeChecks: [expect.objectContaining({ id: 'runtime-pass' })] },
      },
    });
    await expect(fs.readFile(counter, 'utf8')).resolves.toBe('run\n');

    for (const command of ['status', 'show'] as const) {
      const resumed = json(await runNativeCli([command, name, '--json', ...projectArgs()]));
      expect(resumed.data?.continuation).toMatchObject({
        action: 'await-verifier',
      });
    }

    const dispatch = checked.data!.verifierDispatch as {
      candidateId: string;
      verifierExecutionRef: string;
      iteration: number;
      attempt: number;
    };
    const dispatched = await runnerStep(name, {
      kind: 'verifier-response',
      candidateId: dispatch.candidateId,
      verifierExecutionRef: dispatch.verifierExecutionRef,
      response: {
        kind: 'request-checks',
        iteration: dispatch.iteration,
        attempt: dispatch.attempt,
        checks: [verificationCheck],
      },
    });
    expect(dispatched).toMatchObject({
      exitCode: 0,
      data: {
        checks: [expect.objectContaining({ id: 'runtime-pass', status: 'passed' })],
        requestChecks: { reusedCheckIds: ['runtime-pass'], executedCheckIds: [] },
        verifierDispatch: {
          verifierExecutionRef: dispatch.verifierExecutionRef,
          runtimeChecks: [expect.objectContaining({ id: 'runtime-pass' })],
        },
        continuation: { action: 'await-verifier' },
      },
    });
    await expect(fs.readFile(counter, 'utf8')).resolves.toBe('run\n');
  });

  it('returns a failed handoff verification check to Build', async () => {
    const name = 'handoff-runtime-check-failure';
    await prepareBuild(name, ['First behavior works.'], 'zh-CN');

    const checked = await runnerStep(name, {
      ...builderHandoff(['A1']),
      verification_checks: [
        {
          id: 'runtime-fail',
          name: 'Runtime fail',
          executable: process.execPath,
          argv: ['-e', 'process.exit(7)'],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    });

    expect(checked).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'build',
          status: 'active',
          loop: { stage: 'repairing', next_action: 'submit-builder-candidate' },
        },
        checks: [expect.objectContaining({ id: 'runtime-fail', status: 'failed', exit_code: 7 })],
        runtimeCheckExecution: { disposition: 'executed' },
        continuation: { action: 'repair' },
      },
    });
  });

  it('offers retry-checks when a repeatable handoff verification check is interrupted', async () => {
    const name = 'handoff-runtime-check-interrupted';
    await prepareBuild(name, ['First behavior works.'], 'zh-CN');

    const checked = await runnerStep(name, {
      ...builderHandoff(['A1']),
      verification_checks: [
        {
          id: 'runtime-pass',
          name: 'Runtime pass',
          executable: process.execPath,
          argv: ['-e', 'process.exit(0)'],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
        {
          id: 'runtime-timeout',
          name: 'Runtime timeout',
          executable: process.execPath,
          argv: ['-e', 'setTimeout(() => {}, 60000)'],
          cwdRef: '.',
          // 先给进程登记留出真实预算，验证已启动命令的中断，而非登记失败。
          timeoutMs: 10000,
          repeatable: true,
        },
      ],
    });

    expect(checked).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'verify',
          status: 'active',
          loop: { stage: 'verify-ready', next_action: 'run-required-checks-and-dispatch-verifier' },
        },
        checks: [
          expect.objectContaining({ id: 'runtime-pass', status: 'passed' }),
          expect.objectContaining({ id: 'runtime-timeout', status: 'interrupted' }),
        ],
        runtimeCheckExecution: { disposition: 'executed' },
        continuation: {
          action: 'retry-checks',
          inputOptions: [
            expect.objectContaining({
              template: { kind: 'retry-checks', check_ids: ['runtime-timeout'] },
            }),
          ],
        },
      },
    });

    const retried = await runnerStep(name, inputTemplate(checked, 'runner-input'));
    expect(retried).toMatchObject({
      exitCode: 0,
      data: { continuation: { action: 'retry-checks' } },
    });
    const exhausted = await runnerStep(name, inputTemplate(retried, 'runner-input'));
    expect(exhausted).toMatchObject({
      exitCode: 0,
      data: {
        state: { phase: 'build', loop: { stage: 'repairing' } },
        continuation: { action: 'repair' },
      },
    });
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const local = await readNativeLocalExecution(nativeLocalExecutionFile(paths, name));
    expect(local?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'runtime-pass', status: 'passed', executionCount: 1 }),
        expect.objectContaining({
          id: 'runtime-timeout',
          status: 'interrupted',
          executionCount: 3,
        }),
      ]),
    );
  });

  it('rejects delayed generic Verifier errors and unavailable messages from an older attempt', async () => {
    const name = 'stale-generic-verifier-message';
    await prepareBuild(name);
    await runnerStep(name, builderHandoff(['A1']));
    const firstDispatch = await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    const first = (
      firstDispatch.data as {
        verifierDispatch: {
          stateVersion: number;
          iteration: number;
          attempt: number;
          verifierExecutionRef: string;
        };
      }
    ).verifierDispatch;
    const firstError = await runnerStep(name, {
      ...inputTemplate(firstDispatch, 'verifier-execution-error'),
      summary: 'The first Verifier execution ended.',
    });
    expect(firstError).toMatchObject({
      exitCode: 0,
      data: { state: { loop: { stage: 'verify-ready' } } },
    });

    const secondDispatch = await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    const second = (
      secondDispatch.data as {
        verifierDispatch: {
          stateVersion: number;
          iteration: number;
          attempt: number;
          verifierExecutionRef: string;
        };
      }
    ).verifierDispatch;
    expect(second.attempt).toBe(first.attempt + 1);
    const before = json(await runNativeCli(['show', name, '--json', ...projectArgs()]));

    for (const kind of ['verifier-execution-error', 'verifier-unavailable'] as const) {
      const delayed = await runnerStep(name, {
        kind,
        summary: 'Delayed message from the previous Verifier.',
        stateVersion: first.stateVersion,
        iteration: first.iteration,
        attempt: first.attempt,
        verifierExecutionRef: first.verifierExecutionRef,
      });
      expect(delayed).toMatchObject({
        exitCode: 65,
        error: { message: expect.stringContaining('stale for the current attempt') },
      });
    }
    const after = json(await runNativeCli(['show', name, '--json', ...projectArgs()]));
    expect(after.data?.state).toMatchObject({
      state_version: (before.data?.state as { state_version: number }).state_version,
      loop: { attempt: second.attempt, execution_failure_count: 1 },
    });
  });

  it('returns friendly localized guidance when Verifier infrastructure repeatedly fails', async () => {
    const name = 'friendly-verifier-recovery';
    await prepareBuild(name, ['The behavior remains safe during verification recovery.'], 'zh-CN');
    await runnerStep(name, builderHandoff(['A1']));

    let failed: JsonEnvelope | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const dispatched = await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
      expect(dispatched.data?.continuation).toMatchObject({
        action: 'await-verifier',
        userCommunication: {
          required: false,
          message: null,
          suggestedReply: null,
        },
      });
      failed = await runnerStep(name, {
        kind: 'verifier-execution-error',
        summary: `Verifier worker ${attempt} ended without a response.`,
      });
    }

    expect(failed).toMatchObject({
      exitCode: 0,
      data: {
        state: { status: 'blocked', loop: { attempt: 3, execution_failure_count: 3 } },
        continuation: {
          disposition: 'blocked',
          action: 'retry-verifier',
          userCommunication: {
            required: true,
            message:
              '由于独立验收任务连续几次没有正常返回结果，本次验收已暂停。你的代码和已经完成的检查都已安全保留。回复“继续”即可重新尝试，不需要处理文件或进程。',
            suggestedReply: '继续',
            agentInstruction:
              '只向用户转述 message 和 suggestedReply，并等待用户回复。不要展示内部轮次、计数、路径或恢复步骤。',
          },
        },
      },
    });
    const communication = (failed?.data?.continuation as { userCommunication: { message: string } })
      .userCommunication;
    expect(communication.message).not.toMatch(/attempt|requestCheckRounds|Runtime|Verifier/iu);
  });

  it('rejects verifier-unavailable while a resolved Runtime check failed', async () => {
    const name = 'verifier-unavailable-failed-check';
    await prepareBuild(name);
    await runnerStep(name, builderHandoff(['A1']));
    await runnerStep(name, {
      kind: 'dispatch-verifier',
      checks: [
        {
          id: 'runtime-fail',
          name: 'Runtime fail',
          executable: process.execPath,
          argv: ['-e', 'process.exit(1)'],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    });
    const unavailable = await runnerStep(name, {
      kind: 'verifier-unavailable',
      summary: 'No independent execution is available.',
    });
    expect(unavailable).toMatchObject({
      exitCode: 65,
      error: { message: expect.stringContaining('every resolved Runtime check to pass') },
    });
    expect(json(await runNativeCli(['show', name, '--json', ...projectArgs()])).data).toMatchObject(
      { state: { status: 'active', loop: { attempt: 1 } } },
    );
  });

  it('executes Verifier-requested checks and resumes the same programmatic attempt', async () => {
    const name = 'skill-request-checks';
    await prepareBuild(name);
    await runnerStep(name, builderHandoff(['A1']));
    const dispatched = await runnerStep(name, {
      kind: 'dispatch-verifier',
      checks: [
        {
          id: 'initial-focused',
          name: 'Initial focused check',
          executable: process.execPath,
          argv: ['-e', 'process.exit(0)'],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    });
    const firstDispatch = (
      dispatched.data as { verifierDispatch: { iteration: number; attempt: number } }
    ).verifierDispatch;

    const requestTemplate = inputTemplate(dispatched, 'request-checks');
    const requested = await runnerStep(name, {
      ...requestTemplate,
      response: {
        ...(requestTemplate.response as Record<string, unknown>),
        checks: [
          {
            id: 'verifier-extra',
            name: 'Verifier requested check',
            executable: process.execPath,
            argv: ['-e', "process.stdout.write('extra-check')"],
            cwdRef: '.',
            timeoutMs: 10_000,
            repeatable: true,
          },
        ],
      },
    });
    expect(requested).toMatchObject({
      exitCode: 0,
      data: {
        coordination: 'skill-coordinated',
        requestChecks: { round: 1, executedCheckIds: ['verifier-extra'] },
        verifierDispatch: {
          iteration: firstDispatch.iteration,
          attempt: firstDispatch.attempt,
          runtimeChecks: [
            {
              id: 'initial-focused',
              name: { text: 'Initial focused check' },
              status: 'passed',
              exit_code: 0,
            },
            {
              id: 'verifier-extra',
              name: { text: 'Verifier requested check' },
              status: 'passed',
              exit_code: 0,
            },
          ],
        },
      },
    });

    const verified = await runnerStep(
      name,
      finalResponse(firstDispatch.iteration, firstDispatch.attempt, ['A1']),
    );
    expect(verified).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'verify',
          status: 'await-user',
          loop: {
            attempt: firstDispatch.attempt,
            next_action: 'confirm-skill-coordinated-pass',
          },
        },
      },
    });
    expect(json(await runNativeCli(['show', name, '--json', ...projectArgs()])).data).toMatchObject(
      {
        state: {
          verification: {
            checks: [
              { id: 'initial-focused', name: { text: 'Initial focused check' } },
              { id: 'verifier-extra', name: { text: 'Verifier requested check' } },
            ],
          },
        },
      },
    );
    const changeDir = path.join(projectRoot, 'docs', 'comet', 'changes', name);
    const portableYaml = await fs.readFile(path.join(changeDir, 'comet-state.yaml'), 'utf8');
    const report = await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8');
    for (const checkName of ['Initial focused check', 'Verifier requested check']) {
      expect(portableYaml).toContain(checkName);
      expect(report).toContain(checkName);
    }
  });

  it('resolves a semantic Verifier blocker with a new attempt and retained checks', async () => {
    const name = 'resolve-semantic-blocker';
    const acceptance = Array.from({ length: 40 }, (_, index) => `Behavior ${index + 1} works.`);
    await prepareBuild(name, acceptance);
    await runnerStep(name, builderHandoff(['A1']));
    const counter = path.join(projectRoot, 'semantic-blocker-count.txt');
    const plan = {
      kind: 'dispatch-verifier',
      checks: [
        {
          id: 'semantic-baseline',
          name: 'Semantic baseline',
          executable: process.execPath,
          argv: [
            '-e',
            "const fs=require('node:fs');const f=process.argv[1];let n=0;try{n=Number(fs.readFileSync(f,'utf8'))}catch{}fs.writeFileSync(f,String(n+1))",
            counter,
          ],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    };
    await runnerStep(name, plan);
    const blocked = await runnerStep(name, {
      kind: 'verifier-response',
      response: {
        kind: 'final-result',
        result: {
          iteration: 1,
          attempt: 1,
          verdict: 'blocked',
          acceptance: acceptance.map((_, index) => ({
            id: `A${index + 1}`,
            result: 'blocked' as const,
            reason:
              index === 0
                ? 'A user-visible choice is required.'
                : 'Additional user context is required.',
          })),
          risks: [],
          summary: 'Semantic verification needs a user decision.',
        },
      },
    });
    expect(blocked).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'verify',
          status: 'await-user',
          loop: { iteration: 1, attempt: 1, retry_epoch: 0 },
          blockers: [{ resolution_action: 'resolve-verifier-blocker' }],
        },
        continuation: {
          action: 'resolve-verifier-blocker',
          commandArgs: null,
          requiredInputs: ['summary', 'user-decision'],
          inputOptions: [expect.objectContaining({ name: 'summary', flag: '--summary' })],
          commandAlternatives: expect.arrayContaining([
            expect.objectContaining({
              name: 'resolve-verifier-blocker',
              commandArgs: expect.arrayContaining(['--resolve-verifier-blocker']),
              requiredInputs: ['summary', 'user-resolution'],
            }),
            expect.objectContaining({
              name: 'revise-implementation',
              commandArgs: expect.arrayContaining(['--revise-implementation']),
              requiredInputs: ['summary', 'user-decision'],
            }),
            expect.objectContaining({
              name: 'revise-requirements',
              commandArgs: expect.arrayContaining(['--revise-requirements']),
              requiredInputs: ['summary', 'user-decision'],
            }),
          ]),
        },
      },
    });
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const localFile = nativeLocalExecutionFile(paths, name);
    expect(await readNativeLocalExecution(localFile)).toMatchObject({
      execution: { stage: 'checking', status: 'completed' },
      checks: [{ id: 'semantic-baseline', executionCount: 1, status: 'passed' }],
    });

    const resolved = json(
      await runNativeCli([
        'next',
        name,
        '--summary',
        'Retry semantic verification without implementation changes',
        '--resolve-verifier-blocker',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(resolved).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'verify',
          status: 'active',
          verification_result: 'pending',
          loop: {
            stage: 'verify-ready',
            iteration: 1,
            attempt: 1,
            retry_epoch: 1,
          },
        },
        continuation: { action: 'dispatch-verifier' },
      },
    });
    expect(await readNativeLocalExecution(localFile)).toMatchObject({
      checks: [{ id: 'semantic-baseline', executionCount: 1, status: 'passed' }],
    });

    const redispatched = await runnerStep(name, plan);
    expect(redispatched).toMatchObject({
      exitCode: 0,
      data: {
        state: { loop: { iteration: 1, attempt: 2, retry_epoch: 1 } },
        verifierDispatch: {
          iteration: 1,
          attempt: 2,
          recoveryContext: {
            text: 'Retry semantic verification without implementation changes',
            truncated: false,
          },
        },
      },
    });
    expect(await fs.readFile(counter, 'utf8')).toBe('1');
    expect(await readNativeLocalExecution(localFile)).toMatchObject({
      checks: [{ id: 'semantic-baseline', executionCount: 1, status: 'passed' }],
    });
  });

  it('keeps explicit revise-requirements phase eligibility inside the runtime mutation lock', async () => {
    const name = 'locked-revise-requirements';
    await prepareBuild(name);
    const paths = await nativeProjectPaths(projectRoot, 'docs');

    await expect(
      returnNativePortableChangeToShape({
        paths,
        name,
        reason: 'Attempt explicit Verify/Archive recovery while Build is current',
        allowedPhases: ['verify', 'archive'],
      }),
    ).rejects.toThrow('--revise-requirements is only valid from Verify or Archive');

    const shown = json(await runNativeCli(['show', name, '--json', ...projectArgs()]));
    expect(shown).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'build',
          status: 'active',
          loop: { next_action: 'submit-builder-candidate' },
        },
      },
    });
  });

  it('reserves concurrent check-plan dispatch and never reruns an already resolved plan', async () => {
    const name = 'skill-concurrent-dispatch';
    await prepareBuild(name);
    await runnerStep(name, builderHandoff(['A1']));
    const counter = path.join(projectRoot, 'dispatch-count.txt');
    const plan = {
      kind: 'dispatch-verifier',
      checks: [
        {
          id: 'once',
          name: 'Run once',
          executable: process.execPath,
          argv: [
            '-e',
            "const fs=require('node:fs');const f=process.argv[1];let n=0;try{n=Number(fs.readFileSync(f,'utf8'))}catch{}fs.writeFileSync(f,String(n+1));setTimeout(()=>process.exit(0),400)",
            counter,
          ],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    };

    const concurrent = await Promise.all([runnerStep(name, plan), runnerStep(name, plan)]);
    expect(concurrent.map(({ exitCode }) => exitCode).sort((left, right) => left - right)).toEqual([
      0, 65,
    ]);
    expect(concurrent.find(({ exitCode }) => exitCode === 65)?.error?.message).toMatch(
      /already in progress|Verify ready state/iu,
    );
    expect(await fs.readFile(counter, 'utf8')).toBe('1');

    const repeated = await runnerStep(name, plan);
    expect(repeated).toMatchObject({ exitCode: 65, error: { code: 'invalid-data' } });
    expect(await fs.readFile(counter, 'utf8')).toBe('1');
  });

  it('rejects a final result that omits an acceptance ID', async () => {
    const name = 'skill-missing-acceptance';
    await prepareBuild(name, ['First behavior works.', 'Second behavior works.']);
    await runnerStep(name, builderHandoff(['A1', 'A2']));
    await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });

    const missing = await runnerStep(name, finalResponse(1, 1, ['A1']));
    expect(missing).toMatchObject({
      exitCode: 65,
      error: { code: 'invalid-data', message: expect.stringContaining('missing: A2') },
    });
  });

  it('replaces acceptance choices with workspace recovery without mutating state', async () => {
    const name = 'workspace-recovery-output';
    await prepareBuild(name);
    await runnerStep(name, builderHandoff(['A1']));
    await runnerStep(name, { kind: 'dispatch-verifier', checks: [] });
    const ready = await runnerStep(name, finalResponse(1, 1, ['A1']));
    const version = (ready.data?.state as { state_version: number }).state_version;
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/wrong-workspace'], {
      cwd: projectRoot,
    });
    const args = [
      'next',
      name,
      '--summary',
      'Accept',
      '--accept-result',
      '--expected-state-version',
      String(version),
      '--expected-action',
      'accept-result',
      ...projectArgs(),
    ];
    const blocked = json(await runNativeCli([...args, '--json']));
    expect(blocked).toMatchObject({
      exitCode: 0,
      data: {
        state: { state_version: version },
        recovery: { reason: 'workspace-mismatch' },
        continuation: {
          disposition: 'blocked',
          mode: 'reconcile',
          action: 'repair',
          commandArgs: null,
          commandAlternatives: [],
          requiresUserDecision: false,
          runnerAction: { kind: 'none' },
        },
      },
    });
    const text = await runNativeCli(args);
    expect(text.stdout).toContain('wrong-workspace');
    expect(text.stdout).toContain(`comet native status ${name} --json`);
    expect(text.stdout).not.toContain('choose whether to accept');
  });

  it('explains when check is unavailable for portable changes', async () => {
    await prepareBuild('check-guidance');
    const result = json(
      await runNativeCli(['check', 'check-guidance', '--json', ...projectArgs()]),
    );
    expect(result).toMatchObject({
      exitCode: 64,
      error: { message: expect.stringContaining('not available for this change') },
    });
    expect(result.error?.message).toContain('comet native status check-guidance --json');
    expect((await runNativeCli(['check', '--help'])).exitCode).toBe(0);
  });

  it('keeps SDK checks on the Run instead of probing legacy state', async () => {
    const created = json(await runNativeCli(['new', 'sdk-check', '--json', ...projectArgs()]));
    expect(created.exitCode).toBe(0);
    const checked = json(await runNativeCli(['check', 'sdk-check', '--json', ...projectArgs()]));
    expect(checked).toMatchObject({
      exitCode: 64,
      error: { message: expect.stringContaining('not available for this change') },
    });
    expect(checked.error?.message).toContain('comet native status sdk-check --json');
    expect((await inspectNativeSdkRun(projectRoot, 'sdk-check')).state.phase).toBe('shape');
  });

  it('keeps SDK spec sync out of the legacy state mutation path', async () => {
    const created = json(await runNativeCli(['new', 'sdk-sync', '--json', ...projectArgs()]));
    expect(created.exitCode).toBe(0);
    const input = path.join(projectRoot, 'sync-input.json');
    await fs.writeFile(
      input,
      JSON.stringify({
        actor: 'agent',
        reason: 'Reference correction',
        expectedStateVersion: 1,
        affectedAcceptanceIds: ['A1'],
        replacements: [{ from: 'old-ref', to: 'new-ref' }],
      }),
    );
    const synced = json(
      await runNativeCli([
        'spec',
        'sync',
        'sdk-sync',
        'workflow',
        '--input',
        'sync-input.json',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(synced).toMatchObject({
      exitCode: 64,
      error: { message: expect.stringContaining('SDK') },
    });
    expect(synced.error?.message).toContain('revise-requirements');
    expect((await inspectNativeSdkRun(projectRoot, 'sdk-sync')).state.state_version).toBe(1);
    const help = await runNativeCli(['spec', 'sync', '--help']);
    expect(help.stdout).toContain('Compat-only');
    expect(help.stdout).toContain('revise-requirements');
  });
});
