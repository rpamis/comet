import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { buildPluginIntegration } from '../../../scripts/build/build-plugin-integration.mjs';
import { preparePluginIntegration } from '../../../domains/skill/plugin-integration.js';
import {
  buildNodeHookCommand,
  readNodeHookArguments,
} from '../../../platform/process/hook-command.js';

let root: string;
let plugin: string;
let project: string;
let configRoot: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet plugin hook '));
  plugin = path.join(root, 'cache/comet-market/comet/0.5.3');
  project = path.join(root, 'project');
  configRoot = path.join(root, 'codex');
  await fs.mkdir(path.join(project, '.git'), { recursive: true });
  for (const skill of ['comet', 'comet-native'])
    await fs.cp(
      path.resolve('assets/skills', skill, 'scripts'),
      path.join(plugin, 'skills', skill, 'scripts'),
      { recursive: true },
    );
  await buildPluginIntegration(plugin);
  await preparePluginIntegration({
    platform: 'codex',
    pluginRoot: plugin,
    env: { CODEX_HOME: configRoot },
  });
  await fs.writeFile(
    path.join(configRoot, 'config.toml'),
    '[plugins."comet@comet-market"]\nenabled = true\n',
  );
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function invocation(event = 'PreToolUse', platform = 'codex') {
  const file =
    platform === 'codex'
      ? path.join(configRoot, 'hooks.json')
      : (
          await preparePluginIntegration({
            platform: 'dsh',
            pluginRoot: plugin,
            env: { DSH_HOME: path.join(root, 'dsh') },
          })
        ).hookConfigPath;
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  return readNodeHookArguments(config.hooks[event][0].hooks[0].command)!;
}
function execute(args: string[], file = 'src/feature.ts', payload: Record<string, unknown> = {}) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: configRoot },
    input: JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: file },
      cwd: project,
      ...payload,
    }),
    encoding: 'utf8',
    windowsHide: true,
  });
}
async function activeChange() {
  await fs.mkdir(path.join(project, '.comet'));
  await fs.writeFile(
    path.join(project, '.comet/config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
  );
  await fs.writeFile(
    path.join(project, '.comet/current-change.json'),
    JSON.stringify({
      schema: 'comet.selection.v2',
      workflow: 'classic',
      change: 'selected',
      branch: null,
    }),
  );
  for (const change of ['selected', 'other']) {
    const dir = path.join(project, 'openspec/changes', change);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, '.comet.yaml'),
      'workflow: hotfix\nphase: build\ndesign_doc: null\nplan: null\nverification_report: null\nbuild_mode: direct\nisolation: null\nverify_mode: null\nverify_result: pending\nverified_at: null\narchived: false\n',
    );
  }
}

it('runs the packaged router in the event project and provides rules without initializing ordinary projects', async () => {
  const args = await invocation();
  const ordinary = execute(args);
  expect(ordinary.status, ordinary.stderr).toBe(0);
  await expect(fs.access(path.join(project, '.comet'))).rejects.toThrow();
  const session = execute(await invocation('SessionStart'));
  expect(session.status, session.stderr).toBe(0);
  expect(JSON.parse(session.stdout).hookSpecificOutput).toMatchObject({
    hookEventName: 'SessionStart',
    additionalContext: expect.stringContaining('Comet'),
  });
  await activeChange();
  const denied = execute(args, 'openspec/changes/other/tasks.md');
  expect(denied.status, denied.stderr).toBe(0);
  expect(JSON.parse(denied.stdout).hookSpecificOutput).toMatchObject({
    permissionDecision: 'deny',
    permissionDecisionReason: expect.stringContaining("belongs to Classic change 'other'"),
  });
  expect(execute(args).status).toBe(0);
});

