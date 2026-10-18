import { promises as fs } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  invalidateHookReadCache,
  memoizedHookRead,
  memoizedHookReadSync,
  runWithoutHookReadCache,
  runWithHookReadCache,
} from '../../platform/process/hook-read-cache.js';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import path from 'node:path';

import { atomicWriteContainedText, removeContainedFile } from './contained-atomic-write.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from './protected-project-path.js';
import type { CometProjectWorkflow } from './types.js';
import { resolveWorkspaceRuntimeRoot, readWorkspaceRuntimeRoots } from './workspace-runtime.js';

export const COMET_CHANGE_OWNER_SCHEMA = 'comet.change-owner.v1' as const;

export const SDK_APPLICATIONS = [
  'native',
  'classic-full',
  'classic-hotfix',
  'classic-tweak',
] as const;
export type SdkApplication = (typeof SDK_APPLICATIONS)[number];

export interface SdkChangeOwner {
  schema: typeof COMET_CHANGE_OWNER_SCHEMA;
  workflow: CometProjectWorkflow;
  change: string;
  format: 'sdk';
  application: string;
  runId: string;
}

export interface CompatChangeOwner {
  schema: typeof COMET_CHANGE_OWNER_SCHEMA;
  workflow: CometProjectWorkflow;
  change: string;
  format: 'compat';
}

export type ChangeRuntimeOwner = SdkChangeOwner | CompatChangeOwner;

// 只读请求共享一次 Runtime/fence 发现；写入路径仍执行原迁移检查，下一请求重新读取。
const readOnlyRuntimeRoots = memoizedHookRead('changeOwnerRuntimeRoots', (projectRoot: string) =>
  readWorkspaceRuntimeRoots(projectRoot),
);

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

type OwnerPartition = 'active' | 'history';
export interface SdkChangeDiscoveryOptions {
  readOnly?: boolean;
  partition?: 'all' | OwnerPartition;
}

function ownerRef(
  workflow: CometProjectWorkflow,
  change: string,
  partition: OwnerPartition = 'active',
): string {
  if (workflow !== 'native' && workflow !== 'classic') {
    throw new Error(`Unsupported change workflow: ${workflow}`);
  }
  if (!NAME_PATTERN.test(change)) throw new Error(`Invalid change name: ${change}`);
  return `${partition === 'active' ? 'change-owners' : 'change-owner-history'}/${workflow}/${change}.json`;
}

function parseOwner(
  value: unknown,
  workflow: CometProjectWorkflow,
  change: string,
): ChangeRuntimeOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Change runtime owner must be a JSON object');
  }
  const owner = value as Record<string, unknown>;
  const validCommon =
    owner.schema === COMET_CHANGE_OWNER_SCHEMA &&
    owner.workflow === workflow &&
    owner.change === change;
  const validCompat = owner.format === 'compat' && Object.keys(owner).length === 4;
  const validSdk =
    owner.format === 'sdk' &&
    Object.keys(owner).length === 6 &&
    owner.runId === change &&
    ((typeof owner.application === 'string' &&
      /^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(owner.application) &&
      !(SDK_APPLICATIONS as readonly string[]).includes(owner.application)) ||
      (workflow === 'native'
        ? owner.application === 'native'
        : owner.application === 'classic-full' ||
          owner.application === 'classic-hotfix' ||
          owner.application === 'classic-tweak'));
  if (!validCommon || (!validCompat && !validSdk)) {
    throw new Error(`Invalid change runtime owner for ${workflow}/${change}`);
  }
  return owner as unknown as ChangeRuntimeOwner;
}

