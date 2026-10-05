import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getCurrentVersion } from '../../platform/version/version.js';
import {
  inspectApplicationSkill,
  type WorkflowApplicationManifest,
} from '../workflow-application/index.js';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { createNativePortableState } from './native-portable-state.js';
import { defaultProjectConfig, readProjectConfig, writeProjectConfig } from './native-config.js';
import { assertNativeName } from './native-change.js';

const reviewSkill = `---
name: native-candidate-review
description: 在已领取的 Native 候选审查 Action 中检查实际候选工件，回报原绑定的通过、实现失败或需求修订结论。
---

# Native 候选审查

读取当前 Action 的固定输入，只检查 activation.workspaceRoot 中的 candidate.txt。
执行 [审查脚本](scripts/review.mjs)，脚本读取 [检查要求](reference/required.txt)。
普通候选、Supervisor 父级、Child 和集成候选各自执行；父级加载不能替代 Child。
失败回原 Builder 修复 candidate.txt 后提交新候选。出现 NEEDS-REQUIREMENTS 时请求用户修订需求，重新确认 Shape。
审查通过后继续原 Native 独立 Verifier 和用户确认。禁止发布、归档或自行批准。
领取和回报使用同一 Action ID、attempt、inputHash、claimToken；中断先查询原 Action，不重发未知执行。
`;
const guidanceSkill = `---
name: native-candidate-builder-guidance
description: Native 候选审查样板的 Builder 开始实现或修复时读取，约束当前工作区的 candidate.txt。
---

# Builder 指导

范围：当前 Builder 的实际工作区中 candidate.txt。
实现须包含 approved，不能包含 NEEDS-REQUIREMENTS；需要改变需求时请求重新确认 Shape。
这是只读执行指导。加载指导不能代替对实际 candidate.txt 的检查。
禁止接管审批、发布或归档。
`;
const reviewScript = `import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { hashRuntimeValue } from '@rpamis/comet/runtime';
const activation = JSON.parse(process.argv[2]).activation;
const bytes = readFileSync(path.join(activation.workspaceRoot, 'candidate.txt'));
const required = readFileSync(new URL('../reference/required.txt', import.meta.url), 'utf8').trim();
const text = bytes.toString('utf8');
const verdict = text.includes('NEEDS-REQUIREMENTS') ? 'revise-requirements' : text.includes(required) ? 'pass' : 'fail';
process.stdout.write(JSON.stringify({verdict, bindingHash: hashRuntimeValue(activation.reviewSource),
  artifactHashes: {'candidate.txt': createHash('sha256').update(bytes).digest('hex')},
  summary: verdict === 'pass' ? '当前 candidate.txt 满足固定指导。' : verdict === 'fail' ? 'candidate.txt 缺少 approved，请在原工作区修复。' : '候选需要修改已确认需求，请重新确认 Shape。'}));
`;
const applicationModule = `import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createNativeWorkflowApplication } from '@rpamis/comet/applications/native';
import { hashRuntimeValue } from '@rpamis/comet/runtime';
export function createApplication(context) {
  const inspect = (skill, action) => JSON.parse(execFileSync(process.execPath,
    [path.join(skill.root, 'scripts/review.mjs'), JSON.stringify(action.input)], {encoding:'utf8'}));
  const host = context.createSkillExecutor({id:'native-review-script', capabilities:['skill-script'],
    authorize:async () => true,
    invokeSkill:async ({skill,action}) => ({status:'succeeded',output:inspect(skill,action)})});
  return createNativeWorkflowApplication(context, {executors:[host], extensions:[{
    id:'candidate-review',skillId:'candidate-review',scopes:['candidate','parent','child','integration'],artifactRefs:['candidate.txt'],
    validator:{id:'actual-candidate-review',version:'1',validate:({action,outcome}) => {
      const actual=inspect(context.skills.get('candidate-review'), action);
      return {accepted:hashRuntimeValue(actual) === hashRuntimeValue(outcome.output),reason:'回报与实际脚本检查不符'};
    }}
  }]});
}
`;

