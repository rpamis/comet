import { inspectGitWorktree, samePath } from '../../platform/paths/git-worktree.js';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { readGitBlob, runGitCommand } from '../../platform/process/git.js';
import { nativeTotalSpecHash } from './native-delta-spec.js';
import type { NativePortableArchiveTransaction } from './native-portable-transactions.js';
import type { NativeProjectPaths } from './native-types.js';

/** 只用于重算旧候选摘要；不能用于执行检查或写回工作区。 */
export type NativeLegacyArchiveOverlay = ReadonlyMap<
  string,
  { text: string | null; mode: number; bytes?: Buffer }
>;

function gitEntry(projectRoot: string, ref: string, source: 'index' | 'head') {
  const raw = runGitCommand(
    projectRoot,
    source === 'index'
      ? ['ls-files', '--stage', '-z', '--', `:(literal)${ref}`]
      : ['ls-tree', '-z', 'HEAD', '--', `:(literal)${ref}`],
  );
  if (!raw) return null;
  const records = raw.split('\0').filter(Boolean);
  const match =
    records.length === 1
      ? records[0].match(
          source === 'index'
            ? /^(100644|100755) ([a-f0-9]+) 0\t(.+)$/u
            : /^(100644|100755) blob ([a-f0-9]+)\t(.+)$/u,
        )
      : null;
  if (!match || match[3] !== ref)
    throw new Error(`旧 Archive 无法只读重建 ${ref}：索引冲突或文件类型不受支持`);
  return { mode: Number.parseInt(match[1], 8), objectId: match[2] };
}

/** 原文只提供重建材料；最终必须精确匹配已保存的旧候选摘要。 */
export function createNativeLegacyArchiveOverlay(options: {
  paths: NativeProjectPaths;
  transaction: NativePortableArchiveTransaction;
  /** 调用方可提供原文备份；必须匹配原事务的目标摘要，不能覆盖其他路径。 */
  originals?: ReadonlyMap<string, string>;
}): NativeLegacyArchiveOverlay {
  const { paths, transaction } = options;
  const worktree = inspectGitWorktree(paths.projectRoot);
  const ownsGitWorktree =
    worktree.isGitWorktree &&
    worktree.currentWorktreeRoot !== null &&
    samePath(worktree.currentWorktreeRoot, paths.projectRoot);
  const overlay = new Map<string, { text: string | null; mode: number }>();
  for (const change of transaction.spec_changes) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(change.capability))
      throw new Error('旧 Archive 包含无效 capability');
    const ref = path
      .relative(paths.projectRoot, path.join(paths.specsDir, change.capability, 'spec.md'))
      .replaceAll('\\', '/');
    if (path.isAbsolute(ref) || ref.startsWith('../')) throw new Error('旧 Archive Spec 路径越界');
    if (change.expected_target_hash === undefined)
      throw new Error(`旧 Archive 缺少 ${ref} 的原目标摘要，不能重建历史验收依据`);
    if (change.expected_target_hash === null) {
      if (options.originals?.has(ref)) throw new Error(`旧 Archive 的 ${ref} 原本不存在`);
      overlay.set(ref, { text: null, mode: 0o100644 });
      continue;
    }
    const supplied = options.originals?.get(ref);
    const index = ownsGitWorktree ? gitEntry(paths.projectRoot, ref, 'index') : null;
    const head = ownsGitWorktree ? gitEntry(paths.projectRoot, ref, 'head') : null;
    const candidates =
      supplied === undefined
        ? [index, head].flatMap((entry) =>
            entry
              ? [{ text: readGitBlob(paths.projectRoot, entry.objectId), mode: entry.mode }]
              : [],
          )
        : [{ text: supplied, mode: index?.mode ?? head?.mode ?? 0o100644 }];
    const original = candidates.find(
      ({ text }) => nativeTotalSpecHash(text) === change.expected_target_hash,
    );
    if (!original)
      throw new Error(
        `旧 Archive 缺少 ${ref} 的原文。请提供归档前的原文备份（SHA-256/LF：${change.expected_target_hash}）；不能把当前 Spec 当作旧验收依据。`,
      );
    overlay.set(ref, original);
  }
  for (const ref of options.originals?.keys() ?? [])
    if (!overlay.has(ref)) throw new Error(`原文备份 ${ref} 不属于原 Archive 事务`);
  return overlay;
}

