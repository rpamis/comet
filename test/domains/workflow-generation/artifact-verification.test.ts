import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { getCurrentVersion } from '../../../platform/version/version.js';
import {
  prepareWorkflowApplicationPlan,
  compileWorkflowApplication,
  verifyWorkflowApplicationArtifactContracts,
  assertWorkflowVerificationCases,
  type WorkflowApplicationProposal,
  prepareWorkflowApplicationExample,
} from '../../../domains/workflow-generation/index.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime.js';

let scratch: string, project: string;
beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-artifact-creator-'));
  project = path.join(scratch, 'project');
  await fs.mkdir(path.join(project, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(project, 'node_modules/@rpamis/comet'), 'junction');
  vi.stubEnv('COMET_DATA_DIR', path.join(scratch, 'data'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(scratch, { recursive: true, force: true });
});
function proposal(alwaysPass = false): WorkflowApplicationProposal {
  const good = '# 目标\n\n业务已完成\n\n## 验收\n\n核对实际文件\n';
  return {
    schema: 'comet.workflow.application.plan.v1',
    manifest: {
      schema: 'comet.workflow.application.v1',
      id: 'artifact-demo',
      version: '1',
      base: 'standalone',
      runtimeVersion: getCurrentVersion(),
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
        {
          workflowId: 'design-build',
          stepId: 'build',
          artifacts: [],
          noArtifactsReason: '此样例的下游只读取设计，不产生新文件。',
        },
      ],
    },
    composition: {
      kind: 'standalone',
      executorIds: ['local'],
      validatorRefs: [{ id: 'actual-design', version: '1' }],
      transitionHandlers: [],
      workflows: [
        {
          id: 'design-build',
          version: '1',
          entry: 'design',
          steps: {
            design: {
              type: 'handoff',
              ref: 'designer',
              validator: { id: 'actual-design', version: '1' },
              outputSchema: { type: 'object' },
            },
            build: { type: 'handoff', ref: 'builder' },
          },
          transitions: [{ from: 'design', to: 'build' }],
        },
      ],
    },
    modules: {
      'bindings.mjs': `import fs from 'node:fs/promises'; import path from 'node:path'; export function createBindings(context) { return {executors:[{id:'local',capabilities:[],supports:()=>true,execute:async()=>({status:'succeeded',output:{}})}],validators:[{id:'actual-design',version:'1',validate:async()=>({accepted:${alwaysPass ? 'true' : "(await fs.readFile(path.join(context.projectRoot,'docs/design.md'),'utf8')).includes('业务已完成')"},reason:'设计缺少实际业务结果'})}]}; }`,
    },
    artifactTests: [
      {
        workflowId: 'design-build',
        stepId: 'design',
        output: {},
        files: { 'docs/design.md': good },
        invalidCases: [
          {
            name: 'wrong-business-content',
            files: { 'docs/design.md': good.replace('业务已完成', '业务未完成') },
          },
        ],
      },
    ],
  };
}
async function compile(p: WorkflowApplicationProposal) {
  const plan = await prepareWorkflowApplicationPlan({
    proposal: p,
    projectRoot: project,
    packageRoot: path.join(project, 'preview'),
  });
  const compiled = await compileWorkflowApplication({
    plan,
    confirmationHash: hashRuntimeValue(plan),
    projectRoot: project,
    packageRoot: path.join(project, 'compiled'),
  });
  return { plan, compiled };
}
it('checks valid artifacts and real missing, empty, changed, malformed and business negatives in isolation', async () => {
  const { plan, compiled } = await compile(proposal());
  const report = await verifyWorkflowApplicationArtifactContracts({
    plan,
    file: compiled.file,
    packageHash: compiled.contentHash,
  });
  expect(report.checks.map((c) => c.name)).toEqual([
    'valid',
    'missing:docs/design.md',
    'empty:docs/design.md',
    'invalid-content:docs/design.md',
    'changed:docs/design.md',
    'wrong-business-content',
  ]);
  expect(report.checks.filter((c) => c.accepted)).toHaveLength(1);
  expect(await fs.stat(path.join(project, 'docs')).catch(() => null)).toBeNull();
});

