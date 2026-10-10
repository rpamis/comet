import { getCurrentVersion } from '../../../platform/version/version.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { hashRuntimeValue } from '../../../domains/engine/runtime.js';
import {
  compileWorkflowApplication,
  prepareWorkflowApplicationPlan,
} from '../../../domains/workflow-generation/index.js';
import {
  previewWorkflowApplicationInstall,
  installWorkflowApplication,
  uninstallWorkflowApplication,
} from '../../../domains/workflow-application/index.js';
let root: string;
let file: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-host-delivery-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
  const plan = await prepareWorkflowApplicationPlan({
    projectRoot: root,
    packageRoot: path.join(root, 'preview'),
    proposal: {
      schema: 'comet.workflow.application.plan.v1',
      manifest: {
        schema: 'comet.workflow.application.v1',
        id: 'host-report',
        version: '1',
        base: 'standalone',
        runtimeVersion: getCurrentVersion(),
        entrySkill: 'SKILL.md',
        module: 'application.mjs',
        skills: [],
        bindings: [],
      },
      composition: { kind: 'report' },
      modules: {},
    },
  });
  file = (
    await compileWorkflowApplication({
      plan,
      confirmationHash: hashRuntimeValue(plan),
      projectRoot: root,
      packageRoot: path.join(root, 'compiled'),
    })
  ).file;
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it('previews and installs Skill/Runtime/Rule/Hook, preserves shared integration on uninstall, and detects config drift', async () => {
  const consumer = path.join(root, 'consumer');
  await fs.mkdir(consumer);
  const options = { file, projectRoot: consumer, scope: 'project' as const, platforms: ['claude'] };
  const preview = await previewWorkflowApplicationInstall(options);
  expect(preview.hostIntegration?.[0].files.map((f) => f.role)).toEqual(
    expect.arrayContaining(['rule', 'router', 'hook-config']),
  );
  expect(await fs.readdir(consumer)).toEqual([]);
  const installed = await installWorkflowApplication({
    ...options,
    confirmationHash: preview.confirmationHash,
  });
  expect(installed.hostIntegration?.[0].files.every((f) => f.operation === 'unchanged')).toBe(true);
  const settings = JSON.parse(
    await fs.readFile(path.join(consumer, '.claude/settings.local.json'), 'utf8'),
  );
  expect(settings.hooks.PreToolUse).toHaveLength(1);
  const unchanged = await previewWorkflowApplicationInstall(options);
  expect(unchanged.operation).toBe('unchanged');
  await fs.writeFile(
    path.join(consumer, '.claude/settings.local.json'),
    JSON.stringify({ ...settings, permissions: { deny: ['Bash(curl *)'] } }),
  );
  await expect(
    installWorkflowApplication({ ...options, confirmationHash: unchanged.confirmationHash }),
  ).rejects.toThrow(/预览已变化/);
  const uninstall = await uninstallWorkflowApplication({ ...options, id: 'host-report' });
  expect(uninstall.retainedHostIntegration).toBe(true);
  await uninstallWorkflowApplication({
    ...options,
    id: 'host-report',
    confirmationHash: uninstall.confirmationHash,
  });
  expect(
    await fs.readFile(path.join(consumer, '.claude/rules/comet-workflow-guard.md'), 'utf8'),
  ).toContain('application');
});
it('recovers an interrupted unpublished platform entry only through the original approved install intent', async () => {
  const consumer = path.join(root, 'consumer');
  await fs.mkdir(consumer);
  const options = { file, projectRoot: consumer, scope: 'project' as const, platforms: ['claude'] };
  const preview = await previewWorkflowApplicationInstall(options);
  // The recorded intent and exact planned entry represent a process stopping before current.json publication.
  const pending = path.join(preview.target, preview.id, 'pending-install.json');
  await fs.mkdir(path.dirname(pending), { recursive: true });
  await fs.writeFile(
    pending,
    JSON.stringify({ schema: 'comet.workflow.application.install.intent.v1', preview }),
  );
  const entry = preview.hostSkills[0];
  await fs.mkdir(entry.root, { recursive: true });
  const { applicationInstallSkills } =
    await import('../../../domains/workflow-application/install-record.js');
  const { readApplicationFiles } =
    await import('../../../domains/workflow-application/skill-adapter.js');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  const planned = applicationInstallSkills(
    manifest,
    await readApplicationFiles(path.dirname(file)),
    path.join(preview.target, preview.id, 'versions', preview.contentHash),
  )[0];
  await fs.writeFile(
    path.join(entry.root, 'SKILL.md'),
    Buffer.from(planned.files['SKILL.md'], 'base64'),
  );
  const installed = await installWorkflowApplication({
    ...options,
    confirmationHash: preview.confirmationHash,
  });
  expect(installed.contentHash).toBe(preview.contentHash);
  expect(
    (await previewWorkflowApplicationInstall(options)).hostSkills.every(
      (e) => e.operation === 'unchanged',
    ),
  ).toBe(true);
  await expect(fs.stat(pending)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('resumes an interrupted version copy without overwriting any present bytes', async () => {
  const consumer = path.join(root, 'consumer');
  await fs.mkdir(consumer);
  const options = { file, projectRoot: consumer, scope: 'project' as const, platforms: ['claude'] };
  const preview = await previewWorkflowApplicationInstall(options);
  const pending = path.join(preview.target, preview.id, 'pending-install.json');
  await fs.mkdir(path.dirname(pending), { recursive: true });
  await fs.writeFile(
    pending,
    JSON.stringify({ schema: 'comet.workflow.application.install.intent.v1', preview }),
  );
  const version = path.join(preview.target, preview.id, 'versions', preview.contentHash);
  await fs.mkdir(version, { recursive: true });
  await fs.copyFile(file, path.join(version, 'application.json'));
  expect(
    (await installWorkflowApplication({ ...options, confirmationHash: preview.confirmationHash }))
      .contentHash,
  ).toBe(preview.contentHash);
});

it('recovers the install lock of a forcibly terminated owner using the original approved intent', async () => {
  const consumer = path.join(root, 'consumer');
  await fs.mkdir(consumer);
  const options = { file, projectRoot: consumer, scope: 'project' as const, platforms: ['claude'] };
  const preview = await previewWorkflowApplicationInstall(options);
  const pending = path.join(preview.target, preview.id, 'pending-install.json');
  await fs.mkdir(path.dirname(pending), { recursive: true });
  await fs.writeFile(
    pending,
    JSON.stringify({ schema: 'comet.workflow.application.install.intent.v1', preview }),
  );
  const lock = path.join(preview.target, preview.id, 'operation.lock');
  const source = `import {withRecoverableFileLock} from ${JSON.stringify(pathToFileURL(path.join(process.cwd(), 'dist/platform/fs/plugin-store.js')).href)};await withRecoverableFileLock(${JSON.stringify(lock)},async()=>{process.stdout.write('LOCK_READY\\n');await new Promise(()=>{});});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  try {
    let ready = '';
    for await (const chunk of child.stdout!) {
      ready += chunk.toString();
      if (ready.includes('LOCK_READY')) break;
    }
    expect(ready).toContain('LOCK_READY');
    const closed = once(child, 'close');
    child.kill('SIGKILL');
    await closed;
    const installed = await installWorkflowApplication({
      ...options,
      confirmationHash: preview.confirmationHash,
    });
    expect(installed.contentHash).toBe(preview.contentHash);
    await expect(fs.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}, 30000);
