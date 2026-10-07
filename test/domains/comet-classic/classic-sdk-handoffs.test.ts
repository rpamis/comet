import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import {
  COMET_RESUME_PROBE_SCHEMA_VERSION,
  resolveCometResumeProbe,
} from '../../../domains/comet-classic/classic-resume-probe.js';
import {
  classicSdkNextAction,
  inspectClassicSdkRun,
} from '../../../domains/comet-classic/classic-sdk-status.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(profile: 'hotfix' | 'tweak') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-handoff-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Comet Test',
      '-c',
      'user.email=comet@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'baseline',
    ],
    { cwd: root, stdio: 'ignore' },
  );
  const cli = async (...args: string[]) => {
    const result = await runClassicCli([args[0], '--json', ...args.slice(1)], undefined, {
      projectRoot: root,
      invocationCwd: root,
    });
    return JSON.parse(result.stdout!);
  };
  const initialized = await cli('state', 'init', 'demo', profile, '--isolation', 'current');
  expect(initialized.exitCode, initialized.stderr).toBe(0);
  const changeDir = path.join(root, 'openspec/changes/demo');
  await Promise.all([
    fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\nFix the small change.\n'),
    fs.writeFile(path.join(changeDir, 'design.md'), '# Design\nKeep the existing behavior.\n'),
    fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] Implement the change\n'),
  ]);
  return { root, changeDir, cli };
}

function skillCommand(source: string, command: string, approvalHash = ''): string[] {
  const sdk = source.slice(source.indexOf('## SDK Run'), source.indexOf('`runtimeFormat: compat`'));
  const template = sdk.match(new RegExp('`(comet ' + command + '[^`]*)`', 'u'))?.[1];
  expect(template).toBeDefined();
  return template!
    .replace('<change-name>', 'demo')
    .replace('<approvalHash>', approvalHash)
    .split(/\s+/u)
    .slice(1)
    .filter((argument) => argument !== '--json');
}

const cases = (['skills-zh', 'skills'] as const).flatMap((language) =>
  (['hotfix', 'tweak'] as const).map((profile) => ({ language, profile })),
);

