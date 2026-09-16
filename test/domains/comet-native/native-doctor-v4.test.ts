import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import { nativeNextCommand } from '../../../domains/comet-native/native-next-command.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { migrateNativeLegacyChangeToPortable } from '../../../domains/comet-native/native-portable-migration-runtime.js';
import {
  createNativePortableChange,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  nativePortableStateFile,
  prepareNativePortableShapeConfirmation,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { readNativeLocalExecution } from '../../../domains/comet-native/native-local-execution.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';
import { parseNativeChildrenContract } from '../../../domains/comet-native/native-children.js';
import {
  createNativeSupervisorState,
  nativeSupervisorStateFile,
  writeNativeSupervisorState,
} from '../../../domains/comet-native/native-supervisor.js';
import { applyNativeRunnerInput } from '../../../domains/comet-native/native-runner-input.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import {
  parseNativePortableState,
  writeNativePortableState,
} from '../../../domains/comet-native/native-portable-state.js';
import { inspectNativePortableStatus } from '../../../domains/comet-native/native-portable-status.js';
import { runGitCommand } from '../../../platform/process/git.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';
import { ensureCliBuilt } from '../../helpers/ensure-cli-built.js';
import {
  processIsAlive,
  spawnNativePortableProcess,
  waitForCondition,
  waitForProcessExit,
} from '../../helpers/native-portable-process.js';