async function readOwnerFile(
  root: string,
  reference: string,
  workflow: CometProjectWorkflow,
  change: string,
): Promise<ChangeRuntimeOwner | null> {
  let bytes: Buffer;
  try {
    ({ bytes } = await readProtectedProjectFile(root, reference, 16 * 1024, {
      label: 'change runtime owner',
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error(`Invalid change runtime owner JSON for ${workflow}/${change}`);
  }
  return parseOwner(value, workflow, change);
}

const PARTITION_TOKEN_REF = '.change-owner-partitions.json';
const PARTITION_TOKEN_SCHEMA = 'comet.change-owner-partitions.v1';
interface PartitionToken {
  schema: typeof PARTITION_TOKEN_SCHEMA;
  token: string;
  state: 'writing' | 'stable';
}

async function readPartitionToken(root: string): Promise<PartitionToken | null> {
  return runWithoutHookReadCache(async () => {
    let bytes: Buffer;
    try {
      ({ bytes } = await readProtectedProjectFile(root, PARTITION_TOKEN_REF, 1024, {
        label: 'change owner partition token',
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    let value: PartitionToken;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as PartitionToken;
    } catch {
      throw new Error('Invalid change owner partition token');
    }
    if (
      !value ||
      Object.keys(value).length !== 3 ||
      value.schema !== PARTITION_TOKEN_SCHEMA ||
      typeof value.token !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value.token) ||
      (value.state !== 'writing' && value.state !== 'stable')
    )
      throw new Error('Invalid change owner partition token');
    return value;
  });
}

interface OwnerReadBatch {
  roots: ReadonlySet<string>;
  runtimeRoots: Map<string, string[]>;
  owners: Map<string, SdkChangeOwner | null>;
  projects: Set<string>;
  active: boolean;
}
const ownerReadBatches = new AsyncLocalStorage<OwnerReadBatch | null>();

// 仅在已有请求缓存作用域内保存通过整批代次校验的结果；无作用域时每次返回新 Map。
const verifiedOwnerBatchResults = memoizedHookReadSync(
  'verifiedOwnerBatchResults',
  () => new Map<string, SdkChangeOwner | null | Promise<SdkChangeOwner | null>>(),
);
const sdkOwnerKey = (projectRoot: string, workflow: CometProjectWorkflow, change: string) =>
  `${JSON.stringify([projectRoot, workflow])}\u0000${change}`;

async function ownerRuntimeRoots(projectRoot: string): Promise<string[]> {
  const batch = ownerReadBatches.getStore();
  const known = batch?.active ? batch.runtimeRoots.get(projectRoot) : undefined;
  return known ?? readOnlyRuntimeRoots(projectRoot);
}

async function withStableOwnerPartitions<T>(
  roots: readonly string[],
  read: () => Promise<T>,
  freshReadBatch = false,
): Promise<T> {
  const inherited = ownerReadBatches.getStore();
  if (inherited?.active && roots.every((root) => inherited.roots.has(root))) return read();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await Promise.all(roots.map(readPartitionToken));
    if (before.some((token) => token?.state === 'writing'))
      throw new Error(
        'Change owner partition move is incomplete or in progress; use explicit Doctor recovery',
      );
    const batch: OwnerReadBatch = {
      roots: new Set(roots),
      runtimeRoots: new Map(),
      owners: new Map(),
      projects: new Set(),
      active: true,
    };
    let result: PromiseSettledResult<T>;
    try {
      const attemptRead = async (): Promise<PromiseSettledResult<T>> => {
        try {
          return { status: 'fulfilled', value: await read() };
        } catch (reason) {
          return { status: 'rejected', reason };
        }
      };
      result = await ownerReadBatches.run(batch, () =>
        runWithoutHookReadCache(() =>
          freshReadBatch ? runWithHookReadCache(attemptRead) : attemptRead(),
        ),
      );
    } finally {
      batch.active = false;
    }
    // 批量读取会收齐所有 worker，之后才验证代次；重试不会继承上次正文缓存。
    const after = await Promise.all(roots.map(readPartitionToken));
    if (
      after.every(
        (token, index) => token?.state !== 'writing' && token?.token === before[index]?.token,
      )
    ) {
      if (result.status === 'rejected') throw result.reason;
      const published = verifiedOwnerBatchResults();
      // 新快照发布前移除同项目旧命中，删除或转 compat 的 owner 不能借旧缓存复活。
      for (const key of published.keys()) {
        if ([...batch.projects].some((project) => key.startsWith(`${project}\u0000`)))
          published.delete(key);
      }
      for (const [key, owner] of batch.owners) published.set(key, owner);
      return result.value;
    }
  }
  throw new Error(
    'Change owner partitions changed during discovery; retry after the writer completes',
  );
}

async function readPartitionedOwner(
  root: string,
  workflow: CometProjectWorkflow,
  change: string,
): Promise<ChangeRuntimeOwner | null> {
  return withStableOwnerPartitions([root], async () => {
    const active = await readOwnerFile(root, ownerRef(workflow, change), workflow, change);
    const history = await readOwnerFile(
      root,
      ownerRef(workflow, change, 'history'),
      workflow,
      change,
    );
    if (active && history)
      throw new Error(`Conflicting active and history Runtime owners for ${workflow}/${change}`);
    return active ?? history;
  });
}

export async function readChangeRuntimeOwner(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  change: string,
  options: { readOnly?: boolean } = {},
): Promise<ChangeRuntimeOwner | null> {
  ownerRef(workflow, change);
  if (!options.readOnly) {
    return ownerReadBatches.run(null, () =>
      runWithoutHookReadCache(async () =>
        readPartitionedOwner(await resolveWorkspaceRuntimeRoot(projectRoot), workflow, change),
      ),
    );
  }
  const [runtimeRoot, legacyRoot] = await ownerRuntimeRoots(projectRoot);
  const volume = path.parse(runtimeRoot).root;
  const home = await inspectProtectedProjectPath(
    volume,
    path.relative(volume, runtimeRoot).replaceAll('\\', '/'),
    {
      label: 'read-only workspace Runtime',
      expected: 'directory',
    },
  );
  const current = home.exists ? await readPartitionedOwner(runtimeRoot, workflow, change) : null;
  const legacy = legacyRoot ? await readPartitionedOwner(legacyRoot, workflow, change) : null;
  // fence 只用于阻断旧路径；绝不跟随其中记录的外部工作区或目标目录。
  if (
    current &&
    legacy &&
    JSON.stringify(Object.entries(current).sort()) !== JSON.stringify(Object.entries(legacy).sort())
  ) {
    throw new Error(`Conflicting current and legacy Runtime owners for ${workflow}/${change}`);
  }
  return current ?? legacy;
}

async function readSdkChangeOwnerUncached(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  change: string,
  options: { readOnly?: boolean } = {},
): Promise<SdkChangeOwner | null> {
  const owner = await readChangeRuntimeOwner(projectRoot, workflow, change, options);
  const sdk = owner?.format === 'sdk' ? owner : null;
  const batch = ownerReadBatches.getStore();
  if (options.readOnly && batch?.active)
    batch.owners.set(sdkOwnerKey(projectRoot, workflow, change), sdk);
  return sdk;
}

export async function readSdkChangeOwner(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  change: string,
  options: { readOnly?: boolean } = {},
): Promise<SdkChangeOwner | null> {
  if (!options.readOnly || ownerReadBatches.getStore()?.active)
    return readSdkChangeOwnerUncached(projectRoot, workflow, change, options);
  const published = verifiedOwnerBatchResults();
  const key = sdkOwnerKey(projectRoot, workflow, change);
  if (published.has(key)) return published.get(key)!;
  const pending = readSdkChangeOwnerUncached(projectRoot, workflow, change, options).catch(
    (error) => {
      if (published.get(key) === pending) published.delete(key);
      throw error;
    },
  );
  published.set(key, pending);
  return pending;
}

/** 只读验证给定名字；逐项保留错误，不扩展到未请求的历史身份。 */
export async function readSdkChangeOwners(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  names: readonly string[],
): Promise<Map<string, PromiseSettledResult<SdkChangeOwner | null>>> {
  const requested = [...new Set(names)];
  const published = verifiedOwnerBatchResults();
  for (const name of requested) published.delete(sdkOwnerKey(projectRoot, workflow, name));
  if (requested.length === 0) return new Map();
  try {
    const roots = await ownerRuntimeRoots(projectRoot);
    return await withStableOwnerPartitions(
      roots,
      async () => {
        ownerReadBatches.getStore()?.runtimeRoots.set(projectRoot, roots);
        const results = new Array<PromiseSettledResult<SdkChangeOwner | null>>(requested.length);
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(8, requested.length) }, async () => {
            for (;;) {
              const index = next++;
              if (index >= requested.length) return;
              try {
                results[index] = {
                  status: 'fulfilled',
                  value: await readSdkChangeOwner(projectRoot, workflow, requested[index], {
                    readOnly: true,
                  }),
                };
              } catch (reason) {
                results[index] = { status: 'rejected', reason };
              }
            }
          }),
        );
        return new Map(requested.map((name, index) => [name, results[index]]));
      },
      true,
    );
  } catch (reason) {
    return new Map(requested.map((name) => [name, { status: 'rejected', reason }]));
  }
}

/** 只检查调用方发现的身份；只读回调与分区校验共享稳定代次，回调不得写入。 */
export async function inspectSdkChangeOwnerPartitions<T>(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  names: readonly string[],
  inspect: (owner: ChangeRuntimeOwner | null, partition: OwnerPartition | null) => Promise<T>,
): Promise<Map<string, PromiseSettledResult<T>>> {
  const requested = [...new Set(names)];
  if (requested.length === 0) return new Map();
  try {
    const roots = await ownerRuntimeRoots(projectRoot);
    return await withStableOwnerPartitions(
      roots,
      async () => {
        ownerReadBatches.getStore()?.runtimeRoots.set(projectRoot, roots);
        for (const root of roots) {
          const volume = path.parse(root).root;
          await inspectProtectedProjectPath(
            volume,
            path.relative(volume, root).replaceAll('\\', '/'),
            {
              label: 'read-only workspace Runtime',
              expected: 'directory',
            },
          );
        }
        const results = new Array<PromiseSettledResult<T>>(requested.length);
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(8, requested.length) }, async () => {
            for (;;) {
              const index = next++;
              if (index >= requested.length) return;
              const name = requested[index];
              try {
                let owner: ChangeRuntimeOwner | null = null;
                let partition: OwnerPartition | null = null;
                for (const root of roots) {
                  const active = await readOwnerFile(
                    root,
                    ownerRef(workflow, name),
                    workflow,
                    name,
                  );
                  const history = await readOwnerFile(
                    root,
                    ownerRef(workflow, name, 'history'),
                    workflow,
                    name,
                  );
                  if (active && history)
                    throw new Error(
                      `Conflicting active and history Runtime owners for ${workflow}/${name}`,
                    );
                  const found = active ?? history;
                  const foundPartition = active ? 'active' : history ? 'history' : null;
                  if (found && owner && (!sameOwner(found, owner) || partition !== foundPartition))
                    throw new Error(
                      `Conflicting current and legacy Runtime owners for ${workflow}/${name}`,
                    );
                  if (found) {
                    owner = found;
                    partition = foundPartition;
                  }
                }
                results[index] = { status: 'fulfilled', value: await inspect(owner, partition) };
              } catch (reason) {
                results[index] = { status: 'rejected', reason };
              }
            }
          }),
        );
        return new Map(requested.map((name, index) => [name, results[index]]));
      },
      true,
    );
  } catch (reason) {
    return new Map(requested.map((name) => [name, { status: 'rejected', reason }]));
  }
}