it('imports workspace and change-local business records through the packaged SessionStart hook', async () => {
  await activeChange();
  const change = path.join(project, 'openspec/changes/selected');
  const changeId = 'd25ad676-7df6-4d20-86c8-9a20c40d1974';
  await fs.appendFile(path.join(change, '.comet.yaml'), `change_id: ${changeId}\n`);

  const workspaceRecord = 'native/changes/older/trajectory.jsonl';
  const workspaceSource = path.join(project, '.comet/runtime', workspaceRecord);
  const classicSource = path.join(change, '.comet/trajectory.jsonl');
  const workspaceLog = '{"event":"native history"}\n';
  const classicLog = '{"event":"classic history"}\n';
  await fs.mkdir(path.dirname(workspaceSource), { recursive: true });
  await fs.mkdir(path.dirname(classicSource), { recursive: true });
  await fs.writeFile(workspaceSource, workspaceLog);
  await fs.writeFile(classicSource, classicLog);

  vi.stubEnv('COMET_DATA_DIR', path.join(root, 'comet-data'));
  try {
    const session = execute(await invocation('SessionStart'));
    expect(session.status, session.stderr).toBe(0);
    const runtime = resolveWorkspaceRuntimeRootSync(project);
    expect(await fs.readFile(path.join(runtime, workspaceRecord), 'utf8')).toBe(workspaceLog);
    const classicTarget = path.join(
      runtime,
      'classic-changes',
      changeId,
      '.comet/trajectory.jsonl',
    );
    expect(await fs.readFile(classicTarget, 'utf8')).toBe(classicLog);
    expect(await fs.readFile(workspaceSource, 'utf8')).toBe(workspaceLog);
    expect(await fs.readFile(classicSource, 'utf8')).toBe(classicLog);
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each(['dsh', 'codex'] as const)(
  'keeps legitimate writes available and rejects cross-change writes when piped Node children are forbidden (%s)',
  async (platform) => {
    const preload = path.join(root, 'restrict-node-children.mjs');
    const attempts = path.join(root, 'blocked-node-children.log');
    await fs.writeFile(
      preload,
      `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';
const original = childProcess.spawnSync;
childProcess.spawnSync = function(command, args, options) {
  if (command === process.execPath && options?.stdio !== 'inherit') {
    appendFileSync(${JSON.stringify(attempts)}, 'EPERM: piped Node child\\n');
    return { status: null, signal: null, stdout: '', stderr: '',
      error: Object.assign(new Error('spawnSync ' + command + ' EPERM'), { code: 'EPERM' }) };
  }
  return original(command, args, options);
};
syncBuiltinESMExports();
`,
    );
    const args = [
      '--import',
      pathToFileURL(preload).href,
      ...(await invocation('PreToolUse', platform)),
    ];
    const ordinary = execute(args);
    expect(ordinary.status, ordinary.stderr).toBe(0);
    expect(ordinary.stdout).toBe('');
    await expect(fs.access(path.join(project, '.comet'))).rejects.toThrow();
    await activeChange();
    const allowed = execute(args);
    expect(allowed.status, allowed.stderr).toBe(0);
    expect(allowed.stdout).toBe('');
    const denied = execute(args, 'openspec/changes/other/tasks.md');
    expect(denied.status, denied.stderr).toBe(0);
    expect(JSON.parse(denied.stdout).hookSpecificOutput).toMatchObject({
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringContaining("belongs to Classic change 'other'"),
    });
    await expect(fs.access(attempts)).rejects.toThrow();
  },
);

it.each(['codex', 'dsh'] as const)(
  'provides a reusable Rule pointer instead of repeating the full Rule on startup and compact (%s)',
  async (platform) => {
    await activeChange();
    const args = await invocation('SessionStart', platform);
    const rulePath = path.join(plugin, 'rules/comet-workflow-guard.md');
    const rule = await fs.readFile(rulePath, 'utf8');
    for (const source of ['startup', 'resume', 'compact']) {
      const result = execute(args, 'src/feature.ts', {
        session_id: 'same-real-platform-session',
        source,
      });
      expect(result.status, result.stderr).toBe(0);
      const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
      expect(context).toContain(rulePath);
      expect(context).toContain('.comet/current-change.json');
      expect(context).toContain('压缩');
      expect(context).toContain('必须读取并执行');
      expect(context).not.toContain(rule);
      expect(Buffer.byteLength(context)).toBeLessThan(Buffer.byteLength(rule) / 4);
      if (source === 'startup')
        console.info({
          platform,
          ruleBytes: Buffer.byteLength(rule),
          contextBytes: Buffer.byteLength(context),
        });
    }
    const denied = execute(
      await invocation('PreToolUse', platform),
      'openspec/changes/other/tasks.md',
    );
    expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  },
);

it('delivers the English Rule pointer with the same read and recovery requirements', async () => {
  await buildPluginIntegration(plugin, 'en');
  await preparePluginIntegration({
    platform: 'codex',
    pluginRoot: plugin,
    env: { CODEX_HOME: configRoot },
  });
  const result = execute(await invocation('SessionStart'));
  expect(result.status, result.stderr).toBe(0);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  expect(context).toContain('read and follow the complete Rule');
  expect(context).toContain('reread it after compaction');
  expect(context).toContain(path.join(plugin, 'rules/comet-workflow-guard.md'));
  expect(context).not.toContain('# Comet Current-Change Phase Rule');
});

it('enforces native Codex command patches through the packaged router and preserves legitimate writes', async () => {
  await activeChange();
  const args = await invocation();
  const patch = (file: string) => `*** Begin Patch\n*** Add File: ${file}\n+fixture\n*** End Patch`;
  const run = (file: string) =>
    spawnSync(process.execPath, args, {
      cwd: root,
      env: { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: configRoot },
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'apply_patch',
        tool_input: { command: patch(file) },
        cwd: project,
      }),
      encoding: 'utf8',
      windowsHide: true,
    });
  const denied = run('openspec/changes/other/tasks.md');
  expect(denied.status, denied.stderr).toBe(0);
  expect(JSON.parse(denied.stdout).hookSpecificOutput).toMatchObject({
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: expect.stringContaining("belongs to Classic change 'other'"),
  });
  const allowed = run('src/feature.ts');
  expect(allowed.status, allowed.stderr).toBe(0);
  if (process.platform === 'win32') {
    const deniedThroughShell = spawnSync(
      'pwsh',
      ['-NoProfile', '-Command', buildNodeHookCommand(args)],
      {
        cwd: root,
        env: { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: configRoot },
        input: JSON.stringify({
          tool_name: 'apply_patch',
          tool_input: { command: patch('openspec/changes/other/tasks.md') },
          cwd: project,
        }),
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    expect(deniedThroughShell.status, deniedThroughShell.stderr).toBe(0);
    expect(JSON.parse(deniedThroughShell.stdout).hookSpecificOutput).toMatchObject({
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringContaining("belongs to Classic change 'other'"),
    });
  }
});

it('keeps disabled and uninstalled Codex plugins inactive while preserving user hooks', async () => {
  await activeChange();
  const args = await invocation();
  await fs.writeFile(
    path.join(configRoot, 'config.toml'),
    '[plugins."comet@comet-market"]\nenabled = false\n',
  );
  expect(execute(args, 'openspec/changes/other/tasks.md').status).toBe(0);
  const file = path.join(configRoot, 'hooks.json');
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  config.hooks.PreToolUse.push({
    matcher: 'Read',
    hooks: [{ type: 'command', command: 'user-check' }],
  });
  await fs.writeFile(file, JSON.stringify(config));
  await fs.rm(plugin, { recursive: true, force: true });
  const removed = execute(args, 'openspec/changes/other/tasks.md');
  expect(removed.status, removed.stderr).toBe(0);
  const after = JSON.parse(await fs.readFile(file, 'utf8'));
  expect(after.hooks.PreToolUse).toEqual([
    { matcher: 'Read', hooks: [{ type: 'command', command: 'user-check' }] },
  ]);
  expect(after.hooks.SessionStart).toEqual([]);
});

it('migrates only old Comet project hooks after execution and preserves a legitimate write path', async () => {
  const projectConfig = path.join(project, '.codex/hooks.json');
  await fs.mkdir(path.dirname(projectConfig));
  const old = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'command',
              command: buildNodeHookCommand([
                path.join(project, '.agents/skills/comet/scripts/comet-hook-router.mjs'),
                '--platform',
                'codex',
              ]),
            },
            { type: 'command', command: 'user-check' },
          ],
        },
      ],
    },
  });
  await fs.writeFile(projectConfig, old);
  await preparePluginIntegration({
    platform: 'codex',
    pluginRoot: plugin,
    env: { CODEX_HOME: configRoot },
  });
  expect(await fs.readFile(projectConfig, 'utf8')).toBe(old);
  expect(execute(await invocation()).status).toBe(0);
  const after = await fs.readFile(projectConfig, 'utf8');
  expect(after).not.toContain('comet-hook-router');
  expect(after).toContain('user-check');
  expect(execute(await invocation()).status).toBe(0);
  expect(await fs.readFile(projectConfig, 'utf8')).toBe(after);
});

