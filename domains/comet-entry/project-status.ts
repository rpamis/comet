import { promises as fs } from 'fs';
import path from 'path';

import { latestCommandCheck } from '../comet-classic/classic-command-checks.js';
import { inspectClassicChangeReadOnly } from '../comet-classic/classic-diagnostics.js';
import { assertClassicLayoutReadable } from '../comet-classic/classic-layout.js';
import {
  inspectClassicActiveChangeDirectory,
  openSpecChangeNameError,
} from '../comet-classic/classic-paths.js';
import {
  inspectClassicProjectTarget,
  readClassicProjectFile,
} from '../comet-classic/classic-protected-path.js';
import { readClassicState } from '../comet-classic/classic-store.js';
import { classicSdkNextAction, inspectClassicSdkRun } from '../comet-classic/classic-sdk-status.js';
import { assertNoPendingNativeRootMove } from '../comet-native/native-config.js';
import { inspectNativeStatus, listNativeChangeNames } from '../comet-native/native-diagnostics.js';
import { discoverNativeProject, nativeProjectPaths } from '../comet-native/native-paths.js';
import { inspectNativePortableStatus } from '../comet-native/native-portable-status.js';
import { isNativePortableChange } from '../comet-native/native-portable-runtime.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { inspectNativeSdkStatus } from '../comet-native/native-sdk-status.js';
import { hasNativeManagedRunMarker } from '../comet-native/native-sdk-state-store.js';
import {
  inspectSelectedWorkflowApplicationStatus,
  inspectWorkflowApplicationRun,
} from '../workflow-application/index.js';
import { configuredResolution } from './resolve-entry.js';
import type { ChangeStatus, CometEntryResolution, CometProjectStatus } from './types.js';

/** Bound filesystem pressure while keeping independent change inspections concurrent. */
async function inspectChanges<T, R>(items: T[], inspect: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await inspect(items[index]);
      }
    }),
  );
  return results;
}

