import { promises as fs } from 'fs';
import path from 'path';

/**
 * Resolve symlinks in a path, handling broken symlinks by following their
 * readlink target. Falls back to the original path if resolution fails.
 */
async function resolveSymlinkPath(filePath: string): Promise<string> {
  try {
    return await fs.realpath(filePath);
  } catch {
    // Path doesn't fully exist — walk up to find the deepest existing ancestor
    const dir = path.dirname(filePath);
    if (dir === filePath) return filePath; // filesystem root

    const resolvedDir = await resolveSymlinkPath(dir);
    const base = path.basename(filePath);

    // Check if this segment is a broken symlink and follow its target
    try {
      const stat = await fs.lstat(path.join(resolvedDir, base));
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(path.join(resolvedDir, base));
        return path.resolve(resolvedDir, target);
      }
    } catch {
      // Segment doesn't exist — return as-is
    }

    return path.join(resolvedDir, base);
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 * Resolves symlinks so that broken symlink targets are created correctly.
 */
export async function ensureDir(dir: string): Promise<void> {
  const resolved = await resolveSymlinkPath(dir);
  await fs.mkdir(resolved, { recursive: true });
}

/**
 * Copy a file from src to dest, creating parent directories if needed.
 * Resolves symlinks in the destination path so files are written to the
 * actual target location when dest contains symlinks (e.g., skill dirs
 * symlinked from ~/.claude/skills/ to ~/.agents/skills/).
 */
export async function copyFile(src: string, dest: string): Promise<void> {
  const resolvedDest = await resolveSymlinkPath(dest);
  await ensureDir(path.dirname(resolvedDest));
  await fs.copyFile(src, resolvedDest);
}

/**
 * Check if a file or directory exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse a JSON file.
 */
export async function readJson<T = unknown>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Write content to a file, creating parent directories if needed.
 * Resolves symlinks so files are written to the actual target location.
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  const resolved = await resolveSymlinkPath(filePath);
  await ensureDir(path.dirname(resolved));
  await fs.writeFile(resolved, content, 'utf-8');
}

/**
 * List entries in a directory. Returns empty array if directory doesn't exist.
 */
export async function readDir(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return [];
    }

    throw error;
  }
}

/**
 * Returns true when an error means the path was simply not found. ENOENT is
 * the only non-fatal outcome for the removal helpers below; all other errors
 * (permissions, IO) are reported as failures instead of being masked as
 * "already gone".
 */
function isNotFoundError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

/**
 * Remove a file. Returns true if the file existed and was removed.
 * Operates on the path directly so a symlink entry is removed rather than its
 * resolved target (avoids deleting files the symlink merely points at).
 */
export async function removeFile(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    // Not found or failed (permissions/IO): nothing was removed.
    return false;
  }
}

/**
 * Remove a directory recursively. Returns true if the directory existed and was removed.
 * Symlinked directories are unlinked directly rather than recursed into, so the
 * directory a symlink points at is never deleted.
 */
export async function removeDir(dirPath: string): Promise<boolean> {
  try {
    // lstat does not follow symlinks; unlink a symlinked dir instead of rm-ing its target.
    const stat = await fs.lstat(dirPath);
    if (stat.isSymbolicLink()) {
      await fs.unlink(dirPath);
      return true;
    }
    await fs.rm(dirPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    return isNotFoundError(error);
  }
}

/**
 * Check if a directory is empty. A missing directory is treated as empty;
 * unreadable directories (permissions/IO) return false so callers never delete
 * a directory they could not inspect.
 */
export async function isDirEmpty(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.length === 0;
  } catch (error) {
    return isNotFoundError(error);
  }
}