async function discoverOwnerPartitions(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  options: { readOnly?: boolean },
  recovery = false,
): Promise<{ active: Set<string>; history: Set<string> }> {
  ownerRef(workflow, 'validate');
  const roots = options.readOnly
    ? await ownerRuntimeRoots(projectRoot)
    : [await resolveWorkspaceRuntimeRoot(projectRoot)];
  const discover = async () => {
    const discovered = { active: new Set<string>(), history: new Set<string>() };
    for (const runtimeRoot of roots) {
      for (const partition of ['active', 'history'] as const) {
        const volume = path.parse(runtimeRoot).root;
        const relative = path.posix.dirname(ownerRef(workflow, 'validate', partition));
        const directory = await inspectProtectedProjectPath(
          volume,
          path.relative(volume, path.join(runtimeRoot, relative)).replaceAll('\\', '/'),
          { label: `${workflow} ${partition} change runtime owners`, expected: 'directory' },
        );
        if (!directory.exists) continue;
        const entries = await fs.readdir(directory.target, { withFileTypes: true });
        for (const entry of entries) {
          if (
            entry.isFile() &&
            /^\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/u.test(
              entry.name,
            )
          )
            continue;
          // Classic 的既有所有权锁与协调目录位于 active owner 同目录。
          if (workflow === 'classic' && partition === 'active') {
            const lock =
              /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.lock(?:\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:tmp|removed))?$/u;
            if (entry.isFile() && lock.test(entry.name)) continue;
            if (
              entry.isDirectory() &&
              /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.lock\.contenders$/u.test(entry.name)
            )
              continue;
          }
          if (!entry.name.endsWith('.json')) {
            throw new Error(`Invalid ${workflow} change runtime owner entry: ${entry.name}`);
          }
          const name = entry.name.slice(0, -'.json'.length);
          if (!entry.isFile() || !NAME_PATTERN.test(name))
            throw new Error(`Invalid ${workflow} change runtime owner entry: ${entry.name}`);
          discovered[partition].add(name);
        }
      }
    }
    return discovered;
  };
  return recovery ? discover() : withStableOwnerPartitions(roots, discover);
}

