import { getCurrentVersion } from '../../../platform/version/version.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { hashRuntimeValue, createRuntime } from '../../../domains/engine/runtime.js';
import {
  createReportApplication,
  loadWorkflowApplication,
} from '../../../domains/workflow-application/index.js';
import {
  compileWorkflowApplication,
  prepareWorkflowApplicationPlan,
  type WorkflowApplicationProposal,
} from '../../../domains/workflow-generation/index.js';
import { prepareNativeCandidateReviewExample } from '../../../domains/comet-native/native-application.js';
import {
  defineClassicWorkflowApplication,
  classicOpenEvidenceReceipt,
} from '../../../domains/comet-classic/classic-sdk-application.js';
import { parseClassicStateDocument } from '../../../domains/comet-classic/classic-application.js';
import {
  inspectApplicationSkill,
  type ApplicationSkillDependency,
} from '../../../domains/workflow-application/index.js';

const nativeBindings = `import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { hashRuntimeValue } from '@rpamis/comet/runtime';
export function createBindings(context) {
 const inspect=(skill,action)=>JSON.parse(execFileSync(process.execPath,[path.join(skill.root,'scripts/review.mjs'),JSON.stringify(action.input)],{encoding:'utf8'}));
 const host=context.createSkillExecutor({id:'native-review-script',capabilities:['skill-script'],authorize:async()=>true,invokeSkill:async({skill,action})=>({status:'succeeded',output:inspect(skill,action)})});
 return {executors:[host],validators:[{id:'actual-candidate-review',version:'1',validate:({action,outcome})=>({accepted:hashRuntimeValue(inspect(context.skills.get('candidate-review'),action))===hashRuntimeValue(outcome.output),reason:'回报与实际检查不符'})}]};
}`;

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-compiler-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function nativeProposal(
  scopes: Array<'candidate' | 'parent' | 'child' | 'integration'> = [
    'candidate',
    'parent',
    'child',
    'integration',
  ],
) {
  const source = path.join(root, 'source');
  const file = await prepareNativeCandidateReviewExample(source);
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  manifest.skills.forEach((skill: { root: string }) => {
    skill.root = path.join(source, skill.root);
  });
  manifest.bindings = manifest.bindings.filter(
    (binding: { usage: string; stepId: string }) =>
      binding.usage === 'guidance' ||
      scopes.some((scope) => binding.stepId === `native.extension.${scope}.candidate-review`),
  );
  return {
    schema: 'comet.workflow.application.plan.v1',
    manifest,
    composition: {
      kind: 'native',
      extensions: [
        {
          id: 'candidate-review',
          skillId: 'candidate-review',
          scopes,
          artifactRefs: ['candidate.txt'],
          validator: { id: 'actual-candidate-review', version: '1' },
        },
      ],
    },
    modules: { 'bindings.mjs': nativeBindings },
  } as WorkflowApplicationProposal;
}

const prepare = (proposal: WorkflowApplicationProposal) =>
  prepareWorkflowApplicationPlan({
    proposal,
    packageRoot: path.join(root, 'preview'),
    projectRoot: root,
  });
const compile = (plan: unknown, name = 'compiled') =>
  compileWorkflowApplication({
    plan,
    confirmationHash: hashRuntimeValue(plan),
    packageRoot: path.join(root, name),
    projectRoot: root,
  });

it('renders current fixed Skill loading with the standard trigger, real name and exact resource binding', async () => {
  const plan = await prepare(await nativeProposal(['candidate']));
  await compile(plan);
  const entry = await fs.readFile(path.join(root, 'compiled', 'SKILL.md'), 'utf8');
  expect(entry).toContain('**立即执行：** 使用 Skill 工具加载 <skill-name> 技能。禁止跳过此步骤。');
  expect(entry).toContain('技能加载后');
  expect(entry).toContain('skill.files["SKILL.md"]');
  expect(entry).toContain('skill.root');
  expect(entry).toContain('skill.contentHash');
  expect(entry).toContain('waitSkillWork');
  expect(entry).toContain('waitId、proposalHash');
  expect(entry).toContain('等待点指导不等同用户决定或 machine-check 证据');
  expect(entry).toContain('逻辑绑定');
  expect(entry).toContain('无法加载该固定版本时阻塞');
});

