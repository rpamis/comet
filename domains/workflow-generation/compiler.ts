import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Ajv } from 'ajv';
import {
  defineWorkflow,
  hashRuntimeValue,
  type DefineWorkflowOptions,
  type RuntimeAction,
} from '../engine/runtime.js';
import { canonicalRuntimeJson } from '../engine/runtime-json.js';
import {
  loadWorkflowApplication,
  adaptApplicationSkill,
  type WorkflowApplicationManifest,
} from '../workflow-application/index.js';
import {
  applicationError,
  applicationFilesHash,
  readApplicationFiles,
} from '../workflow-application/skill-adapter.js';

export interface ApplicationExtensionPlan {
  id: string;
  skillId: string;
  artifactRefs: string[];
  validator: { id: string; version: string };
}

/** 领域工厂拥有状态机；方案仅选择其支持的组合位置与固定实现。 */
export type ApplicationCompositionPlan =
  | { kind: 'report' }
  | {
      kind: 'native';
      extensions: Array<
        ApplicationExtensionPlan & {
          scopes: Array<'candidate' | 'parent' | 'child' | 'integration'>;
        }
      >;
    }
  | {
      kind: 'classic';
      profile: 'full' | 'hotfix' | 'tweak';
      replacements: Array<{ stepId: string; skillId: string }>;
      extensions: Array<ApplicationExtensionPlan & { afterStep: string }>;
      order?: string[];
    };

/** 模块也是确认方案的一部分；领域工厂由组合器生成。 */
export interface WorkflowApplicationPlan {
  schema: 'comet.workflow.application.plan.v1';
  manifest: WorkflowApplicationManifest;
  workflows: readonly DefineWorkflowOptions[];
  modules: Readonly<Record<string, string>>;
  composition: ApplicationCompositionPlan;
}

export type WorkflowApplicationProposal = Omit<WorkflowApplicationPlan, 'workflows'>;

export interface CompiledWorkflowApplication {
  file: string;
  compositionHash: string;
  contentHash: string;
  workflowHashes: Readonly<Record<string, string>>;
}

const textSchema = { type: 'string', minLength: 1 };
const extensionProperties = {
  id: textSchema,
  skillId: textSchema,
  artifactRefs: { type: 'array', minItems: 1, uniqueItems: true, items: textSchema },
  validator: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'version'],
    properties: { id: textSchema, version: textSchema },
  },
};
const planSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'manifest', 'workflows', 'modules', 'composition'],
  properties: {
    schema: { const: 'comet.workflow.application.plan.v1' },
    manifest: {
      type: 'object',
      additionalProperties: false,
      required: [
        'schema',
        'id',
        'version',
        'base',
        'runtimeVersion',
        'entrySkill',
        'module',
        'skills',
        'bindings',
      ],
      properties: {
        schema: { const: 'comet.workflow.application.v1' },
        id: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$' },
        version: { type: 'string', minLength: 1 },
        base: { enum: ['native', 'classic-full', 'classic-hotfix', 'classic-tweak', 'standalone'] },
        runtimeVersion: { type: 'string', minLength: 1 },
        entrySkill: { const: 'SKILL.md' },
        module: { type: 'string', minLength: 1 },
        skills: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'root', 'contentHash', 'adapter'],
            properties: {
              id: textSchema,
              root: textSchema,
              contentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
              adapter: { type: 'object' },
            },
          },
        },
        bindings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['workflowId', 'stepId', 'skillId', 'capability', 'usage'],
            properties: {
              workflowId: textSchema,
              stepId: textSchema,
              skillId: textSchema,
              capability: textSchema,
              usage: { enum: ['guidance', 'action', 'subworkflow'] },
              authorizationFrom: textSchema,
              authorizationChoices: {
                type: 'array',
                minItems: 1,
                uniqueItems: true,
                items: textSchema,
              },
              workspaceFrom: textSchema,
            },
          },
        },
      },
    },
    workflows: { type: 'array', minItems: 1, items: { type: 'object' } },
    modules: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } },
    composition: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { const: 'report' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'extensions'],
          properties: {
            kind: { const: 'native' },
            extensions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'skillId', 'artifactRefs', 'validator', 'scopes'],
                properties: {
                  ...extensionProperties,
                  scopes: {
                    type: 'array',
                    minItems: 1,
                    uniqueItems: true,
                    items: { enum: ['candidate', 'parent', 'child', 'integration'] },
                  },
                },
              },
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'profile', 'replacements', 'extensions'],
          properties: {
            kind: { const: 'classic' },
            profile: { enum: ['full', 'hotfix', 'tweak'] },
            replacements: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['stepId', 'skillId'],
                properties: { stepId: textSchema, skillId: textSchema },
              },
            },
            extensions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'skillId', 'artifactRefs', 'validator', 'afterStep'],
                properties: { ...extensionProperties, afterStep: textSchema },
              },
            },
            order: { type: 'array', uniqueItems: true, items: textSchema },
          },
        },
      ],
    },
  },
};

