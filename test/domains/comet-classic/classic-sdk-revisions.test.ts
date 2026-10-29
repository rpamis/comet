import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { randomUUID } from 'node:crypto';
import { writeClassicSdkDesignContext } from '../../../domains/comet-classic/classic-handoff.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { captureClassicDeliveryRepair } from '../../../domains/comet-classic/classic-sdk-delivery-repair.js';
import { runClassicSdkCommandCheck } from '../../../domains/comet-classic/classic-sdk-check.js';
import { readPortableRunCheckpoint } from '../../../domains/engine/runtime.js';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import {
  executeClassicSdkArchive,
  recoverClassicSdkArchive,
} from '../../../domains/comet-classic/classic-sdk-archive.js';
import { executeClassicSdkArchivePreflight } from '../../../domains/comet-classic/classic-sdk-archive-preflight.js';
import { recordClassicArchiveRequirements } from '../../../domains/comet-classic/classic-artifact-requirements.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { createOpenSpecArchiveFixture } from '../../helpers/classic-openspec-fixture.js';
import { ensureCometProjectGitignore } from '../../../domains/workflow-contract/project-gitignore.js';
import { runClassicEditReviewCommand } from '../../../domains/comet-classic/classic-edit-review-command.js';
import { classicAcceptedDesignEvidence } from '../../../domains/comet-classic/classic-sdk-application.js';
import { inspectClassicSdkRevisionReadiness } from '../../../domains/comet-classic/classic-sdk-revision-readiness.js';
import { prepareClassicArchiveInputs } from '../../../domains/comet-classic/classic-sdk-archive-manifest.js';
import { classicSdkFormalSourceEvidence } from '../../../domains/comet-classic/classic-formal-source-evidence.js';
import { classicSdkPresetSourceEvidence } from '../../../domains/comet-classic/classic-formal-source-evidence.js';
import { assertClassicPresetRequirementsCurrent } from '../../../domains/comet-classic/classic-sdk-application.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(
  legacyDesign = false,
  profile: 'full' | 'tweak' | 'hotfix' = 'full',
  externalDesign = false,
  taskSource = '- [ ] Implement the adapter <!-- comet-task:impl -->\n',
  upgradePreset = true,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic revised candidate '));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  await prepareClassicLegacyProject(projectRoot);
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
  await ensureCometProjectGitignore(projectRoot);
  execFileSync('git', ['add', '--', '.gitignore'], { cwd: projectRoot, stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    ],
    { cwd: projectRoot, stdio: 'ignore' },
  );
  const cli = async (...args: string[]) => {
    const result = await runClassicCli([args[0], '--json', ...args.slice(1)], undefined, {
      projectRoot,
      invocationCwd: projectRoot,
    });
    return JSON.parse(result.stdout!);
  };
  const ok = async (...args: string[]) => {
    const result = await cli(...args);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    return result.data;
  };
  const put = async (ref: string, text: string) => {
    await fs.mkdir(path.dirname(path.join(projectRoot, ref)), { recursive: true });
    await fs.writeFile(path.join(projectRoot, ref), text);
  };
  const change = 'openspec/changes/example';
  await ok('state', 'init', 'example', profile, '--isolation', 'current');
  await put(`${change}/proposal.md`, '# Proposal\nKeep the existing public API.\n');
  await put(`${change}/design.md`, '# Design\nUse the existing adapter.\n');
  await put(`${change}/tasks.md`, taskSource);
  const opened = await ok('guard', 'example', 'open');
  await ok('guard', 'example', 'open', '--apply', '--approval-hash', opened.approvalHash);
  if (profile !== 'full' && upgradePreset) {
    const escalation = await ok(
      'state',
      'propose-escalation',
      'example',
      '--reason',
      'The change now requires full Design approval.',
    );
    await ok(
      'state',
      'decide-escalation',
      'example',
      '--proposal-hash',
      escalation.wait.proposalHash,
      '--choice',
      'upgrade',
    );
  }
  const inspect = () => inspectClassicSdkRun(projectRoot, 'example');
  const design = async (proposal = 'Use the existing adapter.') => {
    let result;
    if (legacyDesign) {
      const { run, runtime } = await inspect();
      const action = run.actions.find(
        (candidate) => candidate.stepId === 'full.design.handoff' && candidate.status === 'pending',
      )!;
      const handoff = await writeClassicSdkDesignContext({
        projectRoot,
        changeDir: path.join(projectRoot, change),
        change: 'example',
        contextCompression: 'off',
      });
      const claimToken = randomUUID();
      const claimed = await runtime.claim({
        runId: run.runId,
        expectedRevision: run.revision,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'legacy-host',
        claimToken,
      });
      const submitted = await runtime.recordOutcome({
        runId: run.runId,
        expectedRevision: claimed.revision,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken,
          outcomeId: randomUUID(),
          status: 'succeeded',
          output: { proposal, ...handoff },
        },
        context: { requestId: 'legacy-proposal', projectRoot },
      });
      result = { wait: submitted.waits.at(-1)! };
    } else result = await ok('state', 'propose-design', 'example', '--proposal', proposal);
    await ok(
      'state',
      'decide-design',
      'example',
      '--proposal-hash',
      result.wait.proposalHash,
      '--choice',
      'approved',
    );
    return result.wait.proposalHash as string;
  };
  const designRef =
    legacyDesign || externalDesign
      ? 'docs/superpowers/specs/technical design.md'
      : `${change}/design.md`;
  const finishDesign = async (hash: string, content?: string) => {
    await put(
      designRef,
      content ??
        '---\ncomet_change: example\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\nUse the adapter and preserve the public API.\n',
    );
    return ok(
      'state',
      'complete-design',
      'example',
      '--design-doc',
      designRef,
      '--approval-hash',
      hash,
    );
  };
  const plan = 'docs/superpowers/plans/work plan.md';
  const prepareBuild = async () => {
    await finishDesign(await design());
    await put(
      'configuration.json',
      JSON.stringify({
        build_mode: 'executing-plans',
        tdd_mode: 'tdd',
        review_mode: 'standard',
        subagent_dispatch: null,
      }),
    );
    const proposed = await ok('state', 'propose-build', 'example', '--file', 'configuration.json');
    await ok(
      'state',
      'decide-build',
      'example',
      '--proposal-hash',
      proposed.wait.proposalHash,
      '--choice',
      'approved',
    );
    await put(
      plan,
      `<!-- comet-task-authority: ${change}/tasks.md -->\n# Plan\n<!-- comet-task-ref:impl -->\nImplement and validate.\n`,
    );
  };
  return { projectRoot, change, plan, put, cli, ok, inspect, design, finishDesign, prepareBuild };
}

