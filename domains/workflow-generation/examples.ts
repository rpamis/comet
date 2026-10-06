import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getCurrentVersion } from '../../platform/version/version.js';
import { hashRuntimeValue } from '../engine/runtime.js';
import { inspectApplicationSkill } from '../workflow-application/index.js';
import { prepareNativeCandidateReviewExample } from '../comet-native/native-application.js';
import { defineClassicWorkflowApplication } from '../comet-classic/classic-sdk-application.js';
import {
  compileWorkflowApplication,
  prepareWorkflowApplicationPlan,
  type WorkflowApplicationProposal,
} from './compiler.js';

/** 创建可运行的本地样板包；不启动 Run、不提交用户决定、不写外部系统。 */
export async function prepareWorkflowApplicationExample(options: {
  projectRoot: string;
  packageRoot: string;
  base: 'native' | 'classic-full' | 'classic-hotfix' | 'classic-tweak' | 'standalone';
}): Promise<string> {
  if (options.base === 'native') return prepareNativeCandidateReviewExample(options.packageRoot);
  const manifest = {
    schema: 'comet.workflow.application.v1' as const,
    id: options.base === 'standalone' ? 'report-example' : `${options.base}-review-example`,
    version: '1',
    base: options.base,
    runtimeVersion: getCurrentVersion(),
    entrySkill: 'SKILL.md',
    module: 'application.mjs',
    skills: [],
    bindings: [],
  };
  let proposal: WorkflowApplicationProposal = {
    schema: 'comet.workflow.application.plan.v1',
    manifest,
    composition: { kind: 'report' },
    modules: {},
  };
  let temporary: string | undefined;
  try {
    if (options.base.startsWith('classic-')) {
      const profile = options.base.slice('classic-'.length) as 'full' | 'hotfix' | 'tweak';
      temporary = await fs.mkdtemp(path.join(options.projectRoot, '.comet-example-'));
      const skillRoot = path.join(temporary, 'classic-artifact-review');
      await fs.mkdir(path.join(skillRoot, 'scripts'), { recursive: true });
      const markdown =
        '---\nname: classic-artifact-review\ndescription: 检查 Classic 样板实际 candidate.txt，失败返回原 Build 修复。\n---\n\n# 工件审查\n\n读取 [检查脚本](scripts/check.mjs)，核对实际 candidate.txt 与当前 Action 的来源。\n文件需包含 approved；失败保留工件后返回原 Build 修复。只读，不接管用户批准、发布或归档。\n';
      await fs.writeFile(path.join(skillRoot, 'SKILL.md'), markdown);
      await fs.writeFile(
        path.join(skillRoot, 'scripts/check.mjs'),
        `import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import path from 'node:path';import {hashRuntimeValue} from '@rpamis/comet/runtime';\nconst action=JSON.parse(process.argv[2]);const bytes=readFileSync(path.join(process.argv[3],'candidate.txt'));console.log(JSON.stringify({verdict:bytes.toString('utf8').includes('approved')?'pass':'repair',sourceHash:hashRuntimeValue(action.activation.source),artifactHashes:{'candidate.txt':createHash('sha256').update(bytes).digest('hex')},summary:'检查实际候选文件，失败返回原Build修复。'}));\n`,
      );
      const inspected = await inspectApplicationSkill(skillRoot);
      const outputSchema = {
        type: 'object',
        required: ['verdict', 'sourceHash', 'artifactHashes', 'summary'],
        additionalProperties: false,
        properties: {
          verdict: { enum: ['pass', 'repair', 'revise-requirements'] },
          sourceHash: { type: 'string' },
          artifactHashes: { type: 'object' },
          summary: { type: 'string', minLength: 1 },
        },
      };
      proposal = {
        ...proposal,
        manifest: {
          ...manifest,
          skills: [
            {
              id: 'artifact-review',
              root: skillRoot,
              contentHash: inspected.contentHash,
              adapter: {
                kind: 'action',
                inputSchema: { type: 'object' },
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
                  reviewedBy: 'example-source-review',
                  contentHash: inspected.contentHash,
                  capabilities: [
                    { id: 'artifact-review', file: 'SKILL.md', excerpt: '核对实际 candidate.txt' },
                  ],
                  effects: [{ file: 'SKILL.md', excerpt: '只读，不接管用户批准、发布或归档。' }],
                },
              },
            },
          ],
          bindings: [
            {
              workflowId: `comet-classic-${profile}`,
              stepId: 'classic.extension.artifact-review',
              skillId: 'artifact-review',
              capability: 'artifact-review',
              usage: 'action',
            },
          ],
        },
        composition: {
          kind: 'classic',
          profile,
          replacements: [],
          extensions: [
            {
              id: 'artifact-review',
              afterStep: `${profile}.build.check.evidence`,
              skillId: 'artifact-review',
              artifactRefs: ['candidate.txt'],
              validator: { id: 'example-actual-artifact', version: '1' },
            },
          ],
        },
        modules: {
          'bindings.mjs': `import {execFileSync} from 'node:child_process';import path from 'node:path';import {hashRuntimeValue} from '@rpamis/comet/runtime';\nexport function createBindings(context){ const inspect=(skill,action)=>JSON.parse(execFileSync(process.execPath,[path.join(skill.root,'scripts/check.mjs'),JSON.stringify(action.input),context.projectRoot],{encoding:'utf8'}));const host=context.createSkillExecutor({id:'example-artifact-host',capabilities:['skill-script'],authorize:async()=>true,invokeSkill:async({skill,action})=>({status:'succeeded',output:inspect(skill,action)})});return {executors:[host],validators:[{id:'example-actual-artifact',version:'1',validate:({action,outcome})=>({accepted:hashRuntimeValue(inspect(context.skills.get('artifact-review'),action))===hashRuntimeValue(outcome.output),reason:'回报必须匹配实际文件'})}]};}\n`,
        },
      };
      if (proposal.composition.kind !== 'classic') throw new Error('Classic sample composition');
      for (const [stepId, step] of Object.entries(
        defineClassicWorkflowApplication(profile).workflow.steps,
      )) {
        if (step.type !== 'invoke_skill') continue;
        const skillId = `classic-${profile}-stage-${proposal.composition.replacements.length}`;
        const workerRoot = path.join(temporary, skillId);
        await fs.mkdir(workerRoot);
        const instructions = `---\nname: ${skillId}\ndescription: 执行 Classic ${stepId} 的实际领域工作并回报当前 SDK Action。\n---\n\n# ${stepId}\n\n实际宿主处理当前 Action：读取项目文件和原 Classic 的公开 CLI 帮助，完成 ${stepId} 的工件或本地交付。\n启动时在Run input.projectRoot传入当前隔离项目的绝对路径；写入范围按此字段核对。默认采用直接实现；不加载 Superpowers，不调用远程服务。范围为当前隔离项目。\n原领域的工件检查、当前用户 Wait 和审批仍由 Runtime 负责，不自行批准、不跳过证据步骤。\n领域 work 完成后回报原 Action 的真实产物。输出契约：\n\n\`\`\`json\n${JSON.stringify(step.outputSchema ?? { type: 'object' }, null, 2)}\n\`\`\`\n\n失败保留原文件后修复；中断先 inspect 原 Run，不能替换 attempt 或重做已完成工作。\n`;
        await fs.writeFile(path.join(workerRoot, 'SKILL.md'), instructions);
        const worker = await inspectApplicationSkill(workerRoot);
        proposal.manifest.skills.push({
          id: skillId,
          root: workerRoot,
          contentHash: worker.contentHash,
          adapter: {
            kind: 'action',
            inputSchema: { type: 'object' },
            outputSchema: step.outputSchema ?? { type: 'object' },
            scope: ['.'],
            requiredCapabilities: ['skill-host'],
            interaction: 'none',
            sideEffect: 'write',
            controlsApproval: false,
            completion: 'self-report',
            failure: 'repair',
            recovery: 'manual',
            review: {
              status: 'accepted',
              reviewedBy: 'classic-example-source-review',
              contentHash: worker.contentHash,
              capabilities: [
                { id: 'classic-domain-work', file: 'SKILL.md', excerpt: '原领域的工件检查' },
              ],
              effects: [{ file: 'SKILL.md', excerpt: '范围为当前隔离项目。' }],
            },
          },
        });
        proposal.manifest.bindings.push({
          workflowId: `comet-classic-${profile}`,
          stepId,
          skillId,
          capability: 'classic-domain-work',
          usage: 'action',
          authorizationFrom: 'classic.composition.confirm',
          workspaceFrom: 'input.projectRoot',
        });
        proposal.composition.replacements.push({ stepId, skillId });
      }
      proposal.modules = {
        ...proposal.modules,
        'bindings.mjs': proposal.modules['bindings.mjs']
          .replace("capabilities:['skill-script']", "capabilities:['skill-script','skill-host']")
          .replace(
            "invokeSkill:async({skill,action})=>({status:'succeeded',output:inspect(skill,action)})",
            "invokeSkill:async({skill,action})=>{if(skill.id!=='artifact-review')throw new Error('此领域工作需要实际宿主加载当前固定Skill并通过公开SDK领取/回报；自动脚本不能代替');return {status:'succeeded',output:inspect(skill,action)}}",
          ),
      };
    }
    const plan = await prepareWorkflowApplicationPlan({
      proposal,
      projectRoot: options.projectRoot,
      packageRoot: options.packageRoot,
    });
    const compiled = await compileWorkflowApplication({
      plan,
      confirmationHash: hashRuntimeValue(plan),
      projectRoot: options.projectRoot,
      packageRoot: options.packageRoot,
    });
    return compiled.file;
  } finally {
    // 仅删除此调用独占创建的隔离源码；已编译包保存完整固定依赖。
    if (temporary) await fs.rm(temporary, { recursive: true });
  }
}
