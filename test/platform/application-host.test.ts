import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  previewApplicationHostIntegration,
  installApplicationHostIntegration,
  type ApplicationHostIntegrationOptions,
} from '../../platform/install/application-host.js';

describe('SDK application host integration', () => {
  let root: string;
  let options: ApplicationHostIntegrationOptions;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'comet-app-host-'));
    await writeFile(path.join(root, 'guard.md'), '# Comet workflow guard\nUse the SDK Run.\n');
    await writeFile(
      path.join(root, 'router.mjs'),
      "let input=''; for await (const c of process.stdin) input+=c; const value=JSON.parse(input); if(value.tool_input?.file_path?.endsWith('blocked.txt')) { console.error('blocked by SDK'); process.exit(2); }\n",
    );
    options = {
      platformId: 'claude',
      projectRoot: root,
      scope: 'project',
      skillsRoot: path.join(root, '.claude/skills'),
      ruleSource: path.join(root, 'guard.md'),
      routerSource: path.join(root, 'router.mjs'),
    };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('keeps original user settings complete when writing the temporary replacement fails', async () => {
    await mkdir(path.join(root, '.claude'), { recursive: true });
    const target = path.join(root, '.claude/settings.local.json');
    const original = JSON.stringify({ userSetting: 'retain before EIO', hooks: { Stop: [] } });
    await writeFile(target, original);
    const preview = await previewApplicationHostIntegration(options);
    const realOpen = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      if (String(args[0]).includes('.settings.local.json.') && String(args[0]).endsWith('.tmp')) {
        const error = Object.assign(new Error('temporary write EIO'), { code: 'EIO' });
        vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(error);
      }
      return handle;
    });
    await expect(installApplicationHostIntegration({ ...options, preview })).rejects.toThrow(
      'temporary write EIO',
    );
    expect(await readFile(target, 'utf8')).toBe(original);
    expect((await fs.readdir(path.dirname(target))).some((name) => name.endsWith('.tmp'))).toBe(
      false,
    );
  });

  it('rechecks configuration drift after temporary write and preserves the newer user content', async () => {
    await mkdir(path.join(root, '.claude'), { recursive: true });
    const target = path.join(root, '.claude/settings.local.json');
    await writeFile(target, JSON.stringify({ userSetting: 'before' }));
    const changed = JSON.stringify({ userSetting: 'updated during installation' });
    const preview = await previewApplicationHostIntegration(options);
    const realOpen = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      if (String(args[0]).includes('.settings.local.json.') && String(args[0]).endsWith('.tmp')) {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
          await close();
          await writeFile(target, changed);
        });
      }
      return handle;
    });
    await expect(installApplicationHostIntegration({ ...options, preview })).rejects.toThrow(
      /drift|changed/i,
    );
    expect(await readFile(target, 'utf8')).toBe(changed);
  });

  it('publishes a new configuration exclusively and preserves a concurrent target', async () => {
    const target = path.join(root, '.claude/settings.local.json');
    const changed = JSON.stringify({ userSetting: 'created concurrently' });
    const preview = await previewApplicationHostIntegration(options);
    const realLink = fs.link;
    vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
      if (String(destination) === target) await writeFile(target, changed);
      return realLink(source, destination);
    });
    await expect(installApplicationHostIntegration({ ...options, preview })).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(target, 'utf8')).toBe(changed);
  });

  it('previews without writing and installs one shared rule/router with a runnable Claude exec hook', async () => {
    const preview = await previewApplicationHostIntegration(options);
    expect(preview.noFilesWritten).toBe(true);
    expect(preview.files.map((file) => file.role)).toEqual(['rule', 'router', 'hook-config']);
    await expect(readFile(path.join(root, '.claude/settings.local.json'))).rejects.toThrow();
    const result = await installApplicationHostIntegration({ ...options, preview });
    expect(result.hook.status).toBe('installed');
    const settings = JSON.parse(
      await readFile(path.join(root, '.claude/settings.local.json'), 'utf8'),
    );
    const entry = settings.hooks.PreToolUse[0].hooks[0];
    expect(entry.command).toBe('node');
    expect(entry.args).toContain('--project-root');
    const invocation = spawnSync(entry.command, entry.args, {
      input: JSON.stringify({
        cwd: root,
        tool_name: 'Write',
        tool_input: { file_path: path.join(root, 'blocked.txt') },
      }),
      encoding: 'utf8',
    });
    expect(invocation.status).toBe(2);
    expect(invocation.stderr).toContain('blocked by SDK');
    const second = await previewApplicationHostIntegration(options);
    expect(second.files.every((file) => file.operation === 'unchanged')).toBe(true);
    expect(
      (await installApplicationHostIntegration({ ...options, preview: second })).writtenFiles,
    ).toEqual([]);
  });

  it('reuses the shared Claude Hook already installed by Comet', async () => {
    await mkdir(path.join(root, '.claude'), { recursive: true });
    const handler = {
      type: 'command',
      command: 'node',
      args: [
        path.join(options.skillsRoot, 'comet/scripts/comet-hook-router.mjs'),
        '--platform',
        'claude',
        '--project-root',
        root,
      ],
    };
    await writeFile(
      path.join(root, '.claude/settings.local.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [handler] }] } }),
    );
    const preview = await previewApplicationHostIntegration(options);
    expect(preview.conflicts).toEqual([]);
    await installApplicationHostIntegration({ ...options, preview });
    const config = JSON.parse(
      await readFile(path.join(root, '.claude/settings.local.json'), 'utf8'),
    );
    expect(config.hooks.PreToolUse).toHaveLength(1);
    expect(config.hooks.PreToolUse[0].hooks).toEqual([handler]);
  });

  it('loads the shipped shared router through the installed Claude configuration', async () => {
    const scoped = {
      ...options,
      routerSource: path.resolve('assets/skills/comet/scripts/comet-hook-router.mjs'),
    };
    const preview = await previewApplicationHostIntegration(scoped);
    await installApplicationHostIntegration({ ...scoped, preview });
    const config = JSON.parse(
      await readFile(path.join(root, '.claude/settings.local.json'), 'utf8'),
    );
    const handler = config.hooks.PreToolUse[0].hooks[0];
    const invocation = spawnSync(handler.command, handler.args, {
      input: JSON.stringify({
        cwd: root,
        tool_name: 'Write',
        tool_input: { file_path: 'example.txt' },
      }),
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(invocation.status, invocation.stderr).toBe(0);
  });

  it('preserves user settings and unrelated hook groups without exposing their content in preview', async () => {
    await mkdir(path.join(root, '.claude'), { recursive: true });
    const original = {
      secret: 'should-not-be-in-preview',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user' }] }],
      },
    };
    await writeFile(path.join(root, '.claude/settings.local.json'), JSON.stringify(original));
    const preview = await previewApplicationHostIntegration(options);
    expect(JSON.stringify(preview)).not.toContain(original.secret);
    await installApplicationHostIntegration({ ...options, preview });
    const installed = JSON.parse(
      await readFile(path.join(root, '.claude/settings.local.json'), 'utf8'),
    );
    expect(installed.secret).toBe(original.secret);
    expect(installed.hooks.Stop).toEqual(original.hooks.Stop);
    expect(installed.hooks.PreToolUse[0]).toEqual(original.hooks.PreToolUse[0]);
  });

  it('rejects configuration drift before writing any other target', async () => {
    const preview = await previewApplicationHostIntegration(options);
    await mkdir(path.join(root, '.claude'), { recursive: true });
    await writeFile(path.join(root, '.claude/settings.local.json'), '{}');
    await expect(installApplicationHostIntegration({ ...options, preview })).rejects.toThrow(
      /changed|drift/i,
    );
    await expect(
      readFile(path.join(root, '.claude/rules/comet-workflow-guard.md')),
    ).rejects.toThrow();
  });

  it('rejects source drift after preview', async () => {
    const preview = await previewApplicationHostIntegration(options);
    await writeFile(options.ruleSource, 'changed rule');
    await expect(installApplicationHostIntegration({ ...options, preview })).rejects.toThrow(
      /changed|drift/i,
    );
  });

  it('blocks user-owned rule conflicts and malformed configuration without partial writes', async () => {
    await mkdir(path.join(root, '.claude/rules'), { recursive: true });
    await writeFile(path.join(root, '.claude/rules/comet-workflow-guard.md'), 'user owned');
    let preview = await previewApplicationHostIntegration(options);
    expect(preview.rule.status).toBe('conflict');
    await expect(installApplicationHostIntegration({ ...options, preview })).rejects.toThrow(
      /conflict/i,
    );
    await rm(path.join(root, '.claude/rules/comet-workflow-guard.md'));
    await writeFile(path.join(root, '.claude/settings.local.json'), '{invalid');
    preview = await previewApplicationHostIntegration(options);
    expect(preview.hook.status).toBe('conflict');
    await expect(installApplicationHostIntegration({ ...options, preview })).rejects.toThrow(
      /conflict/i,
    );
  });

  it('protects symlinked parent directories', async () => {
    const external = path.join(root, 'external');
    await mkdir(external);
    await symlink(
      external,
      path.join(root, '.claude'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const preview = await previewApplicationHostIntegration(options);
    expect(preview.conflicts.join(' ')).toMatch(/link/i);
    await expect(installApplicationHostIntegration({ ...options, preview })).rejects.toThrow(
      /conflict/i,
    );
    await expect(readFile(path.join(external, 'settings.local.json'))).rejects.toThrow();
  });

  it('preserves a generated router hashbang so the installed Node entry remains runnable', async () => {
    const source = await readFile(options.routerSource, 'utf8');
    await writeFile(options.routerSource, `#!/usr/bin/env node\n${source}`);
    const preview = await previewApplicationHostIntegration(options);
    await installApplicationHostIntegration({ ...options, preview });
    const settings = JSON.parse(
      await readFile(path.join(root, '.claude/settings.local.json'), 'utf8'),
    );
    const handler = settings.hooks.PreToolUse[0].hooks[0];
    const invocation = spawnSync(handler.command, handler.args, {
      input: JSON.stringify({ tool_input: { file_path: 'blocked.txt' } }),
      encoding: 'utf8',
    });
    expect(invocation.status).toBe(2);
    expect(
      (await previewApplicationHostIntegration(options)).files.every(
        (file) => file.operation === 'unchanged',
      ),
    ).toBe(true);
  });

  it('does not expose malformed Hook configuration content in conflict messages', async () => {
    await mkdir(path.join(root, '.claude'));
    await writeFile(path.join(root, '.claude/settings.local.json'), '{privateToken-is-not-json}');
    const preview = await previewApplicationHostIntegration(options);
    expect(preview.hook.status).toBe('conflict');
    expect(JSON.stringify(preview)).not.toContain('privateToken');
  });

  it('blocks an ignored Codex AGENTS installation when a higher-priority override exists', async () => {
    const scoped = {
      ...options,
      platformId: 'codex',
      skillsRoot: path.join(root, '.agents/skills'),
    };
    await writeFile(path.join(root, 'AGENTS.override.md'), 'User override');
    const preview = await previewApplicationHostIntegration(scoped);
    expect(preview.rule.status).toBe('conflict');
    await expect(installApplicationHostIntegration({ ...scoped, preview })).rejects.toThrow(
      /conflict/i,
    );
  });

  it('writes Codex behavior into an AGENTS block and retains user instructions', async () => {
    options.platformId = 'codex';
    options.skillsRoot = path.join(root, '.agents/skills');
    await writeFile(path.join(root, 'AGENTS.md'), '# Project instructions\nRetain this.\n');
    const preview = await previewApplicationHostIntegration(options);
    const result = await installApplicationHostIntegration({ ...options, preview });
    const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('Retain this.');
    expect(agents).toContain('Use the SDK Run.');
    expect(result.rule.status).toBe('installed');
    expect(result.hook.status).toBe('installed');
    expect(result.hook.activationRequired).toContain(
      'Review and trust the current Hook in Codex /hooks',
    );
    expect(result.hook.executionVerified).toBe(false);
    const settings = JSON.parse(await readFile(path.join(root, '.codex/hooks.json'), 'utf8'));
    expect(settings.hooks.PreToolUse[0].matcher).toContain('apply_patch');
    const invocation = spawnSync(settings.hooks.PreToolUse[0].hooks[0].command, {
      shell: true,
      input: JSON.stringify({ tool_name: 'apply_patch', tool_input: { file_path: 'blocked.txt' } }),
      encoding: 'utf8',
    });
    expect(invocation.status).toBe(2);
    await expect(
      readFile(path.join(root, '.codex/rules/comet-workflow-guard.md')),
    ).rejects.toThrow();
  });

  it('keeps shell-sensitive project paths inert in non-exec-form Hook commands', async () => {
    const nested = path.join(root, "quote'$`directory");
    await mkdir(nested);
    const scoped = {
      ...options,
      platformId: 'codex',
      projectRoot: nested,
      skillsRoot: path.join(nested, '.agents/skills'),
    };
    const preview = await previewApplicationHostIntegration(scoped);
    await installApplicationHostIntegration({ ...scoped, preview });
    const settings = JSON.parse(await readFile(path.join(nested, '.codex/hooks.json'), 'utf8'));
    const invocation = spawnSync(settings.hooks.PreToolUse[0].hooks[0].command, {
      shell: true,
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'blocked.txt' } }),
      encoding: 'utf8',
    });
    expect(invocation.status).toBe(2);
    expect(invocation.stderr).toContain('blocked by SDK');
  });

  it('uses explicitly provided user root for user-scope rules, not the real HOME', async () => {
    const userRoot = path.join(root, 'isolated-user');
    options = {
      ...options,
      platformId: 'codex',
      scope: 'user',
      userRoot,
      skillsRoot: path.join(userRoot, '.agents/skills'),
    };
    const preview = await previewApplicationHostIntegration(options);
    expect(preview.rule.path).toBe(path.join(userRoot, '.codex/AGENTS.md'));
    await installApplicationHostIntegration({ ...options, preview });
    expect(await readFile(preview.rule.path!, 'utf8')).toContain('Use the SDK Run.');
  });

  it('requires an explicit isolated user root and rejects an escaped skills root', async () => {
    await expect(previewApplicationHostIntegration({ ...options, scope: 'user' })).rejects.toThrow(
      /userRoot/i,
    );
    await expect(
      previewApplicationHostIntegration({ ...options, skillsRoot: path.dirname(root) }),
    ).rejects.toThrow(/skillsRoot/i);
  });

  it('reports missing integration capability for unimplemented hook formats', async () => {
    const preview = await previewApplicationHostIntegration({
      ...options,
      platformId: 'oh-my-pi',
      skillsRoot: path.join(root, '.omp/skills'),
    });
    expect(preview.hook.status).toBe('unsupported');
    expect(preview.hook.reason).toBeTruthy();
    expect(preview.files.some((file) => file.role === 'hook-config')).toBe(false);
  });

  it('adopts the current Cursor shared rule without duplicating or rejecting it', async () => {
    const rule = await readFile(options.ruleSource, 'utf8');
    await mkdir(path.join(root, '.cursor/rules'), { recursive: true });
    await writeFile(
      path.join(root, '.cursor/rules/comet-workflow-guard.mdc'),
      `---\ndescription: comet workflow guard\nglobs:\nalwaysApply: true\n---\n\n${rule}`,
    );
    const preview = await previewApplicationHostIntegration({
      ...options,
      platformId: 'cursor',
      skillsRoot: path.join(root, '.cursor/skills'),
    });
    expect(preview.rule.status).toBe('available');
  });

  it('blocks a second encoded shared router at a different Skill root', async () => {
    const scoped = {
      ...options,
      platformId: 'codex',
      skillsRoot: path.join(root, '.agents/skills'),
    };
    const preview = await previewApplicationHostIntegration(scoped);
    await installApplicationHostIntegration({ ...scoped, preview });
    const changed = await previewApplicationHostIntegration({
      ...scoped,
      skillsRoot: path.join(root, '.agents/alternative-skills'),
    });
    expect(changed.hook.status).toBe('conflict');
    await expect(
      installApplicationHostIntegration({
        ...scoped,
        skillsRoot: path.join(root, '.agents/alternative-skills'),
        preview: changed,
      }),
    ).rejects.toThrow(/conflict/i);
  });

  it('upgrades the existing Codex shared shell Hook and preserves adjacent user handlers', async () => {
    const scoped = {
      ...options,
      platformId: 'codex',
      skillsRoot: path.join(root, '.agents/skills'),
    };
    await mkdir(path.join(root, '.codex'));
    const quote = (value: string) => `"${value.replaceAll('\\', '/')}"`;
    const legacyCommand = `node ${quote(path.join(scoped.skillsRoot, 'comet/scripts/comet-hook-router.mjs'))} --platform "codex" --project-root ${quote(root)}`;
    const userHandler = { type: 'command', command: 'echo user-hook' };
    await writeFile(
      path.join(root, '.codex/hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [{ type: 'command', command: legacyCommand }, userHandler],
            },
          ],
        },
      }),
    );
    const preview = await previewApplicationHostIntegration(scoped);
    expect(preview.hook.status).toBe('available');
    await installApplicationHostIntegration({ ...scoped, preview });
    const config = JSON.parse(await readFile(path.join(root, '.codex/hooks.json'), 'utf8'));
    const allHandlers = config.hooks.PreToolUse.flatMap(
      (group: { hooks: unknown[] }) => group.hooks,
    );
    expect(allHandlers).toHaveLength(2);
    expect(allHandlers).toContainEqual(userHandler);
    expect(
      allHandlers.filter((entry: { command: string }) => entry.command.includes('spawnSync')),
    ).toHaveLength(1);
  });
});