function conversationProposal(stopAtApproval = false): WorkflowApplicationProposal {
  const p = proposal();
  p.composition = {
    kind: 'standalone',
    executorIds: ['local'],
    validatorRefs: [],
    transitionHandlers: [],
    workflows: [
      {
        id: 'chain',
        version: '1',
        entry: 'grill',
        steps: {
          grill: { type: 'child_workflow', workflow: { id: 'conversation', version: '1' } },
          implement: { type: 'handoff', ref: 'implement' },
        },
        transitions: [{ from: 'grill', to: 'implement' }],
      },
      {
        id: 'conversation',
        version: '1',
        entry: 'talk',
        steps: {
          talk: { type: 'handoff', ref: 'talk' },
          approve: { type: 'ask_user', proposalFrom: 'talk', choices: ['approved', 'rejected'] },
          complete: { type: 'handoff', ref: 'complete' },
        },
        transitions: [
          { from: 'talk', to: 'approve' },
          { from: 'approve', to: 'complete', on: 'approved' },
        ],
      },
    ],
  };
  p.manifest.artifactContracts = [
    ['chain', 'grill'],
    ['chain', 'implement'],
    ['conversation', 'talk'],
    ['conversation', 'complete'],
  ].map(([workflowId, stepId]) => ({
    workflowId,
    stepId,
    artifacts: [],
    noArtifactsReason: '仅核对会话和流程衔接。',
  }));
  p.artifactTests = [];
  p.workflowTests = [
    { workflowId: 'chain', input: {}, module: 'tests/chain.mjs', exportName: 'verify' },
  ];
  p.modules = {
    'bindings.mjs':
      "export function createBindings(){return {executors:[{id:'local',capabilities:[],supports:()=>true,execute:async()=>({status:'succeeded',output:{}})}]};}",
    'tools/session.mjs': `export async function finish(runtime, runId) {
      const run=await runtime.inspect(runId); const a=run.actions.find(a=>a.status==='pending'&&a.type!=='child_workflow');
      const claimed=await runtime.claim({runId,actionId:a.id,attempt:a.attempt,inputHash:a.inputHash,executorId:'local',capabilities:[]});
      const current=claimed.actions.find(item=>item.id===a.id);
      await runtime.recordOutcome({runId,outcome:{actionId:a.id,attempt:a.attempt,inputHash:a.inputHash,claimToken:current.claim.token,outcomeId:'done-'+a.id,status:'succeeded',output:{}}});
    }`,
    'tests/chain.mjs': `import {finish} from '../tools/session.mjs';
      export async function verify({runtime,runId}) {
        let parent=await runtime.next({runId});
        const child=parent.children[0].runId;
        await finish(runtime,child);
        ${
          stopAtApproval
            ? 'return;'
            : `const run=await runtime.inspect(child); const w=run.waits.find(w=>w.status==='pending');
        await runtime.resolveWait({runId:child,waitId:w.id,proposalHash:w.proposalHash,decisionId:'fixture-approval',choice:'approved'});
        await finish(runtime,child);
        await runtime.next({runId});
        await finish(runtime,runId);`
        }
      }`,
  };
  return p;
}

it('runs the original parent/child graph, no-file stages, approval and delivered helper to completion', async () => {
  const { plan, compiled } = await compile(conversationProposal());
  const report = await verifyWorkflowApplicationArtifactContracts({
    plan,
    file: compiled.file,
    packageHash: compiled.contentHash,
  });
  expect(report.workflowChecks).toEqual([
    { workflowId: 'chain', status: 'completed', childRuns: 1 },
  ]);
  expect(
    await fs.stat(path.join(project, '.comet/current-change.json')).catch(() => null),
  ).toBeNull();
});

it('rejects a fixture that returns while the child approval is still pending', async () => {
  const { plan, compiled } = await compile(conversationProposal(true));
  await expect(
    verifyWorkflowApplicationArtifactContracts({
      plan,
      file: compiled.file,
      packageHash: compiled.contentHash,
    }),
  ).rejects.toThrow(/完整流程.*未完成/);
});

