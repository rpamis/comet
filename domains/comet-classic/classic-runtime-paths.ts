import { AsyncLocalStorage } from 'node:async_hooks';
import { resolveClassicStateFile } from './classic-state-file.js';
import { promises as fs } from 'node:fs';
import { CLASSIC_CHANGE_ID_PATTERN } from './classic-state.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';
import { withRecoverableFileLock } from '../../platform/fs/plugin-store.js';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import path from 'node:path';

import { discoverClassicProject } from './classic-layout.js';
import {
  migrateWorkspaceRuntimePath,
  ensureWorkspaceRuntimeMigrationFence,
  isWorkspaceRuntimeMigrationFence,
  assertWorkspaceRuntimeMigrationQuiescent,
  resolveWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
} from '../workflow-contract/workspace-runtime.js';

const preparedRuns = new AsyncLocalStorage<Map<string, Promise<string>>>();

export function withClassicRuntimePreparation<T>(work: () => Promise<T>): Promise<T> {
  return preparedRuns.getStore() ? work() : preparedRuns.run(new Map(), work);
}

/** 本机执行记录；handoff、delivery 和正式审计仍随 change 保存。 */
export const CLASSIC_LOCAL_RECORDS = new Set([
  'run-state.json',
  'pending-action.json',
  'trajectory.jsonl',
  'context.md',
  'artifacts.json',
  'checkpoint.json',
  'skill-snapshots',
  'checks',
  'coordination.json',
  'subagent-progress.md',
]);

/** 在发布便携状态前封锁旧版 compat writer；新版状态锁仍按 change_id 隔离。 */
export async function protectClassicLegacyStateWriter(
  changeDir: string,
  projectRoot: string,
  runtimeRoot?: string,
): Promise<void> {
  await resolveClassicStateFile(changeDir);
  const runtime = runtimeRoot ?? (await resolveWorkspaceRuntimeRoot(projectRoot));
  const source = path.join(changeDir, '.comet-state.lock');
  const target = path.join(runtime, 'classic-legacy-state.lock');
  if (await isWorkspaceRuntimeMigrationFence(source)) {
    await ensureWorkspaceRuntimeMigrationFence(source, target, {
      projectRoot,
      ignoreForeignWorkspaceFence: true,
    });
    return;
  }
  for (const local of ['.comet-state-transaction.json', '.comet']) {
    await assertWorkspaceRuntimeMigrationQuiescent(path.join(changeDir, local), { projectRoot });
  }
  await ensureWorkspaceRuntimeMigrationFence(source, target, {
    projectRoot,
    ignoreForeignWorkspaceFence: true,
  });
}

