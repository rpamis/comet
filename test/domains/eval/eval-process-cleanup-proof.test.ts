import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as identity from '../../../platform/process/process-identity.js';
import * as external from '../../../platform/process/external-command.js';
import {
  cleanupEvalExecution,
  registerEvalContainerOwnership,
  recordEvalProcessTermination,
  writeEvalExecutionState,
} from '../../../domains/eval/eval-run-cleanup.js';
import { requestStopEvalRun } from '../../../domains/eval/eval-run-manager.js';
import { evalRunPath, writeEvalJson, readEvalJson } from '../../../domains/eval/eval-run-store.js';
import type { OwnedProcessInstance } from '../../../platform/process/owned-command.js';

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
let project: string;
const id = 'windows-proof';
const child: OwnedProcessInstance = {
  pid: 2147483000,
  identity: 'win32-ps:original',
  instanceId: 'registered-instance',
  ownerPid: 2147482999,
};
let containers = true;
let stopped = true;

beforeEach(async () => {
  project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-process-proof-'));
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  vi.spyOn(identity, 'readProcessIdentity').mockResolvedValue('win32-ps:test-owner');
  vi.spyOn(identity, 'inspectProcessLiveness').mockImplementation(async (pid) =>
    pid === process.pid ? 'alive' : stopped ? 'dead' : 'alive',
  );
  vi.spyOn(identity, 'inspectProcessTreeLiveness').mockImplementation(async () =>
    stopped ? 'dead' : 'alive',
  );
  vi.spyOn(identity, 'terminateRegisteredProcessTree').mockResolvedValue(false);
  containers = true;
  stopped = true;
  vi.spyOn(external, 'runExternalCommandAsync').mockImplementation(async (_command, args) => {
    if (args[0] === 'ps') return containers ? 'abcdef123456\n' : '';
    if (args[0] === 'stop' || args[0] === 'rm') {
      containers = false;
      return '';
    }
    throw new Error('Unexpected Docker call');
  });
  await registerEvalContainerOwnership(project, id);
  await writeEvalJson(await evalRunPath(project, id, 'dashboard-run.json'), {
    schema: 'comet.eval.managed-run.v1',
    id,
    origin: 'cli',
    status: 'stopping',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config: { target: 'fixture', targetType: 'skill' },
    targetId: 'fixture',
    contentHash: 'fixture',
    previewHash: 'fixture',
    child,
  });
  await writeEvalExecutionState(project, id, { status: 'stopping' });
  await fs.writeFile(await evalRunPath(project, id, 'execution.lock'), 'locked');
});