it('rejects test modules outside the fixed package even when a raw plan declares them', async () => {
  const { plan } = await compile(conversationProposal());
  expect(() =>
    assertWorkflowVerificationCases({
      ...plan,
      modules: { ...plan.modules, '../outside.mjs': 'export function verify(){}' },
      workflowTests: [
        { workflowId: 'chain', input: {}, module: '../outside.mjs', exportName: 'verify' },
      ],
    }),
  ).toThrow(/完整流程验收样例无效/);
});
it('refuses a business validator that always passes despite a well-formed negative artifact', async () => {
  const { plan, compiled } = await compile(proposal(true));
  await expect(
    verifyWorkflowApplicationArtifactContracts({
      plan,
      file: compiled.file,
      packageHash: compiled.contentHash,
    }),
  ).rejects.toThrow(/wrong-business-content|阻止/);
});
it('requires positive and business-negative cases and refuses unsafe fixture paths', async () => {
  const { plan, compiled } = await compile(proposal());
  await expect(
    verifyWorkflowApplicationArtifactContracts({
      plan: { ...plan, artifactTests: [] },
      file: compiled.file,
      packageHash: compiled.contentHash,
    }),
  ).rejects.toThrow(/正常/);
  const missingNegative = structuredClone(plan);
  delete (missingNegative.artifactTests![0] as { invalidCases?: unknown }).invalidCases;
  await expect(
    verifyWorkflowApplicationArtifactContracts({
      plan: missingNegative,
      file: compiled.file,
      packageHash: compiled.contentHash,
    }),
  ).rejects.toThrow(/异常/);
  const escape = structuredClone(plan);
  (escape.artifactTests![0].files as Record<string, string>)['../../outside.txt'] = 'escape';
  await expect(
    verifyWorkflowApplicationArtifactContracts({
      plan: escape,
      file: compiled.file,
      packageHash: compiled.contentHash,
    }),
  ).rejects.toThrow(/relative|相对|路径|declared path/);
  expect(await fs.stat(path.join(scratch, 'outside.txt')).catch(() => null)).toBeNull();
});

it.each(['native', 'classic-full', 'classic-hotfix', 'classic-tweak'] as const)(
  'checks the fixed business validator of a %s extension without replacing domain acceptance',
  async (base) => {
    const source = path.join(project, 'source');
    const file = await prepareWorkflowApplicationExample({
      projectRoot: project,
      packageRoot: source,
      base,
    });
    const manifest = JSON.parse(
      await fs.readFile(file, 'utf8'),
    ) as WorkflowApplicationProposal['manifest'];
    manifest.skills.forEach((skill) => {
      skill.root = path.join(source, skill.root);
    });
    if (base === 'native')
      manifest.bindings = manifest.bindings.filter(
        (b) => b.usage !== 'action' || b.stepId === 'native.extension.candidate.candidate-review',
      );
    const binding = manifest.bindings.find((b) => b.usage === 'action')!;
    manifest.skills.find((skill) => skill.id === binding.skillId)!.adapter.outputSchema = {
      type: 'object',
    };
    manifest.artifactContracts = [
      {
        workflowId: binding.workflowId,
        stepId: binding.stepId,
        artifacts: [{ ref: 'candidate.txt' }],
      },
    ];
    const p: WorkflowApplicationProposal = {
      schema: 'comet.workflow.application.plan.v1',
      manifest,
      composition:
        base === 'native'
          ? {
              kind: 'native',
              extensions: [
                {
                  id: 'candidate-review',
                  scopes: ['candidate'],
                  skillId: binding.skillId,
                  artifactRefs: ['candidate.txt'],
                  validator: { id: 'business', version: '1' },
                },
              ],
            }
          : {
              kind: 'classic',
              profile: base.slice('classic-'.length) as 'full' | 'hotfix' | 'tweak',
              replacements: manifest.bindings
                .filter((b) => b.usage === 'action' && !b.stepId.startsWith('classic.extension.'))
                .map((b) => ({ stepId: b.stepId, skillId: b.skillId })),
              extensions: [
                {
                  id: 'artifact-review',
                  afterStep: `${base.slice('classic-'.length)}.build.check.evidence`,
                  skillId: binding.skillId,
                  artifactRefs: ['candidate.txt'],
                  validator: { id: 'business', version: '1' },
                },
              ],
            },
      modules: {
        'bindings.mjs': `import fs from 'node:fs/promises'; import path from 'node:path'; export function createBindings(context) { return { executors:[{id:'local',capabilities:['skill-script','skill-host'],supports:()=>true,preflight:async()=>{},execute:async()=>({status:'succeeded',output:{}})}], validators:[{id:'business',version:'1',validate:async()=>({accepted:(await fs.readFile(path.join(context.projectRoot,'candidate.txt'),'utf8')).includes('approved')})}] }; }`,
      },
      artifactTests: [
        {
          workflowId: binding.workflowId,
          stepId: binding.stepId,
          output: {},
          files: { 'candidate.txt': 'approved' },
          invalidCases: [
            { name: 'business-rejected', files: { 'candidate.txt': 'needs revision' } },
          ],
        },
      ],
    };
    const { plan, compiled } = await compile(p);
    const report = await verifyWorkflowApplicationArtifactContracts({
      plan,
      file: compiled.file,
      packageHash: compiled.contentHash,
    });
    expect(report.checks.find((c) => c.name === 'business-rejected')?.accepted).toBe(false);
  },
);