describe('Classic SDK profile-aware handoffs', () => {
  it.each(cases)(
    'executes $language $profile Open approval and Build without redundant previews',
    async ({ language, profile }) => {
      const { root, changeDir, cli } = await fixture(profile);
      const skill = await fs.readFile(
        path.resolve('assets', language, `comet-${profile}`, 'SKILL.md'),
        'utf8',
      );
      const previewArgs = skillCommand(skill, 'guard <change-name> open --json');
      const preview = await cli(...previewArgs);
      expect(preview.exitCode, preview.stderr).toBe(0);
      const original = (await inspectClassicSdkRun(root, 'demo')).run;
      const apply = skillCommand(
        skill,
        'guard <change-name> open --apply',
        preview.data.approvalHash,
      );
      expect(apply).toEqual([
        'guard',
        'demo',
        'open',
        '--apply',
        '--approval-hash',
        preview.data.approvalHash,
      ]);
      const missing = await cli('guard', 'demo', 'open', '--apply');
      expect(missing.exitCode).not.toBe(0);
      expect((await inspectClassicSdkRun(root, 'demo')).run).toEqual(original);

      await fs.appendFile(
        path.join(changeDir, 'design.md'),
        'A clarified implementation detail.\n',
      );
      const stale = await cli(...apply);
      expect(stale.exitCode).not.toBe(0);
      expect(stale.stderr).toContain('changed after approval');
      expect((await inspectClassicSdkRun(root, 'demo')).run).toEqual(original);
      const approved = await cli(...previewArgs);
      const opened = await cli(
        ...skillCommand(skill, 'guard <change-name> open --apply', approved.data.approvalHash),
      );
      expect(opened.exitCode, opened.stderr).toBe(0);
      expect(opened.agent.continuation).toMatchObject({
        kind: 'action',
        stepId: `${profile}.build.execute`,
        ref: `comet-${profile}`,
      });
      const persisted = (await inspectClassicSdkRun(root, 'demo')).run;
      const pending = persisted.actions.find((action) => action.status === 'pending')!;
      // 原定义与 Action 保持不变，既有固定版本的 Run 仍能通过 Runtime 校验。
      expect(pending.ref).toBe('comet-build');
      expect(persisted.definitionHashes).toEqual(original.definitionHashes);
      expect(opened.agent.continuation).toMatchObject({
        actionId: pending.id,
        attempt: pending.attempt,
        inputHash: pending.inputHash,
      });

      const next = await cli('state', 'next', 'demo');
      expect(next.stdout).toContain(`SKILL: comet-${profile}`);
      const selected = await cli('state', 'select', 'demo');
      expect(selected.data).toMatchObject({
        runtimeFormat: 'sdk',
        phase: 'build',
        run: { runId: 'demo', revision: persisted.revision, status: persisted.status },
      });
      expect(selected.data.run).toEqual(persisted);
      expect(selected.agent.continuation).toMatchObject({
        ...next.data.nextAction,
        cwd: root,
      });
      expect((await inspectClassicSdkRun(root, 'demo')).run).toEqual(persisted);

      const probe = await resolveCometResumeProbe(root, {
        schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
        utterance: '继续 demo',
        locale: 'zh-CN',
        agent_context: { non_trivial_work: true, already_in_comet_flow: false },
      });
      expect(probe).toMatchObject({ phase: 'build', nextCommand: `/comet-${profile}` });

      const blocked = await cli(
        'guard',
        'demo',
        'build',
        '--apply',
        '--',
        process.execPath,
        '-e',
        'process.exit(90)',
      );
      expect(blocked.exitCode).not.toBe(0);
      expect((await inspectClassicSdkRun(root, 'demo')).run).toEqual(persisted);
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Implement the change\n');
      const failed = await cli(
        'guard',
        'demo',
        'build',
        '--apply',
        '--',
        process.execPath,
        '-e',
        'process.exit(1)',
      );
      expect(failed.exitCode).not.toBe(0);
      const retry = await cli('state', 'next', 'demo');
      expect(retry.data.nextAction).toMatchObject({
        kind: 'action',
        stepId: `${profile}.build.execute`,
        ref: `comet-${profile}`,
      });
      expect(retry.stdout).toContain(`SKILL: comet-${profile}`);
      const built = await cli(
        'guard',
        'demo',
        'build',
        '--apply',
        '--',
        process.execPath,
        '-e',
        'console.log("checked")',
      );
      expect(built.exitCode, built.stderr).toBe(0);
      expect(built.agent.continuation).toMatchObject({
        kind: 'action',
        stepId: `${profile}.verify.run`,
        ref: 'comet-verify',
      });
      expect((await inspectClassicSdkRun(root, 'demo')).run.definitionHashes).toEqual(
        original.definitionHashes,
      );
    },
  );

  it.each(['hotfix', 'tweak'] as const)(
    'preserves %s context on cold resume, reconciliation, and explicit full upgrade',
    async (profile) => {
      const { root, changeDir, cli } = await fixture(profile);
      const preview = await cli('guard', 'demo', 'open');
      expect(
        (
          await cli(
            'guard',
            'demo',
            'open',
            '--apply',
            '--approval-hash',
            preview.data.approvalHash,
          )
        ).exitCode,
      ).toBe(0);
      const original = (await inspectClassicSdkRun(root, 'demo')).run;
      // 从便携检查点恢复旧的 comet-build 引用，保留既有 Action 句柄。
      const copied = await fixture(profile);
      await fs.rm(path.join(copied.root, '.comet/runtime'), { recursive: true, force: true });
      await fs.cp(changeDir, copied.changeDir, { recursive: true });
      const resumed = await copied.cli('state', 'select', 'demo');
      expect(resumed.exitCode, resumed.stderr).toBe(0);
      expect(resumed.agent.continuation).toMatchObject({
        ...classicSdkNextAction(original),
        cwd: copied.root,
      });
      const pending = original.actions.find((action) => action.status === 'pending')!;
      expect(
        classicSdkNextAction({ ...original, actions: [{ ...pending, status: 'unknown' }] }),
      ).toMatchObject({
        kind: 'reconcile',
        actionId: pending.id,
        ref: `comet-${profile}`,
      });
      expect(
        classicSdkNextAction({ ...original, actions: [{ ...pending, ref: 'custom-worker' }] }),
      ).toMatchObject({ ref: 'custom-worker' });
      expect(
        classicSdkNextAction({
          ...original,
          state: { ...(original.state as object), workflow: 'full' },
          actions: [{ ...pending, stepId: 'full.build.execute' }],
        }),
      ).toMatchObject({ ref: 'comet-build' });

      const proposal = await cli(
        'state',
        'propose-escalation',
        'demo',
        '--reason',
        'The change requires an architectural decision',
      );
      expect(proposal.exitCode, proposal.stderr).toBe(0);
      const continued = await cli(
        'state',
        'decide-escalation',
        'demo',
        '--proposal-hash',
        proposal.data.wait.proposalHash,
        '--choice',
        'continue',
      );
      expect(continued.exitCode, continued.stderr).toBe(0);
      expect(continued.agent.continuation).toMatchObject({
        stepId: `${profile}.build.execute`,
        ref: `comet-${profile}`,
      });
      const upgrade = await cli(
        'state',
        'propose-escalation',
        'demo',
        '--reason',
        'A full design is now required',
      );
      const upgraded = await cli(
        'state',
        'decide-escalation',
        'demo',
        '--proposal-hash',
        upgrade.data.wait.proposalHash,
        '--choice',
        'upgrade',
      );
      expect(upgraded.exitCode, upgraded.stderr).toBe(0);
      expect(upgraded.data.configuration).toMatchObject({ workflow: 'full', phase: 'design' });
      expect(upgraded.agent.continuation).toMatchObject({
        stepId: 'full.design.handoff',
        ref: 'comet-design',
      });
      expect((await inspectClassicSdkRun(root, 'demo')).run.definitionHashes).toEqual(
        original.definitionHashes,
      );
    },
  );
});
