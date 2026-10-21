import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import {
  hashRuntimeValue,
  RuntimeProtocolError,
  listFileRuntimeStoreRunSources,
  type RuntimeRecord,
} from '../engine/runtime.js';

const directory = '.runtime-store-coordination';
const schema = 'comet.application-holder-index.v1';
interface Inventory {
  epoch: string;
  members: string[];
  aborted?: string[];
}
export interface ApplicationStorageIndex {
  schema: string;
  epoch: string;
  state: 'building' | 'ready';
  inventoryHash: string | null;
  memberCount: number;
  holders: string[];
  pending: { runId: string; registering: boolean } | null;
  stamps: string | null;
}

/** 调用者持有应用 scope 锁；索引仅保存占用身份，正文仍以 Store 为准。 */
export function createApplicationStorageIndex<T extends RuntimeRecord>(options: {
  rootDir: string;
  read(runId: string): Promise<T | null>;
  holds(record: T): boolean | Promise<boolean>;
  settle?(runId: string): Promise<unknown>;
}) {
  const root = options.rootDir;
  const fail = (message: string): never => {
    throw new RuntimeProtocolError('STORE_INDEX_CORRUPT', message);
  };
  const readJson = async <V>(name: string): Promise<V | null> => {
    const volume = path.parse(root).root;
    if (
      !(
        await inspectProtectedProjectPath(
          volume,
          path.relative(volume, root).replaceAll('\\', '/'),
          { label: '应用 Store', expected: 'directory' },
        )
      ).exists
    )
      return null;
    const ref = `${directory}/${name}.json`;
    if (
      !(await inspectProtectedProjectPath(root, ref, { label: '应用存储索引', expected: 'file' }))
        .exists
    )
      return null;
    try {
      const parsed = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          (
            await readProtectedProjectFile(root, ref, Number.MAX_SAFE_INTEGER, {
              label: '应用存储索引',
            })
          ).bytes,
        ),
      ) as V;
      if (name === 'inventory') {
        const { checksum, ...value } = parsed as V & { checksum?: string };
        if (checksum !== hashRuntimeValue(value)) fail('独立成员清单校验值不一致');
        return value as V;
      }
      return parsed;
    } catch {
      return fail(`应用存储索引 ${name} 无法读取；请保留现场并显式检查`);
    }
  };
  const write = async (name: string, value: unknown) => {
    await ensureProtectedProjectDirectory(root, directory, { label: '应用存储索引' });
    await atomicWriteContainedText(
      path.join(root, directory, `${name}.json`),
      JSON.stringify(
        ['index', 'inventory'].includes(name)
          ? { ...(value as object), checksum: hashRuntimeValue(value) }
          : value,
      ) + '\n',
      { containedRoot: root, requireAtomicPublication: true },
    );
  };
  const stamps = async () =>
    JSON.stringify(
      await Promise.all(
        ['', '.runtime-store-v2', '.runtime-store-history'].map(async (ref) => {
          const inspected = await inspectProtectedProjectPath(
            ref ? root : path.dirname(root),
            ref || path.basename(root),
            { label: '应用存储分区', expected: 'directory' },
          );
          if (!inspected.exists) return null;
          const value = await fs.lstat(inspected.target);
          return [value.dev, value.ino, value.mtimeMs, value.ctimeMs];
        }),
      ),
    );
  async function readIndex(): Promise<ApplicationStorageIndex | null> {
    const raw = await readJson<ApplicationStorageIndex & { checksum?: string }>('index');
    if (!raw) return null;
    const { checksum, ...value } = raw;
    if (checksum !== hashRuntimeValue(value)) fail('应用存储索引校验值不一致');
    if (
      value &&
      (value.schema !== schema ||
        typeof value.epoch !== 'string' ||
        !['building', 'ready'].includes(value.state) ||
        !Array.isArray(value.holders) ||
        value.holders.some((id) => typeof id !== 'string') ||
        new Set(value.holders).size !== value.holders.length ||
        !Number.isSafeInteger(value.memberCount) ||
        value.memberCount < 0 ||
        (value.pending !== null &&
          (!value.pending ||
            typeof value.pending.runId !== 'string' ||
            typeof value.pending.registering !== 'boolean')))
    )
      fail('应用存储索引格式损坏');
    return value;
  }
  async function inventory(index: ApplicationStorageIndex): Promise<Inventory> {
    const value = await readJson<Inventory>('inventory');
    if (
      !value ||
      value.epoch !== index.epoch ||
      !Array.isArray(value.members) ||
      value.members.some((id) => typeof id !== 'string') ||
      new Set(value.members).size !== value.members.length ||
      (value.aborted !== undefined &&
        (!Array.isArray(value.aborted) ||
          value.aborted.some((id) => typeof id !== 'string' || value.members.includes(id)) ||
          new Set(value.aborted).size !== value.aborted.length)) ||
      value.members.length !== index.memberCount ||
      hashRuntimeValue(value) !== index.inventoryHash
    )
      fail('应用存储成员清单与 epoch/hash 不一致，不能忽略已登记 Run');
    return value!;
  }
  async function scan(index: ApplicationStorageIndex, known?: Inventory): Promise<Inventory> {
    const sources = await listFileRuntimeStoreRunSources({ rootDir: root });
    const ids: string[] = [];
    const holders: string[] = [];
    for (const source of sources) {
      if (source.error || !source.runId)
        fail(`Run 无法发现：${source.storageKey} (${source.error?.code ?? 'missing identity'})`);
      const id = source.runId!;
      await options.settle?.(id);
      const record = await options.read(id);
      // 仅忽略已持久化证明未提交的注册；成员丢失或无法识别的分区仍拒绝修复。
      if (!record && known?.aborted?.includes(id) && !known.members.includes(id)) continue;
      if (!record) fail(`已发现的 Run 正文缺失：${id}`);
      ids.push(id);
      if (await options.holds(record!)) holders.push(id);
    }
    if (known?.members.some((id) => !ids.includes(id)))
      fail('已登记 Run 缺失，不能通过重建索引丢弃占用；请恢复原记录');
    index.holders = holders.sort();
    return {
      epoch: index.epoch,
      members: ids.sort(),
      ...(known?.aborted ? { aborted: known.aborted.filter((id) => !ids.includes(id)) } : {}),
    };
  }
  async function initialize(): Promise<ApplicationStorageIndex> {
    const volume = path.parse(root).root;
    await ensureProtectedProjectDirectory(
      volume,
      path.relative(volume, root).replaceAll('\\', '/'),
      { label: '应用 Store' },
    );
    let index = await readIndex();
    if (index?.state === 'ready') return index;
    if (!index) {
      if (await readJson('inventory')) fail('成员清单存在但索引缺失，请显式检查，不能静默初始化');
      index = {
        schema,
        epoch: randomUUID(),
        state: 'building',
        inventoryHash: null,
        memberCount: 0,
        holders: [],
        pending: null,
        stamps: null,
      };
      await write('index', index);
    }
    // inventory 发布后崩溃时必须复核旧清单，不能用当前目录覆盖并掩盖缺失 Run。
    let previous = await readJson<Inventory>('inventory');
    const repair = await readJson<{ previousHash: string; inventory: Inventory }>('repair');
    if (
      repair &&
      repair.inventory.epoch === index.epoch &&
      hashRuntimeValue(repair.inventory) === index.inventoryHash &&
      previous &&
      hashRuntimeValue(previous) === repair.previousHash
    )
      previous = repair.inventory;
    if (
      previous &&
      (previous.epoch !== index.epoch ||
        !Array.isArray(previous.members) ||
        previous.members.some((id) => typeof id !== 'string') ||
        new Set(previous.members).size !== previous.members.length ||
        (index.inventoryHash !== null &&
          (hashRuntimeValue(previous) !== index.inventoryHash ||
            previous.members.length !== index.memberCount)))
    )
      fail('初始化中的成员清单不匹配');
    const value = await scan(index, previous ?? undefined);
    if (
      !previous &&
      index.inventoryHash !== null &&
      hashRuntimeValue(value) !== index.inventoryHash
    )
      fail('初始化期间成员清单发生变化，不能重写并丢弃原成员');
    index.inventoryHash = hashRuntimeValue(value);
    index.memberCount = value.members.length;
    await write('index', index);
    await write('inventory', value);
    index.state = 'ready';
    index.stamps = await stamps();
    await write('index', index);
    return index;
  }
  async function settle(index: ApplicationStorageIndex): Promise<void> {
    if (!index.pending) return;
    const { runId, registering } = index.pending;
    await options.settle?.(runId);
    const record = await options.read(runId);
    if (!record && !registering) fail(`未完成写入的 Run 缺失：${runId}`);
    if (!record && registering) {
      const known = await inventory(index);
      const intent = await readJson<{ epoch: string; previousHash: string; inventory: Inventory }>(
        'registration',
      );
      if (
        known.members.includes(runId) ||
        (intent?.epoch === index.epoch &&
          intent.previousHash === index.inventoryHash &&
          intent.inventory.members.includes(runId))
      )
        fail(`注册已提交或已观测到提交，但 Run 已缺失：${runId}`);
    }
    if (registering) {
      const known = await inventory(index);
      let changed = false;
      if (record && !known.members.includes(runId)) {
        known.members.push(runId);
        known.members.sort();
        if (known.aborted) known.aborted = known.aborted.filter((id) => id !== runId);
        changed = true;
      } else if (!record && !known.aborted?.includes(runId)) {
        known.aborted = [...(known.aborted ?? []), runId].sort();
        changed = true;
      }
      if (changed) {
        // 注册和未提交证明采用同一发布协议；清除 pending 前必须保存可审计身份。
        await write('registration', {
          epoch: index.epoch,
          previousHash: index.inventoryHash,
          inventory: known,
        });
        await write('inventory', known);
        index.inventoryHash = hashRuntimeValue(known);
        index.memberCount = known.members.length;
      }
    }
    index.holders = index.holders.filter((id) => id !== runId);
    if (record && (await options.holds(record))) index.holders.push(runId);
    index.holders.sort();
    index.pending = null;
    index.stamps = await stamps();
    await write('index', index);
  }
  async function reconcileRegistration(index: ApplicationStorageIndex) {
    if (!index.pending?.registering) return;
    const registration = await readJson<{
      epoch: string;
      previousHash: string;
      inventory: Inventory;
    }>('registration');
    if (registration?.epoch === index.epoch && registration.previousHash === index.inventoryHash) {
      const actual = await readJson<Inventory>('inventory');
      if (actual && hashRuntimeValue(actual) === hashRuntimeValue(registration.inventory)) {
        index.inventoryHash = hashRuntimeValue(actual);
        index.memberCount = actual.members.length;
      }
    }
  }
  async function ready(): Promise<ApplicationStorageIndex> {
    const index = await initialize();
    await reconcileRegistration(index);
    if (index.pending) await settle(index);
    if (index.stamps !== (await stamps()))
      fail('Store 分区身份已变化，必须显式 audit；不能继续使用占用投影');
    return index;
  }
  return {
    async isAbortedRegistration(runId: string): Promise<boolean> {
      const index = await readIndex();
      if (!index || index.state !== 'ready' || index.pending) return false;
      const known = await inventory(index);
      return (
        !known.members.includes(runId) &&
        !!known.aborted?.includes(runId) &&
        (await options.read(runId)) === null
      );
    },
    async holders(): Promise<T[]> {
      const index = await ready();
      const result: T[] = [];
      for (const id of index.holders) {
        await options.settle?.(id);
        const record = await options.read(id);
        if (!record) fail(`占用 Run 缺失：${id}`);
        if (await options.holds(record!)) result.push(record!);
      }
      return result;
    },
    async begin(runId: string, registering: boolean): Promise<void> {
      const index = await ready();
      if (registering && (await inventory(index)).members.includes(runId))
        fail(`已登记 Run 不能作为新记录重建：${runId}`);
      index.pending = { runId, registering };
      await write('index', index);
    },
    async finish(): Promise<void> {
      const index = await readIndex();
      if (!index || index.state !== 'ready') fail('应用存储索引未就绪');
      await reconcileRegistration(index!);
      await settle(index!);
    },
    async inspect() {
      try {
        const current = await readIndex();
        if (!current && (await readJson<Inventory>('inventory'))) fail('成员清单存在但索引缺失');
        return current;
      } catch (error) {
        const known = await readJson<Inventory>('inventory');
        if (!known || typeof known.epoch !== 'string') throw error;
        return {
          schema,
          epoch: known.epoch,
          state: 'corrupt' as const,
          error: {
            code: 'STORE_INDEX_CORRUPT',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
    async repair(operation: 'audit' | 'rebuild', expectedEpoch: string) {
      let index: ApplicationStorageIndex | null;
      try {
        index = await readIndex();
      } catch (error) {
        if (operation !== 'rebuild') throw error;
        index = null;
      }
      if (!index && operation === 'rebuild') {
        const known = await readJson<Inventory>('inventory');
        if (
          known &&
          known.epoch === expectedEpoch &&
          Array.isArray(known.members) &&
          known.members.every((id) => typeof id === 'string') &&
          new Set(known.members).size === known.members.length
        ) {
          index = {
            schema,
            epoch: known.epoch,
            state: 'building',
            inventoryHash: hashRuntimeValue(known),
            memberCount: known.members.length,
            holders: [],
            pending: null,
            stamps: null,
          };
        }
      }
      if (!index || index.epoch !== expectedEpoch)
        throw new RuntimeProtocolError(
          'STORE_INDEX_EPOCH_CHANGED',
          '索引 epoch 已变化，请重新 inspect',
        );
      await reconcileRegistration(index);
      if (index.pending) await settle(index);
      const known = await inventory(index);
      const value = await scan(index, known);
      if (operation === 'rebuild') {
        index.epoch = randomUUID();
        value.epoch = index.epoch;
      }
      await write('repair', { previousHash: index.inventoryHash, inventory: value });
      index.inventoryHash = hashRuntimeValue(value);
      index.memberCount = value.members.length;
      index.state = 'building';
      await write('index', index);
      await write('inventory', value);
      index.state = 'ready';
      index.stamps = await stamps();
      await write('index', index);
      return index;
    },
  };
}
