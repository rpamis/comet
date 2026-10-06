import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeContextHash,
  validateClassicSdkDesignContext,
  writeClassicSdkDesignContext,
} from '../../../domains/comet-classic/classic-handoff.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { readRunState } from '../../../domains/engine/state.js';
import { readClassicState } from '../../../domains/comet-classic/classic-store.js';
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

  it.each(['off', 'beta'] as const)(
    'reads each source once per %s preparation and once per commit validation',
    async (contextCompression) => {
      const open = vi.spyOn(fs, 'open');
      const options = { projectRoot: root, changeDir, change: 'demo', contextCompression };
      const prepared = await writeClassicSdkDesignContext(options);
      for (const file of sources)
        expect(open.mock.calls.filter(([target]) => String(target) === file)).toHaveLength(1);
      open.mockClear();
      expect(await validateClassicSdkDesignContext({ ...options, ...prepared })).toBe(true);
      for (const file of sources)
        expect(open.mock.calls.filter(([target]) => String(target) === file)).toHaveLength(1);
      expect(prepared.handoffHash).toBe(
        await computeContextHash(root, changeDir, 'openspec/changes/demo'),
      );
      const document = JSON.parse(
        await fs.readFile(path.join(root, prepared.handoffContext), 'utf8'),
      );
      expect(document.files).toHaveLength(sources.length);
      if (contextCompression === 'beta') {
        const markdown = await fs.readFile(
          path.join(root, prepared.handoffContext.replace(/\.json$/u, '.md')),
          'utf8',
        );
        for (let index = 0; index < 10; index += 1) {
          expect(markdown).toContain(`## openspec/changes/demo/specs/capability-${index}/spec.md`);
        }
        expect(markdown).toContain('```md\n# spec.md');
        expect(markdown).not.toContain('No delta spec files found.');
      }
    },
  );

  it.each(['edit', 'add', 'remove'] as const)(
    'rechecks source %s after preparing a handoff',
    async (change) => {
      const options = {
        projectRoot: root,
        changeDir,
        change: 'demo',
        contextCompression: 'off' as const,
      };
      const prepared = await writeClassicSdkDesignContext(options);
      if (change === 'edit') await fs.appendFile(sources[0], '\nchanged\n');
      else if (change === 'remove') await fs.unlink(sources.at(-1)!);
      else {
        const spec = path.join(changeDir, 'specs', 'new', 'spec.md');
        await fs.mkdir(path.dirname(spec));
        await fs.writeFile(spec, '# New requirement\n');
      }
      expect(await validateClassicSdkDesignContext({ ...options, ...prepared })).toBe(false);
    },
  );

  it('rejects a replaced source symlink at validation', async (context) => {
    const options = {
      projectRoot: root,
      changeDir,
      change: 'demo',
      contextCompression: 'off' as const,
    };
    const prepared = await writeClassicSdkDesignContext(options);
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
      /symbolic link|junction/i,
    );
  });

  it('releases only its stale handoff claim so a changed source can be retried', async () => {
    const run = (args: string[]) =>
      runClassicCli(args, undefined, { projectRoot: root, invocationCwd: root });
    expect((await run(['state', 'init', 'demo', 'full', '--runtime', 'compat'])).exitCode).toBe(0);
    expect((await run(['state', 'transition', 'demo', 'open-complete'])).exitCode).toBe(0);
    const rename = fs.rename.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
      const result = await rename(...args);
      if (
        !changed &&
        String(args[1]).endsWith(`${path.sep}handoff${path.sep}design-context.json`)
      ) {
        changed = true;
        await fs.appendFile(sources[0], '\nsource changed during preparation\n');
      }
      return result;
    });
    const rejected = await run(['handoff', 'demo', 'design', '--write']);
    expect(changed).toBe(true);
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.stderr).toContain('handoff sources changed before completion');
    expect((await readClassicState(changeDir)).classic?.handoffHash).toBeNull();
    expect((await readRunState(changeDir))?.pending).toBeNull();
    const retried = await run(['handoff', 'demo', 'design', '--write']);
    expect(retried.exitCode, retried.stderr).toBe(0);
    expect((await readRunState(changeDir))?.pending).toBeNull();
    expect((await readClassicState(changeDir)).classic?.handoffHash).toBe(
      await computeContextHash(root, changeDir, 'openspec/changes/demo'),
    );
  });
});
