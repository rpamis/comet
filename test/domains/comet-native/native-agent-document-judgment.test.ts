import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';
import {
  validateNativeBrief,
  validateNativeSpecDocumentText,
  validateNativeVerification,
} from '../../../domains/comet-native/native-artifacts.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('leaves document meaning and headings to the Agent while rejecting unreadable or empty inputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-agent-documents-'));
  roots.push(root);
  await fs.writeFile(
    path.join(root, 'brief.md'),
    '# 工作说明\n保持现有行为；验收项目中的实际输出。\n',
  );
  expect(await validateNativeBrief(root, 'brief.md', { strict: true, structure: true })).toEqual({
    valid: true,
    findings: [],
  });
  expect(
    validateNativeSpecDocumentText(
      '# Notes\nTODO: describe the remaining detail after discussion.\n',
      'specs/worker/spec.md',
    ).valid,
  ).toBe(true);
  await fs.writeFile(path.join(root, 'verification.md'), '实际检查通过；保留现有接口。\n');
  expect((await validateNativeVerification(root, 'verification.md')).valid).toBe(true);
  await fs.writeFile(path.join(root, 'brief.md'), '   \n');
  expect((await validateNativeBrief(root, 'brief.md')).valid).toBe(false);
  expect((await validateNativeBrief(root, 'missing.md')).valid).toBe(false);
});

it.each(['source', 'generated'] as const)(
  'prepares a Native Shape without fixed sections or a Spec exemption phrase through %s',
  async (entry) => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'native-agent-shape-'));
    roots.push(base);
    const root = path.join(base, 'project'),
      home = path.join(base, 'home');
    await fs.mkdir(root);
    await fs.mkdir(home);
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('XDG_DATA_HOME', path.join(home, '.local/share'));
    const invoke = async (...args: string[]) => {
      const input = [...args, '--project-root', root, '--json'];
      if (entry === 'source') return runNativeCli(input);
      const result = spawnSync(
        process.execPath,
        [path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs'), ...input],
        { cwd: root, encoding: 'utf8', windowsHide: true },
      );
      return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    };
    expect((await invoke('new', 'plain-documents', '--runtime', 'sdk')).exitCode).toBe(0);
    await fs.writeFile(
      path.join(root, 'docs/comet/changes/plain-documents/brief.md'),
      '# 工作说明\n保留已有输出，Agent 已核对本次只需解释现有行为。\n# Decisions\nSupervisor Change 是背景讨论，并未选择此协作方式。\n- Child 1: 背景方案甲。\n- Child 2: 背景方案乙。\n# Acceptance examples\n- The existing result remains available.\n',
    );
    const prepared = await invoke('next', 'plain-documents');
    expect(prepared.exitCode, prepared.stdout ?? prepared.stderr).toBe(0);
    const before = await inspectNativeSdkRun(root, 'plain-documents');
    expect(before.state).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      acceptance: [{ id: 'A1', text: 'The existing result remains available.' }],
    });
    await invoke('next', 'plain-documents');
    expect((await inspectNativeSdkRun(root, 'plain-documents')).run).toEqual(before.run);
    expect(before.run.actions.some((action) => action.stepId === 'build.builder')).toBe(false);
  },
);

it.each(['source', 'generated'] as const)(
  'submits Agent-selected acceptance from freeform documents through the Native business entry via %s',
  async (entry) => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'native-agent-acceptance-'));
    roots.push(base);
    const root = path.join(base, 'project'),
      home = path.join(base, 'home');
    await fs.mkdir(root);
    await fs.mkdir(home);
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('XDG_DATA_HOME', path.join(home, '.local/share'));
    const invoke = async (...args: string[]) => {
      const input = [...args, '--project-root', root, '--json'];
      if (entry === 'source') return runNativeCli(input);
      const result = spawnSync(
        process.execPath,
        [path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs'), ...input],
        { cwd: root, encoding: 'utf8', windowsHide: true },
      );
      return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    };
    const name = 'freeform-acceptance';
    expect((await invoke('new', name, '--runtime', 'sdk')).exitCode).toBe(0);
    await fs.writeFile(
      path.join(root, 'docs/comet/changes', name, 'brief.md'),
      '# 目标\n保留既有输出和接口。Agent 根据这段说明提交验收条目。\n',
    );
    const claimed = await invoke('next', name, '--session', 'shape-agent');
    expect(claimed.exitCode, claimed.stdout ?? claimed.stderr).toBe(0);
    const data = JSON.parse(claimed.stdout!).data;
    expect(data.task).toMatchObject({ role: 'shape', session: 'shape-agent' });
    expect(data.resultTemplate.output).toHaveProperty('acceptance');
    const file = path.join(root, 'shape-result.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        status: 'succeeded',
        output: { acceptance: [{ source: 'brief.md', text: '既有接口返回原定输出。' }] },
      }),
    );
    const wrong = await invoke(
      'next',
      name,
      '--action',
      data.task.actionId,
      '--session',
      'another-agent',
      '--result',
      file,
    );
    expect(wrong.exitCode).not.toBe(0);
    const submitted = await invoke(
      'next',
      name,
      '--action',
      data.task.actionId,
      '--session',
      'shape-agent',
      '--result',
      file,
    );
    expect(submitted.exitCode, submitted.stdout ?? submitted.stderr).toBe(0);
    const before = await inspectNativeSdkRun(root, name);
    expect(before.state).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      acceptance: [{ id: 'A1', source: 'brief.md', text: '既有接口返回原定输出。' }],
    });
    await invoke('next', name, '--session', 'shape-agent');
    expect((await inspectNativeSdkRun(root, name)).run).toEqual(before.run);
    expect(before.run.actions.some((action) => action.stepId === 'build.builder')).toBe(false);
    await fs.writeFile(
      file,
      JSON.stringify({
        status: 'succeeded',
        output: { acceptance: [{ source: 'brief.md', text: '另一条未经批准的目标。' }] },
      }),
    );
    expect(
      (
        await invoke(
          'next',
          name,
          '--action',
          data.task.actionId,
          '--session',
          'shape-agent',
          '--result',
          file,
        )
      ).exitCode,
    ).not.toBe(0);
    expect((await inspectNativeSdkRun(root, name)).run).toEqual(before.run);
    await fs.writeFile(
      file,
      JSON.stringify({
        status: 'succeeded',
        output: { acceptance: [{ source: 'brief.md', text: '既有接口返回原定输出。' }] },
      }),
    );
    // 此决定只属于隔离夹具，不代表真实 change 已获用户批准。
    const approved = await invoke(
      'next',
      name,
      '--confirmed',
      '--summary',
      'Fixture user approved the criteria.',
      '--expected-state-version',
      String(before.state.state_version),
      '--expected-action',
      'confirm-shape',
    );
    expect(approved.exitCode, approved.stdout ?? approved.stderr).toBe(0);
    const approvedRun = (await inspectNativeSdkRun(root, name)).run;
    const repeated = await invoke(
      'next',
      name,
      '--action',
      data.task.actionId,
      '--session',
      'shape-agent',
      '--result',
      file,
    );
    expect(repeated.exitCode, repeated.stdout ?? repeated.stderr).toBe(0);
    expect((await inspectNativeSdkRun(root, name)).run).toEqual(approvedRun);
  },
);
