import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

/** Version display indexes using bounded metadata reads, without opening artifacts. */
export async function fingerprintDashboardFiles(
  files: readonly string[],
  identity: string,
): Promise<string | null> {
  const hash = createHash('sha256').update(identity);
  for (let offset = 0; offset < files.length; offset += 64) {
    const stamps = await Promise.all(
      files.slice(offset, offset + 64).map(async (file) => {
        try {
          const stat = await fs.lstat(file);
          return [file, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs];
        } catch (error) {
          if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
            return [file, 'missing'];
          return null;
        }
      }),
    );
    if (stamps.some((stamp) => stamp === null)) return null;
    hash.update(JSON.stringify(stamps));
  }
  return hash.digest('hex');
}