function derivedIdentity(seed: string): string {
  const digest = createHash('sha256').update(seed).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

async function readChangeIdentity(projectRoot: string, changeDir: string) {
  const file = await resolveClassicStateFile(changeDir);
  const relative = path.relative(projectRoot, file).replaceAll('\\', '/');
  let source: string | null = null;
  try {
    source = (
      await readProtectedProjectFile(projectRoot, relative, Number.MAX_SAFE_INTEGER, {
        label: 'Classic change identity',
      })
    ).bytes.toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (source === null)
    throw Object.assign(new Error('Classic state file does not exist'), { code: 'ENOENT' });
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length)
    throw new Error(`Invalid Classic state document: ${document.errors[0].message}`);
  const id = document.get('change_id');
  if (id !== undefined && (typeof id !== 'string' || !CLASSIC_CHANGE_ID_PATTERN.test(id)))
    throw new Error('Invalid Classic change_id: expected an immutable UUID');
  return { source, document, id: id as string | undefined };
}

async function changeIdentity(
  projectRoot: string,
  changeDir: string,
  runtimeRoot: string,
): Promise<string> {
  const file = await resolveClassicStateFile(changeDir);
  const relative = path.relative(projectRoot, file).replaceAll('\\', '/');
  const read = () => readChangeIdentity(projectRoot, changeDir);
  const initial = await read();
  await protectClassicLegacyStateWriter(changeDir, projectRoot, runtimeRoot);
  if (initial.id) return initial.id;
  const lockDir = 'classic-change-identities';
  await ensureProtectedProjectDirectory(runtimeRoot, lockDir, {
    label: 'Classic change identity locks',
  });
  const lock = path.join(
    runtimeRoot,
    lockDir,
    `${createHash('sha256').update(relative).digest('hex')}.lock`,
  );
  return withRecoverableFileLock(lock, async () => {
    const { source, document, id } = await read();
    if (id) return id;
    for (const local of ['.comet-state.lock', '.comet-state-transaction.json', '.comet']) {
      await assertWorkspaceRuntimeMigrationQuiescent(path.join(changeDir, local), { projectRoot });
    }
    const runId = document.get('run_id');
    const next =
      typeof runId === 'string' && runId ? derivedIdentity(`classic-run:${runId}`) : randomUUID();
    // 已封存的旧 YAML 不重写；旧 Run ID 或完整 Archive 路径已是便携稳定身份。
    if (document.get('archived') === true || path.basename(path.dirname(changeDir)) === 'archive')
      return typeof runId === 'string' && runId
        ? next
        : derivedIdentity(`classic-archive:${relative}`);
    document.set('change_id', next);
    await atomicWriteContainedText(file, document.toString(), {
      containedRoot: projectRoot,
      exclusive: source === null,
      beforeCommit: async () => {
        if ((await read()).source !== source)
          throw new Error('Classic state changed while assigning its instance identity');
      },
    });
    return next;
  });
}

async function bindChangeIdentity(
  root: string,
  changeDir: string,
  runtimeRoot: string,
  id: string,
  options: { readOnly?: boolean } = {},
): Promise<void> {
  const directory = 'classic-change-identities';
  if (!options.readOnly) {
    await ensureProtectedProjectDirectory(runtimeRoot, directory, {
      label: 'Classic change identity directory',
    });
  }
  const file = `${directory}/${id}.json`;
  const current = path.relative(root, changeDir).replaceAll('\\', '/') || '.';
  const identityAt = async (ref: string): Promise<string | null> => {
    try {
      const source = (
        await readProtectedProjectFile(
          root,
          path.relative(root, await resolveClassicStateFile(path.join(root, ref))),
          Number.MAX_SAFE_INTEGER,
          { label: 'Classic bound change identity' },
        )
      ).bytes.toString('utf8');
      const document = parseDocument(source, { uniqueKeys: true });
      if (document.errors.length) return null;
      const declared = document.get('change_id');
      if (typeof declared === 'string') return declared;
      const run = document.get('run_id');
      if (typeof run === 'string' && run) return derivedIdentity(`classic-run:${run}`);
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
  const readBinding = async () => {
    let previous: { schema?: unknown; changeId?: unknown; changeDir?: unknown } | null = null;
    try {
      previous = JSON.parse(
        (
          await readProtectedProjectFile(runtimeRoot, file, 64 * 1024, {
            label: 'Classic change identity binding',
          })
        ).bytes.toString('utf8'),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (
      previous &&
      (previous.schema !== 'comet.classic.change-identity.v1' ||
        previous.changeId !== id ||
        typeof previous.changeDir !== 'string')
    )
      throw new Error('Classic change instance binding is invalid');
    return previous;
  };
  if ((await readBinding())?.changeDir === current) return;
  const bind = async () => {
    const previous = await readBinding();
    if (previous) {
      if (
        previous.schema !== 'comet.classic.change-identity.v1' ||
        previous.changeId !== id ||
        typeof previous.changeDir !== 'string'
      )
        throw new Error('Classic change instance binding is invalid');
      if (previous.changeDir === current) return;
      if ((await identityAt(previous.changeDir)) === id)
        throw new Error(
          'Duplicate Classic change_id in this workspace; preserve both changes and assign a separate instance before continuing',
        );
    } else if (current !== '.') {
      const base =
        path.basename(path.dirname(changeDir)) === 'archive'
          ? path.dirname(path.dirname(changeDir))
          : path.dirname(changeDir);
      const roots = new Set([
        base,
        path.join(root, 'openspec', 'changes'),
        path.join(root, 'docs', 'openspec', 'changes'),
      ]);
      for (const candidateRoot of roots) {
        const rootRef = path.relative(root, candidateRoot).replaceAll('\\', '/');
        if (!rootRef || rootRef === '..' || rootRef.startsWith('../')) continue;
        const inspected = await inspectProtectedProjectPath(root, rootRef, {
          label: 'Classic change identity candidates',
          expected: 'directory',
        });
        if (!inspected.exists) continue;
        const candidates: string[] = [];
        for (const entry of await fs.readdir(inspected.target, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const ref = path.posix.join(rootRef, entry.name);
          if (entry.name === 'archive') {
            for (const archived of await fs.readdir(path.join(root, ref), { withFileTypes: true }))
              if (archived.isDirectory()) candidates.push(path.posix.join(ref, archived.name));
          } else candidates.push(ref);
        }
        for (const candidate of candidates)
          if (candidate !== current && (await identityAt(candidate)) === id)
            throw new Error(
              'Duplicate Classic change_id in this workspace; preserve both changes before continuing',
            );
      }
    }
    if (options.readOnly) return;
    await atomicWriteContainedText(
      path.join(runtimeRoot, file),
      JSON.stringify({
        schema: 'comet.classic.change-identity.v1',
        changeId: id,
        changeDir: current,
      }) + '\n',
      { containedRoot: runtimeRoot },
    );
  };
  if (options.readOnly) await bind();
  else await withRecoverableFileLock(path.join(runtimeRoot, directory, `${id}.lock`), bind);
}

/** 只查找已有本机 Run；不分配身份、不绑定路径、不创建 fence，也不搬迁旧文件。 */
export async function resolveClassicRunDirectoryForRead(
  changeDir: string,
  projectRoot?: string,
  options: { includeMissing?: boolean } = {},
): Promise<string | null> {
  const root = projectRoot ?? (await discoverClassicProject(changeDir));
  let saved: Awaited<ReturnType<typeof readChangeIdentity>>;
  try {
    saved = await readChangeIdentity(root, changeDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const { document, id } = saved;
  const relative = path.relative(root, changeDir).replaceAll('\\', '/');
  const runId = document.get('run_id');
  const archived =
    document.get('archived') === true || path.basename(path.dirname(changeDir)) === 'archive';
  const identity =
    id ??
    (typeof runId === 'string' && runId
      ? derivedIdentity(`classic-run:${runId}`)
      : archived
        ? derivedIdentity(`classic-archive:${relative}`)
        : null);
  if (!identity) return changeDir;
  const runtimeRoot = resolveWorkspaceRuntimeRootSync(root);
  const volume = path.parse(runtimeRoot).root;
  if (
    !(
      await inspectProtectedProjectPath(
        volume,
        path.relative(volume, runtimeRoot).replaceAll('\\', '/'),
        {
          label: 'Classic read-only Runtime root',
          expected: 'directory',
        },
      )
    ).exists
  )
    return options.includeMissing ? path.join(runtimeRoot, 'classic-changes', identity) : changeDir;
  const target = await inspectProtectedProjectPath(runtimeRoot, `classic-changes/${identity}`, {
    label: 'Classic read-only Run directory',
    expected: 'directory',
  });
  if (!target.exists) return options.includeMissing ? target.target : changeDir;
  await bindChangeIdentity(root, changeDir, runtimeRoot, identity, { readOnly: true });
  return target.target;
}

export async function resolveClassicRunDirectory(
  changeDir: string,
  projectRoot?: string,
): Promise<string> {
  const root = projectRoot ?? (await discoverClassicProject(changeDir));
  const prepared = preparedRuns.getStore();
  if (!prepared) return prepareClassicRunDirectory(changeDir, root);
  const key = JSON.stringify([resolveWorkspaceRuntimeRootSync(root), path.resolve(changeDir)]);
  let pending = prepared.get(key);
  if (!pending) {
    pending = prepareClassicRunDirectory(changeDir, root);
    prepared.set(key, pending);
    void pending.catch(() => prepared.delete(key));
  }
  return pending;
}

async function prepareClassicRunDirectory(
  changeDir: string,
  projectRoot?: string,
): Promise<string> {
  const root = projectRoot ?? (await discoverClassicProject(changeDir));
  const changeRef = path.relative(root, changeDir).replaceAll('\\', '/');
  if (changeRef) {
    const directory = await inspectProtectedProjectPath(root, changeRef, {
      label: 'Classic change directory',
      expected: 'directory',
    });
    if (!directory.exists)
      throw Object.assign(new Error('Classic change directory does not exist'), { code: 'ENOENT' });
  }
  await resolveClassicStateFile(changeDir);
  const runtimeRoot = await resolveWorkspaceRuntimeRoot(root);
  const identity = await changeIdentity(root, changeDir, runtimeRoot);
  await bindChangeIdentity(root, changeDir, runtimeRoot, identity);
  const target = path.join(runtimeRoot, 'classic-changes', identity);
  await ensureProtectedProjectDirectory(runtimeRoot, path.relative(runtimeRoot, target), {
    label: 'Classic local Run directory',
  });
  for (const relative of [
    '.comet-state-transaction.json',
    ...[...CLASSIC_LOCAL_RECORDS].map((entry) => `.comet/${entry}`),
  ]) {
    const source = path.join(changeDir, relative);
    const destination = path.join(target, relative);
    await migrateWorkspaceRuntimePath(source, destination, {
      projectRoot: root,
      ignoreForeignWorkspaceFence: true,
    });
  }
  return target;
}

/** 只读取受保护的旧/新位置；两个真实来源不能静默择一。 */
export async function selectClassicLocalReadTarget(
  projectRoot: string,
  legacyRoot: string,
  localRoot: string,
  suffix = '',
  sourceRoot = projectRoot,
): Promise<{ root: string; target: string }> {
  const volume = path.parse(localRoot).root;
  const target = path.join(localRoot, suffix);
  const current = await inspectProtectedProjectPath(
    volume,
    path.relative(volume, localRoot).replaceAll('\\', '/'),
    { label: 'Classic read-only local record', expected: 'any' },
  );
  const legacy = await inspectProtectedProjectPath(
    sourceRoot,
    path.relative(sourceRoot, legacyRoot).replaceAll('\\', '/'),
    { label: 'Classic read-only legacy record', expected: 'any' },
  );
  if (
    !legacy.exists ||
    (await isWorkspaceRuntimeMigrationFence(legacyRoot, localRoot, {
      projectRoot,
      ignoreForeignWorkspaceFence: true,
    }))
  )
    return { root: volume, target };
  if (current.exists)
    throw new Error('Conflicting current and legacy Classic local records; migrate before reading');
  const oldTarget = path.join(legacyRoot, suffix);
  const previous = suffix
    ? await inspectProtectedProjectPath(
        sourceRoot,
        path.relative(sourceRoot, oldTarget).replaceAll('\\', '/'),
        { label: 'Classic read-only legacy record', expected: 'any' },
      )
    : legacy;
  return previous.exists ? { root: sourceRoot, target: oldTarget } : { root: volume, target };
}

/** 旧的逻辑引用保持可读；实际文件只在 workspace 的本机目录中写入。 */
export async function resolveClassicLocalTarget(
  projectRoot: string,
  absolute: string,
  options: { migrate?: boolean } = {},
): Promise<{ root: string; target: string } | null> {
  const runtime = resolveWorkspaceRuntimeRootSync(projectRoot);
  const runtimeRelative = path.relative(runtime, absolute);
  if (
    runtimeRelative === '' ||
    (!runtimeRelative.startsWith(`..${path.sep}`) &&
      runtimeRelative !== '..' &&
      !path.isAbsolute(runtimeRelative))
  ) {
    if (options.migrate === false) {
      const key = JSON.stringify(['read-root', runtime]);
      const prepared = preparedRuns.getStore();
      let pending = prepared?.get(key);
      if (!pending) {
        const volume = path.parse(runtime).root;
        pending = inspectProtectedProjectPath(
          volume,
          path.relative(volume, runtime).replaceAll('\\', '/'),
          { label: 'Classic read-only Runtime root', expected: 'directory' },
        ).then((entry) => (entry.exists ? runtime : volume));
        prepared?.set(key, pending);
        void pending.catch(() => prepared?.delete(key));
      }
      return { root: await pending, target: absolute };
    }
    const current = await resolveWorkspaceRuntimeRoot(projectRoot);
    if (current !== runtime)
      throw new Error('Classic Runtime workspace changed while resolving an absolute local target');
    return { root: current, target: absolute };
  }
  const relative = path.relative(path.resolve(projectRoot), absolute).replaceAll('\\', '/');
  if (relative.startsWith('.comet/runtime/')) {
    if (options.migrate === false)
      return selectClassicLocalReadTarget(
        projectRoot,
        path.join(projectRoot, '.comet', 'runtime'),
        runtime,
        relative.slice('.comet/runtime/'.length),
      );
    const current = await resolveWorkspaceRuntimeRoot(projectRoot);
    return {
      root: current,
      target: path.join(current, relative.slice('.comet/runtime/'.length)),
    };
  }
  const match = /^(?:(.*)\/)?\.comet\/([^/]+)(\/.*)?$/u.exec(relative);
  if (!match || !CLASSIC_LOCAL_RECORDS.has(match[2])) return null;
  const changeRef = match[1] ?? '';
  const state = await inspectProtectedProjectPath(
    projectRoot,
    path.relative(projectRoot, await resolveClassicStateFile(path.join(projectRoot, changeRef))),
    {
      label: 'Classic local change identity',
      expected: 'file',
    },
  );
  if (!state.exists) return null;
  if (options.migrate === false) {
    const changeDir = path.join(projectRoot, changeRef);
    const legacy = await inspectProtectedProjectPath(
      projectRoot,
      path.posix.join(changeRef, '.comet', match[2]),
      {
        label: 'Classic read-only legacy record',
        expected: 'any',
      },
    );
    const family = await inspectProtectedProjectPath(
      path.parse(runtime).root,
      path
        .relative(path.parse(runtime).root, path.join(runtime, 'classic-changes'))
        .replaceAll('\\', '/'),
      {
        label: 'Classic read-only local records',
        expected: 'directory',
      },
    );
    if (!legacy.exists && !family.exists) return null;
    const directory = await resolveClassicRunDirectoryForRead(changeDir, projectRoot, {
      includeMissing: true,
    });
    if (!directory || directory === changeDir) return null;
    return selectClassicLocalReadTarget(
      projectRoot,
      path.join(changeDir, '.comet', match[2]),
      path.join(directory, '.comet', match[2]),
      match[3]?.slice(1) ?? '',
    );
  }
  const directory = await resolveClassicRunDirectory(
    path.join(projectRoot, changeRef),
    projectRoot,
  );
  const current = resolveWorkspaceRuntimeRootSync(projectRoot);
  const local = path.relative(current, directory);
  if (path.isAbsolute(local) || local === '..' || local.startsWith(`..${path.sep}`)) {
    throw new Error('Classic Runtime workspace changed while resolving a change-local target');
  }
  return { root: current, target: path.join(directory, '.comet', match[2], match[3] ?? '') };
}