const cachedOwnerPartitions = memoizedHookRead('changeOwnerPartitions', discoverOwnerPartitions);

async function ownerPartitions(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  options: { readOnly?: boolean },
) {
  return options.readOnly
    ? cachedOwnerPartitions(projectRoot, workflow, options)
    : discoverOwnerPartitions(projectRoot, workflow, options);
}

export async function listSdkChangeNames(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  options: SdkChangeDiscoveryOptions = {},
): Promise<string[]> {
  const roots = options.readOnly
    ? await ownerRuntimeRoots(projectRoot)
    : [await resolveWorkspaceRuntimeRoot(projectRoot)];
  return withStableOwnerPartitions(
    roots,
    async () => {
      if (options.readOnly) ownerReadBatches.getStore()?.runtimeRoots.set(projectRoot, roots);
      ownerReadBatches.getStore()?.projects.add(JSON.stringify([projectRoot, workflow]));
      const partitions = await ownerPartitions(projectRoot, workflow, {
        readOnly: options.readOnly,
      });
      // history 仅提供已封存身份的名字集合；正文由显式读取、全量查询与 Doctor 校验。
      if (options.partition === 'history')
        return [...partitions.history]
          .filter((name) => !partitions.active.has(name))
          .sort((a, b) => a.localeCompare(b, 'en'));
      const discovered =
        options.partition === 'active'
          ? partitions.active
          : new Set([...partitions.active, ...partitions.history]);
      const candidates = [...discovered];
      const results = new Array<PromiseSettledResult<string | null>>(candidates.length);
      let next = 0;
      // 每条 owner 仍完整读取并校验；收齐结果后按原枚举顺序抛错。
      await Promise.all(
        Array.from({ length: Math.min(options.readOnly ? 8 : 1, candidates.length) }, async () => {
          for (;;) {
            const index = next++;
            if (index >= candidates.length) return;
            const name = candidates[index];
            try {
              const owner = await readSdkChangeOwner(projectRoot, workflow, name, options);
              if (!owner && !(await readChangeRuntimeOwner(projectRoot, workflow, name, options)))
                throw new Error(`${workflow} change runtime owner disappeared: ${name}`);
              results[index] = { status: 'fulfilled', value: owner ? name : null };
            } catch (reason) {
              results[index] = { status: 'rejected', reason };
            }
          }
        }),
      );
      const names: string[] = [];
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason;
        if (result.value) names.push(result.value);
      }
      return names.sort((left, right) => left.localeCompare(right, 'en'));
    },
    options.readOnly === true,
  );
}