/** 固定、手工装配的垂直样板；不替代后续的组合器和 Creator。 */
export async function prepareNativeCandidateReviewExample(packageRoot: string): Promise<string> {
  const root = path.resolve(packageRoot);
  await fs.mkdir(root, { recursive: true });
  if ((await fs.readdir(root)).length) throw new Error('样板包目录必须为空，不能覆盖已有固定包');
  const reviewRoot = path.join(root, 'candidate-review');
  const guidanceRoot = path.join(root, 'builder-guidance');
  await fs.mkdir(path.join(reviewRoot, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(reviewRoot, 'reference'), { recursive: true });
  await fs.mkdir(guidanceRoot, { recursive: true });
  await fs.writeFile(path.join(reviewRoot, 'SKILL.md'), reviewSkill);
  await fs.writeFile(path.join(reviewRoot, 'scripts/review.mjs'), reviewScript);
  await fs.writeFile(path.join(reviewRoot, 'reference/required.txt'), 'approved\n');
  await fs.writeFile(path.join(guidanceRoot, 'SKILL.md'), guidanceSkill);
  await fs.writeFile(path.join(root, 'application.mjs'), applicationModule);
  await fs.writeFile(
    path.join(root, 'SKILL.md'),
    `---
name: native-candidate-review-workflow
description: 启动或恢复 Native 候选审查样板，按固定 Application 和 SDK Run 执行指导、审查、修复及独立验收。
---

# Native 候选审查入口

用 comet runtime dispatch --application-file <本目录>/application.json --project-root <隔离项目> --request <临时JSON> 启动 comet-native@1。
准备 Native 初始状态和正式 brief/Spec；得到用户对完整 Shape 的确认后，按 comet native next 继续。
Builder 必须读取当前 skillWork 中的固定指导。候选审查 Action 领取后读取实际磁盘 Skill 并执行脚本。
后续查询、领取和回报使用 --application native-candidate-review 与同一 Run ID。
中断恢复先 inspect；running/unknown 保留原领取信息。修复重交候选会重新审查，审查不能代替独立验收和用户接受结果。
宿主真实模型执行和平台 Hook 证据须分别记录；此脚本样板不宣称已经完成这些验收。
`,
  );
  const review = await inspectApplicationSkill(reviewRoot);
  const guidance = await inspectApplicationSkill(guidanceRoot);
  const outputSchema = {
    type: 'object',
    required: ['verdict', 'bindingHash', 'artifactHashes', 'summary'],
    properties: {
      verdict: { enum: ['pass', 'fail', 'revise-requirements'] },
      bindingHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      artifactHashes: {
        type: 'object',
        required: ['candidate.txt'],
        properties: { 'candidate.txt': { type: 'string', pattern: '^[a-f0-9]{64}$' } },
        additionalProperties: false,
      },
      summary: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  };
  const manifest: WorkflowApplicationManifest = {
    schema: 'comet.workflow.application.v1',
    id: 'native-candidate-review',
    version: '1',
    base: 'native',
    runtimeVersion: getCurrentVersion(),
    entrySkill: 'SKILL.md',
    module: 'application.mjs',
    skills: [
      {
        id: 'candidate-review',
        root: 'candidate-review',
        contentHash: review.contentHash,
        adapter: {
          kind: 'check',
          inputSchema: {
            type: 'object',
            required: ['activation'],
            properties: {
              activation: {
                type: 'object',
                required: ['reviewSource', 'workspaceRoot', 'artifactRefs'],
                properties: {
                  reviewSource: { type: 'object' },
                  workspaceRoot: { type: 'string' },
                  artifactRefs: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
          outputSchema,
          scope: ['candidate.txt'],
          requiredCapabilities: ['skill-script'],
          interaction: 'none',
          sideEffect: 'read',
          controlsApproval: false,
          completion: 'machine-check',
          failure: 'repair',
          recovery: 'manual',
          review: {
            status: 'accepted',
            reviewedBy: 'native-example-source-review',
            contentHash: review.contentHash,
            capabilities: [
              { id: 'candidate-review', file: 'SKILL.md', excerpt: '执行 [审查脚本]' },
            ],
            effects: [{ file: 'SKILL.md', excerpt: '禁止发布、归档或自行批准。' }],
          },
        },
      },
      {
        id: 'builder-guidance',
        root: 'builder-guidance',
        contentHash: guidance.contentHash,
        adapter: {
          kind: 'guidance',
          inputSchema: {},
          outputSchema: {},
          scope: ['candidate.txt'],
          requiredCapabilities: [],
          interaction: 'none',
          sideEffect: 'read',
          controlsApproval: false,
          completion: 'self-report',
          failure: 'stop',
          recovery: 'manual',
          review: {
            status: 'accepted',
            reviewedBy: 'native-example-source-review',
            contentHash: guidance.contentHash,
            capabilities: [
              { id: 'builder-guidance', file: 'SKILL.md', excerpt: '实现须包含 approved' },
            ],
            effects: [{ file: 'SKILL.md', excerpt: '这是只读执行指导。' }],
          },
        },
      },
    ],
    bindings: [
      ...(['candidate', 'parent', 'child', 'integration'] as const).map((scope) => ({
        workflowId: 'comet-native',
        stepId: `native.extension.${scope}.candidate-review`,
        skillId: 'candidate-review',
        capability: 'candidate-review',
        usage: 'action' as const,
      })),
      ...[
        'build.builder',
        'supervisor.parent.builder',
        'supervisor.child.builder',
        'supervisor.child.integration-repair',
      ].map((stepId) => ({
        workflowId: 'comet-native',
        stepId,
        skillId: 'builder-guidance',
        capability: 'builder-guidance',
        usage: 'guidance' as const,
      })),
    ],
  };
  const file = path.join(root, 'application.json');
  await fs.writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  return file;
}

/** 在调用者明确选择的新 Git 项目中准备样板和公开 start 请求，不推进或批准 Run。 */
export async function prepareNativeCandidateReviewProject(options: {
  projectRoot: string;
  packageRoot: string;
  name?: string;
}) {
  const projectRoot = await fs.realpath(options.projectRoot);
  const name = options.name ?? 'native-example';
  assertNativeName(name);
  const branch = inspectGitWorktree(projectRoot).currentBranch;
  if (!branch || (await readProjectConfig(projectRoot)))
    throw new Error('样板需要已初始化 Git、尚未配置 Comet 的隔离项目');
  const changeDir = path.join(projectRoot, 'docs/comet/changes', name);
  for (const file of [changeDir, path.join(projectRoot, 'candidate.txt')]) {
    try {
      await fs.access(file);
      throw new Error('样板需要尚不存在的 change 和 candidate.txt');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const applicationFile = await prepareNativeCandidateReviewExample(options.packageRoot);
  await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'zh-CN'));
  await fs.mkdir(path.join(changeDir, 'specs', 'example'), { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Outcome\n让 candidate.txt 满足固定指导。\n# Scope\n实现、候选审查、失败修复和冷恢复。\n' +
      '# Non-goals\n发布或归档。\n# Acceptance examples\n- 当前候选满足固定指导。\n' +
      '# Directory structure\n## Created\n- candidate.txt\n## Modified\n无。\n## Deleted\n无。\n## Not created\n外部服务。\n',
    { flag: 'wx' },
  );
  await fs.writeFile(
    path.join(changeDir, 'specs/example/spec.md'),
    '# Example\n当前 candidate.txt 须包含 approved。\n',
    { flag: 'wx' },
  );
  await fs.writeFile(path.join(projectRoot, 'candidate.txt'), 'unreviewed\n', { flag: 'wx' });
  return {
    applicationFile,
    startRequest: {
      operation: 'start',
      runId: name,
      workflow: { id: 'comet-native', version: '1' },
      input: { name, artifactRootRef: 'docs' },
      initialState: createNativePortableState({
        name,
        language: 'zh-CN',
        workspace: {
          isolation: 'current',
          change_branch: branch,
          target_branch: branch,
          finish: null,
        },
      }),
    },
  };
}