it('denies modified packages and DSH startup failures using the platform protocol', async () => {
  const codexArgs = await invocation();
  const dshArgs = await invocation('PreToolUse', 'dsh');
  await fs.appendFile(path.join(plugin, 'rules/comet-workflow-guard.md'), '\nchanged');
  const modifiedCodex = execute(codexArgs);
  expect(modifiedCodex.status).toBe(0);
  expect(JSON.parse(modifiedCodex.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  const modified = execute(dshArgs);
  expect(modified.status).toBe(0);
  expect(JSON.parse(modified.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  const failed = execute([...dshArgs, '--bad']);
  expect(failed.status).toBe(0);
  expect(JSON.parse(failed.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
});

it('does not turn a failed DSH router process into an allowed tool execution', async () => {
  await fs.writeFile(
    path.join(plugin, 'skills/comet/scripts/comet-hook-router.mjs'),
    // Router is now loaded in process. A module-load failure must retain the
    // original fail-closed assertions for both plugin platforms.
    'throw new Error("router failed");',
  );
  const failed = execute(await invocation('PreToolUse', 'dsh'));
  expect(failed.status).toBe(0);
  expect(JSON.parse(failed.stdout).hookSpecificOutput).toMatchObject({
    permissionDecision: 'deny',
    permissionDecisionReason: expect.stringContaining('router failed'),
  });
  await preparePluginIntegration({
    platform: 'codex',
    pluginRoot: plugin,
    env: { CODEX_HOME: configRoot },
  });
  const failedCodex = execute(await invocation());
  expect(failedCodex.status).toBe(0);
  expect(JSON.parse(failedCodex.stdout).hookSpecificOutput).toMatchObject({
    permissionDecision: 'deny',
    permissionDecisionReason: expect.stringContaining('router failed'),
  });
});

it('denies inspection failures from the packaged router on both plugin platforms', async () => {
  await fs.writeFile(
    path.join(plugin, 'skills/comet/scripts/comet-hook-router.mjs'),
    'export async function inspectCometHookRequest() { throw new Error("inspection failed"); }',
  );
  for (const platform of ['dsh', 'codex']) {
    await preparePluginIntegration({
      platform: platform as 'dsh' | 'codex',
      pluginRoot: plugin,
      env: { CODEX_HOME: configRoot, DSH_HOME: path.join(root, 'dsh') },
    });
    const failed = execute(await invocation('PreToolUse', platform));
    expect(failed.status, failed.stderr).toBe(0);
    expect(JSON.parse(failed.stdout).hookSpecificOutput).toMatchObject({
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringContaining('inspection failed'),
    });
  }
});

it('does not migrate files for an invalid hook event or malformed payload', async () => {
  const skill = path.join(project, '.agents/skills/comet/SKILL.md');
  await fs.mkdir(path.dirname(skill), { recursive: true });
  const original = await fs.readFile(path.resolve('assets/skills/comet/SKILL.md'), 'utf8');
  await fs.writeFile(skill, original);
  const config = await fs.readFile(path.join(configRoot, 'config.toml'), 'utf8');
  const invalid = await invocation();
  invalid[invalid.indexOf('--event') + 1] = 'Unknown';
  const invalidResult = execute(invalid);
  expect(invalidResult.status).toBe(0);
  expect(JSON.parse(invalidResult.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  const malformed = spawnSync(process.execPath, await invocation(), {
    input: '{broken',
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, HOME: root, USERPROFILE: root },
  });
  expect(malformed.status).toBe(0);
  expect(JSON.parse(malformed.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  expect(await fs.readFile(skill, 'utf8')).toBe(original);
  expect(await fs.readFile(path.join(configRoot, 'config.toml'), 'utf8')).toBe(config);
});
