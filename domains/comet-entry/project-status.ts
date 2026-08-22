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
import { assertNoPendingNativeRootMove } from '../comet-native/native-config.js';
import { inspectNativeStatus, listNativeChangeNames } from '../comet-native/native-diagnostics.js';
import { discoverNativeProject, nativeProjectPaths } from '../comet-native/native-paths.js';
import { inspectNativePortableStatus } from '../comet-native/native-portable-status.js';
import { isNativePortableChange } from '../comet-native/native-portable-runtime.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import { resolveCometEntry } from './resolve-entry.js';
import type { ChangeStatus, CometEntryResolution, CometProjectStatus } from './types.js';

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
  return Promise.all(
    names.map(async (name) =>
      (await isNativePortableChange(paths, name))
        ? inspectNativePortableStatus({ paths, name })
        : inspectNativeStatus(paths, name, options),
    ),
  );
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
  for (const name of names) {
    if (name === 'archive') continue;
    if (openSpecChangeNameError(name)) continue;
    let change;
    try {
      change = await inspectClassicActiveChangeDirectory(name, projectRoot);
    } catch (error) {
      classic.push(invalidClassicChange(name, error));
      continue;
    }
    if (!change.exists) continue;
    const changeDir = change.directory;
    let done: number;
    let total: number;
    try {
      ({ done, total } = await countTasks(projectRoot, path.join(changeDir, 'tasks.md')));
    } catch (error) {
      classic.push(invalidClassicChange(name, error));
      continue;
    }
    if (!change.stateExists) {
      unmanaged.push(unmanagedChange(name, done, total));
      continue;
    }

    try {
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
        continue;
      }

      const diagnostic = await inspectClassicChangeReadOnly(changeDir, name);
      if (diagnostic.valid && projection.classic) {
        if (projection.classic.archived) continue;
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
        continue;
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
  }
  return { classic, unmanaged };
}

export async function inspectCometProjectStatus(startPath: string): Promise<CometProjectStatus> {
  const projectRoot = await discoverNativeProject(startPath);
  let defaultEntry: CometEntryResolution | { error: string };
  let configError: string | null = null;
  let config = null;
  try {
    config = await readWorkflowProjectConfig(projectRoot);
    defaultEntry = await resolveCometEntry(projectRoot);
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

  return {
    schema: 'comet.status.v2',
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
