import { resolveClassicStateFile } from './classic-state-file.js';
import { CLASSIC_CHANGE_ID_PATTERN } from './classic-state.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import path from 'node:path';

import { discoverClassicProject } from './classic-layout.js';
import {
  ensureWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
} from '../workflow-contract/workspace-runtime.js';

/** 本机执行记录；handoff、delivery 和正式审计仍随 change 保存。 */
export const CLASSIC_LOCAL_RECORDS = new Set([
  'run-state.json',
  'pending-action.json',
  'trajectory.jsonl',
  'context.md',
  'artifacts.json',
  'checkpoint.json',
  'coordination.json',
  'subagent-progress.md',
]);

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

async function changeIdentity(projectRoot: string, changeDir: string): Promise<string> {
  const file = await resolveClassicStateFile(changeDir);
  const relative = path.relative(projectRoot, file).replaceAll('\\', '/');
  const read = () => readChangeIdentity(projectRoot, changeDir);
  const initial = await read();
  if (initial.id) return initial.id;
  const { source, document } = initial;
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
  return target.target;
}

export async function resolveClassicRunDirectory(
  changeDir: string,
  projectRoot?: string,
): Promise<string> {
  return prepareClassicRunDirectory(changeDir, projectRoot);
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
  const runtimeRoot = await ensureWorkspaceRuntimeRoot(root);
  const identity = await changeIdentity(root, changeDir);
  const target = path.join(runtimeRoot, 'classic-changes', identity);
  await ensureProtectedProjectDirectory(runtimeRoot, path.relative(runtimeRoot, target), {
    label: 'Classic local Run directory',
  });
  return target;
}

/** 旧的逻辑引用保持可读；实际文件只在 workspace 的本机目录中写入。 */
export async function resolveClassicLocalTarget(
  projectRoot: string,
  absolute: string,
  options: { readOnly?: boolean } = {},
): Promise<{ root: string; target: string } | null> {
  const runtime = resolveWorkspaceRuntimeRootSync(projectRoot);
  const runtimeRelative = path.relative(runtime, absolute);
  if (
    runtimeRelative === '' ||
    (!runtimeRelative.startsWith(`..${path.sep}`) &&
      runtimeRelative !== '..' &&
      !path.isAbsolute(runtimeRelative))
  ) {
    if (options.readOnly) return { root: path.dirname(runtime), target: absolute };
    await ensureWorkspaceRuntimeRoot(projectRoot);
    return { root: runtime, target: absolute };
  }
  const relative = path.relative(path.resolve(projectRoot), absolute).replaceAll('\\', '/');
  if (relative.startsWith('.comet/runtime/')) {
    return {
      root: runtime,
      target: path.join(runtime, relative.slice('.comet/runtime/'.length)),
    };
  }
  const match = /^(?:(.*)\/)?\.comet\/([^/]+)(\/.*)?$/u.exec(relative);
  if (!match || !CLASSIC_LOCAL_RECORDS.has(match[2])) return null;
  if (options.readOnly) {
    const volume = path.parse(runtime).root;
    const records = await inspectProtectedProjectPath(
      volume,
      path.relative(volume, path.join(runtime, 'classic-changes')),
      { label: 'Classic local records', expected: 'directory' },
    );
    if (!records.exists) return null;
  }
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
  const changeDir = path.join(projectRoot, changeRef);
  const directory = options.readOnly
    ? await resolveClassicRunDirectoryForRead(changeDir, projectRoot, { includeMissing: true })
    : await resolveClassicRunDirectory(changeDir, projectRoot);
  if (!directory) return null;
  if (options.readOnly && directory === changeDir) return null;
  const local = path.relative(runtime, directory);
  if (path.isAbsolute(local) || local === '..' || local.startsWith(`..${path.sep}`)) {
    throw new Error('Classic Runtime workspace changed while resolving a change-local target');
  }
  return {
    root: options.readOnly ? path.dirname(runtime) : runtime,
    target: path.join(directory, '.comet', match[2], match[3] ?? ''),
  };
}
