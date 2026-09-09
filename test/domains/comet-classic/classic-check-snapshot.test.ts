import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkInputFingerprint } from '../../../domains/comet-classic/classic-check-snapshot.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

describe('Classic check input snapshots', () => {
  let root: string;
  let change: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'ignore' });
  const fingerprint = () => checkInputFingerprint(root, change);
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-snapshot-'));
    await prepareClassicLegacyProject(root);
    change = path.join(root, 'openspec', 'changes', 'demo');
    await fs.mkdir(change, { recursive: true });
    git(root, 'init');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(root, 'source.js'), 'v1');
    git(root, 'add', 'source.js');
    git(root, 'commit', '-m', 'baseline');
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('invalidates content changes before and after staging, including deletions', async () => {
    const baseline = await fingerprint();
    await fs.writeFile(path.join(root, 'source.js'), 'v2');
    const unstaged = await fingerprint();
    expect(unstaged).not.toBe(baseline);
    git(root, 'add', 'source.js');
    expect(await fingerprint()).not.toBe(unstaged);
    await fs.unlink(path.join(root, 'source.js'));
    expect(await fingerprint()).not.toBe(baseline);
  });

  it('includes submodule HEAD and dirty contents', async () => {
    const source = path.join(root, 'library');
    await fs.mkdir(source);
    git(source, 'init');
    git(source, 'config', 'user.email', 'test@example.com');
    git(source, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(source, 'api.js'), 'v1');
    git(source, 'add', '.');
    git(source, 'commit', '-m', 'library');
    git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', './library', 'vendor');
    const before = await fingerprint();
    await fs.writeFile(path.join(root, 'vendor', 'api.js'), 'v2');
    expect(await fingerprint()).not.toBe(before);
  });

  it('omits runtime records but includes project configuration and ignored dependency metadata', async () => {
    const before = await fingerprint();
    await fs.mkdir(path.join(change, '.comet'), { recursive: true });
    await fs.writeFile(path.join(change, '.comet', 'progress.md'), 'new progress');
    expect(await fingerprint()).toBe(before);
    await fs.appendFile(path.join(root, '.comet', 'config.yaml'), '\n# config changed\n');
    const config = await fingerprint();
    expect(config).not.toBe(before);
    await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
    const ignored = await fingerprint();
    await fs.writeFile(path.join(root, 'node_modules', '.modules.yaml'), 'layoutVersion: 5');
    expect(await fingerprint()).not.toBe(ignored);
  });
});