it('compiles fixed material deterministically and binds entry/install/recovery to the effective implementation', async () => {
  const manifest = {
    schema: 'comet.workflow.application.v1' as const,
    id: 'quarterly-report',
    version: '1',
    base: 'standalone' as const,
    runtimeVersion: getCurrentVersion(),
    entrySkill: 'SKILL.md',
    module: 'application.mjs',
    skills: [],
    bindings: [],
  };
  const application = createReportApplication({ projectRoot: root, manifest });
  const plan = {
    schema: 'comet.workflow.application.plan.v1' as const,
    manifest,
    workflows: application.workflows,
    modules: {},
    composition: { kind: 'report' as const },
  };
  const first = await compileWorkflowApplication({
    plan,
    confirmationHash: hashRuntimeValue(plan),
    packageRoot: path.join(root, 'first'),
    projectRoot: root,
  });
  const second = await compileWorkflowApplication({
    plan,
    confirmationHash: hashRuntimeValue(plan),
    packageRoot: path.join(root, 'second'),
    projectRoot: root,
  });
  expect(first.contentHash).toBe(second.contentHash);
  expect(await fs.readFile(path.join(root, 'first', 'SKILL.md'), 'utf8')).not.toContain(
    '**立即执行：** 使用 Skill 工具加载',
  );
  expect(await fs.readFile(path.join(root, 'first', 'SKILL.md'), 'utf8')).toContain(
    first.compositionHash,
  );
  const compiled = await loadWorkflowApplication({ file: first.file, projectRoot: root });
  expect(compiled.implementation.workflows).toEqual(application.workflows);
  const installation = JSON.parse(
    await fs.readFile(path.join(root, 'first', 'installation.json'), 'utf8'),
  );
  expect(installation.recovery).toEqual({
    application: manifest.id,
    version: manifest.version,
    compositionHash: first.compositionHash,
  });
});

it('generates different Native extension graphs and real factory handler closures from the declared scopes', async () => {
  const proposal = await nativeProposal();
  const full = await prepare(proposal);
  const limitedProposal = structuredClone(proposal);
  if (limitedProposal.composition.kind !== 'native') throw new Error('fixture');
  limitedProposal.composition.extensions[0].scopes = ['candidate'];
  limitedProposal.manifest.bindings = limitedProposal.manifest.bindings.filter(
    (binding) =>
      binding.usage === 'guidance' ||
      binding.stepId === 'native.extension.candidate.candidate-review',
  );
  const limited = await prepare(limitedProposal);
  const fullResult = await compile(full, 'full');
  const repeat = await compile(full, 'full-repeat');
  expect(repeat.contentHash).toBe(fullResult.contentHash);
  const limitedResult = await compile(limited, 'limited');
  expect(fullResult.workflowHashes).not.toEqual(limitedResult.workflowHashes);
  const fullLoaded = await loadWorkflowApplication({ file: fullResult.file, projectRoot: root });
  const limitedLoaded = await loadWorkflowApplication({
    file: limitedResult.file,
    projectRoot: root,
  });
  expect(
    fullLoaded.implementation.workflows[0].steps['native.extension.child.candidate-review'],
  ).toBeDefined();
  expect(
    limitedLoaded.implementation.workflows[0].steps['native.extension.child.candidate-review'],
  ).toBeUndefined();
  expect(fullLoaded.implementation.transitionHandlers?.[0].apply).not.toBe(
    limitedLoaded.implementation.transitionHandlers?.[0].apply,
  );
  expect(fullLoaded.manifest.bindings.filter((binding) => binding.usage === 'action')).toHaveLength(
    4,
  );
  expect(
    limitedLoaded.manifest.bindings.filter((binding) => binding.usage === 'action'),
  ).toHaveLength(1);
  expect(await fs.readFile(path.join(root, 'full', 'application.mjs'), 'utf8')).toContain(
    'createNativeWorkflowApplication',
  );
  expect(
    await fs.readFile(
      path.join(root, 'full', 'skills/candidate-review/scripts/review.mjs'),
      'utf8',
    ),
  ).toEqual(
    await fs.readFile(path.join(root, 'source/candidate-review/scripts/review.mjs'), 'utf8'),
  );
});