async function countTasks(
  projectRoot: string,
  tasksPath: string,
): Promise<{ done: number; total: number }> {
  let content: string;
  try {
    content = await readClassicProjectFile(projectRoot, tasksPath, {
      label: 'Classic tasks artifact',
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { done: 0, total: 0 };
    throw error;
  }
  const lines = content.split('\n');
  return {
    done: lines.filter((line) => /^\s*- \[x\]/iu.test(line)).length,
    total: lines.filter((line) => /^\s*- \[[ x]\]/iu.test(line)).length,
  };
}

function unmanagedChange(name: string, done: number, total: number): ChangeStatus {
  return {
    name,
    cometManaged: false,
    archiveReady: total > 0 && done === total,
    recommendedArchiveCommand: `comet classic openspec -- archive ${name} -y`,
    workflow: null,
    phase: null,
    buildMode: null,
    isolation: null,
    boundBranch: null,
    verifyMode: null,
    verifyResult: null,
    designDoc: null,
    plan: null,
    tasksCompleted: done,
    tasksTotal: total,
    nextCommand: null,
    currentStep: null,
    runtimeMode: null,
    runtimeEval: null,
    commandChecks: null,
  };
}

function invalidClassicChange(name: string, error: unknown, done = 0, total = 0): ChangeStatus {
  return {
    name,
    cometManaged: true,
    archiveReady: false,
    recommendedArchiveCommand: `comet archive ${name}`,
    workflow: 'unknown',
    phase: 'invalid',
    buildMode: null,
    isolation: null,
    boundBranch: null,
    verifyMode: null,
    verifyResult: 'pending',
    designDoc: null,
    plan: null,
    tasksCompleted: done,
    tasksTotal: total,
    nextCommand: null,
    currentStep: null,
    runtimeMode: 'invalid',
    runtimeEval: null,
    commandChecks: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function listConfiguredNativeStatus(
  paths: Awaited<ReturnType<typeof nativeProjectPaths>>,
  options: { clarificationMode: 'sequential' | 'batch'; maxVerifyFailures: number },
): Promise<CometProjectStatus['workflows']['native']['changes']> {
  const names = await listNativeChangeNames(paths);
  return inspectChanges(names, async (name) => {
    try {
      if (await readSdkChangeOwner(paths.projectRoot, 'native', name))
        return await inspectNativeSdkStatus({
          projectRoot: paths.projectRoot,
          name,
          readOnly: true,
        });
      const managed = await hasNativeManagedRunMarker(
        path.join(paths.changesDir, name, 'comet-state.yaml'),
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (managed)
        throw new Error(
          `Native SDK Run ${name} needs recovery; run comet native doctor ${name} --json`,
        );
      return (await isNativePortableChange(paths, name))
        ? await inspectNativePortableStatus({ paths, name })
        : await inspectNativeStatus(paths, name, options);
    } catch (error) {
      // A single unreadable change (for example a stale worktree copy of a
      // supervisor parent) must not hide every other change from global status.
      return {
        name,
        error: error instanceof Error ? error.message : String(error),
        inspection: {
          commandArgs: [
            'comet',
            'native',
            'doctor',
            name,
            '--project-root',
            paths.projectRoot,
            '--json',
          ],
        },
      };
    }
  });
}

/** 读取同一权威 SDK Run，供项目总览和 Doctor 复用；不恢复或写回投影。 */
export async function inspectClassicSdkChangeStatus(
  projectRoot: string,
  name: string,
  done = 0,
  total = 0,
): Promise<ChangeStatus | null> {
  const owner = await readSdkChangeOwner(projectRoot, 'classic', name);
  if (!owner) return null;
  const builtIn = ['classic-full', 'classic-hotfix', 'classic-tweak'].includes(owner.application);
  const inspected = builtIn
    ? await inspectClassicSdkRun(projectRoot, name, { readOnly: true })
    : await inspectWorkflowApplicationRun(projectRoot, owner.application, name, {
        readOnly: true,
      });
  if ('application' in inspected && !inspected.application.identity.base.startsWith('classic-'))
    throw new Error(`Classic change ${name} belongs to a non-Classic Application`);
  const { run } = inspected;
  const state = ('state' in inspected ? inspected.state : run.state) as Awaited<
    ReturnType<typeof inspectClassicSdkRun>
  >['state'];
  const nextAction = classicSdkNextAction(run);
  const inspection = {
    commandArgs: [
      'comet',
      'runtime',
      'dispatch',
      '--application',
      owner.application,
      '--project-root',
      projectRoot,
      '--request',
      '<request-file>',
      '--json',
    ],
    request: { operation: 'inspect' as const, runId: run.runId },
  };
  return {
    name,
    cometManaged: true,
    archived: state.archived,
    archiveReady: state.phase === 'archive' && state.verifyResult === 'pass' && !state.archived,
    recommendedArchiveCommand: `comet archive ${name}`,
    workflow: state.workflow,
    phase: state.phase,
    buildMode: state.buildMode,
    isolation: state.isolation,
    boundBranch: state.boundBranch,
    verifyMode: state.verifyMode,
    verifyResult: state.verifyResult,
    designDoc: state.designDoc,
    plan: state.plan,
    tasksCompleted: done,
    tasksTotal: total,
    nextCommand: builtIn && run.status !== 'completed' ? `comet state next ${name} --json` : null,
    currentStep: nextAction && 'stepId' in nextAction ? (nextAction.stepId ?? null) : null,
    runtimeMode: 'sdk',
    runtimeEval: null,
    commandChecks: null,
    run: { id: run.runId, revision: run.revision, status: run.status },
    nextAction,
    inspection,
  };
}

async function inspectOpenSpecChanges(
  projectRoot: string,
): Promise<{ classic: ChangeStatus[]; unmanaged: ChangeStatus[]; error?: string }> {
  let changesDir: string;
  try {
    changesDir = (await assertClassicLayoutReadable(projectRoot)).changesDir;
    const inspection = await inspectClassicProjectTarget(projectRoot, changesDir, {
      label: 'Classic changes root',
      expected: 'directory',
    });
    if (!inspection.exists) return { classic: [], unmanaged: [] };
  } catch (error) {
    return {
      classic: [],
      unmanaged: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const classic: ChangeStatus[] = [];
  const unmanaged: ChangeStatus[] = [];
  const names = (await fs.readdir(changesDir)).sort();
  await inspectClassicProjectTarget(projectRoot, changesDir, {
    label: 'Classic changes root',
    expected: 'directory',
  });
  await inspectChanges(names, async (name) => {
    if (name === 'archive') return;
    if (openSpecChangeNameError(name)) return;
    let change;
    try {
      change = await inspectClassicActiveChangeDirectory(name, projectRoot);
    } catch (error) {
      classic.push(invalidClassicChange(name, error));
      return;
    }
    if (!change.exists) return;
    const changeDir = change.directory;
    let done: number;
    let total: number;
    try {
      ({ done, total } = await countTasks(projectRoot, path.join(changeDir, 'tasks.md')));
    } catch (error) {
      classic.push(invalidClassicChange(name, error));
      return;
    }
    try {
      const sdk = await inspectClassicSdkChangeStatus(projectRoot, name, done, total);
      if (sdk) {
        if (!sdk.archived) classic.push(sdk);
        return;
      }
      if (!change.stateExists) {
        unmanaged.push(unmanagedChange(name, done, total));
        return;
      }
      await inspectClassicProjectTarget(projectRoot, path.join(changeDir, '.comet'), {
        label: `Classic runtime directory for ${name}`,
        expected: 'directory',
      });
      const projection = await readClassicState(changeDir, { migrate: false });
      const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
      if (unknownKeys.length > 0) {
        classic.push({
          name,
          cometManaged: true,
          archiveReady: false,
          recommendedArchiveCommand: `comet archive ${name}`,
          workflow: 'unknown',
          phase: 'invalid',
          buildMode: projection.classic?.buildMode ?? null,
          isolation: projection.classic?.isolation ?? null,
          boundBranch: projection.classic?.boundBranch ?? null,
          verifyMode: projection.classic?.verifyMode ?? null,
          verifyResult: projection.classic?.verifyResult ?? 'pending',
          designDoc: projection.classic?.designDoc ?? null,
          plan: projection.classic?.plan ?? null,
          tasksCompleted: done,
          tasksTotal: total,
          nextCommand: null,
          currentStep: null,
          runtimeMode: 'invalid',
          runtimeEval: null,
          commandChecks: null,
          error: `Invalid Classic state: unknown field(s): ${unknownKeys.join(', ')}`,
        });
        return;
      }

      const diagnostic = await inspectClassicChangeReadOnly(changeDir, name, { projection });
      if (diagnostic.valid && projection.classic) {
        if (projection.classic.archived) return;
        const run = projection.run;
        classic.push({
          name,
          cometManaged: true,
          archiveReady:
            projection.classic.phase === 'archive' &&
            projection.classic.verifyResult === 'pass' &&
            !projection.classic.archived,
          recommendedArchiveCommand: `comet archive ${name}`,
          workflow: diagnostic.workflow,
          phase: diagnostic.phase,
          buildMode: projection.classic.buildMode,
          isolation: projection.classic.isolation,
          boundBranch: projection.classic.boundBranch,
          verifyMode: projection.classic.verifyMode,
          verifyResult: projection.classic.verifyResult,
          designDoc: projection.classic.designDoc,
          plan: projection.classic.plan,
          tasksCompleted: done,
          tasksTotal: total,
          nextCommand: diagnostic.nextCommand,
          currentStep: diagnostic.currentStep,
          runtimeMode: diagnostic.runtimeMode,
          runtimeEval: diagnostic.runtimeEval,
          commandChecks: run
            ? {
                build: await latestCommandCheck(projectRoot, changeDir, run, 'build'),
                verify: await latestCommandCheck(projectRoot, changeDir, run, 'verify'),
              }
            : null,
        });
        return;
      }

      classic.push({
        name,
        cometManaged: true,
        archiveReady: false,
        recommendedArchiveCommand: `comet archive ${name}`,
        workflow: diagnostic.workflow,
        phase: diagnostic.phase,
        buildMode: projection.classic?.buildMode ?? null,
        isolation: projection.classic?.isolation ?? null,
        boundBranch: projection.classic?.boundBranch ?? null,
        verifyMode: projection.classic?.verifyMode ?? null,
        verifyResult: projection.classic?.verifyResult ?? 'pending',
        designDoc: projection.classic?.designDoc ?? null,
        plan: projection.classic?.plan ?? null,
        tasksCompleted: done,
        tasksTotal: total,
        nextCommand: diagnostic.nextCommand,
        currentStep: diagnostic.currentStep,
        runtimeMode: diagnostic.runtimeMode,
        runtimeEval: diagnostic.runtimeEval,
        commandChecks: null,
        error: diagnostic.error,
      });
    } catch (error) {
      classic.push(invalidClassicChange(name, error, done, total));
    }
  });
  classic.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  unmanaged.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return { classic, unmanaged };
}

export async function inspectCometProjectStatus(startPath: string): Promise<CometProjectStatus> {
  const projectRoot = await discoverNativeProject(startPath);
  let defaultEntry: CometEntryResolution | { error: string };
  let configError: string | null = null;
  let config = null;
  try {
    config = await readWorkflowProjectConfig(projectRoot);
    if (!config) {
      throw new Error('Comet workflow entry is unavailable because .comet/config.yaml is missing');
    }
    defaultEntry = configuredResolution(config.default_workflow);
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
    defaultEntry = { error: configError };
  }
  const configuredWorkflows =
    config?.workflows ?? (config ? [config.default_workflow] : ['classic']);
  const classicEnabled = configuredWorkflows.includes('classic');
  const nativeEnabled = configuredWorkflows.includes('native');
  const openSpec = configError
    ? { classic: [], unmanaged: [], error: configError }
    : classicEnabled
      ? await inspectOpenSpecChanges(projectRoot)
      : { classic: [], unmanaged: [] };

  let native: CometProjectStatus['workflows']['native'];
  if (configError) {
    native = { changes: [], error: configError };
  } else if (nativeEnabled && config?.native) {
    try {
      await assertNoPendingNativeRootMove(projectRoot);
      const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
      native = {
        changes: await listConfiguredNativeStatus(paths, {
          clarificationMode: config.native.clarification_mode,
          maxVerifyFailures: config.native.max_verify_failures,
        }),
      };
    } catch (error) {
      native = { changes: [], error: error instanceof Error ? error.message : String(error) };
    }
  } else {
    native = { changes: [] };
  }

  let applications: CometProjectStatus['applications'];
  try {
    const selected = await inspectSelectedWorkflowApplicationStatus(projectRoot);
    applications = { changes: selected ? [selected] : [] };
  } catch (error) {
    applications = { changes: [], error: error instanceof Error ? error.message : String(error) };
  }
  return {
    schema: 'comet.status.v2',
    discovery: { projectRoot, scope: 'current-worktree', applications: 'current-selection' },
    applications,
    defaultEntry,
    workflows: {
      native,
      classic: {
        changes: openSpec.classic,
        ...(openSpec.error ? { error: openSpec.error } : {}),
      },
    },
    unmanagedOpenSpec: openSpec.unmanaged,
  };
}
