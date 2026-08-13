import path from 'node:path';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inspectCometHook } from '../../../domains/comet-entry/hook-router.js';
import {
  main,
  isDirectEntry,
  projectRootFrom,
  runCometHookRouter,
} from '../../../domains/comet-entry/hook-router-entry.js';
import { resolveCometHookProjectRoot } from '../../../domains/comet-entry/hook-project-root.js';

vi.mock('../../../domains/comet-entry/hook-router.js', () => ({
  inspectCometHook: vi.fn(),
}));

vi.mock('../../../domains/comet-entry/hook-project-root.js', () => ({
  resolveCometHookProjectRoot: vi.fn((root: string) => root),
}));

describe('Comet Hook Router entry', () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FILE_PATH = 'src/entry.ts';
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    delete process.env.FILE_PATH;
    stderr.mockRestore();
  });

  it('returns usage errors before reading a Hook request', async () => {
    await expect(runCometHookRouter([])).resolves.toBe(64);
    await expect(runCometHookRouter(['--unknown'])).resolves.toBe(64);
    await expect(runCometHookRouter(['--platform', 'unsupported'])).resolves.toBe(64);

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('--platform is required'));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Unknown argument: --unknown'));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('unsupported Hook platform'));
    expect(inspectCometHook).not.toHaveBeenCalled();
  });

  it('routes an explicit project request and renders an allow decision', async () => {
    vi.mocked(inspectCometHook).mockResolvedValue({ allowed: true, reason: 'allowed' });

    await expect(
      runCometHookRouter(['--platform', 'codex', '--project-root', 'project']),
    ).resolves.toBe(0);

    const projectRoot = path.resolve('project');
    expect(resolveCometHookProjectRoot).toHaveBeenCalledWith(
      projectRoot,
      expect.objectContaining({ intent: 'write', targets: ['src/entry.ts'] }),
    );
    expect(inspectCometHook).toHaveBeenCalledWith(
      projectRoot,
      expect.objectContaining({ targets: ['src/entry.ts'] }),
    );
    expect(stderr).not.toHaveBeenCalled();
  });

  it('renders a denied decision and exposes the main entry wrapper', async () => {
    vi.mocked(inspectCometHook).mockResolvedValue({ allowed: false, reason: 'blocked' });

    await expect(main(['--platform', 'codex', '--project-root', 'project'])).resolves.toBe(2);
    expect(stderr).toHaveBeenCalledWith('blocked\n');
  });

  it('fails closed when Hook inspection throws', async () => {
    vi.mocked(inspectCometHook).mockRejectedValue(new Error('inspection failed'));

    await expect(
      runCometHookRouter(['--platform', 'codex', '--project-root', 'project']),
    ).resolves.toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('Comet Hook Router failed closed during project discovery'),
    );
  });

  it('resolves explicit roots and keeps a legacy invocation neutral without a request cwd', async () => {
    const parsed = { platformId: 'codex' } as Parameters<typeof projectRootFrom>[0];
    await expect(projectRootFrom(parsed)).resolves.toBeNull();
    await expect(projectRootFrom(parsed, undefined)).resolves.toBeNull();
    await expect(
      projectRootFrom({ platformId: 'codex', projectRoot: path.resolve('project') }),
    ).resolves.toBe(path.resolve('project'));
  });

  it.skipIf(process.platform === 'win32')(
    'recognizes a direct invocation through a POSIX symlink',
    async () => {
      const tempDir = await mkdtemp(path.join(tmpdir(), 'comet-hook-router-entry-'));
      const target = path.join(tempDir, 'router.mjs');
      const link = path.join(tempDir, 'linked-router.mjs');
      try {
        await writeFile(target, 'export {};\n');
        await symlink(target, link);

        expect(isDirectEntry(link, pathToFileURL(target).href)).toBe(true);
        expect(isDirectEntry(undefined, pathToFileURL(target).href)).toBe(false);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  );
});
