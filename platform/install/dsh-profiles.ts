import path from 'node:path';
import { promises as fs } from 'node:fs';

/** 只枚举已有的真实 profile，安装不创建或改写宿主的 package.json。 */
export async function getDshProfilePatchPaths(configRoot: string): Promise<string[]> {
  const profilesRoot = path.join(configRoot, 'profiles');
  const entries = await fs.readdir(profilesRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const patches: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(profilesRoot, entry.name);
    const manifestPath = path.join(directory, 'package.json');
    const stat = await fs.lstat(manifestPath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat?.isFile() || stat.isSymbolicLink()) continue;
    const source = await fs.readFile(manifestPath, 'utf8');
    let manifest;
    try {
      manifest = JSON.parse(source);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
    if (manifest?.dsh?.profile && typeof manifest.dsh.profile === 'object') {
      patches.push(path.join(directory, 'cordis.patch.yml'));
    }
  }
  return patches.sort();
}
