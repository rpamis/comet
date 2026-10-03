import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inspectApplicationSkill } from '../../domains/workflow-application/index.js';
import type { WorkflowApplicationManifest } from '../../domains/workflow-application/index.js';

/** 真实脚本 Skill，测试模型之外的确定性加载、执行与恢复协议。 */
export async function createDiskApplication(
  root: string,
  options: { parallel?: boolean; external?: boolean } = {},
) {
  const packageRoot = path.join(root, 'package');
  const skillRoot = path.join(root, 'writer');
  await fs.mkdir(path.join(skillRoot, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(skillRoot, 'reference'));
  await fs.mkdir(packageRoot);
  await fs.writeFile(
    path.join(skillRoot, 'SKILL.md'),
    '# Writer\nRun [the script](scripts/run.mjs) with the SDK step input to generate a title.\nRead [the suffix](reference/suffix.txt).\n' +
      (options.external
        ? 'Scope: publish to the isolated service after parent approval; query by Action ID before retrying.\n'
        : 'Scope: local report. No publishing or approvals.\n'),
  );
  await fs.writeFile(path.join(skillRoot, 'reference/suffix.txt'), ' — reviewed');
  await fs.writeFile(
    path.join(skillRoot, 'scripts/run.mjs'),
    `import { readFileSync } from 'node:fs';\nconsole.log(JSON.stringify({title: JSON.parse(process.argv[2]).input.topic + readFileSync(new URL('../reference/suffix.txt', import.meta.url), 'utf8')}));\n`,
  );
  const skill = await inspectApplicationSkill(skillRoot);
  const outputSchema = {
    type: 'object',
    required: ['title'],
    properties: { title: { type: 'string', minLength: 1 } },
    additionalProperties: false,
  };
  const manifest: WorkflowApplicationManifest = {
    schema: 'comet.workflow.application.v1',
    id: 'editorial',
    version: '1',
    base: 'standalone',
    runtimeVersion: '0.4.5',
    entrySkill: 'SKILL.md',
    module: 'application.mjs',
    skills: [
      {
        id: 'writer',
        root: skillRoot,
        contentHash: skill.contentHash,
        adapter: {
          kind: 'action',
          inputSchema: {
            type: 'object',
            required: ['input', 'outputs'],
            properties: {
              input: {
                type: 'object',
                required: ['topic'],
                properties: { topic: { type: 'string' } },
                additionalProperties: false,
              },
              outputs: { type: 'object' },
            },
            additionalProperties: false,
          },
          outputSchema,
          scope: ['report'],
          requiredCapabilities: ['skill-script'],
          interaction: 'none',
          sideEffect: options.external ? 'external' : 'read',
          controlsApproval: false,
          completion: 'machine-check',
          failure: 'repair',
          recovery: options.external ? 'reconcile' : 'manual',
          review: {
            status: 'accepted',
            reviewedBy: 'fixture-adapter-review',
            contentHash: skill.contentHash,
            capabilities: [{ id: 'title', file: 'SKILL.md', excerpt: 'generate a title' }],
            effects: [
              {
                file: 'SKILL.md',
                excerpt: options.external
                  ? 'after parent approval; query by Action ID before retrying.'
                  : 'No publishing or approvals.',
              },
            ],
          },
        },
      },
    ],
    bindings: (options.parallel ? ['left', 'right'] : ['draft']).map((stepId) => ({
      workflowId: 'editorial',
      stepId,
      skillId: 'writer',
      capability: 'title',
      usage: 'action',
      ...(options.external ? { authorizationFrom: 'approve' } : {}),
    })),
  };
  await fs.writeFile(
    path.join(packageRoot, 'SKILL.md'),
    '# Editorial entry\nStart with comet runtime dispatch --application-file application.json; resume with --application editorial and the same Run ID.\n',
  );
  const step = {
    type: 'invoke_skill',
    ref: 'writer',
    outputSchema,
    validator: { id: 'actual-title', version: '1' },
    requiredCapabilities: ['skill-script'],
    retry: options.external ? 'reconcile' : 'manual',
  };
  let workflow = {
    id: 'editorial',
    version: '1',
    entry: options.parallel ? ['left', 'right'] : 'draft',
    steps: options.parallel
      ? {
          left: step,
          right: step,
          join: { type: 'call_tool', ref: 'join', join: ['left', 'right'] },
        }
      : {
          draft: step,
          approve: { type: 'ask_user', proposalFrom: 'draft' },
          publish: { type: 'call_tool', ref: 'publish' },
        },
    transitions: options.parallel
      ? [
          { from: 'left', to: 'join' },
          { from: 'right', to: 'join' },
        ]
      : [
          { from: 'draft', to: 'approve' },
          { from: 'approve', to: 'publish', on: 'approved' },
        ],
  };
  if (options.external) {
    workflow = {
      ...workflow,
      entry: 'prepare',
      steps: {
        prepare: { type: 'call_tool', ref: 'prepare' },
        approve: {
          type: 'ask_user',
          proposalFrom: 'prepare',
          choices: ['multi-session', 'single-session', 'rejected'],
        },
        draft: step,
      },
      transitions: [
        { from: 'prepare', to: 'approve' },
        { from: 'approve', to: 'draft', on: 'multi-session' },
        { from: 'approve', to: 'draft', on: 'single-session' },
      ],
    } as typeof workflow;
    manifest.bindings[0].authorizationChoices = ['multi-session', 'single-session'];
  }
  await fs.writeFile(
    path.join(packageRoot, 'application.mjs'),
    `
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export function createApplication({ createSkillExecutor, skills, projectRoot }) {
  const host = { id: 'local-skill', capabilities: ['skill-script'], authorize: async () => true,
    invokeSkill: async ({ action, skill }) => {
      if (!skill.files['SKILL.md'].includes('Run [the script]')) throw new Error('Unsupported Skill instructions');
      const output = JSON.parse(execFileSync(process.execPath, [path.join(skill.root, 'scripts/run.mjs'), JSON.stringify(action.input)], { encoding: 'utf8' }));
      return { status: 'succeeded', output };
    }
  };
  return { workflows: [${JSON.stringify(workflow)}], executors: [createSkillExecutor(host)],
    validators: [{ id: 'actual-title', version: '1', validate: ({action,outcome}) => ({accepted: outcome.output?.title === action.input.input.topic + readFileSync(path.join(skills.get('writer').root, 'reference/suffix.txt'), 'utf8'), reason: 'Title must match the actual Skill resource and input'}) }],
    wrapStore: (store) => ({ read: (id) => store.read(id), compareAndSwap: async (id, revision, run) => { const changed = await store.compareAndSwap(id, revision, run); if (changed) writeFileSync(path.join(projectRoot, 'projection.json'), JSON.stringify({phase: run.status})); return changed; } }),
    inspectHook: (run) => ({ allowed: false, reason: 'Editorial guard ' + run.runId + ' ' + run.status })
  };
}
`,
  );
  const file = path.join(packageRoot, 'application.json');
  await fs.writeFile(file, JSON.stringify(manifest));
  return { file, packageRoot, skillRoot, manifest };
}

/** 两个写入动作共享实际文件；分别构造并行循环和合法串行修复。 */
export async function createScopeCycleApplication(root: string, serial: boolean) {
  const fixture = await createDiskApplication(root);
  await fs.appendFile(
    path.join(fixture.skillRoot, 'SKILL.md'),
    '\nWrite shared.txt locally after parent approval.\n',
  );
  const inspected = await inspectApplicationSkill(fixture.skillRoot);
  const dependency = fixture.manifest.skills[0];
  dependency.contentHash = inspected.contentHash;
  dependency.adapter.sideEffect = 'write';
  dependency.adapter.scope = ['shared.txt'];
  dependency.adapter.review.contentHash = inspected.contentHash;
  dependency.adapter.review.effects = [
    { file: 'SKILL.md', excerpt: 'Write shared.txt locally after parent approval.' },
  ];
  fixture.manifest.bindings = ['left', 'right'].map((stepId) => ({
    workflowId: 'editorial',
    stepId,
    skillId: 'writer',
    capability: 'title',
    usage: 'action',
    authorizationFrom: 'approve',
  }));
  const writer = {
    type: 'invoke_skill',
    ref: 'writer',
    outputSchema: dependency.adapter.outputSchema,
    requiredCapabilities: ['skill-script'],
    validator: { id: 'actual-title', version: '1' },
  };
  const workflow = {
    id: 'editorial',
    version: '1',
    entry: 'prepare',
    maxTransitions: 20,
    ...(serial
      ? {
          initialState: { round: 0 },
          stateSchema: { type: 'object' },
          transitionHandler: { id: 'bounded-repair', version: '1' },
        }
      : {}),
    steps: {
      prepare: { type: 'call_tool', ref: 'prepare' },
      approve: { type: 'ask_user', proposalFrom: 'prepare' },
      fork: { type: 'call_tool', ref: 'fork' },
      left: writer,
      right: writer,
      join: { type: 'call_tool', ref: 'join', ...(serial ? {} : { join: ['left', 'right'] }) },
      repair: { type: 'call_tool', ref: 'repair' },
    },
    transitions: serial
      ? [
          { from: 'prepare', to: 'approve' },
          { from: 'approve', to: 'left', on: 'approved' },
          { from: 'left', to: 'right' },
          { from: 'right', to: 'repair' },
          { from: 'repair', to: 'left' },
        ]
      : [
          { from: 'prepare', to: 'approve' },
          { from: 'approve', to: 'fork', on: 'approved' },
          { from: 'fork', to: 'left' },
          { from: 'fork', to: 'right' },
          { from: 'left', to: 'join' },
          { from: 'right', to: 'join' },
          { from: 'join', to: 'repair' },
          { from: 'repair', to: 'fork' },
        ],
  };
  await fs.writeFile(fixture.file, JSON.stringify(fixture.manifest));
  await fs.writeFile(
    path.join(fixture.packageRoot, 'application.mjs'),
    `
import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const workflow = ${JSON.stringify(workflow)};
export function createApplication({ createSkillExecutor, projectRoot, skills }) {
  const host = { id: 'local-skill', capabilities: ['skill-script'], authorize: async () => true,
    invokeSkill: async ({ action, skill }) => {
      const output = JSON.parse(execFileSync(process.execPath, [path.join(skill.root, 'scripts/run.mjs'), JSON.stringify(action.input)], { encoding: 'utf8' }));
      await appendFile(path.join(projectRoot, 'shared.txt'), action.stepId + '\\n');
      return { status: 'succeeded', output };
    }
  };
  return { workflows: [workflow], executors: [createSkillExecutor(host), { id: 'tool-host', capabilities: [], supports: (action) => action.type === 'call_tool', execute: async () => ({ status: 'succeeded', output: { ok: true } }) }],
    validators: [{ id: 'actual-title', version: '1', validate: async ({ action, outcome }) => ({ accepted: outcome.output?.title === action.input.input.topic + await readFile(path.join(skills.get('writer').root, 'reference/suffix.txt'), 'utf8') }) }],
    transitionHandlers: ${serial ? `[{ id: 'bounded-repair', version: '1', apply: ({ run, event }) => { if (event.stepId === 'repair') { const round = run.state.round + 1; return { state: { round }, next: round < 2 ? ['left'] : [] }; } const choice = event.kind === 'wait-resolved' ? event.choice : event.outcome?.status; return { state: run.state, next: workflow.transitions.filter((edge) => edge.from === event.stepId && (!edge.on || edge.on === choice)).map((edge) => edge.to) }; } }]` : '[]'}
  };
}
`,
  );
  return fixture;
}