afterEach(async () => {
  Object.defineProperty(process, 'platform', platform);
  vi.restoreAllMocks();
  await fs.rm(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('Windows Eval 清理必须有进程实例绑定证明', () => {
  it.each(['missing', 'failed'] as const)(
    '冷恢复的 %s 收据不能因为 leader 已死而升级 stopped，仍清理容器',
    async (receipt) => {
      if (receipt === 'failed') await recordEvalProcessTermination(project, id, child, false);
      await expect(requestStopEvalRun(project, id)).rejects.toThrow('尚未确认停止');
      expect(containers).toBe(false);
      expect(
        (await readEvalJson(await evalRunPath(project, id, 'dashboard-run.json')))?.status,
      ).toBe('stopping');
      expect(await fs.readFile(await evalRunPath(project, id, 'execution.lock'), 'utf8')).toBe(
        'locked',
      );
      await expect(requestStopEvalRun(project, id)).rejects.toThrow('尚未确认停止');
    },
  );

  it.each(['pid', 'identity', 'instanceId', 'ownerPid'] as const)(
    '拒绝与登记 %s 不匹配的旧成功收据',
    async (field) => {
      const changed = {
        ...child,
        [field]:
          typeof child[field] === 'number' ? Number(child[field]) + 1 : `${child[field]}-old`,
      };
      await recordEvalProcessTermination(project, id, changed as OwnedProcessInstance, true);
      await expect(cleanupEvalExecution(project, id)).rejects.toThrow('尚未确认停止');
      expect(containers).toBe(false);
    },
  );

  it('成功收据冷恢复及重复 Stop 均释放锁，且不重复终止进程', async () => {
    await recordEvalProcessTermination(project, id, child, true);
    expect((await requestStopEvalRun(project, id)).executionStatus).toBe('stopped');
    expect((await requestStopEvalRun(project, id)).executionStatus).toBe('stopped');
    expect(
      await fs.stat(await evalRunPath(project, id, 'execution.lock')).catch(() => null),
    ).toBeNull();
    expect(identity.terminateRegisteredProcessTree).not.toHaveBeenCalled();
  });

  it('旧 completed 状态也不能绕过 Windows 子进程收据核对', async () => {
    const file = await evalRunPath(project, id, 'dashboard-run.json');
    await writeEvalJson(file, { ...(await readEvalJson(file)), status: 'completed' });
    await writeEvalExecutionState(project, id, { status: 'completed' });
    await expect(requestStopEvalRun(project, id)).rejects.toThrow('尚未确认停止');
    expect((await readEvalJson(file))?.status).toBe('stopping');
  });

  it('同进程 Creator Stop 只终止登记的执行树，不杀调用宿主', async () => {
    const ownChild = { ...child, ownerPid: process.pid };
    const file = await evalRunPath(project, id, 'dashboard-run.json');
    await writeEvalJson(file, {
      ...(await readEvalJson(file)),
      status: 'running',
      child: ownChild,
      owner: { pid: process.pid, identity: 'win32-ps:test-owner' },
    });
    await writeEvalExecutionState(project, id, { status: 'running' });
    stopped = false;
    vi.mocked(identity.terminateRegisteredProcessTree).mockImplementation(async (instance) => {
      expect(instance.pid).toBe(child.pid);
      stopped = true;
      return true;
    });
    expect((await requestStopEvalRun(project, id)).executionStatus).toBe('stopped');
    expect(identity.terminateRegisteredProcessTree).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'CLI owner 的成功树终止只覆盖其绑定的活子实例（bound=%s）',
    async (bound) => {
      const file = await evalRunPath(project, id, 'dashboard-run.json');
      const owner = { pid: child.ownerPid, identity: 'win32-ps:cli-owner' };
      await writeEvalJson(file, {
        ...(await readEvalJson(file)),
        status: 'running',
        owner,
        child: bound ? child : { ...child, ownerPid: child.ownerPid + 1 },
      });
      await writeEvalExecutionState(project, id, { status: 'running' });
      stopped = false;
      vi.mocked(identity.terminateRegisteredProcessTree).mockImplementation(async (instance) => {
        if (instance.pid !== owner.pid) return false;
        stopped = true;
        return true;
      });
      if (bound) expect((await requestStopEvalRun(project, id)).executionStatus).toBe('stopped');
      else await expect(requestStopEvalRun(project, id)).rejects.toThrow('尚未确认停止');
    },
  );

  it('仍活着的同实例可重试终止并持久化收据，终止失败仍保持可重试', async () => {
    stopped = false;
    await expect(requestStopEvalRun(project, id)).rejects.toThrow('尚未确认停止');
    vi.mocked(identity.terminateRegisteredProcessTree).mockImplementation(async (instance) => {
      expect(instance).toEqual(child);
      stopped = true;
      return true;
    });
    expect((await requestStopEvalRun(project, id)).executionStatus).toBe('stopped');
    expect(
      (await readEvalJson(await evalRunPath(project, id, 'process-cleanup.json')))?.confirmed,
    ).toBe(true);
  });

  it('同实例并发 Stop/finally 的失败不能覆盖成功证明', async () => {
    await Promise.all([
      recordEvalProcessTermination(project, id, child, true),
      recordEvalProcessTermination(project, id, child, false),
      recordEvalProcessTermination(project, id, child, false),
    ]);
    expect(
      (await readEvalJson(await evalRunPath(project, id, 'process-cleanup.json')))?.confirmed,
    ).toBe(true);
    await expect(cleanupEvalExecution(project, id)).resolves.toBeUndefined();
  });

  it('进程证明有效但 Docker 失败时保锁，后续只重试清理', async () => {
    await recordEvalProcessTermination(project, id, child, true);
    vi.mocked(external.runExternalCommandAsync).mockRejectedValueOnce(
      new Error('Docker unavailable'),
    );
    await expect(requestStopEvalRun(project, id)).rejects.toThrow('Docker unavailable');
    expect(await fs.stat(await evalRunPath(project, id, 'execution.lock'))).toBeTruthy();
    expect((await requestStopEvalRun(project, id)).executionStatus).toBe('stopped');
    expect(identity.terminateRegisteredProcessTree).not.toHaveBeenCalled();
  });
});