describe('Classic candidate revisions', () => {
  it.each([
    ['verify', 'declared'],
    ['archive', 'declared'],
    ['archive', 'default'],
  ] as const)(
    'resumes an actual implementation revision from %s with %s inputs, retaining only B',
    async (startPhase, inputScope) => {
      const f = await fixture();
      const openSpec = await createOpenSpecArchiveFixture(path.dirname(f.projectRoot));
      vi.stubEnv('COMET_OPENSPEC', openSpec.command);
      vi.stubEnv('OPENSPEC_TELEMETRY', '0');
      vi.stubEnv('DO_NOT_TRACK', '1');
      await f.prepareBuild();
      await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
      await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');

      // Current approved scope preserves the adapter API; the Agent changes A's
      // returned value within that scope. No requirement or Design file is edited.
      const originalA = 'exports.read = () => 1;\n';
      const revisedA = 'exports.read = () => 2;\n';
      await f.put('left.cjs', originalA);
      await f.put('right.cjs', 'exports.read = () => 7;\n');
      const countA = path.join(path.dirname(f.projectRoot), 'a4-A-executions.txt');
      const countB = path.join(path.dirname(f.projectRoot), 'a4-B-once.txt');
      const argvA = [
        process.execPath,
        '-e',
        [
          "const fs = require('node:fs');",
          "const assert = require('node:assert/strict');",
          "const adapter = require('./left.cjs');",
          "assert.equal(typeof adapter.read, 'function');",
          'const value = adapter.read();',
          'assert.ok(Number.isInteger(value) && value >= 1 && value <= 2);',
          "fs.appendFileSync(process.argv[1], 'A:' + value + '\\n');",
          "console.log('A returned', value);",
        ].join('\n'),
        countA,
      ];
      const argvB = [
        process.execPath,
        '-e',
        [
          "const fs = require('node:fs');",
          "const assert = require('node:assert/strict');",
          "assert.equal(require('./right.cjs').read(), 7);",
          // Sentinel makes an unwanted replay observable even if the CLI retries.
          "assert.equal(fs.existsSync(process.argv[1]), false, 'B side effect was replayed');",
          "fs.writeFileSync(process.argv[1], 'B:7\\n');",
          "console.log('B returned 7');",
        ].join('\n'),
        countB,
      ];
      if (inputScope === 'declared') {
        await f.put(
          '.comet/check-policy.json',
          JSON.stringify({
            version: 2,
            commands: [argvA, argvB].map((argv) => ({
              argv,
              cwd: '.',
              files: ['left.cjs', 'right.cjs'],
            })),
          }),
        );
      }
      const git = (...args: string[]) =>
        execFileSync('git', args, { cwd: f.projectRoot, encoding: 'utf8' }).trim();
      const commit = (message: string) => {
        git(
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '-m',
          message,
        );
        return git('rev-parse', 'HEAD');
      };
      git(
        'add',
        '--',
        'openspec',
        f.plan,
        'configuration.json',
        '.comet/config.yaml',
        'left.cjs',
        'right.cjs',
      );
      commit('initial accepted adapter implementation');

      await f.ok('guard', 'example', 'build', '--apply', '--local', '--', ...argvB);
      const firstBuild = (await f.inspect()).run;
      const originalB = firstBuild.actions.find(
        (action) => action.ref === 'classic-check' && action.stepId === 'full.build.check',
      )!;
      expect(originalB).toMatchObject({
        status: 'succeeded',
        outcome: { output: { reusable: true, exitCode: 0 } },
      });
      expect(await fs.readFile(countB, 'utf8')).toBe('B:7\n');
      const report = 'docs/superpowers/reports/a4-verify.md';
      const approveArchive = async (summary: string) => {
        const proposed = await f.ok('state', 'propose-archive', 'example', '--summary', summary);
        await f.ok(
          'state',
          'decide-archive',
          'example',
          '--proposal-hash',
          proposed.wait.proposalHash,
          '--choice',
          'local',
        );
        return proposed.wait;
      };
      if (startPhase === 'archive') {
        await f.put(
          report,
          '# Verification\nA returns 1; B returns 7. The adapter API is valid.\n',
        );
        await f.ok(
          'guard',
          'example',
          'verify',
          '--report',
          report,
          '--apply',
          '--local',
          '--',
          ...argvA,
        );
        await approveArchive('Archive the original accepted adapter locally.');
        expect(await fs.readFile(countA, 'utf8')).toBe('A:1\n');
      }
      const before = structuredClone((await f.inspect()).run);
      expect(before.state).toMatchObject({ phase: startPhase });
      const sourceApprovals = before.waits.filter((wait) =>
        ['full.open.confirm', 'full.design.confirm', 'full.build.confirm'].includes(wait.stepId),
      );
      const designBefore = await classicAcceptedDesignEvidence(f.projectRoot, before);
      const planBefore = structuredClone(before.outputs['full.build.plan']);
      const firstCheckActions = before.actions.filter((action) => action.ref === 'classic-check');
      const firstBuilderActions = before.actions.filter(
        (action) => action.stepId === 'full.build.execute',
      );

      // Simulated current Agent: real applied behavior change, raw observation,
      // then an explicit implementation-changed judgment retaining only check B.
      await f.put('left.cjs', revisedA);
      const observed = (await runClassicEditReviewCommand({
        projectRoot: f.projectRoot,
        name: 'example',
        operation: 'observe',
        sessionId: 'a4-current-agent',
      })) as {
        recordTemplate: Record<string, unknown>;
        observation: { changes: Array<{ path: string }> };
        availableChecks: Array<{ actionId: string }>;
      };
      expect(observed.recordTemplate).toBeTruthy();
      expect(observed.observation.changes.map((change) => change.path)).toContain('left.cjs');
      expect(observed.availableChecks.map((check) => check.actionId)).toContain(originalB.id);
      const judgment = path.join(path.dirname(f.projectRoot), 'a4-current-agent-judgment.json');
      await fs.writeFile(
        judgment,
        JSON.stringify({
          ...observed.recordTemplate,
          decision: 'implementation-changed',
          summary:
            'A now returns 2 instead of 1 under the approved adapter API. Rebuild and verify A. B reads only unchanged right.cjs, so retain its successful original check.',
          retainedCheckActionIds: [originalB.id],
        }),
      );
      await runClassicEditReviewCommand({
        projectRoot: f.projectRoot,
        name: 'example',
        operation: 'record',
        file: judgment,
      });
      expect((await f.inspect()).run).toEqual(before);
      const next = await f.ok('state', 'next', 'example');
      expect(next.continuation).toMatchObject({
        mode: 'execute',
        commandArgs: [
          'comet',
          'state',
          'continue-build',
          'example',
          '--expected-revision',
          String(before.revision),
          '--json',
        ],
      });
      const continuationArgs: string[] = next.continuation.commandArgs
        .slice(1)
        .filter((arg: string) => arg !== '--json');

      // A judgment cannot cover a later, unassessed write before command dispatch.
      await f.put('left.cjs', 'exports.read = () => 999;\n');
      const stale = await f.cli(...continuationArgs);
      expect(stale.exitCode).not.toBe(0);
      expect((await f.inspect()).run).toEqual(before);
      expect(await fs.readFile(countB, 'utf8')).toBe('B:7\n');
      await f.put('left.cjs', revisedA);
      await f.ok(...continuationArgs);
      const returned = (await f.inspect()).run;
      expect(returned.runId).toBe(before.runId);
      expect(returned.state).toMatchObject({
        phase: 'build',
        verifyResult: 'pending',
        verificationReport: null,
        archiveConfirmation: null,
        checkEpoch: Number((before.state as { checkEpoch: number }).checkEpoch) + 1,
      });
      expect(
        returned.waits.filter((wait) => sourceApprovals.some((source) => source.id === wait.id)),
      ).toEqual(sourceApprovals);
      expect(
        returned.waits.filter((wait) =>
          ['full.open.confirm', 'full.design.confirm', 'full.build.confirm'].includes(wait.stepId),
        ),
      ).toEqual(sourceApprovals);
      const buildNext = await f.ok('state', 'next', 'example');
      expect(buildNext.continuation.mode).not.toBe('reconcile');
      expect(buildNext.continuation.current.actions).toEqual(
        expect.arrayContaining([expect.objectContaining({ stepId: 'full.build.execute' })]),
      );

      if (inputScope === 'default' && startPhase === 'archive') {
        const { collectCheckSnapshot } =
          await import('../../../domains/comet-classic/classic-check-snapshot.js');
        const { classicCheckInputsRetained } =
          await import('../../../domains/comet-classic/classic-edit-review.js');
        const { readCheckPolicy } =
          await import('../../../domains/comet-classic/classic-check-policy.js');
        const state =
          returned.state as unknown as import('../../../domains/comet-classic/classic-state.js').ClassicState;
        const identity = { argv: argvB, cwd: '.' };
        const snapshot = () =>
          collectCheckSnapshot(f.projectRoot, path.join(f.projectRoot, f.change), identity, {
            verificationReport: null,
          });
        const prior = originalB.outcome!.output as { manifestRef: string; manifestHash: string };
        const retained = async () =>
          classicCheckInputsRetained(
            f.projectRoot,
            'example',
            state,
            originalB.id,
            prior,
            (await snapshot()).manifest,
            returned,
          );
        expect(await retained()).toBe(true);
        const originalReport = await fs.readFile(path.join(f.projectRoot, report), 'utf8');
        await f.put(report, originalReport + '\nA user edit to the original report.\n');
        expect(await retained()).toBe(false);
        await f.put(report, originalReport);
        const beforePolicy = await snapshot();
        const policy = await readCheckPolicy(f.projectRoot, identity);
        await f.put(
          '.comet/check-policy.json',
          JSON.stringify({
            version: 2,
            commands: [
              {
                ...identity,
                files: beforePolicy.entries
                  .filter((entry) => !entry.p.startsWith('\0'))
                  .map((entry) => entry.p),
                git: policy.git,
                taskCheckboxes: policy.taskCheckboxes,
              },
            ],
          }),
        );
        const declared = await snapshot();
        const { createHash } = await import('node:crypto');
        const { serializeCheckManifest } =
          await import('../../../domains/comet-classic/classic-check-manifest.js');
        const beforeHashes = new Map(beforePolicy.entries.map(({ p, h }) => [p, h]));
        // 显式文件使用 SHA-256，默认 Git 批次使用 blob 摘要；用新读取字节统一表示，确认只改变声明。
        const comparable = await Promise.all(
          declared.entries.map(async (entry) => {
            const previous = beforeHashes.get(entry.p);
            if (!previous?.startsWith('git:')) return entry;
            const bytes = await fs.readFile(path.join(f.projectRoot, entry.p));
            expect(entry.h).toBe(createHash('sha256').update(bytes).digest('hex'));
            const h = `git:${createHash(previous.length === 44 ? 'sha1' : 'sha256')
              .update(`blob ${bytes.length}\0`)
              .update(bytes)
              .digest('hex')}`;
            return { ...entry, h };
          }),
        );
        const values = (entries: typeof comparable) =>
          entries.map(({ p, h }) => [p, h]).sort(([left], [right]) => left.localeCompare(right));
        expect(values(comparable)).toEqual(values(beforePolicy.entries));
        expect(
          await classicCheckInputsRetained(
            f.projectRoot,
            'example',
            state,
            originalB.id,
            prior,
            serializeCheckManifest(comparable),
            returned,
          ),
        ).toBe(false);
        await fs.rm(path.join(f.projectRoot, '.comet/check-policy.json'));
        expect((await f.inspect()).run).toEqual(returned);
        expect(await fs.readFile(countB, 'utf8')).toBe('B:7\n');
      }

      // The real public guard finishes the new Builder and consumes its real B check.
      // It must reuse the original B receipt, never rerun the sentinel side effect.
      await f.ok('guard', 'example', 'build', '--apply', '--local', '--', ...argvB);
      const rebuilt = (await f.inspect()).run;
      const retainedB = rebuilt.actions
        .filter((action) => action.stepId === 'full.build.check')
        .at(-1)!;
      expect(retainedB.id).not.toBe(originalB.id);
      expect(retainedB).toMatchObject({
        status: 'succeeded',
        outcome: {
          output: { reused: true, reusedFrom: originalB.id, retainedInput: true, exitCode: 0 },
        },
      });
      expect(await fs.readFile(countB, 'utf8')).toBe('B:7\n');
      expect(
        rebuilt.actions.filter((action) => action.stepId === 'full.build.execute'),
      ).toHaveLength(firstBuilderActions.length + 1);
      for (const original of firstCheckActions)
        expect(rebuilt.actions.find((action) => action.id === original.id)).toEqual(original);

      await f.put(
        report,
        '# Verification\nA now returns 2; unchanged B still returns 7. The adapter API is valid.\n',
      );
      await f.ok(
        'guard',
        'example',
        'verify',
        '--report',
        report,
        '--apply',
        '--local',
        '--',
        ...argvA,
      );
      const verified = (await f.inspect()).run;
      expect(verified.state).toMatchObject({ phase: 'archive', verifyResult: 'pass' });
      const currentA = verified.actions
        .filter((action) => action.stepId === 'full.verify.check')
        .at(-1)!;
      expect(currentA).toMatchObject({ status: 'succeeded', outcome: { output: { exitCode: 0 } } });
      expect((currentA.outcome!.output as { reused?: boolean }).reused).not.toBe(true);
      expect(await fs.readFile(countA, 'utf8')).toBe(
        startPhase === 'archive' ? 'A:1\nA:2\n' : 'A:2\n',
      );
      expect(await fs.readFile(countB, 'utf8')).toBe('B:7\n');
      expect(await classicAcceptedDesignEvidence(f.projectRoot, verified)).toEqual(designBefore);
      expect(verified.outputs['full.build.plan']).toEqual(planBefore);
      const accepted = await approveArchive(
        'Archive the revised and independently verified adapter locally.',
      );
      expect(before.waits.some((wait) => wait.id === accepted.id)).toBe(false);
      const acceptedRun = (await f.inspect()).run;
      expect(
        acceptedRun.waits.filter((wait) => wait.stepId === 'full.archive.confirm'),
      ).toHaveLength(startPhase === 'archive' ? 2 : 1);
      expect(
        acceptedRun.waits.filter((wait) =>
          ['full.open.confirm', 'full.design.confirm', 'full.build.confirm'].includes(wait.stepId),
        ),
      ).toEqual(sourceApprovals);
      expect(
        acceptedRun.actions.filter((action) => action.stepId === 'full.build.plan'),
      ).toHaveLength(before.actions.filter((action) => action.stepId === 'full.build.plan').length);

      await f.ok('guard', 'example', 'archive', '--apply');
      expect(await openSpec.invocations()).toEqual([
        { args: ['archive', 'example', '--yes'], cwd: await fs.realpath(f.projectRoot) },
      ]);
      const archived = (await f.inspect()).run;
      expect(
        archived.actions.filter(
          (action) => action.stepId === 'full.archive.execute' && action.status === 'succeeded',
        ),
      ).toHaveLength(1);
      const archiveRef = (
        archived.outputs['full.archive.execute'].value as { archiveDirectory: string }
      ).archiveDirectory;
      expect(
        await fs.readFile(path.join(f.projectRoot, archiveRef, 'design.md'), 'utf8'),
      ).toContain('status: final');
      expect(await fs.readFile(path.join(f.projectRoot, f.plan), 'utf8')).toContain(
        `archived-with: ${path.posix.basename(archiveRef)}`,
      );
      git('add', '--', 'openspec', f.plan, report, 'left.cjs');
      const delivered = await f.ok(
        'state',
        'complete-delivery',
        'example',
        '--commit',
        commit('archive revised adapter'),
      );
      expect(delivered.continuation).toMatchObject({ mode: 'done', commandArgs: null });
      expect((await f.inspect()).run.runId).toBe(before.runId);
      expect((await f.inspect()).run.status).toBe('completed');
      expect(await fs.readFile(countB, 'utf8')).toBe('B:7\n');
      expect(await openSpec.invocations()).toHaveLength(1);
    },
  );

  it('retains preset canonical edits under the real Open and retires them only after the actual new scope decision', async () => {
    const f = await fixture(
      false,
      'tweak',
      false,
      '- [x] Implement the adapter <!-- comet-task:impl -->\n',
      false,
    );
    const before = (await f.inspect()).run;
    const initial = classicSdkPresetSourceEvidence(before)!;
    expect(initial).toBeTruthy();
    const ref = `${f.change}/proposal.md`;
    const original = await fs.readFile(path.join(f.projectRoot, ref), 'utf8');
    const request = path.join(path.dirname(f.projectRoot), 'preset-judgment.json');
    const judge = async (decision: string) => {
      const prepared = (await runClassicEditReviewCommand({
        projectRoot: f.projectRoot,
        name: 'example',
        operation: 'prepare-applied',
        sessionId: 'current-agent',
      })) as { recordTemplate: Record<string, unknown> };
      expect(prepared.recordTemplate).toBeTruthy();
      await fs.writeFile(
        request,
        JSON.stringify({
          ...prepared.recordTemplate,
          decision,
          summary: 'The current Agent assessed the complete actual requirement change.',
        }),
      );
      await runClassicEditReviewCommand({
        projectRoot: f.projectRoot,
        name: 'example',
        operation: 'record',
        file: request,
      });
    };
    const after = original + '\n<!-- Existing public API explanation. -->\n';
    await f.put(ref, after);
    expect((await f.ok('state', 'next', 'example')).continuation.commandArgs).toContain(
      'prepare-applied',
    );
    await expect(
      assertClassicPresetRequirementsCurrent(f.projectRoot, f.change, before),
    ).rejects.toThrow('requirements changed');
    await judge('non-behavioral');
    await expect(
      assertClassicPresetRequirementsCurrent(f.projectRoot, f.change, (await f.inspect()).run),
    ).resolves.toBeUndefined();
    expect((await f.inspect()).run).toEqual(before);
    await f.put(ref, after + '\nAdd a newly requested public adapter.\n');
    await judge('requirements-changed');
    const proposal = await f.ok(
      'state',
      'propose-escalation',
      'example',
      '--reason',
      'Confirm the newly requested adapter in the same preset.',
    );
    expect(classicSdkPresetSourceEvidence((await f.inspect()).run)).toBeNull();
    await expect(
      assertClassicPresetRequirementsCurrent(f.projectRoot, f.change, (await f.inspect()).run),
    ).rejects.toThrow('尚未接受');
    await f.ok(
      'state',
      'decide-escalation',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'continue',
    );
    const approved = (await f.inspect()).run;
    expect(classicSdkPresetSourceEvidence(approved)?.identity).not.toBe(initial.identity);
    await expect(
      assertClassicPresetRequirementsCurrent(f.projectRoot, f.change, approved),
    ).resolves.toBeUndefined();
    await f.ok(
      'guard',
      'example',
      'build',
      '--apply',
      '--local',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    expect((await f.inspect()).state.phase).toBe('verify');
    expect(await fs.readFile(path.join(f.projectRoot, ref), 'utf8')).toContain(
      'newly requested public adapter',
    );
  });
  it('retains approved canonical source after the current Agent judges its original raw bytes', async () => {
    const f = await fixture();
    await f.prepareBuild();
    const before = (await f.inspect()).run;
    const ref = `${f.change}/proposal.md`;
    expect(classicSdkFormalSourceEvidence(before, [ref])[ref]).toMatch(/^[a-f0-9]{64}$/u);
    const pending = structuredClone(before);
    const approval = pending.waits.findLast((wait) => wait.stepId === 'full.design.confirm')!;
    pending.waits.push({
      ...approval,
      id: 'later-pending-design',
      sequence: pending.sequence + 1,
      status: 'pending',
      decision: undefined,
    });
    expect(classicSdkFormalSourceEvidence(pending, [ref])[ref]).toBeUndefined();
    const original = await fs.readFile(path.join(f.projectRoot, ref), 'utf8');
    const after = original + '\n<!-- Explanation of the existing scope. -->\n';
    await f.put(ref, after);
    expect((await f.ok('state', 'next', 'example')).continuation.commandArgs).toContain(
      'prepare-applied',
    );
    const request = path.join(path.dirname(f.projectRoot), 'canonical-request.json');
    await fs.writeFile(
      request,
      JSON.stringify({
        tool_name: 'Write',
        tool_input: {
          file_path: path.join(f.projectRoot, ref),
          content: after,
        },
      }),
    );
    const prepared = (await runClassicEditReviewCommand({
      projectRoot: f.projectRoot,
      name: 'example',
      operation: 'prepare-applied',
      sessionId: 'current-agent',
      file: request,
    })) as {
      proposal: { edits: Array<{ beforeHash: string; path: string }> };
      recordTemplate: Record<string, unknown>;
    };
    expect(prepared.proposal.edits[0].path).toBe(ref);
    expect(prepared.recordTemplate).toBeTruthy();
    await fs.writeFile(
      request,
      JSON.stringify({
        ...prepared.recordTemplate,
        decision: 'non-behavioral',
        summary: 'The extra explanation preserves all approved requirements.',
      }),
    );
    await runClassicEditReviewCommand({
      projectRoot: f.projectRoot,
      name: 'example',
      operation: 'record',
      file: request,
    });
    expect(
      await inspectClassicSdkRevisionReadiness(f.projectRoot, (await f.inspect()).run),
    ).toEqual([]);
    expect((await f.inspect()).run).toEqual(before);
    expect(await fs.readFile(path.join(f.projectRoot, ref), 'utf8')).toBe(after);
  });
  async function recordChangedFormal(f: Awaited<ReturnType<typeof fixture>>) {
    const prepared = (await runClassicEditReviewCommand({
      projectRoot: f.projectRoot,
      name: 'example',
      operation: 'prepare-applied',
      sessionId: 'current-agent',
    })) as { proposal: { proposalHash: string }; recordTemplate?: Record<string, unknown> };
    const judged = prepared;
    expect(judged.recordTemplate).toBeTruthy();
    const file = path.join(path.dirname(f.projectRoot), 'formal-requirements-change.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        ...judged.recordTemplate,
        decision: 'requirements-changed',
        summary:
          'The edited formal requirement needs the existing workflow revision and a new decision.',
      }),
    );
    await runClassicEditReviewCommand({
      projectRoot: f.projectRoot,
      name: 'example',
      operation: 'record',
      file,
    });
  }
  async function verifyRevisedFormal(f: Awaited<ReturnType<typeof fixture>>, report: string) {
    await f.ok(
      'guard',
      'example',
      'build',
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    await f.put(report, '# Verification\nThe newly approved formal requirements were verified.\n');
    await f.ok(
      'guard',
      'example',
      'verify',
      '--report',
      report,
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const proposal = await f.ok(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Deliver the newly verified requirements.',
    );
    await f.ok(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    expect((await f.inspect()).state).toMatchObject({
      phase: 'archive',
      archiveConfirmation: 'confirmed',
    });
  }
  it('keeps accepted Plan evidence after the current Builder judges an applied explanation', async () => {
    const f = await fixture();
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const { run, runtime } = await f.inspect();
    const action = run.actions.find(
      (entry) => entry.stepId === 'full.build.execute' && entry.status === 'pending',
    )!;
    const claimToken = randomUUID();
    await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      sessionId: 'current-agent',
      claimToken,
      context: { requestId: randomUUID(), projectRoot: f.projectRoot },
    });
    const original = await fs.readFile(path.join(f.projectRoot, f.plan), 'utf8');
    const after = original + '\n<!-- Explanation: preserve the approved task scope. -->\n';
    await f.put(f.plan, after);
    expect(JSON.stringify((await f.ok('state', 'next', 'example')).recoveryActions)).toContain(
      'prepare-applied',
    );
    const prepared = (await runClassicEditReviewCommand({
      projectRoot: f.projectRoot,
      name: run.runId,
      operation: 'prepare-applied',
      sessionId: 'current-agent',
    })) as { recordTemplate: Record<string, unknown> };
    expect(prepared.recordTemplate).toBeTruthy();
    const file = path.join(path.dirname(f.projectRoot), 'plan-edit-result.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        ...prepared.recordTemplate,
        decision: 'non-behavioral',
        summary:
          'Only an explanation was added; task requirements and the approved plan remain applicable.',
      }),
    );
    await runClassicEditReviewCommand({
      projectRoot: f.projectRoot,
      name: run.runId,
      operation: 'record',
      file,
    });
    const current = (await f.inspect()).run;
    expect(await inspectClassicSdkRevisionReadiness(f.projectRoot, current)).toEqual([]);
    expect(current.waits).toEqual(run.waits);
    expect(current.evidenceWaits).toEqual(run.evidenceWaits);
    expect(await fs.readFile(path.join(f.projectRoot, f.plan), 'utf8')).toBe(after);
  });
  it.each([false, true])(
    'keeps accepted Design evidence after the current Agent judges a raw formatting edit (already applied: %s)',
    async (applied) => {
      const f = await fixture();
      await f.prepareBuild();
      const { run, runtime } = await f.inspect();
      const action = run.actions.find(
        (entry) => entry.stepId === 'full.build.plan' && entry.status === 'pending',
      )!;
      const claimToken = randomUUID();
      await runtime.claim({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'host',
        sessionId: 'current-agent',
        claimToken,
        context: { requestId: randomUUID(), projectRoot: f.projectRoot },
      });
      const ref = `${f.change}/design.md`;
      const original = await fs.readFile(path.join(f.projectRoot, ref), 'utf8');
      const after = original + '\n';
      if (applied) await f.put(ref, after);
      if (applied)
        expect(JSON.stringify((await f.ok('state', 'next', 'example')).recoveryActions)).toContain(
          'prepare-applied',
        );
      const file = path.join(path.dirname(f.projectRoot), 'design-edit.json');
      await fs.writeFile(
        file,
        JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: path.join(f.projectRoot, ref), content: after },
        }),
      );
      const prepared = (await runClassicEditReviewCommand({
        projectRoot: f.projectRoot,
        name: run.runId,
        operation: applied ? 'prepare-applied' : 'prepare',
        file,
        sessionId: 'current-agent',
      })) as { proposal: { proposalHash: string }; continuation: { commandArgs: string[] } };
      expect(prepared.continuation.commandArgs).toContain('record');
      await fs.writeFile(
        file,
        JSON.stringify({
          proposalHash: prepared.proposal.proposalHash,
          decision: 'non-behavioral',
          summary: 'Only an empty line; the approved technical decision is unchanged.',
          claim: {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken,
            sessionId: 'current-agent',
          },
        }),
      );
      await runClassicEditReviewCommand({
        projectRoot: f.projectRoot,
        name: run.runId,
        operation: 'record',
        file,
      });
      await f.put(ref, after);
      const current = (await f.inspect()).run;
      await expect(classicAcceptedDesignEvidence(f.projectRoot, current)).resolves.toMatchObject({
        ref,
      });
      expect(current.runId).toBe(run.runId);
      expect(current.waits).toEqual(run.waits);
    },
  );
  it.each(['full.design.handoff', 'full.build.plan'] as const)(
    'continues interrupted %s work without resetting completed stages',
    async (stepId) => {
      const f = await fixture();
      if (stepId === 'full.build.plan') await f.prepareBuild();
      const { run, runtime } = await f.inspect();
      const action = run.actions.find(
        (entry) => entry.stepId === stepId && entry.status === 'pending',
      )!;
      const claimed = await runtime.claim({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'original-host',
        claimToken: 'stopped-claim',
      });
      const rejected = await f.cli(
        'state',
        'continue-work',
        'example',
        '--expected-revision',
        String(claimed.revision),
      );
      expect(rejected.exitCode).not.toBe(0);
      expect((await f.inspect()).run).toEqual(claimed);
      const stopped = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'stopped-claim',
          outcomeId: 'incomplete-work',
          status: 'failed',
          output: { summary: 'The session stopped after preserving partial work.' },
        },
        context: { projectRoot: f.projectRoot, requestId: 'stopped-work' },
      });
      const status = await f.ok('state', 'next', 'example');
      expect(status.continuation.commandArgs).toContain('continue-work');
      await f.ok(
        'state',
        'continue-work',
        'example',
        '--expected-revision',
        String(stopped.revision),
      );
      const resumed = (await f.inspect()).run;
      expect(resumed.runId).toBe(run.runId);
      expect(resumed.state).toEqual(stopped.state);
      expect(resumed.actions.find((entry) => entry.id === action.id)).toEqual(
        stopped.actions.find((entry) => entry.id === action.id),
      );
      expect(resumed.actions.filter((entry) => entry.status === 'pending')).toMatchObject([
        { stepId, attempt: 1 },
      ]);
    },
  );
  it('completes full delivery when repair approval changes only the committed archive checkpoint', async () => {
    const f = await fixture();
    const openSpec = await createOpenSpecArchiveFixture(path.dirname(f.projectRoot));
    vi.stubEnv('COMET_OPENSPEC', openSpec.command);
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: f.projectRoot, encoding: 'utf8' }).trim();
    const commit = () => {
      git(
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'verified delivery',
      );
      return git('rev-parse', 'HEAD');
    };
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    git('add', '--', f.change, f.plan, 'configuration.json', '.comet/config.yaml');
    commit();
    await f.put('implementation.mjs', 'export const answer = 42;\n');
    await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
    await f.put('generated/check-output.bin', 'actual output');
    const command = [
      process.execPath,
      '-e',
      "require('node:fs').writeFileSync('generated/check-output.bin','actual output')",
    ];
    await f.ok('guard', 'example', 'build', '--apply', '--', ...command);
    const report = 'docs/superpowers/reports/verify.md';
    await f.put(report, '# Verification\nCurrent implementation and tests pass.\n');
    await f.ok('guard', 'example', 'verify', '--report', report, '--apply', '--', ...command);
    const proposal = await f.ok(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Deliver locally.',
    );
    await f.ok(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    await f.ok('guard', 'example', 'archive', '--apply');
    const archived = (await f.inspect()).run;
    await f.put(
      '.comet/check-policy.json',
      JSON.stringify({
        version: 2,
        commands: [{ argv: command, cwd: '.', outputs: ['generated/**'] }],
      }),
    );
    await fs.unlink(path.join(f.projectRoot, 'generated/check-output.bin'));
    await f.ok(
      'state',
      'repair-delivery',
      'example',
      '--expected-revision',
      String(archived.revision),
    );
    const next = await f.ok('state', 'next', 'example');
    const request = path.join(path.dirname(f.projectRoot), 'direct-delivery-recheck.json');
    await fs.writeFile(request, JSON.stringify(next.continuation.request));
    const result = await runtimeDispatchCommand(
      { request, application: 'classic-full', projectRoot: f.projectRoot },
      { invocationCwd: f.projectRoot },
    );
    expect(result.response.status).toBe('succeeded');
    const waiting = (await f.inspect()).run;
    const decision = waiting.waits.find((wait) => wait.status === 'pending')!;
    const archiveRef = (
      archived.outputs['full.archive.execute'].value as { archiveDirectory: string }
    ).archiveDirectory;
    git('add', '--', f.change, archiveRef, f.plan, report, 'implementation.mjs');
    const sha = commit();
    expect(
      (await f.cli('state', 'complete-delivery', 'example', '--commit', sha)).exitCode,
    ).not.toBe(0);
    expect((await f.inspect()).run).toEqual(waiting);
    await f.ok(
      'state',
      'decide-delivery-repair',
      'example',
      '--proposal-hash',
      decision.proposalHash,
      '--choice',
      'approved',
    );
    const approved = (await f.inspect()).run;
    const stateFile = path.join(f.projectRoot, archiveRef, 'comet-state.yaml');
    const committedState = await fs.readFile(stateFile, 'utf8');
    const proposalFile = path.join(f.projectRoot, archiveRef, 'proposal.md');
    const proposalSource = await fs.readFile(proposalFile, 'utf8');
    await fs.writeFile(proposalFile, proposalSource + '\nUnapproved scope change.\n');
    expect(
      (await f.cli('state', 'complete-delivery', 'example', '--commit', sha)).exitCode,
    ).not.toBe(0);
    expect((await f.inspect()).run).toEqual(approved);
    await fs.writeFile(proposalFile, proposalSource);
    const deliveryResult = JSON.parse(
      execFileSync(
        process.execPath,
        [
          path.resolve('assets/skills/comet/scripts/comet-state.mjs'),
          'complete-delivery',
          'example',
          '--commit',
          sha,
          '--json',
        ],
        { cwd: f.projectRoot, encoding: 'utf8' },
      ),
    );
    expect(deliveryResult.exitCode).toBe(0);
    const delivered = deliveryResult.data;
    expect(delivered.nextAction.kind).toBe('done');
    expect((await f.inspect()).run.status).toBe('completed');
    expect(await fs.readFile(stateFile, 'utf8')).toBe(committedState);
    expect(approved.actions.filter((a) => a.stepId === 'full.archive.execute')).toHaveLength(1);
    expect(git('ls-tree', '-r', '--name-only', sha, '--', 'generated')).toBe('');
  }, 120_000);

  it('repairs late declared check outputs after Archive without replaying Archive or committing generated files', async () => {
    const f = await fixture();
    const openSpec = await createOpenSpecArchiveFixture(path.dirname(f.projectRoot));
    vi.stubEnv('COMET_OPENSPEC', openSpec.command);
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    await f.put('implementation.mjs', 'export const answer = 42;\n');
    await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
    execFileSync(
      'git',
      [
        'add',
        '--',
        'openspec',
        'docs',
        'implementation.mjs',
        'configuration.json',
        '.comet/config.yaml',
      ],
      { cwd: f.projectRoot },
    );
    const commit = () =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '-m',
          'verified delivery',
        ],
        { cwd: f.projectRoot, stdio: 'ignore' },
      );
    commit();
    const newSource = 'new-adapter.mjs';
    await f.put(newSource, 'export const preserveThisImplementation = true;\n');
    const outputRef = 'generated/check-output.bin';
    const failFlag = path.join(path.dirname(f.projectRoot), 'fail-delivery-check');
    const counter = path.join(path.dirname(f.projectRoot), 'delivery-check-count');
    const command = [
      process.execPath,
      '-e',
      `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(counter)},'run\\n');if(fs.existsSync(${JSON.stringify(failFlag)}))process.exit(9);fs.mkdirSync('generated',{recursive:true});if(!fs.existsSync('generated/check-output.bin'))fs.writeFileSync('generated/check-output.bin',String(Date.now()));`,
    ];
    await f.put(outputRef, 'generated-output');
    await f.ok('guard', 'example', 'build', '--apply', '--', ...command);
    const report = 'docs/superpowers/reports/verify.md';
    await f.put(report, '# Verification\nCurrent implementation and tests pass.\n');
    await f.ok('guard', 'example', 'verify', '--report', report, '--apply', '--', ...command);
    const proposal = await f.ok(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Deliver the verified adapter locally.',
    );
    await f.ok(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    await f.ok('guard', 'example', 'archive', '--apply');
    const initialDelivery = await f.inspect();
    const initialAction = initialDelivery.run.actions.at(-1)!;
    await initialDelivery.runtime.claim({
      runId: initialDelivery.run.runId,
      actionId: initialAction.id,
      attempt: initialAction.attempt,
      inputHash: initialAction.inputHash,
      executorId: 'first-delivery-session',
      claimToken: 'first-delivery-claim',
    });
    const initialStopped = await initialDelivery.runtime.recordOutcome({
      runId: initialDelivery.run.runId,
      outcome: {
        actionId: initialAction.id,
        attempt: initialAction.attempt,
        inputHash: initialAction.inputHash,
        claimToken: 'first-delivery-claim',
        outcomeId: 'first-delivery-stopped',
        status: 'failed',
        output: { summary: 'The original delivery session stopped before performing Git.' },
      },
      context: { projectRoot: f.projectRoot, requestId: 'first-delivery-stop' },
    });
    await f.ok(
      'state',
      'continue-work',
      'example',
      '--expected-revision',
      String(initialStopped.revision),
    );
    const before = (await f.inspect()).run;
    expect(before.state).toMatchObject({ phase: 'archive', archived: true });
    const oldCheck = before.actions
      .slice()
      .reverse()
      .find((a) => a.stepId === 'full.verify.check')!;
    expect(oldCheck.outcome?.output).toMatchObject({
      deliveryInputs: { [outputRef]: expect.any(String) },
    });
    await fs.unlink(path.join(f.projectRoot, outputRef));
    await f.put(
      '.comet/check-policy.json',
      JSON.stringify({
        version: 2,
        commands: [{ argv: command, cwd: '.', outputs: ['generated/**', newSource] }],
      }),
    );
    const unsafe = await f.cli(
      'state',
      'repair-delivery',
      'example',
      '--expected-revision',
      String(before.revision),
    );
    expect(unsafe.exitCode).not.toBe(0);
    expect((await f.inspect()).run).toEqual(before);
    await f.put(
      '.comet/check-policy.json',
      JSON.stringify({
        version: 2,
        commands: [{ argv: command, cwd: '.', outputs: ['generated/**'] }],
      }),
    );
    await f.put('implementation.mjs', 'export const answer = 99;\n');
    const changedSource = await f.cli(
      'state',
      'repair-delivery',
      'example',
      '--expected-revision',
      String(before.revision),
    );
    expect(changedSource.exitCode).not.toBe(0);
    expect((await f.inspect()).run).toEqual(before);
    await f.put('implementation.mjs', 'export const answer = 42;\n');
    const archivedBefore = (
      before.outputs['full.archive.execute'].value as { archiveDirectory: string }
    ).archiveDirectory;
    const stateFile = path.join(f.projectRoot, archivedBefore, 'comet-state.yaml');
    const originalState = await fs.readFile(stateFile, 'utf8');
    const editedState = parseYaml(originalState);
    editedState.run_checkpoint.hash = '0'.repeat(64);
    await fs.writeFile(stateFile, '# comet-execution: managed-run\n' + stringifyYaml(editedState));
    await expect(captureClassicDeliveryRepair(f.projectRoot, before)).rejects.toThrow(
      /checkpoint|检查点/u,
    );
    await fs.writeFile(stateFile, originalState);
    await f.ok(
      'state',
      'repair-delivery',
      'example',
      '--expected-revision',
      String(before.revision),
    );
    let repairing = (await f.inspect()).run;
    expect(repairing.runId).toBe(before.runId);
    expect(repairing.state).toMatchObject({ phase: 'archive', archived: true });
    expect(repairing.actions.at(-1)).toMatchObject({
      stepId: 'full.delivery.check',
      status: 'pending',
    });
    const supersededCheckId = repairing.actions.at(-1)!.id;
    await f.ok(
      'state',
      'repair-delivery',
      'example',
      '--expected-revision',
      String(repairing.revision),
    );
    repairing = (await f.inspect()).run;
    expect(repairing.actions.find((action) => action.id === supersededCheckId)?.status).toBe(
      'cancelled',
    );
    const stale = await f.cli(
      'state',
      'repair-delivery',
      'example',
      '--expected-revision',
      String(before.revision - 1),
    );
    expect(stale.exitCode).not.toBe(0);
    expect((await f.inspect()).run.revision).toBe(repairing.revision);
    const request = path.join(path.dirname(f.projectRoot), 'delivery-recheck.json');
    await fs.writeFile(failFlag, 'fail this actual command');
    const recheck = await f.ok('state', 'next', 'example');
    expect(recheck.continuation.request).toMatchObject({
      operation: 'execute',
      runId: before.runId,
      expectedRevision: repairing.revision,
      actionId: repairing.actions.at(-1)!.id,
      executorId: 'comet-classic-check',
    });
    const serialized = JSON.stringify(recheck);
    expect(serialized.indexOf('"continuation":')).toBeLessThan(
      serialized.indexOf('"configuration":'),
    );
    expect(recheck.nextAction.instruction).toContain('data.continuation.request');
    await fs.writeFile(request, JSON.stringify(recheck.continuation.request));
    const checked = await runtimeDispatchCommand(
      { request, application: 'classic-full', projectRoot: f.projectRoot },
      { invocationCwd: f.projectRoot },
    );
    expect(checked.response.status, JSON.stringify(checked.response)).toBe('succeeded');
    const failedCheck = (await f.inspect()).run;
    expect(failedCheck.status).toBe('failed');
    expect(failedCheck.actions.at(-1)?.outcome?.output).toMatchObject({ exitCode: 9 });
    expect((await f.ok('state', 'next', 'example')).continuation.commandArgs).toContain(
      'repair-delivery',
    );
    await fs.unlink(failFlag);
    await f.ok(
      'state',
      'repair-delivery',
      'example',
      '--expected-revision',
      String(failedCheck.revision),
    );
    const resumedCheck = await f.inspect();
    const checkAction = resumedCheck.run.actions.at(-1)!;
    const claimedCheck = await resumedCheck.runtime.claim({
      runId: resumedCheck.run.runId,
      actionId: checkAction.id,
      attempt: checkAction.attempt,
      inputHash: checkAction.inputHash,
      executorId: 'comet-classic-check',
      claimToken: 'actual-check-lost-reply',
      context: { projectRoot: f.projectRoot, requestId: 'actual-delivery-recheck' },
    });
    expect(
      (
        await f.cli(
          'state',
          'repair-delivery',
          'example',
          '--expected-revision',
          String(claimedCheck.revision),
        )
      ).exitCode,
    ).not.toBe(0);
    expect((await f.inspect()).run).toEqual(claimedCheck);
    const actualResult = await runClassicSdkCommandCheck(
      claimedCheck,
      claimedCheck.actions.at(-1)!,
      {
        projectRoot: f.projectRoot,
        runId: claimedCheck.runId,
        argv: command,
        cwd: '.',
        reusable: false,
      },
    );
    expect(actualResult.status).toBe('succeeded');
    expect(await fs.readFile(path.join(f.projectRoot, outputRef), 'utf8')).not.toBe(
      'generated-output',
    );
    const lostReply = await f.cli('state', 'check', 'example', 'archive', '--recover');
    expect(lostReply.data.recovery.recordOutcomeRequest.outcome.output).toEqual(
      actualResult.output,
    );
    await fs.writeFile(request, JSON.stringify(lostReply.data.recovery.markUnknownRequest));
    expect(
      (
        await runtimeDispatchCommand(
          { request, application: 'classic-full', projectRoot: f.projectRoot },
          { invocationCwd: f.projectRoot },
        )
      ).response.status,
    ).toBe('succeeded');
    const unknownCheck = (await f.inspect()).run;
    expect(unknownCheck.actions.at(-1)?.status).toBe('unknown');
    expect(
      (
        await f.cli(
          'state',
          'repair-delivery',
          'example',
          '--expected-revision',
          String(unknownCheck.revision),
        )
      ).exitCode,
    ).not.toBe(0);
    const recoveredReply = await f.cli('state', 'check', 'example', 'archive', '--recover');
    await fs.writeFile(request, JSON.stringify(recoveredReply.data.recovery.recordOutcomeRequest));
    const restoredOutcome = await runtimeDispatchCommand(
      { request, application: 'classic-full', projectRoot: f.projectRoot },
      { invocationCwd: f.projectRoot },
    );
    expect(restoredOutcome.response.status).toBe('succeeded');
    expect((await fs.readFile(counter, 'utf8')).match(/run/g)).toHaveLength(4);
    await fs.unlink(path.join(f.projectRoot, outputRef));
    const previousWaiting = (await f.inspect()).run;
    const staleDecision = previousWaiting.waits.find((wait) => wait.status === 'pending')!;
    await f.put(
      '.comet/check-policy.json',
      JSON.stringify({
        version: 2,
        commands: [{ argv: command, cwd: '.', outputs: ['generated/**', 'other-generated/**'] }],
      }),
    );
    await f.ok(
      'state',
      'repair-delivery',
      'example',
      '--expected-revision',
      String(previousWaiting.revision),
    );
    const newScope = (await f.inspect()).run;
    await fs.writeFile(
      request,
      JSON.stringify({
        operation: 'execute',
        runId: newScope.runId,
        actionId: newScope.actions.at(-1)!.id,
        executorId: 'comet-classic-check',
      }),
    );
    expect(
      (
        await runtimeDispatchCommand(
          { request, application: 'classic-full', projectRoot: f.projectRoot },
          { invocationCwd: f.projectRoot },
        )
      ).response.status,
    ).toBe('succeeded');
    const waiting = (await f.inspect()).run;
    expect(
      (
        await f.cli(
          'state',
          'decide-delivery-repair',
          'example',
          '--proposal-hash',
          staleDecision.proposalHash,
          '--choice',
          'approved',
        )
      ).exitCode,
    ).not.toBe(0);
    expect((await f.inspect()).run).toEqual(waiting);
    expect((await fs.readFile(counter, 'utf8')).match(/run/g)).toHaveLength(5);
    await fs.unlink(path.join(f.projectRoot, outputRef));
    const decision = waiting.waits.find((wait) => wait.status === 'pending')!;
    expect(decision.stepId).toBe('full.delivery.confirm');
    expect(
      (
        await f.cli(
          'state',
          'complete-delivery',
          'example',
          '--commit',
          execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: f.projectRoot,
            encoding: 'utf8',
          }).trim(),
        )
      ).exitCode,
    ).not.toBe(0);
    await f.ok(
      'state',
      'decide-delivery-repair',
      'example',
      '--proposal-hash',
      decision.proposalHash,
      '--choice',
      'approved',
    );
    const approved = (await f.inspect()).run;
    for (const original of before.actions.filter(
      (action) => action.stepId !== 'full.archive.deliver',
    )) {
      const retained = approved.actions.find((action) => action.id === original.id)!;
      expect(retained.outcome).toEqual(original.outcome);
      expect(retained.receipts).toEqual(original.receipts);
      expect(retained.inputHash).toBe(original.inputHash);
    }
    expect(approved.actions.filter((a) => a.stepId === 'full.archive.execute')).toHaveLength(1);
    expect(await openSpec.invocations()).toHaveLength(1);
    const pendingDelivery = approved.actions.at(-1)!;
    const deliveryRuntime = (await f.inspect()).runtime;
    await deliveryRuntime.claim({
      runId: approved.runId,
      expectedRevision: approved.revision,
      actionId: pendingDelivery.id,
      attempt: pendingDelivery.attempt,
      inputHash: pendingDelivery.inputHash,
      executorId: 'delivery-session',
      claimToken: 'stopped-delivery-claim',
    });
    const failedDelivery = await deliveryRuntime.recordOutcome({
      runId: approved.runId,
      outcome: {
        actionId: pendingDelivery.id,
        attempt: pendingDelivery.attempt,
        inputHash: pendingDelivery.inputHash,
        claimToken: 'stopped-delivery-claim',
        outcomeId: 'delivery-session-stopped',
        status: 'failed',
        output: { summary: 'The session stopped before performing Git delivery.' },
      },
      context: { requestId: 'delivery-stop', projectRoot: f.projectRoot },
    });
    await f.ok(
      'state',
      'continue-work',
      'example',
      '--expected-revision',
      String(failedDelivery.revision),
    );
    const continuedDelivery = (await f.inspect()).run;
    expect(continuedDelivery.actions.at(-1)?.input).toMatchObject({
      activation: {
        deliveryRepairCheckId: (
          pendingDelivery.input as { activation: { deliveryRepairCheckId: string } }
        ).activation.deliveryRepairCheckId,
      },
    });
    expect(
      continuedDelivery.actions.filter((a) => a.stepId === 'full.delivery.check'),
    ).toHaveLength(4);
    const continuedContext = (await f.ok('state', 'next', 'example')).continuation.current;
    expect(continuedContext.actions[0].inputSummary.outputs).toHaveProperty(
      'full.archive.preflight',
    );
    expect(continuedContext.actions[0].inputSummary.outputs).toHaveProperty('full.archive.execute');
    expect(continuedContext.approvals.map((wait: { stepId: string }) => wait.stepId)).toEqual(
      expect.arrayContaining(['full.archive.confirm', 'full.delivery.confirm']),
    );
    const archiveRef = (
      approved.outputs['full.archive.execute'].value as { archiveDirectory: string }
    ).archiveDirectory;
    execFileSync('git', ['add', '--', f.change, archiveRef, f.plan, report, newSource], {
      cwd: f.projectRoot,
    });
    commit();
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: f.projectRoot,
      encoding: 'utf8',
    }).trim();
    const delivered = await f.ok('state', 'complete-delivery', 'example', '--commit', sha);
    expect(delivered.nextAction.kind).toBe('done');
    await f.ok('state', 'delivery', 'example', '--verify');
    expect(
      execFileSync('git', ['ls-tree', '-r', '--name-only', sha, '--', outputRef], {
        cwd: f.projectRoot,
        encoding: 'utf8',
      }).trim(),
    ).toBe('');
  }, 180_000);
  it('revises the accepted plan from Archive before side effects and rejects the old delivery approval', async () => {
    const f = await fixture();
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
    await f.ok(
      'guard',
      'example',
      'build',
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const report = 'docs/superpowers/reports/verify.md';
    await f.put(report, '# Verification\nAll behavior was verified.\n');
    await f.ok(
      'guard',
      'example',
      'verify',
      '--report',
      report,
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const approval = await f.ok(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Archive the current work locally.',
    );
    await f.ok(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      approval.wait.proposalHash,
      '--choice',
      'local',
    );
    const before = (await f.inspect()).run;
    await fs.appendFile(
      path.join(f.projectRoot, f.plan),
      '\nExplain the updated implementation detail.\n',
    );
    await recordChangedFormal(f);
    const diagnosis = await f.ok('state', 'next', 'example');
    expect(diagnosis.continuation.commandArgs).toContain('revise-plan');
    await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(before.revision));
    expect((await f.inspect()).state).toMatchObject({
      phase: 'build',
      verifyResult: 'pending',
      archiveConfirmation: null,
      buildMode: 'executing-plans',
    });
    expect(
      (
        await f.cli(
          'state',
          'decide-archive',
          'example',
          '--proposal-hash',
          approval.wait.proposalHash,
          '--choice',
          'local',
        )
      ).exitCode,
    ).not.toBe(0);
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    expect((await f.inspect()).run.runId).toBe(before.runId);
    await verifyRevisedFormal(f, report);
  });
  it('revises changed Design from Verify and preserves completed implementation and Build configuration', async () => {
    const f = await fixture();
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
    await f.put('implemented.txt', 'preserved implementation\n');
    await f.ok(
      'guard',
      'example',
      'build',
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const before = (await f.inspect()).run;
    expect(before.state).toMatchObject({ phase: 'verify' });
    await fs.appendFile(
      path.join(f.projectRoot, f.change, 'design.md'),
      '\nUse the revised adapter architecture.\n',
    );
    const changedDesign = await fs.readFile(
      path.join(f.projectRoot, f.change, 'design.md'),
      'utf8',
    );
    await recordChangedFormal(f);
    const diagnosis = await f.cli('state', 'check', 'example', 'verify', '--recover');
    expect(
      (diagnosis.data.recoveryActions ?? []).some((entry: { commandArgs: string[] }) =>
        entry.commandArgs.includes('revise-design'),
      ),
    ).toBe(true);
    await f.ok('state', 'revise-design', 'example', '--expected-revision', String(before.revision));
    const revised = (await f.inspect()).run;
    expect(revised.state).toMatchObject({
      phase: 'design',
      buildMode: 'executing-plans',
      verifyResult: 'pending',
      archiveConfirmation: null,
    });
    expect(await fs.readFile(path.join(f.projectRoot, 'implemented.txt'), 'utf8')).toBe(
      'preserved implementation\n',
    );
    await f.finishDesign(await f.design('Use the revised adapter architecture.'), changedDesign);
    const completed = await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    expect(completed.nextAction.stepId).toBe('full.build.execute');
    expect((await f.inspect()).run.runId).toBe(before.runId);
    await verifyRevisedFormal(f, 'docs/superpowers/reports/revised-design.md');
  });

  it('records an interrupted Builder failure and resumes its partial work on the same Run', async () => {
    const f = await fixture();
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const { run, runtime } = await f.inspect();
    const action = run.actions.find(
      (entry) => entry.stepId === 'full.build.execute' && entry.status === 'pending',
    )!;
    await f.put('partial.txt', 'preserve partial work\n');
    await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'external-executor',
      sessionId: 'original-session',
      claimToken: 'original-claim',
    });
    const failed = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'original-claim',
        outcomeId: 'stopped-builder',
        status: 'failed',
        output: { summary: 'The original session stopped with partial work.' },
      },
      context: { projectRoot: f.projectRoot, requestId: 'stopped-builder' },
    });
    expect(failed.actions.find((entry) => entry.id === action.id)).toMatchObject({
      status: 'failed',
    });
    const resume = await f.ok('state', 'next', 'example');
    expect(resume.continuation.commandArgs).toEqual(expect.arrayContaining(['continue-build']));
    await f.ok(
      'state',
      'continue-build',
      'example',
      '--expected-revision',
      String(failed.revision),
    );
    const resumed = (await f.inspect()).run;
    const next = resumed.actions.find((entry) => entry.status === 'pending')!;
    expect(next).toMatchObject({ stepId: 'full.build.execute' });
    expect(next.id).not.toBe(action.id);
    expect(await fs.readFile(path.join(f.projectRoot, 'partial.txt'), 'utf8')).toBe(
      'preserve partial work\n',
    );
    expect((await f.ok('state', 'next', 'example')).nextAction).toMatchObject({
      kind: 'action',
      actionId: next.id,
    });
  });
  it('stabilizes missing task IDs before Design approval and keeps later task scope protected', async () => {
    const f = await fixture(false, 'full', false, '- [ ] Implement the adapter\n');
    const proposal = await f.ok(
      'state',
      'propose-design',
      'example',
      '--proposal',
      'Use the existing adapter.',
    );
    const tasksFile = path.join(f.projectRoot, f.change, 'tasks.md');
    const assigned = await f.ok('state', 'tasks', 'example');
    expect(assigned.needsIds).toBe(false);
    expect(assigned.tasks[0]).toMatchObject({ text: 'Implement the adapter', completed: false });
    const taskId = assigned.tasks[0].id as string;
    expect(taskId).toBeTruthy();
    const source = await fs.readFile(tasksFile, 'utf8');
    const pending = (await f.inspect()).run;
    const repeated = await f.cli(
      'state',
      'propose-design',
      'example',
      '--proposal',
      'Use the existing adapter.',
    );
    expect(repeated.exitCode).not.toBe(0);
    expect((await f.inspect()).run).toEqual(pending);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await f.ok('state', 'tasks', 'example', '--assign-ids');
      expect(await fs.readFile(tasksFile, 'utf8')).toBe(source);
    }
    await f.ok(
      'state',
      'decide-design',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'approved',
    );
    await f.finishDesign(proposal.wait.proposalHash);
    await f.put(
      'configuration.json',
      JSON.stringify({
        build_mode: 'executing-plans',
        tdd_mode: 'tdd',
        review_mode: 'standard',
        subagent_dispatch: null,
      }),
    );
    await f.ok('state', 'propose-build', 'example', '--file', 'configuration.json', '--confirmed');
    await f.put(
      f.plan,
      `<!-- comet-task-authority: ${f.change}/tasks.md -->\n# Plan\n<!-- comet-task-ref:${taskId} -->\nImplement and validate.\n`,
    );
    const submitted = await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    expect(submitted.nextAction.stepId).toBe('full.build.execute');
    const accepted = (await f.inspect()).run;
    await f.put(
      `${f.change}/tasks.md`,
      `- [ ] Replace the public API <!-- comet-task:${taskId} -->\n`,
    );
    await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(accepted.revision));
    const before = (await f.inspect()).run;
    const blocked = await f.cli('state', 'submit-plan', 'example', '--plan', f.plan);
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr).toContain('revise-design');
    expect((await f.inspect()).run).toEqual(before);
  });

  it('does not assign new task IDs through an already approved Design proposal', async () => {
    const f = await fixture(false, 'full', false, '- [ ] Implement the adapter\n');
    const hash = await f.design();
    const tasksFile = path.join(f.projectRoot, f.change, 'tasks.md');
    const source = (await fs.readFile(tasksFile, 'utf8')) + '- [ ] Add an unapproved capability\n';
    await fs.writeFile(tasksFile, source);
    const before = (await f.inspect()).run;
    const repeated = await f.cli(
      'state',
      'propose-design',
      'example',
      '--proposal',
      'Use the existing adapter.',
    );
    expect(repeated.exitCode).not.toBe(0);
    expect(await fs.readFile(tasksFile, 'utf8')).toBe(source);
    expect((await f.inspect()).run).toEqual(before);
    await f.put(
      `${f.change}/design.md`,
      '---\ncomet_change: example\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\nUse the existing adapter.\n',
    );
    const completed = await f.cli(
      'state',
      'complete-design',
      'example',
      '--design-doc',
      `${f.change}/design.md`,
      '--approval-hash',
      hash,
    );
    expect(completed.exitCode).not.toBe(0);
    expect(completed.stderr).toContain('revise-design');
  });

  it('rejects invalid Build semantics before claiming, then accepts a corrected proposal', async () => {
    const f = await fixture();
    await f.finishDesign(await f.design());
    const before = (await f.inspect()).run;
    await f.put(
      'configuration.json',
      JSON.stringify({
        build_mode: 'autonomous',
        tdd_mode: 'direct',
        review_mode: 'standard',
        subagent_dispatch: null,
        direct_override: true,
      }),
    );
    const invalid = await f.cli(
      'state',
      'propose-build',
      'example',
      '--file',
      'configuration.json',
    );
    expect(invalid.exitCode).not.toBe(0);
    expect(JSON.stringify(invalid)).toContain('direct_override');
    expect((await f.inspect()).run).toEqual(before);
    await f.put(
      'configuration.json',
      JSON.stringify({
        build_mode: 'autonomous',
        tdd_mode: 'direct',
        review_mode: 'standard',
        subagent_dispatch: null,
        direct_override: false,
      }),
    );
    const proposed = await f.ok(
      'state',
      'propose-build',
      'example',
      '--file',
      'configuration.json',
    );
    expect(proposed.wait.proposalHash).toEqual(expect.any(String));
  });

  it('repairs a rejected builtin Build proposal with its original claim and a new user decision', async () => {
    const f = await fixture();
    await f.finishDesign(await f.design());
    const { run, runtime } = await f.inspect();
    const action = run.actions.find((entry) => entry.stepId === 'full.build.configure')!;
    const claimToken = 'rejected-build-claim';
    const claimed = await runtime.claim({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-classic-state',
      claimToken,
    });
    const output = {
      buildMode: 'autonomous',
      tddMode: 'direct',
      reviewMode: 'standard',
      subagentDispatch: null,
      directOverride: true,
      isolation: 'current',
      boundBranch: 'main',
    };
    const outcome = {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken,
      outcomeId: 'rejected-build-outcome',
      status: 'succeeded' as const,
      output,
    };
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        expectedRevision: claimed.revision,
        outcome,
        context: { projectRoot: f.projectRoot, requestId: 'reject-build' },
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    const rejected = (await f.inspect()).run;
    const next = await f.ok('state', 'next', 'example');
    expect(next.continuation).toMatchObject({ mode: 'reconcile' });
    expect(next.continuation.commandArgs).toContain('propose-build');
    const recovery = await f.cli('state', 'check', 'example', 'build', '--recover');
    expect(recovery.exitCode).toBe(1);
    expect(JSON.stringify(recovery)).toContain('outcome-rejected');
    await f.put(
      'configuration.json',
      JSON.stringify({
        build_mode: 'autonomous',
        tdd_mode: 'direct',
        review_mode: 'standard',
        subagent_dispatch: null,
        direct_override: false,
      }),
    );
    expect(
      (
        await f.cli(
          'state',
          'propose-build',
          'example',
          '--file',
          'configuration.json',
          '--confirmed',
        )
      ).exitCode,
    ).not.toBe(0);
    expect((await f.inspect()).run).toEqual(rejected);
    expect(recovery.data.recovery.commandArgs).not.toContain('--project-root');
    expect(recovery.data.recovery.cwd).toBe(f.projectRoot);
    const roundtrip = await runClassicCli(
      recovery.data.recovery.commandArgs
        .slice(1)
        .map((argument: string) =>
          argument === '<configuration-json>' ? 'configuration.json' : argument,
        ),
      undefined,
      { invocationCwd: recovery.data.recovery.cwd },
    );
    expect(roundtrip.exitCode, roundtrip.stdout).toBe(0);
    const proposed = JSON.parse(roundtrip.stdout!).data;
    const repaired = (await f.inspect()).run;
    const repairedAction = repaired.actions.find((entry) => entry.id === action.id)!;
    expect(repairedAction).toMatchObject({
      status: 'succeeded',
      attempt: action.attempt,
      inputHash: action.inputHash,
      claim: { token: claimToken },
      rejectedOutcomes: [{ outcome }],
    });
    expect(repairedAction.outcome?.outcomeId).not.toBe(outcome.outcomeId);
    expect(repaired.waits.at(-1)).toMatchObject({
      status: 'pending',
      proposalHash: proposed.wait.proposalHash,
    });
    // 旧 revision 的并发回传不能覆盖修正后的提案。
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        expectedRevision: rejected.revision,
        outcome: {
          ...outcome,
          outcomeId: 'stale-build-outcome',
          output: { ...output, directOverride: false },
        },
        context: { projectRoot: f.projectRoot, requestId: 'stale-build' },
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(
      (await f.cli('state', 'propose-build', 'example', '--file', 'configuration.json')).exitCode,
    ).not.toBe(0);
    expect((await f.inspect()).run).toEqual(repaired);
    await f.ok(
      'state',
      'decide-build',
      'example',
      '--proposal-hash',
      proposed.wait.proposalHash,
      '--choice',
      'approved',
    );
    const approved = (await f.inspect()).run;
    expect(
      (await f.cli('state', 'propose-build', 'example', '--file', 'configuration.json')).exitCode,
    ).not.toBe(0);
    expect((await f.inspect()).run).toEqual(approved);
  });

  it.each(['comet-classic-state', 'external-executor'])(
    'does not take over an unreturned Build claim (%s)',
    async (executorId) => {
      const f = await fixture();
      await f.finishDesign(await f.design());
      const { run, runtime } = await f.inspect();
      const action = run.actions.find((entry) => entry.stepId === 'full.build.configure')!;
      const claimed = await runtime.claim({
        runId: run.runId,
        expectedRevision: run.revision,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId,
        claimToken: 'running-build-claim',
      });
      await f.put(
        'configuration.json',
        JSON.stringify({
          build_mode: 'autonomous',
          tdd_mode: 'direct',
          review_mode: 'standard',
          subagent_dispatch: null,
        }),
      );
      expect(
        (await f.cli('state', 'propose-build', 'example', '--file', 'configuration.json')).exitCode,
      ).not.toBe(0);
      expect((await f.inspect()).run).toEqual(claimed);
    },
  );

  it('allows the approved Design document to grow in place and retains Open approval history', async () => {
    const f = await fixture();
    const before = (await f.inspect()).run;
    const hash = await f.design();
    await f.finishDesign(hash);
    const after = (await f.inspect()).run;
    expect(after.state).toMatchObject({ phase: 'build', designDoc: `${f.change}/design.md` });
    expect(after.outputs['full.open.evidence']).toEqual(before.outputs['full.open.evidence']);
    expect(after.workflow).toEqual(before.workflow);
  });

  it('reproposes changed requirements atomically, rejects old decisions, and resumes the known old builtin Run', async () => {
    const f = await fixture();
    const hash = await f.design();
    const before = (await f.inspect()).run;
    await f.put(
      `${f.change}/tasks.md`,
      '- [ ] Implement the revised adapter <!-- comet-task:impl -->\n',
    );
    const blocked = await f.cli(
      'state',
      'complete-design',
      'example',
      '--design-doc',
      `${f.change}/design.md`,
      '--approval-hash',
      hash,
    );
    expect(blocked.exitCode).not.toBe(0);
    const checked = await f.cli('state', 'check', 'example', 'design', '--recover');
    expect(checked.exitCode).not.toBe(0);
    expect(checked.data.recoveryActions[0].commandArgs).toContain('revise-design');
    const revised = await f.ok(
      'state',
      'revise-design',
      'example',
      '--expected-revision',
      String(before.revision),
    );
    expect(revised.nextAction.stepId).toBe('full.design.handoff');
    const after = (await f.inspect()).run;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.workflow.hash).not.toBe(before.workflow.hash);
    expect(after.waits).toEqual(before.waits);
    expect(after.actions.slice(0, -1).filter((a) => a.status === 'succeeded')).toEqual(
      before.actions.filter((a) => a.status === 'succeeded'),
    );
    await f.ok('state', 'revise-design', 'example', '--expected-revision', String(before.revision));
    expect((await f.inspect()).run).toEqual(after);
    const stale = await f.cli(
      'state',
      'revise-design',
      'example',
      '--expected-revision',
      String(before.revision - 1),
    );
    expect(stale.exitCode).not.toBe(0);
    const proposal = await f.ok(
      'state',
      'propose-design',
      'example',
      '--proposal',
      'Implement the revised adapter.',
    );
    expect(proposal.wait.proposalHash).not.toBe(hash);
    const oldDecision = await f.cli(
      'state',
      'decide-design',
      'example',
      '--proposal-hash',
      hash,
      '--choice',
      'approved',
    );
    expect(oldDecision.exitCode).not.toBe(0);
    await f.ok(
      'state',
      'decide-design',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'approved',
    );
    await f.finishDesign(proposal.wait.proposalHash);
    const current = (await f.inspect()).run;
    const request = path.join(f.projectRoot, 'inspect.json');
    await fs.writeFile(request, JSON.stringify({ operation: 'inspect', runId: 'example' }));
    const dispatch = await runtimeDispatchCommand(
      { request, application: 'classic-full', projectRoot: f.projectRoot },
      { invocationCwd: f.projectRoot },
    );
    expect(dispatch.response).toMatchObject({
      status: 'succeeded',
      data: { revision: current.revision, workflow: current.workflow },
    });
  });

  it.each([false, true])(
    'revises a plan from execute or plan-ready (pause=%s), binding the new candidate and rejecting stale handles',
    async (pause) => {
      const f = await fixture();
      await f.prepareBuild();
      await f.ok(
        'state',
        'submit-plan',
        'example',
        '--plan',
        f.plan,
        ...(pause ? ['--pause'] : []),
      );
      const before = (await f.inspect()).run;
      const oldWait = before.waits.at(-1)!;
      const oldAction = before.actions.find((a) => a.status === 'pending');
      await fs.appendFile(
        path.join(f.projectRoot, f.plan),
        'Clarify the existing validation command.\n',
      );
      const drift = await f.cli('state', 'check', 'example', 'build', '--recover');
      expect(drift.exitCode).not.toBe(0);
      expect(drift.data.recoveryActions[0].commandArgs).toContain('revise-plan');
      await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(before.revision));
      const revised = (await f.inspect()).run;
      expect(revised.state).toEqual(before.state);
      if (oldAction) {
        const { runtime } = await f.inspect();
        await expect(
          runtime.claim({
            runId: revised.runId,
            expectedRevision: revised.revision,
            actionId: oldAction.id,
            attempt: oldAction.attempt,
            inputHash: oldAction.inputHash,
            executorId: 'test',
          }),
        ).rejects.toThrow();
      }
      await f.ok(
        'state',
        'submit-plan',
        'example',
        '--plan',
        f.plan,
        ...(pause ? ['--pause'] : []),
      );
      if (pause) {
        const current = (await f.inspect()).run.waits.at(-1)!;
        expect(current.proposalHash).not.toBe(oldWait.proposalHash);
        const stale = await f.cli(
          'state',
          'continue-plan',
          'example',
          '--proposal-hash',
          oldWait.proposalHash,
        );
        expect(stale.exitCode).not.toBe(0);
        await f.ok('state', 'continue-plan', 'example', '--proposal-hash', current.proposalHash);
      }
      await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
      await f.ok('state', 'complete-build', 'example');
    },
  );

  it('routes task scope changes through a fresh Design approval while preserving configured Build and task IDs', async () => {
    const f = await fixture();
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const before = (await f.inspect()).run;
    await f.put(
      `${f.change}/tasks.md`,
      '- [x] Implement the adapter <!-- comet-task:impl -->\n- [ ] Add a new capability <!-- comet-task:extra -->\n',
    );
    await fs.appendFile(path.join(f.projectRoot, f.plan), '<!-- comet-task-ref:extra -->\n');
    await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(before.revision));
    const blocked = await f.cli('state', 'submit-plan', 'example', '--plan', f.plan);
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr).toContain('revise-design');
    const current = (await f.inspect()).run;
    const revised = await f.ok(
      'state',
      'revise-design',
      'example',
      '--expected-revision',
      String(current.revision),
    );
    expect(revised).toMatchObject({
      phase: 'design',
      nextAction: { stepId: 'full.design.handoff', ref: 'comet-design' },
    });
    for (const args of [
      ['next', 'example'],
      ['select', 'example'],
      ['check', 'example', 'design'],
      ['check', 'example', 'design', '--recover'],
    ]) {
      const entry = await f.ok('state', ...args);
      expect(entry.phase).toBe('design');
      expect(entry.nextAction).toEqual(revised.nextAction);
    }
    expect((await f.cli('state', 'check', 'example', 'build')).exitCode).not.toBe(0);
    const projection = await fs.readFile(
      path.join(f.projectRoot, f.change, 'comet-state.yaml'),
      'utf8',
    );
    expect(projection).toContain('phase: design');
    await fs.rename(
      resolveWorkspaceRuntimeRootSync(f.projectRoot),
      path.join(f.projectRoot, '.comet/runtime-before-recovery'),
    );
    const recovered = await f.ok('state', 'next', 'example');
    expect(recovered.phase).toBe('design');
    expect(recovered.run.revision).toBe(revised.run.revision);
    expect(recovered.nextAction).toEqual(revised.nextAction);
    await f.ok('state', 'check', 'example', 'design');
    const hash = await f.design('Preserve the implemented adapter and approve the new capability.');
    const completed = await f.finishDesign(hash);
    expect(completed.nextAction.stepId).toBe('full.build.plan');
    const reapproved = (await f.inspect()).run;
    expect(reapproved.state).toMatchObject({
      phase: 'build',
      buildMode: 'executing-plans',
      tddMode: 'tdd',
      reviewMode: 'standard',
    });
    expect(reapproved.waits.filter((wait) => wait.stepId === 'full.build.confirm')).toEqual(
      before.waits.filter((wait) => wait.stepId === 'full.build.confirm'),
    );
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    expect(await fs.readFile(path.join(f.projectRoot, f.change, 'tasks.md'), 'utf8')).toContain(
      '- [x] Implement the adapter <!-- comet-task:impl -->',
    );
  });
  it('requires new Design approval for changed legacy requirements and never accepts a forged definition hash', async () => {
    const f = await fixture(true);
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const before = (await f.inspect()).run;
    expect(before.outputs['full.design.handoff'].value).not.toHaveProperty('requirementsEvidence');
    await f.put(`${f.change}/tasks.md`, '- [ ] Replace the public API <!-- comet-task:impl -->\n');
    await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(before.revision));
    const blocked = await f.cli('state', 'submit-plan', 'example', '--plan', f.plan);
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr).toContain('revise-design');
    const { createClassicSdkStateStore } =
      await import('../../../domains/comet-classic/classic-sdk-state-store.js');
    const store = createClassicSdkStateStore(f.projectRoot);
    const current = (await f.inspect()).run;
    const forged = structuredClone(current);
    forged.revision += 1;
    forged.workflow.hash = 'a'.repeat(64);
    forged.definitionHashes[JSON.stringify([forged.workflow.id, forged.workflow.version])] =
      forged.workflow.hash;
    await store.compareAndSwap(current.runId, current.revision, forged);
    await expect(f.inspect()).rejects.toThrow(/definition|定义|hash/u);
  });

  it('rejects competing stale revisions and leaves a claimed Action untouched', async () => {
    const f = await fixture();
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const { run, runtime } = await f.inspect();
    const action = run.actions.find((candidate) => candidate.status === 'pending')!;
    const claimed = await runtime.claim({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'paused-worker',
    });
    const blocked = await f.cli(
      'state',
      'revise-plan',
      'example',
      '--expected-revision',
      String(claimed.revision),
    );
    expect(blocked.exitCode).not.toBe(0);
    expect((await f.inspect()).run).toEqual(claimed);
  });
  it('preserves archive references after revised-plan delivery', async () => {
    const f = await fixture();
    const openSpec = await createOpenSpecArchiveFixture(path.dirname(f.projectRoot));
    vi.stubEnv('COMET_OPENSPEC', openSpec.command);
    vi.stubEnv('OPENSPEC_TELEMETRY', '0');
    vi.stubEnv('DO_NOT_TRACK', '1');
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const before = (await f.inspect()).run;
    await fs.appendFile(
      path.join(f.projectRoot, f.plan),
      'Clarify validation without changing scope.\n',
    );
    await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(before.revision));
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const planned = (await f.inspect()).run;
    const { classicDesignEvidenceReceipt } =
      await import('../../../domains/comet-classic/classic-sdk-application.js');
    expect(planned.outputs['full.build.plan'].value).toMatchObject({
      designEvidence: await classicDesignEvidenceReceipt(f.projectRoot, `${f.change}/design.md`),
    });
    await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
    execFileSync(
      'git',
      ['add', '--', 'openspec', 'docs', 'configuration.json', '.comet/config.yaml'],
      { cwd: f.projectRoot },
    );
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'implementation',
      ],
      { cwd: f.projectRoot, stdio: 'ignore' },
    );
    await f.ok(
      'guard',
      'example',
      'build',
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const report = 'docs/superpowers/reports/verify.md';
    await f.put(report, '# Verification\nAll current behavior checks pass.\n');
    await f.ok(
      'guard',
      'example',
      'verify',
      '--report',
      report,
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const proposal = await f.ok(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Archive the implemented adapter locally.',
    );
    await f.ok(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    await f.ok('guard', 'example', 'archive', '--apply');
    expect(await openSpec.invocations()).toEqual([
      { args: ['archive', 'example', '--yes'], cwd: await fs.realpath(f.projectRoot) },
    ]);
    const archived = (await f.inspect()).run;
    const archiveRef = (
      archived.outputs['full.archive.execute'].value as { archiveDirectory: string }
    ).archiveDirectory;
    expect(archived.state).toMatchObject({
      designDoc: `${archiveRef}/design.md`,
      handoffContext: `${archiveRef}/.comet/handoff/design-context.json`,
      plan: f.plan,
      verificationReport: report,
    });
    const projected = parseYaml(
      await fs.readFile(path.join(f.projectRoot, archiveRef, 'comet-state.yaml'), 'utf8'),
    );
    expect(projected.design_doc).toBe(`${archiveRef}/design.md`);
    expect(projected.handoff_context).toBe(`${archiveRef}/.comet/handoff/design-context.json`);
    expect(projected.plan).toBe(f.plan);
    expect(projected.verification_report).toBe(report);
    expect(readPortableRunCheckpoint(projected.run_checkpoint, 'example')?.state).toMatchObject({
      designDoc: `${archiveRef}/design.md`,
    });
    expect(archived.outputs['full.design.document'].value).toMatchObject({
      designDoc: `${f.change}/design.md`,
    });
    const source = await fs.readFile(path.join(f.projectRoot, archiveRef, 'design.md'), 'utf8');
    expect(source).toContain('status: final');
    expect(source).toContain(`archived-with: ${path.posix.basename(archiveRef)}`);
    const boundBranch = (archived.state as { boundBranch: string }).boundBranch;
    execFileSync('git', ['checkout', '-b', 'after-archive'], {
      cwd: f.projectRoot,
      stdio: 'ignore',
    });
    const beforeDelivery = await f.ok('state', 'next', 'example');
    expect(beforeDelivery.continuation.commandArgs).toEqual(['git', 'switch', boundBranch]);
    expect(beforeDelivery.run.revision).toBe(archived.revision);
    execFileSync('git', ['checkout', boundBranch], { cwd: f.projectRoot, stdio: 'ignore' });
    const deliveryAction = archived.actions.at(-1)!;
    const deliveryRuntime = (await f.inspect()).runtime;
    await deliveryRuntime.claim({
      runId: archived.runId,
      actionId: deliveryAction.id,
      attempt: deliveryAction.attempt,
      inputHash: deliveryAction.inputHash,
      executorId: 'interrupted-delivery',
      claimToken: 'ordinary-delivery-claim',
    });
    const stopped = await deliveryRuntime.recordOutcome({
      runId: archived.runId,
      outcome: {
        actionId: deliveryAction.id,
        attempt: deliveryAction.attempt,
        inputHash: deliveryAction.inputHash,
        claimToken: 'ordinary-delivery-claim',
        outcomeId: 'ordinary-delivery-stopped',
        status: 'failed',
        output: { summary: 'Stopped before Git delivery.' },
      },
      context: { projectRoot: f.projectRoot, requestId: 'ordinary-delivery-stop' },
    });
    await f.ok(
      'state',
      'continue-work',
      'example',
      '--expected-revision',
      String(stopped.revision),
    );
    const resumedDelivery = (await f.ok('state', 'next', 'example')).continuation.current;
    expect(resumedDelivery.actions[0].inputSummary.outputs).toHaveProperty(
      'full.archive.preflight',
    );
    expect(resumedDelivery.actions[0].inputSummary.outputs).toHaveProperty('full.archive.execute');
    expect(resumedDelivery.approvals.map((wait: { stepId: string }) => wait.stepId)).toContain(
      'full.archive.confirm',
    );
    execFileSync('git', ['add', '--', 'openspec', f.plan, report], { cwd: f.projectRoot });
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'archive'],
      { cwd: f.projectRoot, stdio: 'ignore' },
    );
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: f.projectRoot,
      encoding: 'utf8',
    }).trim();
    const delivered = await f.ok('state', 'complete-delivery', 'example', '--commit', commit);
    expect(delivered.nextAction.kind).toBe('done');
    execFileSync('git', ['checkout', '-b', 'after-delivery'], {
      cwd: f.projectRoot,
      stdio: 'ignore',
    });
    const completed = await f.ok('state', 'next', 'example');
    expect(completed.nextAction.kind).toBe('done');
    expect(completed.continuation).toMatchObject({ mode: 'done', commandArgs: null });
  });
  it('rejects Design document drift after plan acceptance and reports the legal reapproval command', async () => {
    const f = await fixture();
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const before = (await f.inspect()).run;
    await fs.appendFile(
      path.join(f.projectRoot, f.change, 'design.md'),
      'Change the chosen architecture.\n',
    );
    await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
    const complete = await f.cli('state', 'complete-build', 'example');
    expect(complete.exitCode).not.toBe(0);
    expect(complete.stderr).toContain('revise-design');
    expect((await f.inspect()).run).toEqual(before);
    const recovery = await f.cli('state', 'check', 'example', 'build', '--recover');
    expect(recovery.exitCode).not.toBe(0);
    expect(recovery.data.recoveryActions[0].commandArgs).toContain('revise-design');
  });
  it('keeps the original builtin identity when revising a preset already upgraded to Full', async () => {
    const f = await fixture(false, 'tweak');
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const before = (await f.inspect()).run;
    expect(before.workflow.id).toBe('comet-classic-tweak');
    await fs.appendFile(
      path.join(f.projectRoot, f.plan),
      'Clarify the current implementation detail.\n',
    );
    await f.ok('state', 'revise-plan', 'example', '--expected-revision', String(before.revision));
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    const after = (await f.inspect()).run;
    expect(after.workflow.id).toBe(before.workflow.id);
    expect(after.state).toMatchObject({ workflow: 'full', phase: 'build' });
    expect(after.actions.at(-1)).toMatchObject({ stepId: 'full.build.execute', status: 'pending' });
  });
  it('keeps canonical design.md immutable when completing an external Design document', async () => {
    const f = await fixture(false, 'full', true);
    const hash = await f.design();
    await fs.appendFile(
      path.join(f.projectRoot, f.change, 'design.md'),
      'Unapproved source change.\n',
    );
    const external = 'docs/superpowers/specs/technical design.md';
    await f.put(
      external,
      '---\ncomet_change: example\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\nKeep the approved adapter.\n',
    );
    const before = (await f.inspect()).run;
    const blocked = await f.cli(
      'state',
      'complete-design',
      'example',
      '--design-doc',
      external,
      '--approval-hash',
      hash,
    );
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr).toContain('revise-design');
    expect((await f.inspect()).run).toEqual(before);
  });

  it('rejects canonical source drift in Build when the accepted Design document is external', async () => {
    const f = await fixture(false, 'full', true);
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    await fs.appendFile(
      path.join(f.projectRoot, f.change, 'design.md'),
      'Unapproved source change.\n',
    );
    await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
    const before = (await f.inspect()).run;
    const blocked = await f.cli('state', 'complete-build', 'example');
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr).toContain('requirements changed after approval');
    expect((await f.inspect()).run).toEqual(before);
    const recovery = await f.cli('state', 'check', 'example', 'build', '--recover');
    expect(recovery.data.recoveryActions[0].commandArgs).toContain('revise-design');
  });
});

