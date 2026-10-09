import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it, expect } from 'vitest';
import { getDshProfilePatchPaths } from '../../platform/install/dsh-profiles.js';

it('discovers existing DSH profiles without following directory links or creating profiles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dsh-profiles-'));
  try {
    expect(await getDshProfilePatchPaths(root)).toEqual([]);
    const desktop = path.join(root, 'profiles/desktop');
    const unrelated = path.join(root, 'profiles/unrelated');
    await fs.mkdir(desktop, { recursive: true });
    await fs.mkdir(unrelated, { recursive: true });
    await fs.writeFile(
      path.join(desktop, 'package.json'),
      JSON.stringify({ dsh: { profile: { bundles: [] } } }),
    );
    await fs.writeFile(path.join(unrelated, 'package.json'), '{}');
    const broken = path.join(root, 'profiles/broken');
    await fs.mkdir(broken);
    await fs.writeFile(path.join(broken, 'package.json'), '{invalid');
    await fs.symlink(
      desktop,
      path.join(root, 'profiles/linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(await getDshProfilePatchPaths(root)).toEqual([path.join(desktop, 'cordis.patch.yml')]);
    expect(await fs.readdir(desktop)).toEqual(['package.json']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