describe('Native portable Doctor', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-portable-doctor-'));
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function createPortable(name: string): Promise<void> {
    await createNativePortableChange({ paths, name, language: 'en' });
  }

  async function createLegacySupervisorFixture(name: string) {
    await fs.writeFile(path.join(projectRoot, '.gitignore'), '.comet/runtime/\n');
    runGitCommand(projectRoot, ['init', '-b', 'main']);
    runGitCommand(projectRoot, ['config', 'user.email', 'native@example.test']);
    runGitCommand(projectRoot, ['config', 'user.name', 'Native Test']);
    runGitCommand(projectRoot, ['add', '.']);
    runGitCommand(projectRoot, ['commit', '--allow-empty', '-m', 'seed test repository']);
    const childrenSource = `schema: comet.native.children.v1
children:
  - name: foundation
    depends_on: []
    covers: [A1]
`;
    await createPortable(name);
    const changeDir = nativePortableChangeDir(paths, name);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The legacy child is complete.\n',
    );
    await fs.writeFile(path.join(changeDir, 'children.yaml'), childrenSource);

    const shapeState = await readNativePortableChange(paths, name);
    await writeNativePortableState(
      nativePortableStateFile(paths, name),
      {
        ...shapeState,
        workspace: {
          ...shapeState.workspace,
          change_branch: 'main',
          target_branch: 'main',
        },
      },
      { containedRoot: paths.nativeRoot },
    );
    const buildState = await confirmNativePortableShape({ paths, name });
    const contract = parseNativeChildrenContract(
      childrenSource,
      buildState.acceptance.map(({ id }) => id),
    );
    const overlay = createNativeSupervisorState({
      parent: name,
      targetBranch: 'main',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'main',
      integrationWorktree: projectRoot,
      contract,
    });
    await writeNativeSupervisorState(paths, overlay);
    return {
      buildState,
      overlay,
      file: nativeSupervisorStateFile(paths, name),
    };
  }

  async function archiveLegacyChild(state: Awaited<ReturnType<typeof confirmNativePortableShape>>) {
    const archivedChild = parseNativePortableState({
      ...state,
      name: 'foundation',
      phase: 'archive',
      status: 'done',
      workspace: {
        isolation: 'worktree',
        change_branch: 'comet/foundation',
        target_branch: 'main',
        finish: 'merge',
      },
      loop: { ...state.loop, stage: 'done', next_action: 'done' },
      archived: true,
    });
    const archivedChildFile = path.join(
      paths.archiveDir,
      '2026-09-03-foundation',
      'comet-state.yaml',
    );
    await writeNativePortableState(archivedChildFile, archivedChild, {
      containedRoot: paths.nativeRoot,
    });
    runGitCommand(projectRoot, ['add', 'docs/comet/archive']);
    runGitCommand(projectRoot, ['commit', '-m', 'record merged test child']);
  }

  async function createLegacy(name: string): Promise<void> {
    const changeDir = path.join(paths.changesDir, name);
    await fs.mkdir(path.join(changeDir, 'specs'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- Preserve the legacy behavior.\n',
    );
    await fs.writeFile(
      path.join(changeDir, 'comet-state.yaml'),
      stringify({
        schema: 'comet.native.v3',
        minimum_runtime_version: 3,
        revision: 1,
        verification_protocol: 'legacy-v1',
        name,
        language: 'en',
        phase: 'shape',
        brief: 'brief.md',
        approval: null,
        approved_contract_hash: null,
        spec_changes: [],
        verification_result: 'pending',
        verification_report: null,
        implementation_scope: null,
        verification_evidence: null,
        partial_allowance: null,
        archived: false,
        created_at: '2026-08-01',
        run_id: null,
      }),
    );
    await fs.mkdir(path.join(paths.changesRuntimeDir, name), { recursive: true });
  }

  it('keeps a fresh portable change healthy in named and project-wide Doctor', async () => {
    await createPortable('fresh-portable');

    await expect(nativeDoctorCommand(['fresh-portable'], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: { healthy: true, workflow: 'native-portable', change: 'fresh-portable' },
    });
    await expect(nativeDoctorCommand([], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        healthy: true,
        workflow: 'native-portable',
        findings: [],
      },
    });
  });

  it('reports and repairs pending Shape confirmation drift before it is confirmed', async () => {
    const name = 'pending-shape-drift';
    await createPortable(name);
    const changeDir = nativePortableChangeDir(paths, name);
    const brief = path.join(changeDir, 'brief.md');
    await fs.mkdir(path.join(changeDir, 'specs', 'fixture'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'fixture', 'spec.md'),
      '# Test target\n\nThis target exists only for the Doctor drift regression.\n',
    );
    await fs.writeFile(
      brief,
      [
        '# Outcome',
        '',
        'Refresh the pending Shape confirmation when its acceptance changes.',
        '',
        '# Scope',
        '',
        'Only the confirmation boundary is under test.',
        '',
        '# Non-goals',
        '',
        'No implementation work is performed.',
        '',
        '# Acceptance examples',
        '',
        '- The original acceptance is recorded.',
        '',
        '# Constraints and invariants',
        '',
        'The Runtime owns the state transition.',
        '',
        '# Decisions',
        '',
        'No user decision is pending in this fixture.',
        '',
        '# Open questions',
        '',
        'None.',
        '',
        '# Verification expectations',
        '',
        'Doctor must report drift without mutating the state.',
        '',
      ].join('\n'),
    );
    const waiting = await prepareNativePortableShapeConfirmation({ paths, name });
    expect(waiting).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      state_version: 2,
      loop: { next_action: 'confirm-shape' },
      acceptance: [{ text: 'The original acceptance is recorded.' }],
    });
    const stateFile = nativePortableStateFile(paths, name);
    const beforeDoctor = await fs.readFile(stateFile);

    await fs.writeFile(
      brief,
      [
        '# Outcome',
        '',
        'Refresh the pending Shape confirmation when its acceptance changes.',
        '',
        '# Scope',
        '',
        'Only the confirmation boundary is under test.',
        '',
        '# Non-goals',
        '',
        'No implementation work is performed.',
        '',
        '# Acceptance examples',
        '',
        '- The original acceptance is recorded.',
        '- The changed acceptance is recorded after repair.',
        '',
        '# Constraints and invariants',
        '',
        'The Runtime owns the state transition.',
        '',
        '# Decisions',
        '',
        'No user decision is pending in this fixture.',
        '',
        '# Open questions',
        '',
        'None.',
        '',
        '# Verification expectations',
        '',
        'Doctor must report drift without mutating the state.',
        '',
      ].join('\n'),
    );

    const diagnosis = await nativeDoctorCommand([name], projectRoot);
    expect(diagnosis).toMatchObject({
      exitCode: 65,
      data: {
        healthy: false,
        repaired: false,
        findings: [
          expect.objectContaining({
            code: 'portable-shape-confirmation-drift',
            repair: 'recover',
            repairCommand: `comet native doctor ${name} --repair`,
          }),
        ],
      },
    });
    await expect(fs.readFile(stateFile)).resolves.toEqual(beforeDoctor);

    const repaired = await nativeDoctorCommand([name, '--repair'], projectRoot);
    expect(repaired).toMatchObject({
      exitCode: 0,
      data: {
        healthy: true,
        repaired: true,
        result: {
          state: {
            phase: 'shape',
            status: 'active',
            state_version: 3,
            acceptance: [],
            loop: { next_action: 'prepare-shape-confirmation' },
          },
        },
      },
    });

    const refreshed = await nativeNextCommand(
      [name, '--summary', 'Re-read the changed Shape confirmation'],
      projectRoot,
    );
    expect(refreshed).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'shape',
          status: 'await-user',
          acceptance: { total: 2, pending: 2 },
        },
      },
    });
  });

  it('reports an orphaned Runtime check instead of claiming the change is healthy', async () => {
    const name = 'orphaned-check-doctor';
    await fs.mkdir(path.join(projectRoot, '.git'));
    await createPortable(name);
    await fs.writeFile(
      path.join(nativePortableChangeDir(paths, name), 'brief.md'),
      '# Acceptance examples\n- Doctor reports an orphaned check owner.\n',
    );
    await confirmNativePortableShape({ paths, name });
    const runner = createNativeRunnerChannel();
    const state = await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'orphaned-doctor-builder',
        }),
        candidateId: 'orphaned-doctor-candidate',
        summary: 'Implemented.',
        addressedAcceptanceIds: ['A1'],
        review: null,
      },
    });
    const marker = path.join(projectRoot, 'orphaned-doctor-starts.txt');
    const plan = {
      id: 'orphaned-doctor-check',
      name: 'Orphaned Doctor check',
      executable: process.execPath,
      argv: [
        '-e',
        "require('node:fs').appendFileSync(process.argv[1],'start\\n');setInterval(()=>{},1000)",
        marker,
      ],
      cwdRef: '.',
      timeoutMs: 10_000,
      repeatable: true,
    } as const;
    const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
    await ensureCliBuilt(repositoryRoot);
    const file = nativeLocalExecutionFile(paths, name);
    const owner = spawnNativePortableProcess({
      repositoryRoot,
      payload: { action: 'execute-checks', paths, name: state.name, plans: [plan] },
    });
    await waitForCondition(async () => {
      const local = await readNativeLocalExecution(file);
      const reserved =
        local?.execution?.ownerPid === owner.pid &&
        local.checks[0]?.activeProcess?.status === 'running';
      const mutationLockReleased = await fs
        .access(path.join(paths.locksDir, 'root-move.lock'))
        .then(() => false)
        .catch(() => true);
      return reserved && mutationLockReleased;
    }, 'Runtime owner did not start the orphaned Doctor check');
    const running = await readNativeLocalExecution(file);
    const activePid =
      running?.checks[0]?.activeProcess?.status === 'running'
        ? running.checks[0].activeProcess.pid
        : undefined;
    expect(activePid).toEqual(expect.any(Number));
    owner.kill('SIGKILL');
    await waitForProcessExit(owner);
    if (activePid !== undefined && processIsAlive(activePid)) process.kill(activePid, 'SIGKILL');
    await waitForCondition(
      () => activePid !== undefined && !processIsAlive(activePid),
      'Orphaned Doctor check process did not exit',
    );

    await expect(nativeDoctorCommand([name], projectRoot)).resolves.toMatchObject({
      exitCode: 65,
      data: {
        healthy: false,
        findings: [
          expect.objectContaining({
            code: 'portable-check-execution-stuck',
            repair: 'recover',
          }),
        ],
      },
    });
    await expect(nativeDoctorCommand([name, '--repair'], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: { healthy: true, repaired: true },
    });
  });

  it('does not let Doctor repair take over a live Runtime check', async () => {
    const name = 'live-check-doctor';
    await fs.mkdir(path.join(projectRoot, '.git'));
    await createPortable(name);
    await fs.writeFile(
      path.join(nativePortableChangeDir(paths, name), 'brief.md'),
      '# Acceptance examples\n- Doctor preserves a live Runtime check.\n',
    );
    await confirmNativePortableShape({ paths, name });
    const runner = createNativeRunnerChannel();
    const state = await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'live-doctor-builder',
        }),
        candidateId: 'live-doctor-candidate',
        summary: 'Implemented.',
        addressedAcceptanceIds: ['A1'],
        review: null,
      },
    });
    const marker = path.join(projectRoot, 'doctor-check-starts.txt');
    const release = path.join(projectRoot, 'release-doctor-check');
    const plan = {
      id: 'live-doctor-check',
      name: 'Live Doctor check',
      executable: process.execPath,
      argv: [
        '-e',
        "const fs=require('node:fs');fs.appendFileSync(process.argv[1],'start\\n');setInterval(()=>{if(fs.existsSync(process.argv[2]))process.exit(0)},25)",
        marker,
        release,
      ],
      cwdRef: '.',
      timeoutMs: 10_000,
      repeatable: true,
    } as const;
    const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
    await ensureCliBuilt(repositoryRoot);
    const owner = spawnNativePortableProcess({
      repositoryRoot,
      payload: { action: 'execute-checks', paths, name: state.name, plans: [plan] },
    });
    const file = nativeLocalExecutionFile(paths, name);
    await waitForCondition(async () => {
      const local = await readNativeLocalExecution(file);
      const reserved =
        local?.execution?.ownerPid === owner.pid &&
        local.checks[0]?.activeProcess?.status === 'running';
      const mutationLockReleased = await fs
        .access(path.join(paths.locksDir, 'root-move.lock'))
        .then(() => false)
        .catch(() => true);
      return reserved && mutationLockReleased;
    }, 'Runtime owner did not start the Doctor test check');

    const repaired = await nativeDoctorCommand([name, '--repair'], projectRoot);
    const duringRepair = await readNativeLocalExecution(file);
    const startsDuringRepair = (await fs.readFile(marker, 'utf8')).trim().split(/\r?\n/);

    await fs.writeFile(release, 'release\n');
    await waitForProcessExit(owner);

    expect(repaired).toMatchObject({
      exitCode: 0,
      data: { healthy: true, repaired: false },
    });
    expect(duringRepair).toMatchObject({
      execution: { status: 'running', ownerPid: owner.pid },
      checks: [{ status: 'running' }],
    });
    expect(startsDuringRepair).toHaveLength(1);
    expect(owner.exitCode).toBe(0);
    await expect(readNativeLocalExecution(file)).resolves.toMatchObject({
      execution: { status: 'completed' },
      checks: [{ status: 'passed' }],
    });
  });

  it('repairs an exact empty v2 overlay left beside a legacy v1 child contract', async () => {
    const name = 'stale-v1-overlay';
    const { buildState, file } = await createLegacySupervisorFixture(name);

    await expect(nativeDoctorCommand([name], projectRoot)).resolves.toMatchObject({
      exitCode: 65,
      data: {
        healthy: false,
        findings: [
          expect.objectContaining({
            code: 'portable-supervisor-overlay-stale',
            repairCommand: `comet native doctor ${name} --repair`,
          }),
        ],
      },
    });

    await expect(nativeDoctorCommand([name, '--repair'], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: { healthy: true, repaired: true },
    });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readNativePortableChange(paths, name)).resolves.toMatchObject({
      name,
      phase: 'build',
      state_version: buildState.state_version,
    });

    await archiveLegacyChild(buildState);

    const applied = await applyNativeRunnerInput({
      paths,
      name,
      input: {
        kind: 'builder-handoff',
        summary: 'The legacy child result is ready for verification.',
        addressed_acceptance_ids: buildState.acceptance.map(({ id }) => id),
        checks: [],
        known_limits: [],
        review: {
          status: 'passed',
          summary: 'Read-only review passed.',
          reviewer_execution_ref: 'reviewer',
        },
      },
      maxVerifyFailures: 3,
    });
    expect(applied.state.phase).toBe('verify');
  });

  it('auto-recovers the stale overlay before accepting a public runner handoff', async () => {
    const name = 'auto-recover-v1-overlay';
    const { buildState, file } = await createLegacySupervisorFixture(name);
    await archiveLegacyChild(buildState);
    const status = await inspectNativePortableStatus({ paths, name });
    expect(status).toMatchObject({
      childSummary: { total: 1, done: 1 },
      supervisorOverlay: {
        status: 'repairable-legacy-overlay',
        repairCommand: `comet native doctor ${name} --repair`,
      },
      continuation: { action: 'builder-handoff' },
    });
    expect(status).not.toHaveProperty('supervisor');
    const runnerInputFile = path.join(projectRoot, 'builder-handoff.json');
    await fs.writeFile(
      runnerInputFile,
      JSON.stringify({
        kind: 'builder-handoff',
        summary: 'The legacy child result is ready for verification.',
        addressed_acceptance_ids: buildState.acceptance.map(({ id }) => id),
        checks: [],
        known_limits: [],
        review: {
          status: 'passed',
          summary: 'Read-only review passed.',
          reviewer_execution_ref: 'reviewer',
        },
      }),
    );

    await expect(
      nativeNextCommand([name, '--runner-input', runnerInputFile], projectRoot),
    ).resolves.toMatchObject({
      exitCode: 0,
      data: { state: { phase: 'verify' } },
    });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed for Supervisor overlay progress, parent drift, and unknown fields', async () => {
    const name = 'incompatible-v1-overlay';
    const { file, overlay } = await createLegacySupervisorFixture(name);
    const base = JSON.stringify(overlay);
    const cases: Array<[string, (value: Record<string, unknown>) => void]> = [
      [
        'advanced integration head',
        (value) => {
          (value.integration as Record<string, unknown>).headCommit = 'b'.repeat(40);
        },
      ],
      [
        'parent mismatch',
        (value) => {
          value.parent = 'different-parent';
        },
      ],
      [
        'history',
        (value) => {
          value.history = [
            {
              kind: 'target-refreshed',
              child: null,
              runId: null,
              summary: 'Already started.',
              at: new Date().toISOString(),
            },
          ];
        },
      ],
      [
        'final verification layers',
        (value) => {
          (value.finalVerification as Record<string, unknown>).layers = {};
        },
      ],
      [
        'child progress',
        (value) => {
          const child = (value.children as Array<Record<string, unknown>>)[0];
          child.baseCommit = 'c'.repeat(40);
        },
      ],
      [
        'unknown child field',
        (value) => {
          const child = (value.children as Array<Record<string, unknown>>)[0];
          child.futureProgress = 'keep me';
        },
      ],
      [
        'unknown top-level field',
        (value) => {
          value.futureProgress = 'keep me';
        },
      ],
      [
        'unknown integration field',
        (value) => {
          (value.integration as Record<string, unknown>).futureProgress = 'keep me';
        },
      ],
    ];

    for (const [label, mutate] of cases) {
      const value = JSON.parse(base) as Record<string, unknown>;
      mutate(value);
      await fs.writeFile(file, JSON.stringify(value));
      await expect(nativeDoctorCommand([name, '--repair'], projectRoot)).resolves.toMatchObject({
        exitCode: 65,
        data: {
          healthy: false,
          findings: [
            expect.objectContaining({
              code: 'portable-supervisor-overlay-incompatible',
            }),
          ],
        },
      });
      await expect(fs.stat(file), label).resolves.toBeTruthy();
      await fs.writeFile(file, base);
    }
  });

  it('leaves a valid v2 Supervisor overlay on the normal path', async () => {
    const name = 'current-v2-overlay';
    // A real Supervisor overlay only exists after a Git-bound confirmation;
    // seed the repository and the workspace binding the normal path produces.
    await fs.writeFile(path.join(projectRoot, '.gitignore'), '.comet/runtime/\n');
    runGitCommand(projectRoot, ['init', '-b', 'main']);
    runGitCommand(projectRoot, ['config', 'user.email', 'native@example.test']);
    runGitCommand(projectRoot, ['config', 'user.name', 'Native Test']);
    runGitCommand(projectRoot, ['add', '.']);
    runGitCommand(projectRoot, ['commit', '--allow-empty', '-m', 'seed test repository']);
    await createPortable(name);
    const changeDir = nativePortableChangeDir(paths, name);
    const childrenSource = `schema: comet.native.children.v2
children:
  - name: foundation
    summary: Implement the foundation.
    depends_on: []
`;
    await fs.writeFile(path.join(changeDir, 'children.yaml'), childrenSource);
    const contract = parseNativeChildrenContract(childrenSource);
    const overlay = createNativeSupervisorState({
      parent: name,
      targetBranch: 'main',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'main',
      integrationWorktree: projectRoot,
      contract,
    });
    await writeNativeSupervisorState(paths, overlay);
    const state = await readNativePortableChange(paths, name);
    await writeNativePortableState(nativePortableStateFile(paths, name), {
      ...state,
      workspace: { ...state.workspace, change_branch: 'main', target_branch: 'main' },
    });

    await expect(nativeDoctorCommand([name, '--repair'], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: { healthy: true, repaired: true },
    });
    await expect(fs.stat(nativeSupervisorStateFile(paths, name))).resolves.toBeTruthy();
  });

  it('keeps a generated portable verification report out of migration findings', async () => {
    const name = 'verified-portable';
    await createPortable(name);
    const report = path.join(paths.changesDir, name, 'verification.md');
    await fs.writeFile(report, '# Verification\n\nPassed\n');

    await expect(nativeDoctorCommand([name], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: { healthy: true, workflow: 'native-portable', change: name },
    });
    await expect(nativeDoctorCommand([name, '--repair'], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: { healthy: true, repaired: true },
    });
    await expect(fs.stat(report)).resolves.toBeTruthy();
    await expect(nativeDoctorCommand([], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: { healthy: true, workflow: 'native-portable', findings: [] },
    });
  });

  it('merges portable statuses with legacy migration findings in a mixed project', async () => {
    await createPortable('portable-change');
    await createLegacy('legacy-change');

    const result = await nativeDoctorCommand([], projectRoot);

    expect(result).toMatchObject({
      command: 'doctor',
      exitCode: 65,
      data: {
        healthy: false,
        workflow: 'native-mixed',
        changes: [{ name: 'portable-change', schema: 'comet.native.status.v2' }],
        legacyChanges: ['legacy-change'],
        findings: expect.arrayContaining([
          expect.objectContaining({
            severity: 'error',
            code: 'portable-migration-required',
            repair: 'migrate',
          }),
        ]),
      },
      error: { code: 'invalid-data', message: 'Native project needs attention' },
    });
  });

  it('reports an active and archived portable change with the same name as unhealthy', async () => {
    const name = 'layout-conflict';
    await createPortable(name);
    const archiveDir = path.join(paths.archiveDir, `2026-08-09-${name}`);
    await fs.cp(path.join(paths.changesDir, name), archiveDir, { recursive: true });

    const result = await nativeDoctorCommand([name], projectRoot);

    expect(result).toMatchObject({
      command: 'doctor',
      exitCode: 65,
      data: {
        healthy: false,
        workflow: 'native-portable',
        change: name,
        repaired: false,
        findings: [
          {
            severity: 'error',
            code: 'portable-active-archive-conflict',
            path: archiveDir,
          },
        ],
      },
      error: { code: 'invalid-data', message: 'Native project needs attention' },
    });
  });

  it('finishes an incomplete portable migration through named Doctor repair', async () => {
    const name = 'migration-recovery';
    await createLegacy(name);
    const state = await migrateNativeLegacyChangeToPortable({ paths, name });
    const activeDir = path.join(paths.changesDir, name);
    const legacyRuntime = path.join(activeDir, 'runtime');
    await fs.mkdir(legacyRuntime, { recursive: true });
    await fs.writeFile(path.join(legacyRuntime, 'trajectory.jsonl'), 'legacy');
    await fs.writeFile(path.join(activeDir, 'evidence.md'), 'legacy projection');
    await fs.rm(path.join(paths.changesRuntimeDir, name), { recursive: true, force: true });

    const inspected = await nativeDoctorCommand([name], projectRoot);
    expect(inspected).toMatchObject({
      exitCode: 65,
      data: {
        healthy: false,
        findings: [{ code: 'portable-migration-incomplete', repair: 'migrate' }],
      },
    });

    const repaired = await nativeDoctorCommand([name, '--repair'], projectRoot);
    expect(repaired).toMatchObject({
      exitCode: 0,
      data: {
        healthy: true,
        repaired: true,
        migration: { recovered: true, to: 'comet.native.v4', stateVersion: state.state_version },
      },
    });
    await expect(fs.stat(legacyRuntime)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(activeDir, 'evidence.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fs.readdir(path.join(paths.changesRuntimeDir, name))).toEqual(['state.json']);
  });

  it('reports and resumes a persisted portable migration transaction', async () => {
    const name = 'migration-transaction';
    await createLegacy(name);
    const file = path.join(paths.transactionsDir, `portable-migration-${name}.json`);
    await fs.writeFile(
      file,
      `${JSON.stringify({
        schema: 'comet.native.portable-migration.v1',
        id: randomUUID(),
        change: name,
        fromSchema: 'comet.native.v3',
        status: 'prepared',
        createdAt: new Date().toISOString(),
      })}\n`,
    );

    await expect(nativeDoctorCommand([name], projectRoot)).resolves.toMatchObject({
      exitCode: 65,
      data: {
        findings: [
          expect.objectContaining({
            code: 'portable-migration-incomplete',
            path: file,
            repair: 'migrate',
          }),
        ],
      },
    });
    await expect(nativeDoctorCommand([name, '--repair'], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        healthy: true,
        repaired: true,
        migration: { recovered: true, to: 'comet.native.v4' },
      },
    });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('repairs a persisted portable transaction from project-wide Doctor', async () => {
    const name = 'project-migration-transaction';
    await createLegacy(name);
    const file = path.join(paths.transactionsDir, `portable-migration-${name}.json`);
    await fs.writeFile(
      file,
      `${JSON.stringify({
        schema: 'comet.native.portable-migration.v1',
        id: randomUUID(),
        change: name,
        fromSchema: 'comet.native.v3',
        status: 'prepared',
        createdAt: new Date().toISOString(),
      })}\n`,
    );

    const repaired = await nativeDoctorCommand(['--repair'], projectRoot);

    expect(repaired).toMatchObject({
      exitCode: 0,
      data: {
        healthy: true,
        workflow: 'native-portable',
        repaired: true,
        repairedPortableTransactions: [
          { kind: 'migration', change: name, transactionId: expect.any(String) },
        ],
      },
    });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
