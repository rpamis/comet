import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import {
  createFileRuntimeStore,
  type FileRuntimeStoreOptions,
  type RuntimeRecord,
} from './runtime-store.js';
import { RuntimeProtocolError } from './runtime-errors.js';

export interface FileRuntimeStoreRun<T extends RuntimeRecord> {
  storageKey: string;
  runId: string | null;
  record: T | null;
  error: { code: string; message: string } | null;
}

export interface FileRuntimeStoreRunSource {
  storageKey: string;
  runId: string | null;
  fingerprint: string;
  error: { code: string; message: string } | null;
}

/** 只枚举稳定身份键；不打开未选中的记录，保留异常项目供调用者呈现。 */
export async function listFileRuntimeStoreRunKeys(
  options: FileRuntimeStoreOptions,
): Promise<string[]> {
  const root = path.resolve(options.rootDir);
  const volume = path.parse(root).root;
  const rootRef = path.relative(volume, root).replaceAll('\\', '/');
  if (!rootRef)
    throw new RuntimeProtocolError('STORE_INVALID_ROOT', 'rootDir 不能是文件系统根目录');
  if (
    !(
      await inspectProtectedProjectPath(volume, rootRef, {
        label: 'RuntimeStore discovery',
        expected: 'directory',
      })
    ).exists
  )
    return [];
  const keys: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (
      /^\.[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/u.test(entry.name) &&
      entry.isFile() &&
      !entry.isSymbolicLink()
    )
      continue;
    if (entry.name === '.runtime-store-coordination') continue;
    if (['.runtime-store-v2', '.runtime-store-history'].includes(entry.name)) {
      const partition = await inspectProtectedProjectPath(root, entry.name, {
        label: 'RuntimeStore checkpoint directory',
        expected: 'directory',
      });
      // checkpoint 发布早于 marker；中断或 marker 丢失不能让一个持有者从发现中消失。
      // 缺少顶层身份的分区项目由后续发现返回错误，不猜测或静默跳过。
      for (const child of await fs.readdir(partition.target)) keys.push(child);
      continue;
    }
    keys.push(entry.name);
  }
  return [...new Set(keys)].sort((a, b) => a.localeCompare(b));
}

