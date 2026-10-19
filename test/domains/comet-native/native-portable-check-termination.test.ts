import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as checkExecutor from '../../../domains/comet-native/native-check-executor.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import * as atomicFile from '../../../domains/comet-native/native-atomic-file.js';
import { canonicalHash } from '../../../domains/comet-native/native-canonical-hash.js';
import { nativePortableStateFile } from '../../../domains/comet-native/native-portable-storage.js';
import { writeNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import * as processIdentity from '../../../platform/process/process-identity.js';
import {
  inspectNativeCheckStopEvidenceTargets,
  recoverNativeChecksWithStopEvidence,
} from '../../../domains/comet-native/native-check-stop-evidence.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { readNativeLocalExecution } from '../../../domains/comet-native/native-local-execution.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
  nativePreferredChangeRuntimeDir,
} from '../../../domains/comet-native/native-paths.js';
import { inspectNativePortableCheckExecution } from '../../../domains/comet-native/native-portable-checks.js';
import { recoverNativePortableChange } from '../../../domains/comet-native/native-portable-recovery.js';
import {
  createNativePortableChange,
  dispatchNativePortableVerifier,
  executeNativePortableCheckPlan,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  readNativePortableChange,
  retryNativePortableCheckPlan,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function candidate() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-check-termination-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  await createNativePortableChange({ paths, name: 'change', language: 'en' });
  await fs.writeFile(
    path.join(nativePortableChangeDir(paths, 'change'), 'brief.md'),
    '# Acceptance examples\n- Unconfirmed checks cannot overlap a retry.\n',
  );
  const state = await confirmNativePortableShape({ paths, name: 'change' });
  const runner = createNativeRunnerChannel();
  await submitNativePortableBuilderCandidate({
    paths,
    name: state.name,
    input: {
      identity: runner.captureExecutionIdentity({
        identityProvider: 'test-host',
        executionRef: 'builder',
      }),
      candidateId: 'candidate',
      summary: 'Implemented.',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      review: {
        status: 'passed',
        summary: 'Independent review passed.',
        reviewerExecutionRef: 'reviewer',
      },
    },
  });
  return { paths, runner };
}

