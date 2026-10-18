import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

/** Version display indexes using bounded metadata reads, without opening artifacts. */
export async function fingerprintDashboardFiles(
  files: readonly string[],
  identity: string,
): Promise<string | null> {
  return (await fingerprintDashboardFileGroups([files], identity))[0];
}

/** 同一轮校验共享元数据读取；采集前后两轮校验不能共享。 */
export async function fingerprintDashboardFileGroups(
  groups: readonly (readonly string[])[],
  identity: string,
): Promise<(string | null)[]> {
  const files = [...new Set(groups.flat())];
  const stamps = new Map<string, unknown[] | null>();
  for (let offset = 0; offset < files.length; offset += 64) {
    await Promise.all(
      files.slice(offset, offset + 64).map(async (file) => {
        try {
          const stat = await fs.lstat(file);
          stamps.set(file, [file, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs]);
        } catch (error) {
          stamps.set(
            file,
            ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
              ? [file, 'missing']
              : null,
          );
        }
      }),
    );
  }
  return groups.map((group) => {
    const hash = createHash('sha256').update(identity);
    for (let offset = 0; offset < group.length; offset += 64) {
      const values = group.slice(offset, offset + 64).map((file) => stamps.get(file));
      if (values.some((value) => value == null)) return null;
      hash.update(JSON.stringify(values));
    }
    return hash.digest('hex');
  });
}