it('rejects malformed plans, undeclared edges, mismatched graphs, missing validators and duplicate identities before producing a package', async () => {
  const proposal = await nativeProposal();
  const plan = await prepare(proposal);
  const reject = async (value: unknown, pattern: RegExp) => {
    await expect(compile(value)).rejects.toThrow(pattern);
    await expect(fs.access(path.join(root, 'compiled'))).rejects.toThrow();
    expect((await fs.readdir(root)).filter((entry) => entry.startsWith('.comet-compile-'))).toEqual(
      [],
    );
  };
  await reject('{bad', /JSON/u);
  await reject({ schema: plan.schema }, /结构/u);
  const missing = structuredClone(plan);
  missing.modules = {
    'bindings.mjs': 'export function createBindings(){ return {validators:[],executors:[]}; }',
  };
  await reject(missing, /验证器/u);
  const missingHost = structuredClone(plan);
  missingHost.modules = {
    'bindings.mjs': nativeBindings.replace('executors:[host]', 'executors:[]'),
  };
  await reject(missingHost, /执行端口/u);
  const duplicate = structuredClone(plan);
  duplicate.modules = {
    'bindings.mjs': nativeBindings.replace(
      'return {executors:[host]',
      'return {executors:[host,host]',
    ),
  };
  await reject(duplicate, /重复/u);
  const duplicateSkill = structuredClone(plan);
  duplicateSkill.manifest.skills.push(duplicateSkill.manifest.skills[0]);
  await reject(duplicateSkill, /重复/u);
  const duplicateWorkflow = structuredClone(plan);
  duplicateWorkflow.workflows = [...plan.workflows, ...plan.workflows];
  await reject(duplicateWorkflow, /重复流程/u);
  const undeclared = structuredClone(plan);
  undeclared.workflows[0].transitions!.push({ from: 'build.builder', to: 'undeclared-step' });
  await reject(undeclared, /不存在/u);
  const mismatch = structuredClone(plan);
  mismatch.workflows[0].maxTransitions = (mismatch.workflows[0].maxTransitions ?? 100) + 1;
  await reject(mismatch, /不匹配/u);
  const identity = structuredClone(plan);
  identity.manifest.id = 'native';
  await reject(identity, /冲突/u);
  const takeover = structuredClone(plan);
  takeover.modules = { 'bindings.mjs': 'export function createBindings(){return {workflows:[]};}' };
  await reject(takeover, /不能覆盖/u);
  await expect(
    compileWorkflowApplication({
      plan,
      confirmationHash: hashRuntimeValue({ other: 'proposal' }),
      packageRoot: path.join(root, 'compiled'),
      projectRoot: root,
    }),
  ).rejects.toThrow(/重新确认/u);
});

it('runs a compiled report through public exports and cold process recovery while approval blocks publishing', async () => {
  const manifest = {
    schema: 'comet.workflow.application.v1' as const,
    id: 'compiled-report',
    version: '1',
    base: 'standalone' as const,
    runtimeVersion: getCurrentVersion(),
    entrySkill: 'SKILL.md',
    module: 'application.mjs',
    skills: [],
    bindings: [],
  };
  const plan = await prepare({
    schema: 'comet.workflow.application.plan.v1',
    manifest,
    composition: { kind: 'report' },
    modules: {},
  });
  const result = await compile(plan);
  const loaded = await loadWorkflowApplication({ file: result.file, projectRoot: root });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId: 'quarterly',
    workflow: { id: 'report-publishing', version: '1' },
    input: { title: 'Quarterly', body: 'Actual local evidence.', sources: ['local repository'] },
  });
  run = await runtime.next({ runId: run.runId });
  await runtime.runUntilBlocked({ runId: run.children[0].runId, executorId: 'report-local' });
  run = await runtime.next({ runId: run.runId });
  expect(run.status).toBe('waiting');
  expect(run.actions.some((action) => action.stepId === 'publish')).toBe(false);
  const consumer = path.join(root, 'consumer.mjs');
  await fs.writeFile(
    consumer,
    `import {loadWorkflowApplication} from '@rpamis/comet/applications';import {createRuntime} from '@rpamis/comet/runtime';import {compileWorkflowApplication} from '@rpamis/comet/applications/compiler';
const loaded=await loadWorkflowApplication({file:${JSON.stringify(result.file)},projectRoot:${JSON.stringify(root)},runId:'quarterly'});const runtime=createRuntime({...loaded.implementation,store:loaded.store});let run=await runtime.inspect('quarterly');const wait=run.waits.at(-1);run=await runtime.resolveWait({runId:run.runId,waitId:wait.id,proposalHash:wait.proposalHash,decisionId:'approve-current',choice:'approved'});await runtime.runUntilBlocked({runId:run.runId,executorId:'report-local'});run=await runtime.inspect(run.runId);console.log(JSON.stringify({status:run.status,compiler:typeof compileWorkflowApplication}));`,
  );
  const completed = JSON.parse(
    execFileSync(process.execPath, [consumer], { cwd: root, encoding: 'utf8' }),
  );
  expect(completed.status).toBe('completed');
  expect(completed.compiler).toBe('function');
  expect(
    (await fs.readdir(path.join(root, '.comet/reports/compiled-report/published'))).length,
  ).toBe(1);
});