function parsePlan(value: unknown, requireWorkflows = true): WorkflowApplicationPlan {
  try {
    const parsed =
      typeof value === 'string' ? JSON.parse(value) : JSON.parse(canonicalRuntimeJson(value));
    const ajv = new Ajv({ strict: true, allErrors: true });
    const validate = ajv.compile(
      requireWorkflows
        ? planSchema
        : {
            ...planSchema,
            properties: {
              ...planSchema.properties,
              workflows: { ...planSchema.properties.workflows, minItems: 0 },
            },
          },
    );
    if (!validate(parsed)) applicationError(`组合方案结构无效：${ajv.errorsText(validate.errors)}`);
    return parsed as unknown as WorkflowApplicationPlan;
  } catch (error) {
    applicationError(
      `组合方案必须是有效 JSON：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function workflowHashes(workflows: readonly DefineWorkflowOptions[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const workflow of workflows) {
    const definition = defineWorkflow(workflow);
    const key = `${definition.id}@${definition.version}`;
    if (Object.hasOwn(result, key)) applicationError(`重复流程身份：${key}`);
    result[key] = hashRuntimeValue(definition);
  }
  return result;
}

function moduleRef(ref: string): void {
  if (
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(?:mjs|json)$/u.test(ref) ||
    ref === 'application.json' ||
    ref === 'installation.json' ||
    ref.startsWith('skills/')
  )
    applicationError(`执行模块路径无效或与生成内容冲突：${ref}`);
}

function applicationModule(plan: WorkflowApplicationPlan): string {
  const composition = plan.composition;
  const kind = composition.kind;
  if (plan.manifest.module !== 'application.mjs' || plan.modules['application.mjs'])
    applicationError('application.mjs 由组合器生成，不能以手写工厂覆盖');
  if (kind !== 'report' && !plan.modules['bindings.mjs'])
    applicationError('Native/Classic 组合需要固定 bindings.mjs 实现集合');
  if (
    (kind === 'report' && plan.manifest.base !== 'standalone') ||
    (kind === 'native' && plan.manifest.base !== 'native') ||
    (kind === 'classic' && plan.manifest.base !== `classic-${composition.profile}`)
  )
    applicationError('基础流程与组合种类冲突');
  const imported =
    kind === 'report'
      ? "import { createReportApplication as factory } from '@rpamis/comet/applications';"
      : kind === 'native'
        ? "import { createNativeWorkflowApplication as factory } from '@rpamis/comet/applications/native';"
        : "import { createClassicApplication as factory } from '@rpamis/comet/applications/classic';";
  return `${imported}\n${kind === 'report' ? '' : "import { createBindings } from './bindings.mjs';"}\nconst composition = ${canonicalRuntimeJson(composition)};\nexport async function createApplication(context) {\n  const implementations = ${kind === 'report' ? '{}' : 'await createBindings(context)'};\n  for (const key of Object.keys(implementations)) if (!['validators','executors'].includes(key)) throw new Error('实现集合不能覆盖领域流程或转移处理器：'+key);\n  for (const key of ['validators','executors']) {\n    const identities = new Set();\n    for (const entry of implementations[key] ?? []) {\n      const identity = key === 'validators' ? entry.id+'@'+entry.version : entry.id;\n      if (!entry.id || (key === 'validators' && (!entry.version || typeof entry.validate !== 'function')) || identities.has(identity)) throw new Error('重复或无效实现身份：'+identity);\n      identities.add(identity);\n    }\n  }\n  const resolveValidator = (ref) => { const result = implementations.validators?.find(entry => entry.id === ref.id && entry.version === ref.version); if (!result) throw new Error('未注册方案要求的验证器：'+ref.id+'@'+ref.version); return result; };\n  ${kind === 'report' ? 'return factory(context);' : 'const extensions = composition.extensions.map(extension => ({...extension, validator:resolveValidator(extension.validator)}));\n  return factory(context, {...composition, extensions, executors:implementations.executors});'}\n}\n`;
}

export interface CompileWorkflowApplicationOptions {
  plan: unknown;
  confirmationHash: string;
  packageRoot: string;
  projectRoot: string;
  /** 相对 Skill 依赖目录的解析基线，必须由调用者明确给出。 */
  dependencyRoot?: string;
}

async function assemblyFiles(
  plan: WorkflowApplicationPlan,
  dependencyRoot?: string,
): Promise<Record<string, string>> {
  for (const ref of Object.keys(plan.modules)) moduleRef(ref);
  const files: Record<string, string> = Object.fromEntries(
    Object.entries(plan.modules).map(([ref, source]) => [
      ref,
      Buffer.from(source).toString('base64'),
    ]),
  );
  files['application.mjs'] = Buffer.from(applicationModule(plan)).toString('base64');
  const manifest = structuredClone(plan.manifest);
  const ids = new Set<string>();
  for (const dependency of manifest.skills) {
    if (!/^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(dependency.id) || ids.has(dependency.id))
      applicationError(`重复或无效 Skill 身份：${dependency.id}`);
    ids.add(dependency.id);
    if (!path.isAbsolute(dependency.root) && !dependencyRoot)
      applicationError(`相对依赖需要明确 dependencyRoot：${dependency.id}`);
    const adapted = await adaptApplicationSkill(dependency, dependencyRoot ?? process.cwd());
    const dependencyFiles = await readApplicationFiles(adapted.root);
    if (applicationFilesHash(dependencyFiles) !== dependency.contentHash)
      applicationError(`编译读取期间 Skill 发生变化：${dependency.id}`);
    dependency.root = `skills/${dependency.id}`;
    for (const [ref, bytes] of Object.entries(dependencyFiles))
      files[`${dependency.root}/${ref}`] = bytes;
  }
  const compositionHash = hashRuntimeValue(plan);
  const expectedHashes = workflowHashes(plan.workflows);
  const recovery = { application: manifest.id, version: manifest.version, compositionHash };
  const textFile = (ref: string, text: string) => {
    files[ref] = Buffer.from(text).toString('base64');
  };
  textFile('application.json', canonicalRuntimeJson(manifest) + '\n');
  textFile(
    'installation.json',
    canonicalRuntimeJson({
      schema: 'comet.workflow.application.installation.v1',
      recovery,
      runtimeVersion: manifest.runtimeVersion,
      workflowHashes: expectedHashes,
      entrySkill: manifest.entrySkill,
      module: manifest.module,
      skills: manifest.skills.map(({ id, root, contentHash }) => ({ id, root, contentHash })),
      bindings: manifest.bindings,
    }) + '\n',
  );
  textFile(
    'SKILL.md',
    `---\nname: ${manifest.id}\ndescription: 启动或恢复已确认的 ${manifest.id} 工作流应用。\n---\n\n# ${manifest.id}\n\n固定组合：${compositionHash}\nRuntime：${manifest.runtimeVersion}；基础流程：${manifest.base}。\n\n用 comet runtime dispatch --application-file <本目录>/application.json --project-root <项目> --request <临时JSON> 启动下列流程：\n${plan.workflows.map(({ id, version }) => `- ${id}@${version}`).join('\n')}\n\n查询和恢复使用 --application ${manifest.id} 与原 Run ID，先 inspect 原 Action；保留 attempt、inputHash 和 claimToken。未知执行先核对结果。按返回的 skillWork 加载固定依赖并执行当前 Action；审批只沿 Runtime 当前 Wait 提交。\n流程与绑定见 application.json，安装与恢复身份见 installation.json。不能以完成字符串代替实际 Schema、候选或工件检查；检查拒绝后保留现场，修正实际产物后继续原动作。\n本包通过组合结构和实际注册实现检查；真实宿主、模型执行与完整业务验收须另行记录。\n`,
  );
  return files;
}

async function inspectAssembly(
  files: Record<string, string>,
  options: Pick<CompileWorkflowApplicationOptions, 'packageRoot' | 'projectRoot'>,
) {
  const parent = path.dirname(path.resolve(options.packageRoot));
  await fs.mkdir(parent, { recursive: true });
  const staging = await fs.mkdtemp(path.join(parent, '.comet-compile-'));
  try {
    for (const [ref, bytes] of Object.entries(files)) {
      const target = path.join(staging, ref);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(bytes, 'base64'));
    }
    const loaded = await loadWorkflowApplication({
      file: path.join(staging, 'application.json'),
      projectRoot: options.projectRoot,
    });
    for (const raw of loaded.implementation.workflows) {
      const workflow = defineWorkflow(raw);
      for (const [stepId, step] of Object.entries(workflow.steps)) {
        if (step.type !== 'invoke_skill') continue;
        // 这里只查询声明的路由；不调用 preflight、authorize 或 execute。
        const probe: RuntimeAction = {
          protocolVersion: 1,
          id: 'compilation-probe',
          runId: 'compilation-probe',
          stepId,
          type: step.type,
          ref: step.ref,
          attempt: 1,
          input: step.input ?? null,
          inputHash: hashRuntimeValue(step.input ?? null),
          status: 'pending',
          retry: step.retry,
          requiredCapabilities: step.requiredCapabilities ?? [],
          receipts: [],
          reconciliations: [],
        };
        if (
          !loaded.implementation.executors?.some(
            (executor) =>
              Boolean(executor.preflight) &&
              typeof executor.execute === 'function' &&
              executor.supports(probe) &&
              probe.requiredCapabilities.every((capability) =>
                executor.capabilities.includes(capability),
              ),
          )
        )
          applicationError(`Skill 缺少可路由且具备所需能力的执行端口：${workflow.id}/${stepId}`);
      }
    }
    return JSON.parse(
      canonicalRuntimeJson(loaded.implementation.workflows),
    ) as DefineWorkflowOptions[];
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

/** 从真实固定实现生成有效流程供用户确认；只加载工厂，不执行业务 Action。 */
export async function prepareWorkflowApplicationPlan(options: {
  proposal: WorkflowApplicationProposal;
  packageRoot: string;
  projectRoot: string;
  dependencyRoot?: string;
}): Promise<WorkflowApplicationPlan> {
  const plan = parsePlan({ ...options.proposal, workflows: [] }, false);
  const files = await assemblyFiles(plan, options.dependencyRoot);
  plan.workflows = await inspectAssembly(files, options);
  return plan;
}

/** 只装配确认的材料；不启动 Run、不执行 Action，也不覆盖已有目录。 */
export async function compileWorkflowApplication(
  options: CompileWorkflowApplicationOptions,
): Promise<CompiledWorkflowApplication> {
  const plan = parsePlan(options.plan);
  const compositionHash = hashRuntimeValue(plan);
  if (options.confirmationHash !== compositionHash)
    applicationError('方案已变化，请展示当前方案并重新确认');
  const expectedHashes = workflowHashes(plan.workflows);
  const files = await assemblyFiles(plan, options.dependencyRoot);
  const actual = await inspectAssembly(files, options);
  if (hashRuntimeValue(workflowHashes(actual)) !== hashRuntimeValue(expectedHashes))
    applicationError('实际工厂的流程与确认方案不匹配，请同步流程、转移处理器和执行绑定后重新确认');
  const destination = path.resolve(options.packageRoot);
  // mkdir 的排他创建保证错误方案、已有安装或并发编译不会覆盖用户文件。
  await fs.mkdir(destination);
  for (const [ref, bytes] of Object.entries(files)) {
    const target = path.join(destination, ref);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(bytes, 'base64'), { flag: 'wx' });
  }
  return {
    file: path.join(destination, 'application.json'),
    compositionHash,
    contentHash: applicationFilesHash(files),
    workflowHashes: expectedHashes,
  };
}
