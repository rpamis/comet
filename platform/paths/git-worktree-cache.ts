import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** 小型 Git 元数据快照；不读取工作区内容、索引或 Runtime 状态。 */
export async function gitWorktreeMetadataStamp(
  projectPath: string,
  configPaths: readonly string[],
): Promise<string | null> {
  try {
    const parts: string[] = [];
    let bytes = 0;
    const file = async (target: string): Promise<string | null> => {
      let stat;
      try {
        stat = await fs.lstat(target, { bigint: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        parts.push(`${target}:missing`);
        return null;
      }
      if (stat.isSymbolicLink() || stat.ino === 0n || !(stat.isFile() || stat.isDirectory()))
        throw new Error('Unstable Git metadata');
      parts.push(`${target}:${stat.dev}:${stat.ino}:${stat.ctimeNs}:${stat.mtimeNs}:${stat.size}`);
      if (stat.isDirectory()) return null;
      if (stat.size > 65536n || (bytes += Number(stat.size)) > 262144)
        throw new Error('Git metadata exceeds cache budget');
      const content = await fs.readFile(target, 'utf8');
      // include/includeIf 和重定向工作区需要 Git 自己解释，每次查询都走原路径。
      if (/(?:^|\n)\s*\[\s*include(?:if)?\b|(?:^|\n)\s*worktree\s*=/iu.test(content))
        throw new Error('Indirect Git configuration');
      parts.push(content);
      return content;
    };
    let root = path.resolve(projectPath);
    let gitDir: string | undefined;
    for (let level = 0; level < 32; level++) {
      const marker = path.join(root, '.git');
      const content = await file(marker);
      if (content !== null) {
        const match = /^gitdir: (.+)\s*$/u.exec(content.trim());
        if (!match) return null;
        gitDir = path.resolve(root, match[1]);
        break;
      }
      try {
        if ((await fs.lstat(marker)).isDirectory()) {
          gitDir = marker;
          break;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const parent = path.dirname(root);
      if (parent === root) return null;
      root = parent;
    }
    if (!gitDir) return null;
    await file(root);
    await file(gitDir);
    const commonRef = await file(path.join(gitDir, 'commondir'));
    const common = commonRef === null ? gitDir : path.resolve(gitDir, commonRef.trim());
    await file(common);
    for (const target of [
      ...configPaths,
      path.join(common, 'config'),
      path.join(common, 'config.worktree'),
      path.join(common, 'HEAD'),
      path.join(gitDir, 'HEAD'),
      path.join(gitDir, 'config.worktree'),
    ])
      await file(target);
    const registry = path.join(common, 'worktrees');
    await file(registry);
    let names: string[];
    try {
      names = (await fs.readdir(registry)).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      names = [];
    }
    if (names.length > 128) return null;
    parts.push(JSON.stringify(names));
    for (const name of names) {
      const dir = path.join(registry, name);
      await file(dir);
      for (const ref of ['HEAD', 'commondir', 'config.worktree', 'locked'])
        await file(path.join(dir, ref));
      const backlink = await file(path.join(dir, 'gitdir'));
      if (backlink === null || !path.isAbsolute(backlink.trim())) return null;
      await file(backlink.trim());
      await file(path.dirname(backlink.trim()));
    }
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  } catch {
    // 文件消失、权限不足、符号链接、过大的注册表都只关闭缓存。
    return null;
  }
}