export async function listSdkChangePartitions(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  options: { readOnly?: boolean } = {},
): Promise<{ active: string[]; history: string[] }> {
  const roots = options.readOnly
    ? await ownerRuntimeRoots(projectRoot)
    : [await resolveWorkspaceRuntimeRoot(projectRoot)];
  return withStableOwnerPartitions(
    roots,
    async () => {
      if (options.readOnly) ownerReadBatches.getStore()?.runtimeRoots.set(projectRoot, roots);
      ownerReadBatches.getStore()?.projects.add(JSON.stringify([projectRoot, workflow]));
      const active = await listSdkChangeNames(projectRoot, workflow, {
        ...options,
        partition: 'active',
      });
      const history = await listSdkChangeNames(projectRoot, workflow, {
        ...options,
        partition: 'history',
      });
      return { active, history };
    },
    options.readOnly === true,
  );
}

function sameOwner(left: ChangeRuntimeOwner, right: ChangeRuntimeOwner): boolean {
  return (
    JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort())
  );
}

async function withOwnerLock<T>(
  projectRoot: string,
  owner: Pick<ChangeRuntimeOwner, 'workflow' | 'change'>,
  work: (runtimeRoot: string) => Promise<T>,
): Promise<T> {
  invalidateHookReadCache();
  return ownerReadBatches.run(null, () =>
    runWithoutHookReadCache(async () => {
      const runtimeRoot = await resolveWorkspaceRuntimeRoot(projectRoot);
      ownerRef(owner.workflow, owner.change);
      return withRecoverableFileLock(
        path.join(runtimeRoot, '.change-owner-partitions.lock'),
        async () => {
          // 旧 token 可以为 writing：持锁已证明旧写入者不再运行；只有显式写入口可恢复。
          await readPartitionToken(runtimeRoot);
          const token: PartitionToken = {
            schema: PARTITION_TOKEN_SCHEMA,
            token: randomUUID(),
            state: 'writing',
          };
          const publish = () =>
            atomicWriteContainedText(
              path.join(runtimeRoot, PARTITION_TOKEN_REF),
              `${JSON.stringify(token)}\n`,
              { containedRoot: runtimeRoot },
            );
          await publish();
          try {
            return await work(runtimeRoot);
          } finally {
            token.state = 'stable';
            await publish();
          }
        },
      );
    }),
  );
}

