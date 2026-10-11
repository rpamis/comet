import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { installCometHooksForPlatform } from '../../../domains/skill/platform-install.js';
import { inspectCometHooksForPlatform } from '../../../domains/skill/platform-inspect.js';
import { removeCometHooksForPlatform } from '../../../domains/skill/uninstall.js';
import { PLATFORMS } from '../../../platform/install/platforms.js';
import { doctorCommand } from '../../../app/commands/doctor.js';

const { applyEntryPatches } = await import(
  pathToFileURL(path.resolve('test/fixtures/dsh-0.2.0-rc.2/entry-patches.mjs')).href
);
const { matchesMatcher, parseHookOutput } = await import(
  pathToFileURL(path.resolve('test/fixtures/dsh-0.2.0-rc.2/hook-protocol.mjs')).href
);
const dsh = PLATFORMS.find((p) => p.id === 'dsh')!;
const router = path.resolve('assets/skills/comet/scripts/comet-hook-router.mjs');

describe('DSH installed hook contract', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'comet-dsh-contract-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function install(scope: 'project' | 'global' = 'project') {
    expect(await installCometHooksForPlatform(root, dsh, scope)).toMatchObject({
      status: 'installed',
    });
    const script = path.join(root, '.dsh/skills/comet/scripts/comet-hook-router.mjs');
    await fs.mkdir(path.dirname(script), { recursive: true });
    await fs.copyFile(router, script);
    return JSON.parse(await fs.readFile(path.join(root, '.dsh/hooks.json'), 'utf8'));
  }
  async function profile(name: string, patch = '- id: user-plugin\n  disabled: false\n') {
    const dir = path.join(root, '.dsh/profiles', name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ dsh: { profile: { bundles: [] } } }),
    );
    await fs.writeFile(path.join(dir, 'cordis.patch.yml'), patch);
    return dir;
  }
  async function rows(file: string) {
    return parse(await fs.readFile(file, 'utf8'));
  }

  it('preserves existing profile bridges when a Hook configuration update fails', async () => {
    const desktop = await profile('desktop');
    const web = await profile('web');
    await install('global');
    const before = await Promise.all(
      [desktop, web].map((dir) => fs.readFile(path.join(dir, 'cordis.patch.yml'), 'utf8')),
    );
    await fs.writeFile(path.join(root, '.dsh/hooks.json'), '{invalid');
    expect(await installCometHooksForPlatform(root, dsh, 'global')).toMatchObject({
      status: 'failed',
    });
    expect(
      await Promise.all(
        [desktop, web].map((dir) => fs.readFile(path.join(dir, 'cordis.patch.yml'), 'utf8')),
      ),
    ).toEqual(before);
  });

  it('installs a loadable insertion that matches native lower-case write and edit tools', async () => {
    const hooks = await install();
    const warnings: string[] = [];
    const entries = applyEntryPatches(
      [],
      await rows(path.join(root, '.dsh/cordis.patch.yml')),
      (m: string) => warnings.push(m),
    );
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: '@deepseek-ai/dsh-hooks-claude-code',
      config: { configPath: path.join(root, '.dsh/hooks.json').replaceAll('\\', '/') },
    });
    for (const tool of ['write', 'edit'])
      expect(matchesMatcher(hooks.hooks.PreToolUse[0].matcher, tool, 'claude-code')).toBe(true);
    expect(matchesMatcher(hooks.hooks.PreToolUse[0].matcher, 'read', 'claude-code')).toBe(false);
  });

  it('migrates the legacy root row into existing profiles without loading a duplicate bridge', async () => {
    const desktop = await profile('desktop');
    const web = await profile('web');
    const configPath = path.join(root, '.dsh/hooks.json').replaceAll('\\', '/');
    await fs.writeFile(
      path.join(root, '.dsh/cordis.patch.yml'),
      `- dsh-hooks-claude-code:\n    configPath: ${configPath}\n- insert:\n    - id: user-root\n      name: user-root\n`,
    );
    await install('global');
    await install('global');
    for (const dir of [desktop, web]) {
      const user = [{ id: 'user-plugin', name: 'user-plugin' }];
      const entries = applyEntryPatches(
        user,
        [
          ...(await rows(path.join(dir, 'cordis.patch.yml'))),
          ...(await rows(path.join(root, '.dsh/cordis.patch.yml'))),
        ],
        () => {},
      );
      expect(
        entries.filter(
          (row: { name: string }) => row.name === '@deepseek-ai/dsh-hooks-claude-code',
        ),
      ).toHaveLength(1);
      expect(entries.find((row: { id: string }) => row.id === 'user-plugin')).toBeDefined();
    }
    expect(await removeCometHooksForPlatform(root, dsh, 'global')).toMatchObject({ failed: 0 });
    expect(await fs.readFile(path.join(desktop, 'cordis.patch.yml'), 'utf8')).toContain(
      'user-plugin',
    );
    expect(await fs.readFile(path.join(root, '.dsh/cordis.patch.yml'), 'utf8')).toContain(
      'user-root',
    );
    expect(JSON.stringify(await rows(path.join(desktop, 'cordis.patch.yml')))).not.toContain(
      'dsh-hooks-claude-code',
    );
  });

  it('rejects a legacy map row, disabled insertion and missing profile bridge during inspection', async () => {
    await install();
    const patch = path.join(root, '.dsh/cordis.patch.yml');
    await fs.writeFile(
      patch,
      '- dsh-hooks-claude-code:\n    configPath: ./.dsh/hooks.json\n    projectDir: .\n',
    );
    expect(await inspectCometHooksForPlatform(root, dsh, 'project')).toMatchObject({
      present: false,
      managedPresent: true,
      error: expect.any(String),
    });
    await install();
    const entries = await rows(patch);
    entries[0].insert[0].disabled = true;
    await fs.writeFile(patch, (await import('yaml')).stringify(entries));
    expect(await inspectCometHooksForPlatform(root, dsh, 'project')).toMatchObject({
      present: false,
      error: expect.any(String),
    });
    const desktop = await profile('desktop');
    await install('global');
    await fs.writeFile(path.join(desktop, 'cordis.patch.yml'), '[]\n');
    expect(await inspectCometHooksForPlatform(root, dsh, 'global')).toMatchObject({
      present: false,
      error: expect.stringContaining('desktop'),
    });
  });

  it('doctor warns about activation rather than claiming an active project bridge', async () => {
    await install();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await doctorCommand(root, { json: true, scope: 'project', homeDir: path.join(root, 'home') });
      const report = JSON.parse(log.mock.calls.map((args) => args.join(' ')).join('\n'));
      const hook = report.results.find(
        (row: { check: string }) => row.check === 'hooks: DeepSeek Harness (project)',
      );
      expect(hook).toMatchObject({
        status: 'warn',
        message: expect.stringMatching(/restart|--patch|activat/i),
      });
      expect(hook.message).not.toBe('exactly one managed Router Hook present');
    } finally {
      log.mockRestore();
    }
  });

  it('does not treat the home patch as desktop activation after a new profile is created', async () => {
    await install('global');
    await profile('desktop');
    expect(await inspectCometHooksForPlatform(root, dsh, 'global')).toMatchObject({
      present: false,
      error: expect.stringContaining('desktop'),
    });
    await install('global');
    expect(await inspectCometHooksForPlatform(root, dsh, 'global')).toMatchObject({
      present: true,
      activationRequired: true,
    });
  });

  it('preserves unrelated insertions and refuses a conflicting bridge id', async () => {
    const desktop = await profile(
      'desktop',
      '- insert: []\n- insert:\n    - id: comet-workflow-guard\n      name: user-plugin\n',
    );
    const patch = path.join(desktop, 'cordis.patch.yml');
    const original = await fs.readFile(patch, 'utf8');
    expect(await installCometHooksForPlatform(root, dsh, 'global')).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('comet-workflow-guard'),
    });
    expect(await fs.readFile(patch, 'utf8')).toBe(original);
  });

  it.runIf(process.platform === 'win32').each(['project', 'global'] as const)(
    'preserves a %s router denial through PowerShell and the actual DSH codec',
    async (scope) => {
      const hooks = await install(scope);
      await fs.mkdir(path.join(root, '.comet'), { recursive: true });
      await fs.writeFile(path.join(root, '.comet/config.yaml'), 'schema: invalid\n');
      const result = spawnSync(
        'pwsh',
        ['-NoProfile', '-Command', hooks.hooks.PreToolUse[0].hooks[0].command],
        {
          cwd: scope === 'global' ? path.dirname(root) : root,
          input: JSON.stringify({
            hook_event_name: 'PreToolUse',
            tool_name: 'write',
            cwd: root,
            tool_input: { file_path: 'src/app.ts' },
          }),
          encoding: 'utf8',
          timeout: 15_000,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(
        parseHookOutput(result.status, result.stdout, result.stderr, 'PreToolUse'),
      ).toMatchObject({
        decision: 'deny',
        reason: expect.stringContaining('Unsupported Comet project schema'),
      });
    },
  );
});
