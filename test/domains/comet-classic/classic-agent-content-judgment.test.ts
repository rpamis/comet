import { reviseClassicSdkWork } from '../../../domains/comet-classic/classic-sdk-revision.js';
import { assertVerifyEvidenceCurrent } from '../../../domains/comet-classic/classic-sdk-archive-preflight.js';
import { createOpenSpecArchiveFixture } from '../../helpers/classic-openspec-fixture.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';

import { inspectClassicHookGuard } from '../../../domains/comet-classic/classic-hook-guard.js';
import { parseCometHookRequest } from '../../../platform/process/hook-adapter.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it.each(
  [
    {
      profile: 'tweak',
      fail: true,
      name: 'blocks Classic Archive when a new real check fails after an accepted pass',
    },
    ...(['generated'] as const).map((entry) => ({
      profile: 'full',
      fail: false,
      generated: entry === 'generated',
      freeform: true,
      name: `completes Classic full from an Agent-reviewed design without metadata rules through ${entry}`,
    })),
    ...(['full', 'hotfix', 'tweak'] as const).map((profile) => ({
      profile,
      fail: false,
      generated: true,
      name: `continues the same Classic ${profile} Verify and Archive through the generated Runtime without content proof`,
    })),
  ].map(
    (item) =>
      [
        item.name,
        item.profile,
        item.fail,
        'generated' in item && item.generated,
        'freeform' in item && item.freeform,
      ] as const,
  ),
)('%s', async (_title, profile, fail, generated, freeform) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-edit-review-'));
  roots.push(base);
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('XDG_DATA_HOME', path.join(home, '.local/share'));
  await prepareClassicLegacyProject(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-b', 'main');
  git('add', '--', 'openspec/config.yaml');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--allow-empty',
    '-m',
    'baseline',
  );
  const cli = async (...args: string[]) => {
    const separator = args.indexOf('--');
    args.splice(separator < 0 ? args.length : separator, 0, '--json');
    const result = generated
      ? (() => {
          const result = spawnSync(
            process.execPath,
            [path.resolve('assets/skills/comet/scripts/comet-runtime.mjs'), ...args],
            { cwd: root, encoding: 'utf8', windowsHide: true },
          );
          return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
        })()
      : await runClassicCli(args, undefined, { projectRoot: root, invocationCwd: root });
    expect(
      result.exitCode,
      JSON.stringify(JSON.parse(result.stdout ?? '{}').data?.issues ?? { stderr: result.stderr }),
    ).toBe(0);
    return JSON.parse(result.stdout!);
  };
  if (profile === 'tweak') {
    const large = await fs.open(path.join(root, 'existing-large.bin'), 'w');
    await large.truncate(65 * 1024 * 1024);
    await large.close();
  }
  await cli('state', 'init', 'example', profile, '--isolation', 'current');
  const change = path.join(root, 'openspec/changes/example');
  for (const [ref, source] of Object.entries({
    'proposal.md': '# Proposal\nPreserve the worker behavior.\n',
    'design.md': '# Design\nPreserve behavior.\n',
    'tasks.md': '- [x] Implement the worker <!-- comet-task:impl -->\n',
  }))
    await fs.writeFile(path.join(change, ref), source);
  await fs.writeFile(path.join(root, 'worker.py'), 'value = 1\n');
  const preview = await cli('guard', 'example', 'open');
  await cli('guard', 'example', 'open', '--apply', '--approval-hash', preview.data.approvalHash);
  const plan = 'docs/superpowers/plans/work.md';
  if (profile === 'full') {
    await fs.appendFile(
      path.join(change, 'proposal.md'),
      '\n<!-- Agent clarified the same approved scope -->\n',
    );
    const proposal = await cli(
      'state',
      'propose-design',
      'example',
      '--proposal',
      'Preserve the worker behavior.',
    );
    if (freeform) {
      await expect(fs.stat(path.join(change, '.comet/handoff'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      const prepared = (await inspectClassicSdkRun(root, 'example')).run;
      expect(prepared.outputs['full.design.handoff'].value).toMatchObject({
        handoffContext: 'openspec/changes/example/proposal.md',
      });
      await cli('handoff', 'example', 'design', '--write', '--full');
      expect(await fs.readdir(path.join(change, '.comet/handoff'))).toEqual(['design-context.md']);
      expect(
        await fs.readFile(path.join(change, '.comet/handoff/design-context.md'), 'utf8'),
      ).toContain('Preserve the worker behavior.');
      expect((await inspectClassicSdkRun(root, 'example')).run).toEqual(prepared);
    }
    expect((await inspectClassicSdkRun(root, 'example')).state.phase).toBe('design');
    // 此决定仅属于隔离测试夹具，不表示真实用户批准。
    await cli(
      'state',
      'decide-design',
      'example',
      '--proposal-hash',
      proposal.data.wait.proposalHash,
      '--choice',
      'approved',
    );
    await fs.writeFile(
      path.join(change, 'design.md'),
      freeform
        ? '# 实施说明\nPreserve the worker behavior. 复用原接口并核对实际输出。\n'
        : '---\ncomet_change: example\nrole: technical-design\ncanonical_spec: openspec\n---\n# Design\nPreserve the worker behavior.\n',
    );
    await cli(
      'state',
      'complete-design',
      'example',
      '--design-doc',
      'openspec/changes/example/design.md',
      '--approval-hash',
      proposal.data.wait.proposalHash,
    );
    await fs.writeFile(
      path.join(root, 'configuration.json'),
      JSON.stringify({
        build_mode: 'executing-plans',
        tdd_mode: 'tdd',
        review_mode: 'standard',
        subagent_dispatch: null,
      }),
    );
    const build = await cli(
      'state',
      'propose-build',
      'example',
      '--file',
      path.join(root, 'configuration.json'),
    );
    await cli(
      'state',
      'decide-build',
      'example',
      '--proposal-hash',
      build.data.wait.proposalHash,
      '--choice',
      'approved',
    );
    await fs.unlink(path.join(root, 'configuration.json'));
    await fs.mkdir(path.dirname(path.join(root, plan)), { recursive: true });
    await fs.writeFile(
      path.join(root, plan),
      '<!-- comet-task-authority: openspec/changes/example/tasks.md -->\n# Plan\n<!-- comet-task-ref:impl -->\nImplement and verify the worker.\n',
    );
    await cli('state', 'submit-plan', 'example', '--plan', plan);
  }
  const checksFile = path.join(base, 'checks.json');
  const invocations = path.join(base, 'platform-checks.jsonl');
  const runCheck = async () => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        "if(require('node:fs').readFileSync('worker.py','utf8').includes('broken'))process.exit(7)",
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true },
    );
    await fs.appendFile(invocations, JSON.stringify({ exitCode: result.status }) + '\n');
    await fs.writeFile(
      checksFile,
      JSON.stringify({
        checks: [
          {
            name: 'node worker check; cwd=.',
            result: result.status === 0 ? 'passed' : 'failed',
            note: 'Actual platform exit code ' + result.status,
          },
        ],
      }),
    );
    return result.status;
  };
  expect(await runCheck()).toBe(0);
  await cli(
    'guard',
    'example',
    'build',
    '--apply',
    '--session',
    'builder-session',
    '--checks',
    checksFile,
  );
  const run = (await inspectClassicSdkRun(root, 'example')).run;
  expect(run.workflow.version).toBe('2');
  expect(run.actions.some((action) => action.stepId === profile + '.build.check')).toBe(false);
  expect(
    run.actions.find((action) => action.stepId === profile + '.build.execute')?.claim?.sessionId,
  ).toBe('builder-session');
  const after = '# Explanation.\nvalue = 1\n';
  const input = {
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'worker.py'), content: after },
  };
  const request = parseCometHookRequest(JSON.stringify(input));
  expect((await inspectClassicHookGuard(root, 'example', request)).allowed).toBe(true);
  await fs.writeFile(path.join(root, 'worker.py'), after);
  expect((await inspectClassicHookGuard(root, 'example', request)).allowed).toBe(true);
  expect(await fs.readFile(path.join(root, 'worker.py'), 'utf8')).toBe(after);
  const current = (await inspectClassicSdkRun(root, 'example')).run;
  expect(current.actions).toEqual(run.actions);
  const report = 'docs/superpowers/reports/verify.md';
  await fs.mkdir(path.dirname(path.join(root, report)), { recursive: true });
  await fs.writeFile(
    path.join(root, report),
    '# Verification\nThe worker behavior is unchanged.\n',
  );
  expect(
    (await cli('guard', 'example', 'verify', '--report', report, '--apply', '--checks', checksFile))
      .data.phase,
  ).toBe('archive');
  const formalFile = path.join(change, 'proposal.md');
  const originalFormal = await fs.readFile(formalFile, 'utf8');
  await fs.appendFile(formalFile, '\n<!-- clarify the same scope -->\n');
  expect((await cli('state', 'next', 'example')).data.phase).toBe('archive');
  const openSpec = await createOpenSpecArchiveFixture(base);
  vi.stubEnv('COMET_OPENSPEC', openSpec.command);
  const archive = await cli(
    'state',
    'propose-archive',
    'example',
    '--summary',
    'Archive this accepted worker locally.',
  );
  await cli(
    'state',
    'decide-archive',
    'example',
    '--proposal-hash',
    archive.data.wait.proposalHash,
    '--choice',
    'local',
  );
  if (fail) {
    await fs.appendFile(path.join(root, 'worker.py'), '# broken check condition\n');
    const before = (await inspectClassicSdkRun(root, 'example')).run;
    await reviseClassicSdkWork({
      projectRoot: root,
      change: 'example',
      name: 'reopen-verification',
      expectedRevision: before.revision,
    });
    expect(await runCheck()).toBe(7);
    const rejected = await runClassicCli(
      [
        'guard',
        'example',
        'verify',
        '--report',
        report,
        '--apply',
        '--checks',
        checksFile,
        '--json',
      ],
      undefined,
      { projectRoot: root, invocationCwd: root },
    );
    expect(rejected.exitCode).not.toBe(0);
    await cli(
      'state',
      'transition',
      'example',
      'verify-fail',
      '--reason',
      'Actual platform worker check exited 7; repair is required.',
    );
    const failed = (await inspectClassicSdkRun(root, 'example')).run;
    await expect(
      assertVerifyEvidenceCurrent(failed, root, failed.state as never),
    ).rejects.toThrow();
    expect(
      failed.actions.findLast((action) => action.stepId === profile + '.verify.run')?.outcome
        ?.output,
    ).toMatchObject({
      event: 'verify-fail',
      reason: 'Actual platform worker check exited 7; repair is required.',
    });
    expect(failed.outputs[profile + '.archive.execute']).toBeUndefined();
    await expect(
      fs.stat(path.join(base, 'openspec-archive-invocations.jsonl')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    return;
  }
  await cli('guard', 'example', 'archive', '--apply');
  let archived = (await inspectClassicSdkRun(root, 'example')).run;
  expect(archived.state).toMatchObject({ archived: true });
  expect(archived.status).not.toBe('completed');
  const archiveRef = (
    archived.outputs[profile + '.archive.execute'].value as { archiveDirectory: string }
  ).archiveDirectory;
  const manifestRef = path.join(root, archiveRef, '.comet/archive-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestRef, 'utf8'));
  expect(manifest).not.toHaveProperty('files');
  // 可编辑视图不能扩大交付范围；原 Runtime 中的路径记录保持权威。
  await fs.writeFile(path.join(root, 'unrelated.txt'), 'Unrelated draft.\n');
  manifest.paths.push('unrelated.txt');
  await fs.writeFile(manifestRef, JSON.stringify(manifest));
  git('add', '--', 'openspec', 'worker.py', report, ...(profile === 'full' ? [plan] : []));
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-m',
    'archive accepted worker',
  );
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  await cli('state', 'complete-delivery', 'example', '--commit', commit);
  archived = (await inspectClassicSdkRun(root, 'example')).run;
  expect(archived.status).toBe('completed');
  expect(await openSpec.invocations()).toHaveLength(1);
  expect(
    archived.actions.filter((action) => action.stepId === profile + '.verify.check'),
  ).toHaveLength(0);
  expect((await fs.readFile(invocations, 'utf8')).trim().split('\n')).toHaveLength(1);
  expect(await fs.readFile(path.join(root, 'unrelated.txt'), 'utf8')).toBe('Unrelated draft.\n');
});