it('assembles Classic replacements and order into actual SDK transitions and retains the original domain evidence check', async () => {
  const skillRoot = path.join(root, 'worker');
  await fs.mkdir(skillRoot);
  await fs.writeFile(
    path.join(skillRoot, 'SKILL.md'),
    '# Worker\nPerform domain-work and read actual source. No publishing or approvals.\n',
  );
  const inspected = await inspectApplicationSkill(skillRoot);
  const base = defineClassicWorkflowApplication('hotfix');
  const dependencies: ApplicationSkillDependency[] = [];
  const replacements: Array<{ stepId: string; skillId: string }> = [];
  for (const [stepId, step] of Object.entries(base.workflow.steps)) {
    if (step.type !== 'invoke_skill') continue;
    const id = `work-${replacements.length}`;
    dependencies.push({
      id,
      root: skillRoot,
      contentHash: inspected.contentHash,
      adapter: {
        kind: 'action',
        inputSchema: { type: 'object' },
        outputSchema: step.outputSchema ?? { type: 'object' },
        scope: ['source.js'],
        requiredCapabilities: ['domain-work'],
        interaction: 'none',
        sideEffect: 'read',
        controlsApproval: false,
        completion: 'self-report',
        failure: 'repair',
        recovery: 'manual',
        review: {
          status: 'accepted',
          reviewedBy: 'compiler-fixture-review',
          contentHash: inspected.contentHash,
          capabilities: [{ id: 'domain-work', file: 'SKILL.md', excerpt: 'Perform domain-work' }],
          effects: [{ file: 'SKILL.md', excerpt: 'No publishing or approvals.' }],
        },
      },
    });
    replacements.push({ stepId, skillId: id });
  }
  const review = {
    ...dependencies[0],
    id: 'review',
    adapter: {
      ...dependencies[0].adapter,
      completion: 'machine-check' as const,
      outputSchema: { type: 'object' },
    },
  };
  dependencies.push(review);
  const proposal: WorkflowApplicationProposal = {
    schema: 'comet.workflow.application.plan.v1',
    manifest: {
      schema: 'comet.workflow.application.v1',
      id: 'compiled-classic',
      version: '1',
      base: 'classic-hotfix',
      runtimeVersion: getCurrentVersion(),
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: dependencies,
      bindings: [
        ...replacements.map((replacement) => ({
          ...replacement,
          workflowId: base.workflow.id,
          capability: 'domain-work',
          usage: 'action' as const,
        })),
        ...['alpha', 'beta'].map((id) => ({
          workflowId: base.workflow.id,
          stepId: `classic.extension.${id}`,
          skillId: 'review',
          capability: 'domain-work',
          usage: 'action' as const,
        })),
      ],
    },
    composition: {
      kind: 'classic',
      profile: 'hotfix',
      replacements,
      extensions: ['alpha', 'beta'].map((id) => ({
        id,
        skillId: 'review',
        afterStep: 'hotfix.open.evidence',
        artifactRefs: ['source.js'],
        validator: { id: 'actual-source', version: '1' },
      })),
      order: ['alpha', 'beta'],
    },
    modules: {
      'bindings.mjs': `import {readFileSync} from 'node:fs';import path from 'node:path';export function createBindings(context){return {executors:[context.createSkillExecutor({id:'compiler-host',capabilities:['domain-work'],authorize:async()=>true,invokeSkill:async()=>({status:'succeeded',output:{event:'open-complete'}})})],validators:[{id:'actual-source',version:'1',validate:()=>({accepted:readFileSync(path.join(context.projectRoot,'source.js'),'utf8').includes('ready = true')})}]};}`,
    },
  };
  const first = await prepare(proposal);
  const reversed = structuredClone(proposal);
  if (reversed.composition.kind !== 'classic') throw new Error('fixture');
  reversed.composition.order = ['beta', 'alpha'];
  const second = await prepare(reversed);
  const packages = [await compile(first, 'classic-first'), await compile(second, 'classic-second')];
  expect(packages[0].workflowHashes).not.toEqual(packages[1].workflowHashes);
  for (const [index, compiled] of packages.entries()) {
    const project = path.join(root, `project-${index}`);
    const changeRef = 'docs/openspec/changes/example';
    const changeDir = path.join(project, changeRef);
    await fs.mkdir(changeDir, { recursive: true });
    await fs.mkdir(path.join(project, '.comet'));
    await fs.mkdir(path.join(project, 'docs/superpowers'), { recursive: true });
    await fs.writeFile(
      path.join(project, '.comet/config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: docs\n',
    );
    await fs.writeFile(path.join(project, 'docs/openspec/config.yaml'), 'schema: spec-driven\n');
    await fs.writeFile(path.join(project, 'source.js'), 'export const ready = true;\n');
    await fs.writeFile(
      path.join(changeDir, 'proposal.md'),
      '# Proposal\nKeep the existing source usable.\n',
    );
    await fs.writeFile(
      path.join(changeDir, 'design.md'),
      '# Design\nUse the existing source and check it.\n',
    );
    await fs.writeFile(
      path.join(changeDir, 'tasks.md'),
      '- [x] 1.1 Validate source <!-- comet-task:T1 -->\n',
    );
    const git = (args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=Comet Test', '-c', 'user.email=comet@example.invalid', ...args],
        { cwd: project, encoding: 'utf8' },
      ).trim();
    git(['init', '-b', 'main']);
    git(['add', '.']);
    git(['commit', '-m', 'initial']);
    const loaded = await loadWorkflowApplication({ file: compiled.file, projectRoot: project });
    const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
    const initial = parseClassicStateDocument({
      workflow: 'hotfix',
      language: 'en',
      phase: 'open',
      design_doc: null,
      plan: null,
      build_mode: 'direct',
      tdd_mode: 'direct',
      review_mode: 'off',
      isolation: 'current',
      bound_branch: 'main',
      verify_mode: null,
      verify_result: 'pending',
      verified_at: null,
      archived: false,
      check_epoch: 0,
    }).classic!;
    let run = await runtime.start({
      runId: 'example',
      workflow: { id: base.workflow.id, version: '1' },
      input: { change: 'example', changeDir: changeRef, workspaceRoot: project },
      initialState: initial,
    });
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions[0].id,
      executorId: 'compiler-host',
      context: { requestId: 'open', projectRoot: project },
    });
    const wait = run.evidenceWaits!.find((wait) => wait.status === 'pending')!;
    const receipt = await classicOpenEvidenceReceipt(project, changeRef);
    await expect(
      runtime.recordEvidence({
        runId: run.runId,
        evidenceId: wait.id,
        kind: wait.kind,
        ref: receipt.ref,
        contentHash: 'a'.repeat(64),
        submissionId: 'forged',
        expectedRevision: run.revision,
        context: { requestId: 'forged', projectRoot: project },
      }),
    ).rejects.toThrow();
    run = await runtime.inspect(run.runId);
    run = await runtime.recordEvidence({
      runId: run.runId,
      evidenceId: wait.id,
      kind: wait.kind,
      ...receipt,
      submissionId: 'actual-evidence',
      expectedRevision: run.revision,
      context: { requestId: 'evidence', projectRoot: project },
    });
    expect(run.actions.find((action) => action.status === 'pending')?.stepId).toBe(
      index === 0 ? 'classic.extension.alpha' : 'classic.extension.beta',
    );
    const reopened = await loadWorkflowApplication({
      file: compiled.file,
      projectRoot: project,
      runId: run.runId,
    });
    expect((await reopened.store.read(run.runId))?.actions).toEqual(run.actions);
  }
});
