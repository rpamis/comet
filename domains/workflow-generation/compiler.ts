import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
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
import { renderApplicationRule } from './application-rule.js';
import {
  validateApplicationDocuments,
  validateApplicationDocumentLinks,
} from './application-documents.js';

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
      kind: 'standalone';
      workflows: DefineWorkflowOptions[];
      transitionHandlers: Array<{
        id: string;
        version: string;
        module: string;
        exportName: string;
        /** 使用公开SDK的hashRuntimeValue(moduleSource)固定完整源码字符串。 */
        sourceHash: string;
      }>;
      executorIds: string[];
      validatorRefs: Array<{ id: string; version: string }>;
    }
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
  documents?: Readonly<Record<string, string>>;
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
        rule: { const: 'rules/workflow-guard.md' },
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
    documents: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } },
    composition: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'workflows', 'transitionHandlers', 'executorIds', 'validatorRefs'],
          properties: {
            kind: { const: 'standalone' },
            workflows: { type: 'array', minItems: 1, items: { type: 'object' } },
            transitionHandlers: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'version', 'module', 'exportName', 'sourceHash'],
                properties: {
                  id: textSchema,
                  version: textSchema,
                  module: textSchema,
                  exportName: { type: 'string', pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$' },
                  sourceHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                },
              },
            },
            executorIds: { type: 'array', uniqueItems: true, items: textSchema },
            validatorRefs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'version'],
                properties: { id: textSchema, version: textSchema },
              },
            },
          },
        },
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

// 两种私有固定 Schema 按需编译；每次仍验证当前方案，互不共享必填流程的约束。
const planValidators = new Map<boolean, { ajv: Ajv; validate: ValidateFunction }>();