/** Archive 不改索引；保留当前索引、HEAD 与其他路径，只虚拟还原事务目标。 */
export function nativeLegacyArchiveGitStatus(
  projectRoot: string,
  status: string,
  overlay: NativeLegacyArchiveOverlay,
): string {
  const records = status.split('\0').filter(Boolean);
  const kept: string[] = [];
  for (let offset = 0; offset < records.length; offset += 1) {
    const record = records[offset];
    if (record.length < 4) throw new Error('旧 Archive 的 Git 状态记录无效');
    const renamed = /[RC]/u.test(record.slice(0, 2));
    const source = renamed ? records[++offset] : undefined;
    if (renamed && !source) throw new Error('旧 Archive 的 Git 重命名记录不完整');
    if (overlay.has(record.slice(3)) || (source !== undefined && overlay.has(source))) {
      if (renamed || /U/u.test(record.slice(0, 2)))
        throw new Error('旧 Archive 事务目标涉及重命名、复制或未合并索引，不能重建历史状态');
      continue;
    }
    kept.push(source === undefined ? record : `${record}\0${source}`);
  }
  for (const [ref, original] of overlay) {
    const index = gitEntry(projectRoot, ref, 'index');
    const head = gitEntry(projectRoot, ref, 'head');
    if (!index) {
      if (head) {
        // 同一路径可同时有 staged deletion 和 untracked 文件；不猜测其原顺序。
        if (original.text !== null)
          throw new Error(`旧 Archive 的 ${ref} 有已暂存删除，无法安全重建`);
        kept.push(`D  ${ref}`);
      } else if (original.text !== null) kept.push(`?? ${ref}`);
      continue;
    }
    const x = !head
      ? 'A'
      : head.objectId === index.objectId && head.mode === index.mode
        ? ' '
        : 'M';
    const y =
      original.text === null
        ? 'D'
        : original.text === readGitBlob(projectRoot, index.objectId) && original.mode === index.mode
          ? ' '
          : 'M';
    if (x !== ' ' || y !== ' ') kept.push(`${x}${y} ${ref}`);
  }
  kept.sort((left, right) => {
    const category = Number(left.startsWith('??')) - Number(right.startsWith('??'));
    return category || Buffer.compare(Buffer.from(left.slice(3)), Buffer.from(right.slice(3)));
  });
  return kept.length ? `${kept.join('\0')}\0` : '';
}

/** rename 后、收据落盘前，只读地把实际归档材料投影回原路径。 */
export async function withNativeLegacyArchiveMaterials(options: {
  paths: NativeProjectPaths;
  transaction: NativePortableArchiveTransaction;
  overlay: NativeLegacyArchiveOverlay;
}): Promise<NativeLegacyArchiveOverlay> {
  const { paths, transaction } = options;
  if (
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(transaction.change) ||
    !/^\d{4}-\d{2}-\d{2}-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(transaction.archive_ref)
  )
    throw new Error('旧 Archive 材料路径无效');
  const ref = (file: string) => path.relative(paths.projectRoot, file).replaceAll('\\', '/');
  const active = path.join(paths.changesDir, transaction.change);
  const archived = path.join(paths.archiveDir, transaction.archive_ref);
  const activeInspection = await inspectProtectedProjectPath(paths.projectRoot, ref(active), {
    label: '旧 Archive 原材料目录',
    expected: 'directory',
  });
  const archivedInspection = await inspectProtectedProjectPath(paths.projectRoot, ref(archived), {
    label: '旧 Archive 归档材料目录',
    expected: 'directory',
  });
  if (activeInspection.exists && archivedInspection.exists)
    throw new Error('旧 Archive 原目录和归档目录同时存在，不能猜测材料归属');
  if (activeInspection.exists) return options.overlay;
  if (!archivedInspection.exists) throw new Error('旧 Archive 原材料和归档材料均缺失');
  const overlay = new Map(options.overlay);
  let count = 0;
  let total = 0;
  async function visit(directory: string) {
    const checked = await inspectProtectedProjectPath(paths.projectRoot, ref(directory), {
      label: '旧 Archive 材料目录',
      expected: 'directory',
    });
    if (!checked.exists) throw new Error('旧 Archive 材料在读取期间消失');
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('旧 Archive 材料不能包含符号链接');
      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }
      if (!entry.isFile()) throw new Error('旧 Archive 材料必须为普通文件');
      if (['verification.md', 'comet-state.yaml', 'children.yaml'].includes(entry.name)) continue;
      const { bytes, stat } = await readProtectedProjectFile(
        paths.projectRoot,
        ref(file),
        8 * 1024 * 1024,
        { label: '旧 Archive 材料' },
      );
      total += bytes.length;
      if (++count > 4096 || total > 64 * 1024 * 1024)
        throw new Error('旧 Archive 材料超出只读恢复大小限制');
      const relative = path.relative(archived, file);
      overlay.set(ref(file), { text: null, mode: Number(stat.mode) });
      overlay.set(ref(path.join(active, relative)), {
        text: bytes.toString('utf8'),
        bytes,
        mode: Number(stat.mode),
      });
    }
  }
  await visit(archived);
  return overlay;
}
