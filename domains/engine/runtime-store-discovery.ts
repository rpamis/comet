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

/** 枚举只发现身份；每条记录仍通过原 Store 校验，不迁移、恢复或写入。 */
async function discoverFileRuntimeStoreRunSources(
  options: FileRuntimeStoreOptions,
  withFingerprint: boolean,
): Promise<FileRuntimeStoreRunSource[]> {
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
  for (const entry of (await fs.readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (
      /^\.[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/u.test(entry.name) &&
      entry.isFile() &&
      !entry.isSymbolicLink()
    )
      continue;
    if (['.runtime-store-v2', '.runtime-store-history'].includes(entry.name)) {
      await inspectProtectedProjectPath(root, entry.name, {
        label: 'RuntimeStore checkpoint directory',
        expected: 'directory',
      });
      continue;
    }
    let runId: string | null = null;
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
        throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', 'RuntimeStore 记录身份与目录不匹配');
      runId = identity;
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
  }
  return result;
}

/** Read each discovered Run through the original validating Store. */
export async function listFileRuntimeStoreRuns<T extends RuntimeRecord = RuntimeRecord>(
  options: FileRuntimeStoreOptions,
): Promise<FileRuntimeStoreRun<T>[]> {
  const store = createFileRuntimeStore<T>(options);
  const result: FileRuntimeStoreRun<T>[] = [];
  for (const source of await discoverFileRuntimeStoreRunSources(options, false)) {
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