function parsePlan(value: unknown, requireWorkflows = true): WorkflowApplicationPlan {
  try {
    const parsed =
      typeof value === 'string' ? JSON.parse(value) : JSON.parse(canonicalRuntimeJson(value));
    let compiled = planValidators.get(requireWorkflows);
    if (!compiled) {
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
      compiled = { ajv, validate };
      planValidators.set(requireWorkflows, compiled);
    }
    const { ajv, validate } = compiled;
    if (!validate(parsed)) applicationError(`组合方案结构无效：${ajv.errorsText(validate.errors)}`);
    const plan = parsed as WorkflowApplicationPlan;
    validateApplicationDocuments(plan.documents, plan.manifest.id, [
      'SKILL.md',
      'rules/workflow-guard.md',
      'application.json',
      'installation.json',
      'application.mjs',
      ...Object.keys(plan.modules),
    ]);
    return plan;
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
  if (kind === 'standalone') {
    if (plan.manifest.base !== 'standalone' || !plan.modules['bindings.mjs'])
      applicationError('独立组合需要standalone基础流程与固定bindings.mjs');
    const imports: string[] = [];
    const registrations: string[] = [];
    for (const [index, handler] of composition.transitionHandlers.entries()) {
      moduleRef(handler.module);
      const source = plan.modules[handler.module];
      if (!source || hashRuntimeValue(source) !== handler.sourceHash)
        applicationError(`转移处理器源码摘要不匹配：${handler.id}`);
      imports.push(
        `import { ${handler.exportName} as handler${index} } from './${handler.module}';`,
      );
      registrations.push(
        `{ id:${JSON.stringify(handler.id)},version:${JSON.stringify(handler.version)},apply:handler${index} }`,
      );
    }
    return `import { createStandaloneApplication } from '@rpamis/comet/applications';\nimport { createBindings } from './bindings.mjs';\n${imports.join('\n')}\nconst composition=${canonicalRuntimeJson(composition)};\nexport async function createApplication(context) {\nconst ports=await createBindings(context);\nfor (const key of Object.keys(ports)) if (!['executors','validators','inspectHook'].includes(key)) throw new Error('独立执行端口不能覆盖流程与转移处理器');\nif (ports.inspectHook !== undefined && typeof ports.inspectHook !== 'function') throw new Error('inspectHook 必须是固定的 Guard 函数');\nconst implementation=createStandaloneApplication({workflows:composition.workflows,executorIds:composition.executorIds,validatorRefs:composition.validatorRefs,executors:ports.executors??[],validators:ports.validators??[],transitionHandlers:[${registrations.join(',')}]});\nreturn ports.inspectHook === undefined ? implementation : {...implementation,inspectHook:ports.inspectHook};\n}\n`;
  }
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
  if (plan.documents) manifest.rule ??= 'rules/workflow-guard.md';
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
  if (manifest.rule) {
    const rule = renderApplicationRule(manifest, plan.workflows);
    textFile(
      manifest.rule,
      plan.documents ? plan.documents[manifest.rule] + '\n\n## SDK 通用规则\n\n' + rule : rule,
    );
  }
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
  const skillLoading = manifest.bindings.length
    ? '\n当前 Action 返回 skillWork 或当前 Wait 返回 waitSkillWork 时，逐项读取 skill.files["SKILL.md"] 的真实 name；没有 name 时按该固定目录的宿主命名规则确定，无法确定时阻塞。skill.id 只是逻辑绑定，不能用应用名称或别名代替实际 Skill 名称。\n\n**立即执行：** 使用 Skill 工具加载 <skill-name> 技能。禁止跳过此步骤。\n\n技能加载后，核对实际加载来源对应当前 skill.root，并核对 SKILL.md、脚本和资源的完整内容摘要与 skill.contentHash 一致；同名不能代替固定版本。宿主无法加载该固定版本时阻塞，保留原 Action。核对通过后，Action 保留 actionId、attempt、inputHash；Wait 保留 waitId、proposalHash，不能把等待点当作 Action 领取。传递当前输入、范围和固定指导，执行工作后提交真实结果；等待点指导不等同用户决定或 machine-check 证据，审批仍只提交当前 Wait 的用户决定。\n'
    : '';
  const protocol = `固定组合：${compositionHash}\nRuntime：${manifest.runtimeVersion}；基础流程：${manifest.base}。\n\n用 comet runtime dispatch --application-file <本目录>/application.json --project-root <项目> --request <临时JSON> 启动下列流程：\n${plan.workflows.map(({ id, version }) => `- ${id}@${version}`).join('\n')}\n\n查询和恢复使用 --application ${manifest.id} 与原 Run ID，先 inspect 原 Action；保留 attempt、inputHash 和 claimToken。未知执行先核对结果。审批只沿 Runtime 当前 Wait 提交。\n${skillLoading}\n流程与绑定见 application.json，安装与恢复身份见 installation.json。不能以完成字符串代替实际 Schema、候选或工件检查；检查拒绝后保留现场，修正实际产物后继续原动作。\n本包通过组合结构和实际注册实现检查；真实宿主、模型执行与完整业务验收须另行记录。\n`;
  textFile(
    'SKILL.md',
    plan.documents
      ? plan.documents['SKILL.md'] + '\n\n## SDK 执行协议\n\n' + protocol
      : `---\nname: ${manifest.id}\ndescription: 启动或恢复已确认的 ${manifest.id} 工作流应用。\n---\n\n# ${manifest.id}\n\n` +
          protocol,
  );
  for (const [ref, content] of Object.entries(plan.documents ?? {})) {
    if (ref !== 'SKILL.md' && ref !== manifest.rule) textFile(ref, content);
  }
  if (manifest.rule) {
    const entry = Buffer.from(files['SKILL.md'], 'base64').toString('utf8');
    files['SKILL.md'] = Buffer.from(
      entry +
        `\n执行前读取[应用规则](${manifest.rule})。Rule 与流程和写入声明一起生成；宿主集成通过正式安装预览部署。\n`,
    ).toString('base64');
  }
  validateApplicationDocumentLinks(plan.documents, files);
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
  plan.manifest.rule = 'rules/workflow-guard.md';
  const files = await assemblyFiles(plan, options.dependencyRoot);
  plan.workflows = await inspectAssembly(files, options);
  return plan;
}

/** 核对编译/恢复的实际字节与确认方案；此查询不生成包或执行业务动作。 */
export async function hashWorkflowApplicationPlanContent(
  plan: unknown,
  dependencyRoot?: string,
): Promise<string> {
  return applicationFilesHash(await assemblyFiles(parsePlan(plan), dependencyRoot));
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
