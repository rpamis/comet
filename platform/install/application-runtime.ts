import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFileRaceSafe } from '../fs/race-safe-read.js';
import { withRecoverableFileLock } from '../fs/recoverable-file-lock.js';
import { sameFileObject } from '../fs/file-identity.js';
import { buildNodeHookCommand } from '../process/hook-command.js';
import { promises as fs } from 'node:fs';

/** 定位当前 Runtime 的发布资源；安装与宿主预览复用同一来源。 */
export async function applicationRuntimeRoot(): Promise<string> {
  let cursor = path.dirname(fileURLToPath(import.meta.url));
  let runtimeRoot: string | undefined;
  while (cursor !== path.dirname(cursor)) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(cursor, 'package.json'), 'utf8'));
      if (pkg.name === '@rpamis/comet') {
        runtimeRoot = await fs.realpath(cursor);
        break;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    cursor = path.dirname(cursor);
  }
  if (!runtimeRoot) throw new Error('找不到已安装的 Comet Runtime；保留应用并修复 Runtime 安装');
  return runtimeRoot;
}

interface RuntimeLinkOwner {
  schema: 'comet.runtime-link.v1';
  destination: string;
  target: string;
  previousTarget?: string;
}

/** 明确核对无托管记录的旧链接时使用；普通目录始终不能被替换。 */
export interface RuntimeDependencyRepair {
  expectedLinkTarget?: string;
}

