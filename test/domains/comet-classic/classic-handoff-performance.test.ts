import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import {
  resolveClassicDesignContext,
  validateClassicSdkDesignContext,
} from '../../../domains/comet-classic/classic-handoff.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

describe('Classic handoff material reuse', () => {
  let root: string;
  let changeDir: string;
  let sources: string[];
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-handoff-budget-'));
    await prepareClassicLegacyProject(root);
    changeDir = path.join(root, 'openspec', 'changes', 'demo');
    await fs.mkdir(changeDir, { recursive: true });
    sources = ['proposal.md', 'design.md', 'tasks.md'].map((name) => path.join(changeDir, name));
    for (let index = 0; index < 10; index += 1) {
      const spec = path.join(changeDir, 'specs', `capability-${index}`, 'spec.md');
      await fs.mkdir(path.dirname(spec), { recursive: true });
      sources.push(spec);
    }
    await Promise.all(
      sources.map((file) => fs.writeFile(file, `# ${path.basename(file)}\n\n- [ ] implement\n`)),
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function initializeDesignContext() {
    const initialized = await runClassicCli(
      ['state', 'init', 'demo', 'full', '--runtime', 'compat'],
      undefined,
      { projectRoot: root, invocationCwd: root },
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
  }

  it.each(['off', 'beta'] as const)(
    'reads only the original proposal for %s handoff references',
    async (contextCompression) => {
      await initializeDesignContext();
      const open = vi.spyOn(fs, 'open');
      const options = { projectRoot: root, changeDir, change: 'demo', contextCompression };
      const prepared = await resolveClassicDesignContext(options);
      expect(prepared).toEqual({
        handoffContext: 'openspec/changes/demo/proposal.md',
        handoffHash: null,
      });
      for (const file of sources)
        expect(open.mock.calls.filter(([target]) => String(target) === file)).toHaveLength(
          file === sources[0] ? 1 : 0,
        );
      open.mockClear();
      expect(await validateClassicSdkDesignContext({ ...options, ...prepared })).toBe(true);
      for (const file of sources)
        expect(open.mock.calls.filter(([target]) => String(target) === file)).toHaveLength(
          file === sources[0] ? 1 : 0,
        );
      await expect(fs.stat(path.join(changeDir, '.comet/handoff'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it.each(['edit', 'add', 'remove'] as const)(
    'keeps the original handoff reference after Agent-managed source %s',
    async (change) => {
      await initializeDesignContext();
      const options = {
        projectRoot: root,
        changeDir,
        change: 'demo',
        contextCompression: 'off' as const,
      };
      const prepared = await resolveClassicDesignContext(options);
      if (change === 'edit') await fs.appendFile(sources[0], '\nUpdated source.\n');
      else if (change === 'remove') await fs.unlink(sources.at(-1)!);
      else {
        const spec = path.join(changeDir, 'specs/new/spec.md');
        await fs.mkdir(path.dirname(spec), { recursive: true });
        await fs.writeFile(spec, 'A new requirement.\n');
      }
      expect(await validateClassicSdkDesignContext({ ...options, ...prepared })).toBe(true);
      expect(prepared.handoffContext).toBe('openspec/changes/demo/proposal.md');
    },
  );

  it('rejects a replaced source symlink at validation', async (context) => {
    await initializeDesignContext();
    const options = {
      projectRoot: root,
      changeDir,
      change: 'demo',
      contextCompression: 'off' as const,
    };
    const prepared = await resolveClassicDesignContext(options);
    await fs.unlink(sources[0]);
    try {
      await fs.symlink(sources[1], sources[0]);
    } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip('当前 Windows 环境未允许创建文件符号链接');
      }
      throw error;
    }
    await expect(validateClassicSdkDesignContext({ ...options, ...prepared })).rejects.toThrow(
      /regular file|symbolic link|junction/i,
    );
  });
});