/** 只读取调用者选中的身份；选中前只枚举目录名称。 */
async function discoverFileRuntimeStoreRunSources(
  options: FileRuntimeStoreOptions,
  withFingerprint: boolean,
  storageKeys?: readonly string[],
  excludeClosed = false,
): Promise<FileRuntimeStoreRunSource[]> {
  const root = path.resolve(options.rootDir);
  const available = storageKeys
    ? [...new Set(storageKeys)].filter(
        (key) => key && key !== '.' && key !== '..' && !key.includes('/') && !key.includes('\\'),
      )
    : await listFileRuntimeStoreRunKeys(options);
  const selected = storageKeys ? new Set(storageKeys) : null;
  const result: FileRuntimeStoreRunSource[] = [];
  const stamp = async (ref: string) => {
    const inspection = await inspectProtectedProjectPath(root, ref, {
      label: 'RuntimeStore source',
      expected: 'file',
    });
    if (!inspection.exists) return null;
    const stat = await fs.lstat(inspection.target);
    return [ref, stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino, stat.dev];
  };
  const json = async (ref: string) =>
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        (
          await readProtectedProjectFile(root, ref, Number.MAX_SAFE_INTEGER, {
            label: 'RuntimeStore discovery record',
          })
        ).bytes,
      ),
    );
  const concurrency = excludeClosed ? 8 : 1;
  for (let offset = 0; offset < available.length; offset += concurrency) {
    await Promise.all(
      available.slice(offset, offset + concurrency).map(async (name) => {
        if (selected && !selected.has(name)) return;
        const stat = await fs.lstat(path.join(root, name)).catch(() => null);
        const entry = {
          name,
          isFile: () => stat?.isFile(),
          isDirectory: () => stat?.isDirectory(),
          isSymbolicLink: () => stat?.isSymbolicLink(),
        };
        let runId: string | null = null;
        let closed = false;
        try {
          if (!/^[a-f0-9]{64}$/u.test(entry.name) || entry.isSymbolicLink())
            throw new RuntimeProtocolError('STORE_INVALID_ENTRY', 'RuntimeStore 目录含异常项目');
          let identity: unknown;
          if (entry.isFile()) {
            const marker = await json(entry.name);
            if (
              !['comet.runtime-store-format.v2', 'comet.runtime-store-format.v3'].includes(
                marker.schema,
              )
            )
              throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', 'RuntimeStore 格式标记无效');
            identity = marker.runId;
            if (
              excludeClosed &&
              marker.schema === 'comet.runtime-store-format.v3' &&
              marker.state === 'closed'
            ) {
              if (
                !Number.isSafeInteger(marker.revision) ||
                marker.revision < 1 ||
                typeof marker.recordHash !== 'string' ||
                !/^[a-f0-9]{64}$/u.test(marker.recordHash) ||
                Object.keys(marker).some(
                  (key) =>
                    ![
                      'schema',
                      'runId',
                      'state',
                      'revision',
                      'recordHash',
                      'writerProtocol',
                    ].includes(key),
                )
              )
                throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', 'RuntimeStore 历史标记损坏');
              const active = await inspectProtectedProjectPath(
                root,
                `.runtime-store-v2/${entry.name}/checkpoint.json`,
                {
                  label: 'RuntimeStore 活动 checkpoint',
                  expected: 'file',
                },
              );
              const history = await inspectProtectedProjectPath(
                root,
                `.runtime-store-history/${entry.name}/checkpoint.json`,
                {
                  label: 'RuntimeStore 历史 checkpoint',
                  expected: 'file',
                },
              );
              if (active.exists || !history.exists)
                throw new RuntimeProtocolError(
                  'STORE_HISTORY_CONFLICT',
                  '历史分区与存储事务不一致',
                );
              closed = true;
            }
          } else if (entry.isDirectory()) {
            await inspectProtectedProjectPath(root, entry.name, {
              label: 'RuntimeStore legacy directory',
              expected: 'directory',
            });
            const names = (await fs.readdir(path.join(root, entry.name)))
              .filter((n) => /^[0-9]{16}\.json$/u.test(n))
              .sort();
            if (!names.length)
              throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', 'RuntimeStore 旧记录缺少版本');
            const latest = await json(`${entry.name}/${names.at(-1)}`);
            identity =
              latest.schema === 'comet.runtime-store-checkpoint.v1'
                ? latest.record?.runId
                : latest.runId;
          } else throw new RuntimeProtocolError('STORE_INVALID_ENTRY', 'RuntimeStore 项目类型无效');
          if (
            typeof identity !== 'string' ||
            !identity.trim() ||
            createHash('sha256').update(JSON.stringify(identity)).digest('hex') !== entry.name
          )
            throw new RuntimeProtocolError(
              'STORE_CORRUPT_RECORD',
              'RuntimeStore 记录身份与目录不匹配',
            );
          runId = identity;
          if (closed) return;
          const refs = !withFingerprint
            ? []
            : entry.isFile()
              ? [
                  entry.name,
                  `.runtime-store-v2/${entry.name}/checkpoint.json`,
                  `.runtime-store-history/${entry.name}/checkpoint.json`,
                ]
              : (await fs.readdir(path.join(root, entry.name)))
                  .filter((name) => /^[0-9]{16}\.json$/u.test(name))
                  .sort()
                  .map((name) => `${entry.name}/${name}`);
          const fingerprint = createHash('sha256')
            .update(JSON.stringify(await Promise.all(refs.map(stamp))))
            .digest('hex');
          result.push({ storageKey: entry.name, runId, fingerprint, error: null });
        } catch (error) {
          result.push({
            storageKey: entry.name,
            runId,
            fingerprint: JSON.stringify(
              await fs
                .lstat(path.join(root, entry.name))
                .then((stat) => [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino])
                .catch(() => null),
            ),
            error: {
              code: error instanceof RuntimeProtocolError ? error.code : 'STORE_UNREADABLE',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }),
    );
  }
  return result.sort((left, right) => left.storageKey.localeCompare(right.storageKey));
}

/**
 * 默认通过权威 Store 完整验证每条 Run。excludeClosed 仅供资源发现：调用方承诺
 * closeRun 前验证业务静止；封存正文留给显式 inspect 校验，未完成封存仍完整读取。
 */
export async function listFileRuntimeStoreRuns<T extends RuntimeRecord = RuntimeRecord>(
  options: FileRuntimeStoreOptions,
  discovery: { excludeClosed?: boolean } = {},
): Promise<FileRuntimeStoreRun<T>[]> {
  const store = createFileRuntimeStore<T>(options);
  const result: FileRuntimeStoreRun<T>[] = [];
  for (const source of await discoverFileRuntimeStoreRunSources(
    options,
    false,
    undefined,
    discovery.excludeClosed,
  )) {
    const identity = { storageKey: source.storageKey, runId: source.runId, error: source.error };
    if (source.error || !source.runId) {
      result.push({ ...identity, record: null });
      continue;
    }
    try {
      const record = await store.read(source.runId);
      if (!record)
        throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', 'RuntimeStore 当前记录缺失');
      result.push({ ...identity, record });
    } catch (error) {
      result.push({
        ...identity,
        record: null,
        error: {
          code: error instanceof RuntimeProtocolError ? error.code : 'STORE_UNREADABLE',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return result;
}

export async function listFileRuntimeStoreRunSources(
  options: FileRuntimeStoreOptions,
): Promise<FileRuntimeStoreRunSource[]> {
  return discoverFileRuntimeStoreRunSources(options, true);
}

/** 调用内分页只返回身份，不提供变化指纹；需要指纹时使用 listFileRuntimeStoreRunSources。 */
export async function readFileRuntimeStoreRunSources(
  options: FileRuntimeStoreOptions,
  storageKeys: readonly string[],
): Promise<Omit<FileRuntimeStoreRunSource, 'fingerprint'>[]> {
  const sources = await discoverFileRuntimeStoreRunSources(options, false, storageKeys);
  return sources.map(({ storageKey, runId, error }) => ({ storageKey, runId, error }));
}

/** 按需发现；每次 next 只解析一个来源，不预读整个目录或 Run 正文。 */
export async function* iterateFileRuntimeStoreRunSources(
  options: FileRuntimeStoreOptions,
): AsyncGenerator<FileRuntimeStoreRunSource> {
  const root = path.resolve(options.rootDir);
  const volume = path.parse(root).root;
  const relative = path.relative(volume, root).replaceAll('\\', '/');
  if (!relative)
    throw new RuntimeProtocolError('STORE_INVALID_ROOT', 'rootDir 不能是文件系统根目录');
  if (
    !(
      await inspectProtectedProjectPath(volume, relative, {
        label: 'RuntimeStore discovery',
        expected: 'directory',
      })
    ).exists
  )
    return;
  const seen = new Set<string>();
  for (const ref of ['', '.runtime-store-v2', '.runtime-store-history']) {
    if (
      ref &&
      !(
        await inspectProtectedProjectPath(root, ref, {
          label: 'RuntimeStore partition',
          expected: 'directory',
        })
      ).exists
    )
      continue;
    const entries = await fs.opendir(path.join(root, ref));
    for await (const entry of entries) {
      if (
        !ref &&
        (['.runtime-store-v2', '.runtime-store-history', '.runtime-store-coordination'].includes(
          entry.name,
        ) ||
          /^\.[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/u.test(entry.name))
      )
        continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      const [source] = await discoverFileRuntimeStoreRunSources(options, true, [entry.name]);
      if (source) yield source;
    }
  }
}
