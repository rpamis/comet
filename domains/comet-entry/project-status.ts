import { promises as fs } from 'fs';
import path from 'path';

import { fileExists, readDir } from '../../platform/fs/file-system.js';
import { latestCommandCheck } from '../comet-classic/classic-command-checks.js';
import { inspectClassicChangeReadOnly } from '../comet-classic/classic-diagnostics.js';
import { readClassicState } from '../comet-classic/classic-store.js';
import { assertNoPendingNativeRootMove, readProjectConfig } from '../comet-native/native-config.js';
import { listNativeStatus } from '../comet-native/native-diagnostics.js';
import { discoverNativeProject, nativeProjectPaths } from '../comet-native/native-paths.js';
import { resolveCometEntry } from './resolve-entry.js';
import type { ChangeStatus, CometEntryResolution, CometProjectStatus } from './types.js';

async function countTasks(tasksPath: string): Promise<{ done: number; total: number }> {
  if (!(await fileExists(tasksPath))) return { done: 0, total: 0 };
  const content = await fs.readFile(tasksPath, 'utf8');
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
    recommendedArchiveCommand: `openspec archive ${name} -y`,
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

async function inspectOpenSpecChanges(
  projectRoot: string,
): Promise<{ classic: ChangeStatus[]; unmanaged: ChangeStatus[] }> {
  const changesDir = path.join(projectRoot, 'openspec', 'changes');
  if (!(await fileExists(changesDir))) return { classic: [], unmanaged: [] };
  const classic: ChangeStatus[] = [];
  const unmanaged: ChangeStatus[] = [];
  for (const name of (await readDir(changesDir)).sort()) {
    if (name === 'archive') continue;
    const changeDir = path.join(changesDir, name);
    if (!(await fs.stat(changeDir)).isDirectory()) continue;
    const { done, total } = await countTasks(path.join(changeDir, 'tasks.md'));
    if (!(await fileExists(path.join(changeDir, '.comet.yaml')))) {
      unmanaged.push(unmanagedChange(name, done, total));
      continue;
    }

    try {
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
                build: await latestCommandCheck(changeDir, run, 'build'),
                verify: await latestCommandCheck(changeDir, run, 'verify'),
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
      classic.push({
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
      });
    }
  }
  return { classic, unmanaged };
}

export async function inspectCometProjectStatus(startPath: string): Promise<CometProjectStatus> {
  const projectRoot = await discoverNativeProject(startPath);
  const openSpec = await inspectOpenSpecChanges(projectRoot);
  let defaultEntry: CometEntryResolution | { error: string };
  let configError: string | null = null;
  let config = null;
  try {
    defaultEntry = await resolveCometEntry(projectRoot);
    if (defaultEntry.source === 'project-config') {
      config = await readProjectConfig(projectRoot);
    }
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
    defaultEntry = { error: configError };
  }

  let native: CometProjectStatus['workflows']['native'];
  if (configError) {
    native = { changes: [], error: configError };
  } else if (config) {
    try {
      await assertNoPendingNativeRootMove(projectRoot);
      const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
      native = { changes: await listNativeStatus(paths) };
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
      classic: { changes: openSpec.classic },
    },
    unmanagedOpenSpec: openSpec.unmanaged,
  };
}