/** 修复托管链接；先写可恢复意图，再原子替换链接，不触碰旧目标内容。 */
export async function ensureApplicationRuntimeDependency(
  storageRoot: string,
  repair: RuntimeDependencyRepair = {},
): Promise<void> {
  const runtimeRoot = await applicationRuntimeRoot();
  const root = await fs.realpath(storageRoot);
  const namespace = path.join(root, 'node_modules/@rpamis');
  const directories: Array<{ file: string; stat: Awaited<ReturnType<typeof fs.lstat>> }> = [];
  directories.push({ file: root, stat: await fs.lstat(root) });
  for (const directory of [path.dirname(namespace), namespace]) {
    try {
      await fs.mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Runtime 依赖目录存在冲突');
    directories.push({ file: directory, stat });
  }
  const identity = (stat: Awaited<ReturnType<typeof readFileRaceSafe>>['stat']) => ({
    dev: stat.dev,
    ino: stat.ino,
    birthtime: stat.birthtimeMs,
  });
  const verifyDirectories = async () => {
    for (const entry of directories) {
      const stat = await fs.lstat(entry.file);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        !sameFileObject(identity(stat), identity(entry.stat)) ||
        (await fs.realpath(entry.file)) !== entry.file
      )
        throw new Error('Runtime 依赖目录在修复期间变化，保留现场');
    }
  };
  await verifyDirectories();
  const destination = path.join(namespace, 'comet');
  const ownerFile = path.join(namespace, '.comet-runtime-link.json');
  await withRecoverableFileLock(`${ownerFile}.lock`, async () => {
    await verifyDirectories();
    let ownerSnapshot: Awaited<ReturnType<typeof readFileRaceSafe>> | null = null;
    const readOwner = async () => {
      await verifyDirectories();
      try {
        return await readFileRaceSafe(ownerFile, 16384, {
          label: 'Runtime 链接托管记录',
          verify: verifyDirectories,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await verifyDirectories();
        return null;
      }
    };
    const verifyOwner = async () => {
      const current = await readOwner();
      if (
        Boolean(current) !== Boolean(ownerSnapshot) ||
        (current &&
          ownerSnapshot &&
          (!sameFileObject(identity(current.stat), identity(ownerSnapshot.stat)) ||
            !current.bytes.equals(ownerSnapshot.bytes)))
      )
        throw new Error('Runtime 链接托管记录在修复期间变化，保留现场');
    };
    const writeOwner = async (value: RuntimeLinkOwner) => {
      await verifyOwner();
      const temporary = `${ownerFile}.${randomUUID()}.tmp`;
      const content = JSON.stringify(value);
      let written: Awaited<ReturnType<typeof fs.lstat>> | undefined;
      try {
        const handle = await fs.open(temporary, 'wx', 0o600);
        try {
          await verifyDirectories();
          await handle.writeFile(content, 'utf8');
          await handle.sync();
          written = await handle.stat();
        } finally {
          await handle.close();
        }
        await verifyOwner();
        await fs.rename(temporary, ownerFile);
        await verifyDirectories();
        const published = await readOwner();
        if (
          !published ||
          !written ||
          !sameFileObject(identity(published.stat), identity(written)) ||
          published.bytes.toString('utf8') !== content
        )
          throw new Error('Runtime 链接托管记录在发布期间变化，保留现场');
        ownerSnapshot = published;
      } finally {
        await verifyDirectories();
        await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    };
    let owner: RuntimeLinkOwner | null = null;
    try {
      ownerSnapshot = await readOwner();
      if (!ownerSnapshot) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      const content = ownerSnapshot.bytes.toString('utf8');
      const value = JSON.parse(content);
      if (
        !value ||
        value.schema !== 'comet.runtime-link.v1' ||
        value.destination !== destination ||
        typeof value.target !== 'string' ||
        !path.isAbsolute(value.target) ||
        (value.previousTarget !== undefined && typeof value.previousTarget !== 'string')
      )
        throw new Error('Runtime 链接托管记录无效，保留现场');
      owner = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await verifyDirectories();
    const observed = await fs.lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (observed && !observed.isSymbolicLink())
      throw new Error('Runtime 依赖不是托管符号链接；保留现有目录');
    const current = observed ? await fs.readlink(destination) : null;
    await verifyDirectories();
    const canonicalTarget = (target: string) =>
      path.toNamespacedPath(path.resolve(namespace, target));
    const matchesCurrent =
      current !== null && canonicalTarget(current) === canonicalTarget(runtimeRoot);
    const managed =
      current !== null &&
      owner !== null &&
      [owner.target, owner.previousTarget].some(
        (target) => target !== undefined && canonicalTarget(target) === canonicalTarget(current),
      );
    if (repair.expectedLinkTarget !== undefined && repair.expectedLinkTarget !== current)
      throw new Error('Runtime 链接目标已变化；重新核对，不覆盖较新的链接');
    if (current !== null && !matchesCurrent && !managed && repair.expectedLinkTarget !== current) {
      const moduleFile = pathToFileURL(
        path.join(runtimeRoot, 'dist/platform/install/application-runtime.js'),
      ).href;
      const script = `const m=await import(${JSON.stringify(moduleFile)});await m.ensureApplicationRuntimeDependency(${JSON.stringify(root)},${JSON.stringify({ expectedLinkTarget: current })});`;
      const command = buildNodeHookCommand(['--input-type=module', '-e', script]);
      throw new Error(
        `Runtime 链接没有匹配的托管记录，保留现场。核对以下旧目标确属 Comet 后，可执行绑定该目标的修复命令。旧目标：${JSON.stringify(current)}\n${command}`,
      );
    }
    const intent: RuntimeLinkOwner = {
      schema: 'comet.runtime-link.v1',
      destination,
      target: runtimeRoot,
      ...(current !== null && current !== runtimeRoot ? { previousTarget: current } : {}),
    };
    await writeOwner(intent);
    if (!matchesCurrent) {
      const temporary = `${destination}.${randomUUID()}.link`;
      await verifyDirectories();
      await fs.symlink(runtimeRoot, temporary, process.platform === 'win32' ? 'junction' : 'dir');
      try {
        await verifyDirectories();
        const latest = await fs.lstat(destination).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (
          Boolean(latest) !== Boolean(observed) ||
          (latest &&
            observed &&
            (!latest.isSymbolicLink() ||
              !sameFileObject(
                { dev: latest.dev, ino: latest.ino, birthtime: latest.birthtimeMs },
                { dev: observed.dev, ino: observed.ino, birthtime: observed.birthtimeMs },
              ) ||
              (await fs.readlink(destination)) !== current))
        )
          throw new Error('Runtime 链接在修复期间变化，保留现场');
        await verifyDirectories();
        await verifyOwner();
        // POSIX 原子替换；Windows junction 不支持覆盖，保留旧链接后再发布。
        if (process.platform === 'win32' && observed) {
          const previous = `${destination}.${randomUUID()}.previous`;
          await fs.rename(destination, previous);
          await verifyDirectories();
          const moved = await fs.lstat(previous);
          if (
            !moved.isSymbolicLink() ||
            !sameFileObject(identity(moved), identity(observed)) ||
            (await fs.readlink(previous)) !== current
          )
            throw new Error(`Runtime 链接在修复期间变化，保留现场：${previous}`);
          // symlink 是 no-clobber；中断后 journal 允许重试，旧目标内容始终保留。
          await fs.symlink(runtimeRoot, destination, 'junction');
          await verifyDirectories();
          await fs.unlink(previous);
        } else {
          await fs.rename(temporary, destination);
        }
        await verifyDirectories();
      } finally {
        await verifyDirectories();
        await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }
    await writeOwner({ schema: intent.schema, destination, target: runtimeRoot });
  });
}
