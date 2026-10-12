import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime.js';
import {
  loadWorkflowApplication,
  inspectApplicationArtifactFiles,
  validateApplicationArtifactContracts,
} from '../../../domains/workflow-application/index.js';

let root: string, scratch: string;
beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-artifact-contract-'));
  root = path.join(scratch, 'project');
  await fs.mkdir(root);
  vi.stubEnv('COMET_DATA_DIR', path.join(scratch, 'data'));
  await fs.mkdir(path.join(root, 'package'));
  await fs.writeFile(path.join(root, 'package', 'SKILL.md'), '# Design then build\n');
  await fs.writeFile(
    path.join(root, 'package', 'application.json'),
    JSON.stringify({
      schema: 'comet.workflow.application.v1',
      id: 'design-build',
      version: '1',
      base: 'standalone',
      runtimeVersion: '0.5.0',
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
      artifactContracts: [
        {
          workflowId: 'design-build',
          stepId: 'design',
          artifacts: [{ ref: 'docs/design.md', requiredHeadings: ['目标', '验收'] }],
        },
      ],
    }),
  );
  await fs.writeFile(
    path.join(root, 'package', 'application.mjs'),
    `export function createApplication(){ return {workflows:[{id:'design-build',version:'1',entry:'design',steps:{design:{type:'handoff',ref:'design'},build:{type:'handoff',ref:'build'}},transitions:[{from:'design',to:'build'}]}]}; }`,
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(scratch, { recursive: true, force: true });
});
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
async function start() {
  const loaded = await loadWorkflowApplication({
    file: path.join(root, 'package/application.json'),
    projectRoot: root,
  });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId: 'one',
    workflow: { id: 'design-build', version: '1' },
    input: {},
  });
  const action = run.actions[0];
  run = await runtime.claim({
    runId: 'one',
    actionId: action.id,
    attempt: 1,
    inputHash: action.inputHash,
    executorId: 'designer',
    claimToken: 'designer-token',
  });
  return { loaded, runtime, run, action: run.actions[0] };
}
it('rejects absent, empty, incomplete and falsely hashed phase artifacts and preserves the claimed Action', async () => {
  const { runtime, action } = await start();
  const submit = (id: string, sha256: string) =>
    runtime.recordOutcome({
      runId: 'one',
      outcome: {
        actionId: action.id,
        attempt: 1,
        inputHash: action.inputHash,
        claimToken: 'designer-token',
        outcomeId: id,
        status: 'succeeded',
        output: {},
        artifacts: [{ uri: 'docs/design.md', sha256 }],
      },
    });
  await expect(submit('missing', digest(''))).rejects.toThrow(/工件|产物|不存在|exist/);
  await fs.mkdir(path.join(root, 'docs'));
  await fs.writeFile(path.join(root, 'docs/design.md'), '');
  await expect(submit('empty', digest(''))).rejects.toThrow(/空|empty/);
  await fs.writeFile(path.join(root, 'docs/design.md'), '# 目标\n\n真实内容\n');
  await expect(submit('sections', digest('# 目标\n\n真实内容\n'))).rejects.toThrow(/章节|验收/);
  const good = '# 目标\n\n真实内容\n\n## 验收\n\n通过条件\n';
  await fs.writeFile(path.join(root, 'docs/design.md'), good);
  await expect(submit('hash', '0'.repeat(64))).rejects.toThrow(/摘要|hash/);
  expect((await runtime.inspect('one')).actions[0].status).toBe('running');
  expect((await runtime.inspect('one')).actions.some((a) => a.stepId === 'build')).toBe(false);
  const passed = await submit('valid', digest(good));
  expect(passed.actions.find((a) => a.stepId === 'build')?.status).toBe('pending');
});
it('rechecks upstream artifact evidence on manual claim and in a cold application', async () => {
  const { runtime, action } = await start();
  const good = '# 目标\n\n真实内容\n\n## 验收\n\n通过条件\n';
  await fs.mkdir(path.join(root, 'docs'));
  await fs.writeFile(path.join(root, 'docs/design.md'), good);
  const run = await runtime.recordOutcome({
    runId: 'one',
    outcome: {
      actionId: action.id,
      attempt: 1,
      inputHash: action.inputHash,
      claimToken: 'designer-token',
      outcomeId: 'valid',
      status: 'succeeded',
      output: {},
      artifacts: [{ uri: 'docs/design.md', sha256: digest(good) }],
    },
  });
  const build = run.actions.find((a) => a.stepId === 'build')!;
  await fs.writeFile(path.join(root, 'docs/design.md'), good + '\n变化\n');
  const loaded = await loadWorkflowApplication({
    file: path.join(root, 'package/application.json'),
    projectRoot: root,
    runId: 'one',
  });
  const cold = createRuntime({ ...loaded.implementation, store: loaded.store });
  await expect(
    cold.claim({
      runId: 'one',
      actionId: build.id,
      attempt: 1,
      inputHash: build.inputHash,
      executorId: 'builder',
      claimToken: 'builder-token',
    }),
  ).rejects.toThrow(/摘要|变化|依赖/);
  expect((await cold.inspect('one')).actions.find((a) => a.id === build.id)?.status).toBe(
    'pending',
  );
  await fs.writeFile(path.join(root, 'docs/design.md'), good);
  expect(
    (
      await cold.claim({
        runId: 'one',
        actionId: build.id,
        attempt: 1,
        inputHash: build.inputHash,
        executorId: 'builder',
        claimToken: 'builder-token',
      })
    ).actions.find((a) => a.id === build.id)?.status,
  ).toBe('running');
  await fs.writeFile(path.join(root, 'docs/design.md'), good + '\n执行期间变化\n');
  await expect(
    cold.recordOutcome({
      runId: 'one',
      outcome: {
        actionId: build.id,
        attempt: 1,
        inputHash: build.inputHash,
        claimToken: 'builder-token',
        outcomeId: 'stale-build',
        status: 'succeeded',
        output: {},
      },
    }),
  ).rejects.toThrow(/摘要|变化/);
  expect((await cold.inspect('one')).actions.find((a) => a.id === build.id)?.status).toBe(
    'running',
  );
});