describe('Native portable unconfirmed check termination', () => {
  it.each(['runtime', 'verifier', 'legacy-verifier'] as const)(
    'preserves the registered process and blocks retries for %s checks',
    async (source) => {
      const { paths, runner } = await candidate();
      const plan = {
        id: 'pending',
        name: 'Pending check',
        executable: process.execPath,
        argv: ['-e', 'process.exit(0)'],
        cwdRef: '.',
        timeoutMs: 10000,
        repeatable: true,
      };
      if (source !== 'runtime') {
        const baseline = await executeNativePortableCheckPlan({ paths, name: 'change', plans: [] });
        await dispatchNativePortableVerifier({
          paths,
          name: 'change',
          checks: baseline.checks,
          verifierExecutionId: 'verifier',
        });
      }
      const failure = new checkExecutor.NativeCheckTerminationUnconfirmedError();
      const execute = vi
        .spyOn(checkExecutor, 'executeNativeCheck')
        .mockImplementation(async ({ onSpawn }) => {
          await onSpawn?.({ pid: 2147483000, signal: new AbortController().signal });
          throw failure;
        });
      const attempt = () =>
        source === 'runtime'
          ? executeNativePortableCheckPlan({ paths, name: 'change', plans: [plan] })
          : submitNativePortableVerifierResult({
              paths,
              name: 'change',
              checks: [],
              maxVerifyFailures: 5,
              envelope: runner.envelopeVerifierResponse({
                candidateId: 'candidate',
                identity: runner.captureExecutionIdentity({
                  identityProvider: 'test-host',
                  executionRef: 'verifier',
                }),
                payload: {
                  kind: 'request-checks',
                  iteration: 1,
                  attempt: 1,
                  checks: [plan],
                },
              }),
            });
      await expect(attempt()).rejects.toBe(failure);
      const file = nativeLocalExecutionFile(paths, 'change');
      const local = (await readNativeLocalExecution(file))!;
      expect(local).toMatchObject({
        execution: { stage: 'checking', actor: 'runtime', status: 'running' },
        checks: [
          {
            id: 'pending',
            status: 'running',
            executionCount: 1,
            activeProcess: { status: 'running', pid: 2147483000 },
          },
        ],
      });
      expect((await readNativePortableChange(paths, 'change')).loop.execution_failure_count).toBe(
        0,
      );
      await expect(attempt()).rejects.toThrow();
      await expect(
        retryNativePortableCheckPlan({ paths, name: 'change', checkIds: ['pending'] }),
      ).rejects.toThrow();
      expect(execute).toHaveBeenCalledTimes(1);

      // A pre-upgrade request-checks overlay can legally lack verifier_action.
      if (source === 'legacy-verifier') {
        const legacy = await readNativePortableChange(paths, 'change');
        delete legacy.verifier_action;
        await writeNativePortableState(nativePortableStateFile(paths, 'change'), legacy);
      }

      // 模拟 owner 已退出，但检查树没有整树停止证据。
      local.execution!.ownerPid = 2147483001;
      await fs.writeFile(file, JSON.stringify(local));
      vi.spyOn(checkExecutor, 'inspectNativeCheckProcessTreeLiveness').mockResolvedValue('unknown');
      await expect(inspectNativePortableCheckExecution(local)).resolves.toBe('unknown');
      await expect(recoverNativePortableChange({ paths, name: 'change' })).resolves.toMatchObject({
        action: 'await-user',
        reason: 'execution-active',
      });
      await expect(
        recoverNativePortableChange({ paths, name: 'change', recoverUnknownRuntimeCheck: true }),
      ).resolves.toMatchObject({ action: 'await-user', reason: 'execution-active' });
      const diagnostic = await nativeDoctorCommand(['change'], paths.projectRoot);
      expect(diagnostic).toMatchObject({
        exitCode: 65,
        data: {
          findings: [
            {
              code: 'portable-check-execution-stuck',
              message: expect.stringContaining('process tree has not been confirmed stopped'),
            },
          ],
        },
      });
      const finding = (diagnostic.data as { findings: Array<{ repair?: string }> }).findings[0];
      expect(finding.repair).toBeUndefined();
      await expect(
        nativeDoctorCommand(['change', '--repair'], paths.projectRoot),
      ).resolves.toMatchObject({
        exitCode: 65,
        data: { healthy: false, repaired: false, result: { reason: 'execution-active' } },
      });
      expect(await readNativeLocalExecution(file)).toEqual(local);
      expect(execute).toHaveBeenCalledTimes(1);

      const [target] = await inspectNativeCheckStopEvidenceTargets(paths, 'change');
      expect(target.canConfirm).toBe(true);
      const confirmation = {
        ...target.confirmation,
        evidence:
          'The host process inventory confirms the original check and all descendants stopped.',
      };
      const recover = (entries: unknown = [confirmation]) =>
        recoverNativeChecksWithStopEvidence({ paths, name: 'change', confirmations: entries });
      for (const invalid of [
        { ...confirmation, operationId: 'another-operation' },
        { ...confirmation, executionHash: '0'.repeat(64) },
        { ...confirmation, evidence: '' },
        target.confirmation,
      ]) {
        await expect(recover([invalid])).rejects.toThrow();
        expect(await readNativeLocalExecution(file)).toEqual(local);
      }
      const processProbe = vi.spyOn(processIdentity, 'inspectProcessTreeLiveness');
      for (const liveness of ['alive', 'unknown'] as const) {
        processProbe.mockResolvedValue(liveness);
        await expect(recover()).rejects.toThrow('尚未确认退出');
        expect(await readNativeLocalExecution(file)).toEqual(local);
      }
      processProbe.mockRestore();
      const ownerProbe = vi
        .spyOn(processIdentity, 'inspectProcessLiveness')
        .mockResolvedValue('unknown');
      await expect(recover()).rejects.toThrow('尚未确认退出');
      ownerProbe.mockRestore();
      const starting = structuredClone(local);
      starting.checks[0].activeProcess = { status: 'starting' };
      await fs.writeFile(file, JSON.stringify(starting));
      const [unregistered] = await inspectNativeCheckStopEvidenceTargets(paths, 'change');
      await expect(
        recover([{ ...confirmation, executionHash: unregistered.executionHash }]),
      ).rejects.toThrow('同机PID登记');
      expect(await readNativeLocalExecution(file)).toEqual(starting);
      await fs.writeFile(file, JSON.stringify(local));

      const originalWrite = atomicFile.atomicWriteJson;
      const write = vi
        .spyOn(atomicFile, 'atomicWriteJson')
        .mockImplementation(async (targetFile, value, settings) => {
          if (String(targetFile).includes(`${path.sep}check-stops${path.sep}`))
            throw new Error('receipt write failed');
          return originalWrite(targetFile, value, settings);
        });
      await expect(recover()).rejects.toThrow('receipt write failed');
      expect(await readNativeLocalExecution(file)).toEqual(local);
      write.mockRestore();

      const proofFile = path.join(paths.workspaceRuntimeRoot, 'check-stop-confirmation.json');
      await fs.writeFile(proofFile, JSON.stringify([confirmation]));
      await expect(
        nativeDoctorCommand(
          ['change', '--repair', '--stopped-actions', proofFile],
          paths.projectRoot,
        ),
      ).rejects.toThrow('--confirmed');
      const command = () =>
        nativeDoctorCommand(
          ['change', '--repair', '--confirmed', '--stopped-actions', proofFile],
          paths.projectRoot,
        );
      if (source === 'runtime') {
        const failLocal = vi
          .spyOn(atomicFile, 'atomicWriteJson')
          .mockImplementation(async (targetFile, value, settings) => {
            if (targetFile === file) throw new Error('local write failed');
            return originalWrite(targetFile, value, settings);
          });
        await expect(command()).rejects.toThrow('local write failed');
        failLocal.mockRestore();
        const aliveOwner = vi
          .spyOn(processIdentity, 'inspectProcessLiveness')
          .mockResolvedValue('alive');
        await expect(command()).rejects.toThrow('尚未确认退出');
        expect(await readNativeLocalExecution(file)).toEqual(local);
        aliveOwner.mockRestore();
        const childProbe = vi.spyOn(processIdentity, 'inspectProcessTreeLiveness');
        for (const liveness of ['alive', 'unknown'] as const) {
          childProbe.mockResolvedValue(liveness);
          await expect(command()).rejects.toThrow('尚未确认退出');
          expect(await readNativeLocalExecution(file)).toEqual(local);
        }
        childProbe.mockRestore();
      }
      if (source !== 'runtime') {
        const failLocal = vi
          .spyOn(atomicFile, 'atomicWriteJson')
          .mockImplementation(async (targetFile, value, settings) => {
            if (targetFile === file) throw new Error('local write failed');
            return originalWrite(targetFile, value, settings);
          });
        await expect(command()).rejects.toThrow('local write failed');
        failLocal.mockRestore();
        const failApplied = vi
          .spyOn(atomicFile, 'atomicWriteJson')
          .mockImplementation(async (targetFile, value, settings) => {
            if (
              (value as { schema?: string; applied?: boolean }).schema ===
                'comet.native.check-stop-evidence.v1' &&
              (value as { applied?: boolean }).applied
            )
              throw new Error('applied write failed');
            return originalWrite(targetFile, value, settings);
          });
        await expect(command()).rejects.toThrow('applied write failed');
        failApplied.mockRestore();
      }
      const recovered = await command();
      expect(recovered).toMatchObject({
        data: {
          repaired: source === 'runtime',
          stoppedChecks: { alreadyApplied: source !== 'runtime' },
        },
      });
      const recoveredLocal = (await readNativeLocalExecution(file))!;
      expect(recoveredLocal.checks).toMatchObject([
        { status: 'interrupted', executionCount: 1, activeProcess: null },
      ]);
      expect((await readNativePortableChange(paths, 'change')).loop.execution_failure_count).toBe(
        source !== 'runtime' ? 1 : 0,
      );
      const receiptRef = (recovered.data as { stoppedChecks: { receiptRef: string } }).stoppedChecks
        .receiptRef;
      const receiptFile = path.join(nativePreferredChangeRuntimeDir(paths, 'change'), receiptRef);
      const receipt = await fs.readFile(receiptFile, 'utf8');
      expect(JSON.parse(receipt)).toMatchObject({
        applied: true,
        before: { local },
        confirmations: [confirmation],
      });
      await expect(command()).resolves.toMatchObject({
        data: { repaired: false, stoppedChecks: { alreadyApplied: true } },
      });
      expect(await fs.readFile(receiptFile, 'utf8')).toBe(receipt);
      expect(await readNativeLocalExecution(file)).toEqual(recoveredLocal);
      expect(execute).toHaveBeenCalledTimes(1);

      // Even a receipt with a recomputed checksum cannot authorize a passed result.
      const forged = JSON.parse(receipt);
      forged.after.local.checks[0].status = 'passed';
      forged.recoveryHash = canonicalHash('comet.native.check-stop-recovery.v1', {
        before: forged.before,
        after: forged.after,
      });
      await fs.writeFile(receiptFile, JSON.stringify(forged));
      await expect(command()).rejects.toThrow('不合法的恢复结果');
      expect(await readNativeLocalExecution(file)).toEqual(recoveredLocal);
      await fs.writeFile(receiptFile, receipt);
      if (source === 'legacy-verifier') {
        const next = await readNativePortableChange(paths, 'change');
        expect(next.verifier_action).toBeUndefined();
        expect(next.loop.next_action).toBe('dispatch-new-verifier');
      }

      const newer = structuredClone(recoveredLocal);
      newer.execution!.operationId = 'new-completed-operation';
      newer.execution!.status = 'completed';
      for (const check of newer.checks) check.operationId = newer.execution!.operationId;
      await fs.writeFile(file, JSON.stringify(newer));
      await expect(command()).rejects.toThrow('旧证明');
      expect(await readNativeLocalExecution(file)).toEqual(newer);
    },
  );
});