it('does not pass host credentials to local validators', async () => {
  vi.stubEnv('COMET_ARTIFACT_TEST_SECRET', 'fixture-secret');
  const p = proposal();
  p.modules = {
    ...p.modules,
    'bindings.mjs': p.modules['bindings.mjs'].replace(
      "(await fs.readFile(path.join(context.projectRoot,'docs/design.md'),'utf8')).includes('业务已完成')",
      "process.env.COMET_ARTIFACT_TEST_SECRET === undefined && (await fs.readFile(path.join(context.projectRoot,'docs/design.md'),'utf8')).includes('业务已完成')",
    ),
  };
  const { plan, compiled } = await compile(p);
  await verifyWorkflowApplicationArtifactContracts({
    plan,
    file: compiled.file,
    packageHash: compiled.contentHash,
  });
});

it('keeps run input and genuine SDK activation separate for business validators', async () => {
  const p = proposal();
  if (p.composition.kind === 'standalone') {
    p.composition.workflows[0].initialState = { guardEnabled: true };
    p.composition.workflows[0].stateSchema = {
      type: 'object',
      properties: { guardEnabled: { type: 'boolean' } },
      required: ['guardEnabled'],
      additionalProperties: false,
    };
  }
  const test = p.artifactTests![0] as { input?: unknown; activation?: unknown };
  test.input = { contractLabel: 'fixture' };
  test.activation = { stage: 'design' };
  p.modules = {
    ...p.modules,
    'bindings.mjs': p.modules['bindings.mjs']
      .replace('validate:async()=>', 'validate:async({action,run,context:invocation})=>')
      .replace(
        "(await fs.readFile(path.join(context.projectRoot,'docs/design.md'),'utf8')).includes('业务已完成')",
        "run.state.guardEnabled === true && action.type === 'handoff' && action.ref === 'designer' && invocation.projectRoot === context.projectRoot && action.input.input.contractLabel === 'fixture' && action.input.activation.stage === 'design' && (await fs.readFile(path.join(context.projectRoot,'docs/design.md'),'utf8')).includes('业务已完成')",
      ),
  };
  const { plan, compiled } = await compile(p);
  expect(
    (
      await verifyWorkflowApplicationArtifactContracts({
        plan,
        file: compiled.file,
        packageHash: compiled.contentHash,
      })
    ).checks.find((c) => c.name === 'valid')?.accepted,
  ).toBe(true);
});

it('refuses access to files in the real user project during isolated verification', async () => {
  const p = proposal();
  await fs.writeFile(path.join(project, 'private.txt'), 'fixture-only');
  p.modules = {
    ...p.modules,
    'bindings.mjs': p.modules['bindings.mjs'].replace(
      "(await fs.readFile(path.join(context.projectRoot,'docs/design.md'),'utf8')).includes('业务已完成')",
      `(await fs.readFile(${JSON.stringify(path.join(project, 'private.txt'))},'utf8')) === 'fixture-only'`,
    ),
  };
  const { plan, compiled } = await compile(p);
  await expect(
    verifyWorkflowApplicationArtifactContracts({
      plan,
      file: compiled.file,
      packageHash: compiled.contentHash,
    }),
  ).rejects.toThrow(/Access.*denied|permission/iu);
});