it('checks actual JSON and Markdown outside code fences and rejects control-resource declarations', async () => {
  await fs.mkdir(path.join(root, 'docs'));
  await fs.writeFile(path.join(root, 'docs/design.md'), '# 目标\n\n```md\n## 验收\n```\n');
  await expect(
    inspectApplicationArtifactFiles(root, [
      { ref: 'docs/design.md', requiredHeadings: ['目标', '验收'] },
    ]),
  ).rejects.toThrow(/章节/);
  await fs.writeFile(path.join(root, 'docs/data.json'), '{"complete":false}');
  await expect(
    inspectApplicationArtifactFiles(root, [
      {
        ref: 'docs/data.json',
        schema: {
          type: 'object',
          required: ['complete'],
          properties: { complete: { const: true } },
        },
      },
    ]),
  ).rejects.toThrow(/结构/);
  for (const ref of ['.GIT/config', 'AGENTS.md', '.cursor/config', '../outside.md'])
    expect(() =>
      validateApplicationArtifactContracts([
        { workflowId: 'design-build', stepId: 'design', artifacts: [{ ref }] },
      ]),
    ).toThrow();
});

it('allows a declared failure handler without treating a failed stage as verified artifacts', async () => {
  await fs.writeFile(
    path.join(root, 'package/application.mjs'),
    `export function createApplication(){ return {workflows:[{id:'design-build',version:'1',entry:'design',steps:{design:{type:'handoff',ref:'design'},failure:{type:'handoff',ref:'failure-handler'}},transitions:[{from:'design',to:'failure',on:'failed'}]}]}; }`,
  );
  const { runtime, action } = await start();
  const run = await runtime.recordOutcome({
    runId: 'one',
    outcome: {
      actionId: action.id,
      attempt: 1,
      inputHash: action.inputHash,
      claimToken: 'designer-token',
      outcomeId: 'missing-design',
      status: 'failed',
      output: { reason: '没有设计文件，进入异常处理。' },
    },
  });
  const failure = run.actions.find((a) => a.stepId === 'failure')!;
  const claimed = await runtime.claim({
    runId: 'one',
    actionId: failure.id,
    attempt: 1,
    inputHash: failure.inputHash,
    executorId: 'failure-handler',
    claimToken: 'failure-handler',
  });
  expect(claimed.actions.find((a) => a.id === failure.id)?.status).toBe('running');
  expect(await fs.stat(path.join(root, 'docs/design.md')).catch(() => null)).toBeNull();
});

it('preserves pinned artifact requirements when business bindings mutate their configuration copy', async () => {
  const file = path.join(root, 'package/application.mjs');
  const source = await fs.readFile(file, 'utf8');
  await fs.writeFile(
    file,
    source.replace(
      'createApplication(){ return',
      'createApplication(context){ context.manifest.artifactContracts=[]; return',
    ),
  );
  const { loaded, runtime, action } = await start();
  expect(loaded.manifest.artifactContracts).toHaveLength(1);
  await expect(
    runtime.recordOutcome({
      runId: 'one',
      outcome: {
        actionId: action.id,
        attempt: 1,
        inputHash: action.inputHash,
        claimToken: 'designer-token',
        outcomeId: 'mutated-configuration',
        status: 'succeeded',
        output: {},
      },
    }),
  ).rejects.toThrow(/产物|工件|exist/);
  expect((await runtime.inspect('one')).actions[0].status).toBe('running');
});