async function moveSdkChangeOwner(
  projectRoot: string,
  owner: SdkChangeOwner,
  destination: OwnerPartition,
): Promise<void> {
  const validated = parseOwner(owner, owner.workflow, owner.change);
  if (
    validated.format !== 'sdk' ||
    validated.workflow !== 'native' ||
    validated.application !== 'native'
  ) {
    throw new Error('Only builtin Native owners can enter or leave history');
  }
  await withOwnerLock(projectRoot, validated, (runtimeRoot) =>
    moveOwnerWithinLock(runtimeRoot, validated, destination),
  );
}

async function syncOwnerDirectoryChain(runtimeRoot: string, reference: string): Promise<void> {
  const segments = path.posix.dirname(reference).split('/');
  for (let length = segments.length; length >= 0; length -= 1) {
    const directory = path.join(runtimeRoot, ...segments.slice(0, length));
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(directory, 'r');
      await handle.sync();
    } catch (error) {
      // 与既有 contained writer 一致：部分平台/文件系统不支持目录 fsync。
      if (
        !['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        throw error;
    } finally {
      await handle?.close();
    }
  }
}

async function moveOwnerWithinLock(
  runtimeRoot: string,
  owner: SdkChangeOwner,
  destination: OwnerPartition,
): Promise<void> {
  const validated = owner;
  const source: OwnerPartition = destination === 'history' ? 'active' : 'history';
  const sourceRef = ownerRef(owner.workflow, owner.change, source);
  const targetRef = ownerRef(owner.workflow, owner.change, destination);
  const from = await readOwnerFile(runtimeRoot, sourceRef, owner.workflow, owner.change);
  const to = await readOwnerFile(runtimeRoot, targetRef, owner.workflow, owner.change);
  if (
    (!from && !to) ||
    (from && !sameOwner(from, validated)) ||
    (to && !sameOwner(to, validated))
  ) {
    throw new Error(`Change runtime owner identity changed for ${owner.workflow}/${owner.change}`);
  }
  if (!to) {
    await ensureProtectedProjectDirectory(runtimeRoot, path.posix.dirname(targetRef), {
      label: 'change runtime owner directory',
    });
    await atomicWriteContainedText(
      path.join(runtimeRoot, targetRef),
      `${JSON.stringify(validated)}\n`,
      {
        containedRoot: runtimeRoot,
        exclusive: true,
        requireAtomicPublication: true,
      },
    );
  }
  // 删除来源前持久化新建目录链，避免目标祖先目录项尚未落盘。
  await syncOwnerDirectoryChain(runtimeRoot, targetRef);
  if (from) {
    // 先发布目标再删除来源；中断留下双份时，active 仍可见，普通读取明确报冲突。
    await removeContainedFile(path.join(runtimeRoot, sourceRef), {
      containedRoot: runtimeRoot,
      beforeRemove: async () => {
        const current = await readOwnerFile(runtimeRoot, sourceRef, owner.workflow, owner.change);
        const published = await readOwnerFile(runtimeRoot, targetRef, owner.workflow, owner.change);
        if (
          !current ||
          !published ||
          !sameOwner(current, validated) ||
          !sameOwner(published, validated)
        )
          throw new Error('Change runtime owner changed during partition move');
      },
    });
  }
}

/** 调用方须先完整验证 Native 收尾，确认 Store 已成功关闭此 Run。 */
export async function closeSdkChangeOwner(
  projectRoot: string,
  owner: SdkChangeOwner,
): Promise<void> {
  await moveSdkChangeOwner(projectRoot, owner, 'history');
}

/** 必须先恢复 active 身份，再调用 Store 的重新打开入口。 */
export async function reopenSdkChangeOwner(
  projectRoot: string,
  owner: SdkChangeOwner,
): Promise<void> {
  await moveSdkChangeOwner(projectRoot, owner, 'active');
}

/** 仅供显式恢复枚举，不证明身份有效，也不能用于 Hook 排除历史。 */
export async function listSdkChangeOwnerRecoveryNames(
  projectRoot: string,
  workflow: CometProjectWorkflow,
): Promise<string[]> {
  return withOwnerLock(projectRoot, { workflow, change: 'partition-recovery' }, async () => {
    const partitions = await discoverOwnerPartitions(projectRoot, workflow, {}, true);
    return [...new Set([...partitions.active, ...partitions.history])].sort((a, b) =>
      a.localeCompare(b, 'en'),
    );
  });
}

/** 不依赖普通读取，允许在中断 token 或相同双份 owner 下保守恢复 active 身份。 */
export async function recoverSdkChangeOwnerToActive(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  change: string,
): Promise<ChangeRuntimeOwner> {
  return withOwnerLock(projectRoot, { workflow, change }, async (runtimeRoot) => {
    const active = await readOwnerFile(runtimeRoot, ownerRef(workflow, change), workflow, change);
    const history = await readOwnerFile(
      runtimeRoot,
      ownerRef(workflow, change, 'history'),
      workflow,
      change,
    );
    if (active && history && !sameOwner(active, history))
      throw new Error(`Conflicting active and history Runtime owners for ${workflow}/${change}`);
    const owner = active ?? history;
    if (active && !history && (active.format !== 'sdk' || active.application !== 'native'))
      return active;
    if (
      !owner ||
      owner.format !== 'sdk' ||
      owner.workflow !== 'native' ||
      owner.application !== 'native'
    )
      throw new Error('Only builtin Native owners can be recovered from history');
    await moveOwnerWithinLock(runtimeRoot, owner, 'active');
    return owner;
  });
}

async function registerChangeRuntimeOwner<T extends ChangeRuntimeOwner>(
  projectRoot: string,
  owner: T,
): Promise<T> {
  const ref = ownerRef(owner.workflow, owner.change);
  const validated = parseOwner(owner, owner.workflow, owner.change) as T;
  return withOwnerLock(projectRoot, validated, async (runtimeRoot) => {
    const history = await readOwnerFile(
      runtimeRoot,
      ownerRef(owner.workflow, owner.change, 'history'),
      owner.workflow,
      owner.change,
    );
    if (history)
      throw new Error(
        `Change ${owner.workflow}/${owner.change} is in history; restore its active owner before registering`,
      );
    await ensureProtectedProjectDirectory(runtimeRoot, path.posix.dirname(ref), {
      label: 'change runtime owner directory',
    });
    try {
      await atomicWriteContainedText(
        path.join(runtimeRoot, ...ref.split('/')),
        `${JSON.stringify(validated)}\n`,
        {
          containedRoot: runtimeRoot,
          exclusive: true,
          requireAtomicPublication: true,
        },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = await readOwnerFile(runtimeRoot, ref, owner.workflow, owner.change);
      if (JSON.stringify(current) !== JSON.stringify(validated)) {
        throw new Error(
          `Change ${owner.workflow}/${owner.change} is already bound to another Runtime`,
          { cause: error },
        );
      }
    }
    return validated;
  });
}

export function registerSdkChangeOwner(
  projectRoot: string,
  owner: SdkChangeOwner,
): Promise<SdkChangeOwner> {
  return registerChangeRuntimeOwner(projectRoot, owner);
}

export function registerCompatChangeOwner(
  projectRoot: string,
  owner: CompatChangeOwner,
): Promise<CompatChangeOwner> {
  return registerChangeRuntimeOwner(projectRoot, owner);
}

export async function assertChangeNotSdkOwned(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  change: string,
): Promise<void> {
  const owner = await readSdkChangeOwner(projectRoot, workflow, change);
  if (owner) {
    throw new Error(
      `Change ${workflow}/${change} belongs to SDK Run ${owner.runId}; use its SDK application`,
    );
  }
}
