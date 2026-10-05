import { createHash, randomUUID } from 'node:crypto';
import { classicSdkRunMatchesProfile } from './classic-sdk-profile.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { WorkflowRun, WorkflowRuntime } from '../engine/runtime.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { terminateProcessTree } from '../../platform/process/terminate-process-tree.js';
import { spawnCommand } from '../../platform/process/spawn-command.js';
import { checkEnvironmentFingerprint, collectCheckSnapshot } from './classic-check-snapshot.js';
import { checkManifestHash, diffCheckManifests } from './classic-check-manifest.js';
import { readCheckPolicy } from './classic-check-policy.js';
import {
  ensureClassicProjectDirectory,
  writeClassicProjectText,
} from './classic-protected-path.js';
import type { ClassicState } from './classic-state.js';

interface ClassicSdkCheckInput {
  runId: string;
  projectRoot: string;
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

async function checkedCwd(
  root: string,
  requested: string,
): Promise<{ relative: string; absolute: string }> {
  if (!requested.trim() || requested.includes('\0'))
    throw new Error('Classic check cwd is invalid');
  const absolute = path.resolve(root, requested);
  if (!within(root, absolute)) throw new Error('Classic check cwd is outside the project');
  const [realRoot, realCwd] = await Promise.all([fs.realpath(root), fs.realpath(absolute)]);
  if (!within(realRoot, realCwd)) throw new Error('Classic check cwd resolves outside the project');
  return { relative: path.relative(root, absolute).replaceAll('\\', '/') || '.', absolute };
}

async function runCommand(
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawnCommand(argv[0], argv.slice(1), { cwd });
    let output = '';
    let timedOut = false;
    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-2 * 1024 * 1024);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (error) => {
      output += `\n${error.message}`;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child).catch(() => child.kill('SIGKILL'));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        output: (timedOut ? 'Check timed out.\n' : '') + output,
      });
    });
  });
}

/** Execute one claimed SDK check Action without reading or advancing legacy Classic state. */
export async function executeClassicSdkCommandCheck(
  runtime: Pick<WorkflowRuntime, 'inspect' | 'claim' | 'recordOutcome' | 'markUnknown'>,
  input: ClassicSdkCheckInput,
): Promise<WorkflowRun> {
  const root = path.resolve(input.projectRoot);
  const cwd = await checkedCwd(root, input.cwd ?? '.');
  if (
    !input.argv.length ||
    input.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0'))
  ) {
    throw new Error('Classic check requires literal program arguments');
  }
  const timeoutMs = input.timeoutMs ?? 300_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
    throw new Error('Classic check timeout must be 1..3600000 milliseconds');
  }
  const run = await runtime.inspect(input.runId);
  const state = run.state as ClassicState | undefined;
  const changeDirRef =
    run.input !== null &&
    typeof run.input === 'object' &&
    !Array.isArray(run.input) &&
    typeof run.input.changeDir === 'string'
      ? run.input.changeDir
      : null;
  const scope = state?.phase === 'build' ? 'build' : state?.phase === 'verify' ? 'verify' : null;
  const profile = state?.workflow;
  const action = run.actions
    .slice()
    .reverse()
    .find(
      (candidate) =>
        candidate.stepId === `${profile}.${scope}.check` && candidate.status === 'pending',
    );
  if (
    !profile ||
    !classicSdkRunMatchesProfile(run, profile) ||
    run.status !== 'running' ||
    scope === null ||
    !state ||
    (scope === 'verify' && !state.verificationReport) ||
    !changeDirRef ||
    !action
  ) {
    throw new Error('Current Classic SDK Run has no pending check Action');
  }
  const change = await inspectProtectedProjectPath(root, changeDirRef, {
    label: 'Classic change',
    expected: 'directory',
  });
  if (!change.exists) throw new Error('Classic change directory does not exist');
  const token = randomUUID();
  const requestId = randomUUID();
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-classic-check',
    claimToken: token,
    expectedRevision: run.revision,
    context: { requestId, projectRoot: root },
  });
  try {
    const checksDir = path.join(change.target, '.comet', 'checks');
    await ensureClassicProjectDirectory(root, checksDir, 'Classic SDK check evidence');
    const identity = { argv: [...input.argv], cwd: cwd.relative };
    const snapshotOptions = { verificationReport: state.verificationReport };
    const before = await collectCheckSnapshot(root, change.target, identity, snapshotOptions);
    const environment = await checkEnvironmentFingerprint(
      identity.argv,
      cwd.absolute,
      await readCheckPolicy(root, identity),
    );
    const result = await runCommand(identity.argv, cwd.absolute, timeoutMs);
    const after = await collectCheckSnapshot(root, change.target, identity, snapshotOptions).catch(
      () => null,
    );
    let inputAfter = after?.digest ?? 'unavailable';
    if (
      environment !==
      (await checkEnvironmentFingerprint(
        identity.argv,
        cwd.absolute,
        await readCheckPolicy(root, identity),
      ))
    ) {
      inputAfter = 'environment-changed';
    }
    const logPath = path.join(checksDir, `${randomUUID()}.log`);
    await writeClassicProjectText(root, logPath, result.output, { label: 'Classic SDK check log' });
    const receiptRef = path.relative(root, logPath).replaceAll('\\', '/');
    const contentHash = createHash('sha256').update(result.output).digest('hex');
    const manifestPath = path.join(checksDir, `${randomUUID()}.manifest`);
    if (after) {
      await writeClassicProjectText(root, manifestPath, after.manifest, {
        label: 'Classic SDK check manifest',
      });
    }
    const changedDuringExecution = after
      ? (() => {
          const diff = diffCheckManifests(before.entries, after.entries);
          return [...diff.added, ...diff.removed, ...diff.changed].slice(0, 100);
        })()
      : [];
    return await runtime.recordOutcome({
      runId: run.runId,
      context: { requestId, projectRoot: root },
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: token,
        outcomeId: randomUUID(),
        status: result.exitCode === 0 && before.digest === inputAfter ? 'succeeded' : 'failed',
        output: {
          scope,
          argv: identity.argv,
          cwd: identity.cwd,
          timeoutMs,
          exitCode: result.exitCode,
          inputBefore: before.digest,
          inputAfter,
          environment,
          changedDuringExecution,
          receiptRef,
          contentHash,
          manifestRef: after ? path.relative(root, manifestPath).replaceAll('\\', '/') : null,
          manifestHash: after ? checkManifestHash(after.manifest) : null,
          tier: 'full',
          checkEpoch: state.checkEpoch ?? 0,
        },
      },
    });
  } catch (error) {
    const current = await runtime.inspect(run.runId);
    const latest = current.actions.find((candidate) => candidate.id === action.id);
    if (latest?.status === 'running' && latest.attempt === action.attempt) {
      await runtime.markUnknown({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