describe('Classic upgraded preset archive recovery', () => {
  it.each([
    ['tweak', 'running'],
    ['tweak', 'unknown'],
    ['hotfix', 'running'],
    ['hotfix', 'unknown'],
  ] as const)('recovers %s after a moved %s Archive on cold start', async (profile, status) => {
    const f = await fixture(false, profile);
    const openSpec = await createOpenSpecArchiveFixture(path.dirname(f.projectRoot));
    await fs.appendFile(
      openSpec.command,
      "\nprocess.stderr.write('injected disconnect after move'); process.exit(1);\n",
    );
    vi.stubEnv('COMET_OPENSPEC', openSpec.command);
    await f.prepareBuild();
    await f.ok('state', 'submit-plan', 'example', '--plan', f.plan);
    await f.put(`${f.change}/tasks.md`, '- [x] Implement the adapter <!-- comet-task:impl -->\n');
    await f.ok(
      'guard',
      'example',
      'build',
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const report = 'docs/superpowers/reports/verify.md';
    await f.put(report, '# Verification\nAll current behavior checks pass.\n');
    await f.ok(
      'guard',
      'example',
      'verify',
      '--report',
      report,
      '--apply',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    );
    const proposal = await f.ok(
      'state',
      'propose-archive',
      'example',
      '--summary',
      'Archive locally.',
    );
    await f.ok(
      'state',
      'decide-archive',
      'example',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    const { runtime, run } = await f.inspect();
    const preflighted = await executeClassicSdkArchivePreflight(runtime, {
      runId: run.runId,
      projectRoot: f.projectRoot,
    });
    if (status === 'unknown') {
      await expect(
        executeClassicSdkArchive(runtime, { runId: run.runId, projectRoot: f.projectRoot }),
      ).rejects.toThrow('injected disconnect');
    } else {
      const action = preflighted.actions.at(-1)!;
      expect(action.stepId).toBe('full.archive.execute');
      const claimed = await runtime.claim({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'comet-classic-archive',
        claimToken: randomUUID(),
      });
      const active = path.join(f.projectRoot, f.change);
      await recordClassicArchiveRequirements(f.projectRoot, active);
      // 模拟真实归档边界：先保存原执行输入，再发生外部目录搬迁。
      await prepareClassicArchiveInputs(
        f.projectRoot,
        claimed,
        claimed.actions.at(-1)!,
        'openspec/specs',
      );
      await fs.rename(active, path.join(path.dirname(active), 'archive', '2026-10-20-example'));
    }
    const cold = await f.inspect();
    expect(cold.profile).toBe('full');
    expect(cold.run.workflow.id).toBe(`comet-classic-${profile}`);
    expect(cold.state).toMatchObject({ workflow: 'full', phase: 'archive', archived: false });
    expect(cold.run.actions.at(-1)).toMatchObject({ stepId: 'full.archive.execute', status });
    expect((await f.ok('state', 'next', 'example')).nextAction).toMatchObject({
      kind: 'reconcile',
      stepId: 'full.archive.execute',
    });

    if (status === 'running') {
      // 原领取方可能仍在运行，目录搬迁不能代替停止或丢失执行上下文的证据。
      const blocked = await f.cli('archive', 'example', '--recover');
      expect(blocked.exitCode).not.toBe(0);
      expect(blocked.stderr).toContain('markUnknownRequest');
      expect((await f.ok('state', 'next', 'example')).continuation.commandArgs).toEqual([
        'comet',
        'state',
        'check',
        'example',
        'archive',
        '--recover',
        '--json',
      ]);
      expect((await f.inspect()).run.actions.at(-1)?.status).toBe('running');
      const diagnosis = await f.cli('state', 'check', 'example', 'archive', '--recover');
      const request = path.join(f.projectRoot, 'archive-reconciliation.json');
      expect(diagnosis.data.recovery.markUnknownRequest.operation).toBe('mark-unknown');
      await fs.writeFile(request, JSON.stringify(diagnosis.data.recovery.markUnknownRequest));
      const dispatch = await runtimeDispatchCommand(
        { request, application: `classic-${profile}`, projectRoot: f.projectRoot },
        { invocationCwd: f.projectRoot },
      );
      expect(dispatch.response.status).toBe('succeeded');
      expect((await f.inspect()).run.actions.at(-1)?.status).toBe('unknown');
    }

    if (profile === 'tweak' && status === 'unknown') {
      for (const corruption of ['claim', 'attempt', 'executor'] as const) {
        const forged = structuredClone(cold.run);
        const action = forged.actions.at(-1)!;
        if (corruption === 'claim') action.claim!.token = 'unrelated-claim';
        else if (corruption === 'attempt') action.attempt++;
        else action.claim!.executorId = 'unrelated-executor';
        const recordOutcome = vi.fn();
        await expect(
          recoverClassicSdkArchive(
            { inspect: async () => forged, recordOutcome },
            { projectRoot: f.projectRoot, runId: forged.runId },
          ),
        ).rejects.toThrow(/does not match|no single moved Action/u);
        expect(recordOutcome).not.toHaveBeenCalled();
      }
      const store = createClassicSdkStateStore(f.projectRoot);
      for (const corruption of ['choice', 'unresolved'] as const) {
        const current = (await f.inspect()).run;
        const forged = structuredClone(current);
        forged.revision++;
        const wait = forged.waits.find(
          (entry) => entry.stepId === 'tweak.build.escalation-confirm',
        )!;
        if (corruption === 'choice') wait.decision!.choice = 'continue';
        else {
          wait.status = 'cancelled';
          delete wait.decision;
        }
        expect(await store.compareAndSwap(current.runId, current.revision, forged)).toBe(true);
        await expect(f.inspect()).rejects.toThrow('does not match its change ownership');
        expect((await f.cli('archive', 'example', '--recover')).exitCode).not.toBe(0);
        expect(
          await store.compareAndSwap(current.runId, forged.revision, {
            ...current,
            revision: forged.revision + 1,
          }),
        ).toBe(true);
      }
    }

    if (profile === 'hotfix') {
      const originalRuntime = path.join(f.projectRoot, '.comet/runtime-before-moved-restore');
      await fs.rename(resolveWorkspaceRuntimeRootSync(f.projectRoot), originalRuntime);
      await f.ok('state', 'next', 'example');
      expect((await f.inspect()).run.actions.at(-1)?.status).toBe('unknown');
      // 便携检查点不能补造外部执行前的文件快照，必须带回原设备保存的收据。
      const missing = await f.cli('archive', 'example', '--recover');
      expect(missing.exitCode).not.toBe(0);
      expect(missing.stderr).toContain('缺少原始执行清单');
      await fs.cp(
        path.join(originalRuntime, 'archive-inputs'),
        path.join(resolveWorkspaceRuntimeRootSync(f.projectRoot), 'archive-inputs'),
        { recursive: true },
      );
    }
    expect((await f.ok('state', 'next', 'example')).continuation.commandArgs).toEqual([
      'comet',
      'archive',
      'example',
      '--recover',
      '--json',
    ]);
    const recovery = await f.ok('archive', 'example', '--recover');
    expect(recovery.recoveredAction).toBe(cold.run.actions.at(-1)!.id);
    const recovered = await f.inspect();
    expect(recovered.state.archived).toBe(true);
    expect(recovered.run.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.deliver',
      status: 'pending',
    });
    if (status === 'unknown') expect(await openSpec.invocations()).toHaveLength(1);
    await fs.rename(
      resolveWorkspaceRuntimeRootSync(f.projectRoot),
      path.join(f.projectRoot, '.comet/runtime-before-archive-restore'),
    );
    await f.ok('state', 'next', 'example');
    const restored = await f.inspect();
    expect(restored.profile).toBe('full');
    expect(restored.state.archived).toBe(true);
    expect(restored.run.actions.at(-1)).toMatchObject({
      stepId: 'full.archive.deliver',
      status: 'pending',
    });
  });
});
