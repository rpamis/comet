import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { createFileRuntimeStore, type WorkflowRun } from '../../../domains/engine/runtime.js';
import { ensureWorkspaceRuntimeRoot } from '../../../domains/workflow-contract/workspace-runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';

const roots: string[] = [];
beforeAll(async () => {
  await fs.access(path.resolve('dist/app/cli/index.js'));
});
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it.each(['pending', 'claimed', 'completed-invalid'] as const)(
  'continues published 0.5.2 Build checks %s at the original Builder without a stop receipt or fabricated candidate',
  async (kind) => {
    const fixture = JSON.parse(
      await fs.readFile(
        path.resolve('test/fixtures/native-052-build-check-frontier', kind + '.json'),
        'utf8',
      ),
    ) as {
      run: WorkflowRun;
      projectMaterials: Array<{ ref: string; bytesBase64: string }>;
      legacyCache?: {
        files: Array<{ ref: string; bytesBase64: string }>;
        executionRef: string;
        logRef: string;
        counterFile: {
          name: string;
          relativeToProject: string;
          bytesBase64: string;
        };
        actualOriginalResult: {
          status: string;
          output: { checks: Array<{ status: string }> };
        };
      };
    };
    const original = fixture.run,
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-published-build-frontier-')),
      root = kind === 'completed-invalid' ? path.join(directory, 'project') : directory;
    roots.push(directory);
    await fs.mkdir(root, { recursive: true });
    for (const file of fixture.projectMaterials) {
      const target = path.resolve(root, file.ref);
      expect(target.startsWith(root + path.sep)).toBe(true);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(file.bytesBase64, 'base64'));
    }
    const runtimeRoot = await ensureWorkspaceRuntimeRoot(root),
      storeRoot = path.join(runtimeRoot, 'sdk-runs/native');
    const rawStore = () => createFileRuntimeStore<WorkflowRun>({ rootDir: storeRoot });
    await rawStore().restoreCheckpoint!(original.runId, null, original);
    expect(await rawStore().read(original.runId)).toEqual(original);
    await registerSdkChangeOwner(root, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: original.runId,
      format: 'sdk',
      application: 'native',
      runId: original.runId,
    });
    const cacheBefore = new Map<string, Buffer>();
    let counterFile: string | undefined;
    if (fixture.legacyCache) {
      expect(fixture.legacyCache.files).toHaveLength(4);
      for (const file of fixture.legacyCache.files) {
        expect(file.ref.startsWith('native/sdk-checks/')).toBe(true);
        const target = path.resolve(runtimeRoot, file.ref);
        expect(target.startsWith(runtimeRoot + path.sep)).toBe(true);
        await fs.mkdir(path.dirname(target), { recursive: true });
        const bytes = Buffer.from(file.bytesBase64, 'base64');
        await fs.writeFile(target, bytes);
        cacheBefore.set(target, bytes);
      }
      counterFile = path.join(directory, fixture.legacyCache.counterFile.name);
      expect(path.relative(root, counterFile).replaceAll('\\', '/')).toBe(
        fixture.legacyCache.counterFile.relativeToProject,
      );
      const countBytes = Buffer.from(fixture.legacyCache.counterFile.bytesBase64, 'base64');
      expect(countBytes.toString('utf8')).toBe('once\n');
      await fs.writeFile(counterFile, countBytes);
      cacheBefore.set(counterFile, countBytes);
      const execution = JSON.parse(
        (await fs.readFile(path.join(runtimeRoot, fixture.legacyCache.executionRef))).toString(
          'utf8',
        ),
      );
      expect(execution).toMatchObject({
        phase: 'completed',
        terminationUnconfirmed: false,
        outcome: {
          status: 'succeeded',
          output: { checks: [{ name: 'Previous plan', status: 'passed' }] },
        },
      });
      expect(fixture.legacyCache.actualOriginalResult).toMatchObject({
        status: 'succeeded',
        output: { checks: [{ status: 'passed' }] },
      });
      expect(
        await fs.readFile(path.join(runtimeRoot, fixture.legacyCache.logRef), 'utf8'),
      ).toContain('actual-legacy-check-completed');
    }
    const invoke = (command: 'next' | 'doctor', extra: string[] = []) => {
      const result = spawnSync(
        process.execPath,
        [
          path.resolve('dist/app/cli/index.js'),
          'native',
          command,
          original.runId,
          ...extra,
          '--project-root',
          root,
          '--json',
        ],
        {
          cwd: root,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30_000,
          env: {
            ...process.env,
            COMET_DAEMON: 'off',
            COMET_SKIP_UPDATE_CHECK: '1',
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr || result.stdout).toBe(0);
      return JSON.parse(result.stdout);
    };
    const next = invoke('next'),
      current = (await rawStore().read(original.runId))!;
    expect(next.agent.continuation.action).toBe('builder-handoff');
    expect(current.runId).toBe(original.runId);
    expect(current.input).toEqual(original.input);
    expect(current.waits).toEqual(original.waits);
    expect(current.state).toMatchObject({
      phase: 'build',
      status: 'active',
      builder_handoff: null,
      verification_result: 'pending',
      verification: null,
      history: (original.state as any).history,
      shape_confirmation_hash: (original.state as any).shape_confirmation_hash,
    });
    expect(
      current.actions.filter((a) => a.stepId === 'build.builder' && a.status === 'pending'),
    ).toHaveLength(1);
    expect(current.actions.some((a) => a.stepId === 'verify.verifier')).toBe(false);
    const check = original.actions.find((a) => a.stepId === 'build.checks')!;
    expect(check.status).toBe(
      kind === 'pending' ? 'pending' : kind === 'claimed' ? 'running' : 'unknown',
    );
    for (const prior of original.actions) {
      const actual = current.actions.find((a) => a.id === prior.id)!;
      expect(actual).toBeDefined();
      for (const key of [
        'input',
        'inputHash',
        'claim',
        'outcome',
        'rejectedOutcomes',
        'receipts',
      ] as const)
        expect(actual[key]).toEqual(prior[key]);
    }
    expect(current.actions.find((a) => a.id === check.id)).toMatchObject({
      status: 'cancelled',
      input: check.input,
      inputHash: check.inputHash,
      ...(check.claim ? { claim: check.claim } : {}),
    });
    expect(current.actions.find((a) => a.id === check.id)?.outcome).toBeUndefined();
    expect(current.actions.find((a) => a.id === check.id)?.executionStop).toBeUndefined();
    const doctor = invoke('doctor');
    expect(doctor.data.healthy).toBe(true);
    expect(JSON.stringify(doctor)).not.toContain('--stopped-actions');
    expect(JSON.stringify(next)).not.toContain('--stopped-actions');
    expect(JSON.stringify(next)).not.toContain('refreshChecks');
    expect(next.agent.continuation.requiresUserDecision).toBe(false);
    const beforeRepeat = (await rawStore().read(original.runId))!;
    invoke('next');
    expect(await rawStore().read(original.runId)).toEqual(beforeRepeat);
    for (const [file, bytes] of cacheBefore) expect(await fs.readFile(file)).toEqual(bytes);
    if (counterFile) expect(await fs.readFile(counterFile, 'utf8')).toBe('once\n');
    await expect(fs.stat(path.join(root, 'FORBIDDEN-CHECK-SIDE-EFFECT'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  },
);
