import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire, isBuiltin } from 'node:module';
import { init, parse } from 'es-module-lexer';
import {
  createFileRuntimeStore,
  createRuntime,
  defineWorkflow,
  hashRuntimeValue,
  RuntimeProtocolError,
  type RuntimeStore,
  type WorkflowRun,
} from '../engine/runtime.js';
import { getCurrentVersion } from '../../platform/version/version.js';
import {
  readCometCurrentSelection,
  writeCometCurrentSelection,
} from '../workflow-contract/current-selection.js';
import {
  SDK_APPLICATIONS,
  readChangeRuntimeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import {
  adaptApplicationSkill,
  applicationError,
  applicationFilesHash,
  readApplicationFiles,
} from './skill-adapter.js';
import type {
  AdaptedSkill,
  ApplicationIdentity,
  LoadedWorkflowApplication,
  WorkflowApplicationImplementation,
  WorkflowApplicationManifest,
} from './types.js';
import {
  assertApplicationSkillExecutionScope,
  assertApplicationSkillAction,
  createApplicationSkillExecutor,
} from './skill-executor.js';
import { resolveInstalledWorkflowApplication } from './installed-application.js';
import { projectWorkflowApplicationRun } from './run-view.js';

interface ApplicationRunRecord {
  runId: string;
  revision: number;
  application: ApplicationIdentity;
  run: WorkflowRun;
}

const loadedModules = new Map<string, string>();

function safeId(id: string): string {
  if (typeof id !== 'string' || !/^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(id))
    applicationError('应用身份必须是小写名称');
  return id;
}

function rawStore(projectRoot: string, id: string) {
  return createFileRuntimeStore<ApplicationRunRecord>({
    rootDir: path.join(projectRoot, '.comet/runtime/applications', safeId(id)),
    mirroredRevisionPaths: ['run.revision'],
  });
}

/** 只读取保存的进度；不加载应用代码、不恢复记录，也不更新领域投影。 */
export async function readWorkflowApplicationRun(
  projectRoot: string,
  applicationId: string,
  runId: string,
): Promise<WorkflowRun | null> {
  const record = await rawStore(projectRoot, applicationId).read(runId);
  if (!record) return null;
  if (
    record.application.id !== applicationId ||
    record.runId !== record.run.runId ||
    record.revision !== record.run.revision
  )
    throw new RuntimeProtocolError('INVALID_RUN', '应用归属与 SDK Run 不一致');
  return record.run;
}

export function parseWorkflowApplicationManifest(value: unknown): WorkflowApplicationManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    applicationError('应用文件必须是 JSON 对象');
  const manifest = value as WorkflowApplicationManifest;
  if (manifest.schema !== 'comet.workflow.application.v1')
    applicationError('应用格式不受支持，请重新生成 SDK 应用；原文件会保留');
  safeId(manifest.id);
  if ((SDK_APPLICATIONS as readonly string[]).includes(manifest.id))
    applicationError(`应用身份 ${manifest.id} 与内置应用冲突，请使用独立名称`);
  if (
    !manifest.version?.trim() ||
    !['standalone', 'native', 'classic-full', 'classic-hotfix', 'classic-tweak'].includes(
      manifest.base,
    ) ||
    !manifest.runtimeVersion?.trim() ||
    !manifest.entrySkill?.trim() ||
    !manifest.module?.endsWith('.mjs') ||
    !Array.isArray(manifest.skills) ||
    !Array.isArray(manifest.bindings)
  )
    applicationError('应用定义缺少版本、基础流程、入口或绑定');
  return manifest;
}

/** Run 内的不可变归属是恢复依据；current 文件只是选择投影。 */
export async function resolveWorkflowApplicationFile(
  projectRoot: string,
  id: string,
  runId: string,
): Promise<string> {
  const record = await rawStore(await fs.realpath(projectRoot), id).read(runId);
  if (record) return path.join(record.application.packageRoot, 'application.json');
  return (
    (await resolveInstalledWorkflowApplication({ projectRoot, scope: 'project' }, safeId(id))) ??
    (await resolveInstalledWorkflowApplication({ projectRoot, scope: 'user' }, safeId(id))) ??
    path.join(projectRoot, '.comet/applications', safeId(id), 'application.json')
  );
}

export async function loadWorkflowApplication(options: {
  file: string;
  projectRoot: string;
  runId?: string;
  /** 领域从 portable checkpoint 恢复时，在执行模块加载前核对原固定身份。 */
  expectedIdentity?: ApplicationIdentity;
  /** 显式迁移只请求当前定义；仍先核对同一 Run 的固定身份，不修改保存记录。 */
  useLatestDefinition?: boolean;
  /** 诊断不恢复 Run，也不写回领域投影。 */
  readOnly?: boolean;
}): Promise<LoadedWorkflowApplication> {
  const projectRoot = await fs.realpath(options.projectRoot);
  const file = path.resolve(options.file);
  if (path.basename(file) !== 'application.json')
    applicationError('应用入口文件必须命名为 application.json');
  const packageRoot = await fs.realpath(path.dirname(file));
  if (packageRoot === projectRoot) applicationError('应用包须放在独立目录，不能包含项目的运行状态');
  const files = await readApplicationFiles(packageRoot);
  const manifest = parseWorkflowApplicationManifest(
    JSON.parse(Buffer.from(files['application.json'] ?? '', 'base64').toString('utf8')),
  );
  const version = getCurrentVersion();
  if (manifest.runtimeVersion !== version)
    applicationError(`应用要求 Runtime ${manifest.runtimeVersion}，当前是 ${version}`);
  if (!files[manifest.entrySkill] || !files[manifest.module])
    applicationError('应用入口 Skill 或执行模块缺失');
  const skills = new Map<string, AdaptedSkill>();
  for (const dependency of manifest.skills) {
    if (skills.has(dependency.id)) applicationError(`重复 Skill 身份：${dependency.id}`);
    skills.set(dependency.id, await adaptApplicationSkill(dependency, packageRoot));
  }
  const identity: ApplicationIdentity = {
    id: manifest.id,
    version: manifest.version,
    base: manifest.base,
    runtimeVersion: version,
    projectRoot,
    packageRoot,
    contentHash: hashRuntimeValue({
      package: applicationFilesHash(files),
      skills: [...skills.values()].map((skill) => ({
        id: skill.id,
        contentHash: skill.contentHash,
      })),
    }),
  };
  const assertCurrentMaterial = async () => {
    const currentFiles = await readApplicationFiles(packageRoot);
    const currentSkills = await Promise.all(
      manifest.skills.map((dependency) => adaptApplicationSkill(dependency, packageRoot)),
    );
    const hash = hashRuntimeValue({
      package: applicationFilesHash(currentFiles),
      skills: currentSkills.map((skill) => ({ id: skill.id, contentHash: skill.contentHash })),
    });
    if (hash !== identity.contentHash)
      throw new RuntimeProtocolError(
        'WORKFLOW_CHANGED',
        '运行中的应用或依赖发生漂移；恢复原内容后继续原 Action',
      );
  };
  if (
    options.expectedIdentity &&
    hashRuntimeValue(identity) !== hashRuntimeValue(options.expectedIdentity)
  )
    throw new RuntimeProtocolError('WORKFLOW_CHANGED', '恢复需要原固定应用包、依赖和工作区');
  const persistent = rawStore(projectRoot, manifest.id);
  const assertIdentity = (record: ApplicationRunRecord) => {
    if (hashRuntimeValue(record.application) !== hashRuntimeValue(identity))
      throw new RuntimeProtocolError(
        'WORKFLOW_CHANGED',
        '应用定义、执行/验证绑定、Skill 或工作区归属发生变化；请恢复原应用包和依赖后继续原 Run',
      );
    if (record.revision !== record.run.revision || record.runId !== record.run.runId)
      throw new RuntimeProtocolError('INVALID_RUN', '应用归属与 SDK Run 不一致');
  };
  let existingRun: WorkflowRun | undefined;
  // 先核对固定身份再 import，漂移的代码不会在恢复请求中执行。
  if (options.runId) {
    const existing = await persistent.read(options.runId);
    if (existing) {
      assertIdentity(existing);
      existingRun = structuredClone(existing.run);
    }
  }
  await init;
  for (const [ref, encoded] of Object.entries(files)) {
    if (!ref.endsWith('.mjs')) continue;
    const source = Buffer.from(encoded, 'base64').toString('utf8');
    for (const imported of parse(source)[0]) {
      if (imported.d === -2) continue;
      const specifier = imported.n;
      if (!specifier) applicationError(`应用模块不能动态选择未固定的导入：${ref}`);
      if (
        isBuiltin(specifier) ||
        specifier === '@rpamis/comet/runtime' ||
        specifier === '@rpamis/comet/applications' ||
        specifier === '@rpamis/comet/applications/compiler' ||
        specifier === '@rpamis/comet/applications/native' ||
        specifier === '@rpamis/comet/applications/classic'
      )
        continue;
      if (!specifier.startsWith('.'))
        applicationError(`应用模块依赖未固定：${ref} -> ${specifier}，请 bundle 后再加载`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(ref), specifier));
      if (!files[target] || target.startsWith('../'))
        applicationError(`应用模块依赖缺失或越过包目录：${ref} -> ${specifier}`);
      if (!target.endsWith('.mjs') && !target.endsWith('.json'))
        applicationError(
          `执行依赖必须是可检查的 .mjs 或 JSON：${ref} -> ${specifier}，请先 bundle`,
        );
    }
  }
  const priorHash = loadedModules.get(packageRoot);
  if (priorHash && priorHash !== identity.contentHash)
    applicationError('当前进程已加载不同的应用实现，请在新进程加载新版本');
  loadedModules.set(packageRoot, identity.contentHash);
  const module = createRequire(file)(path.join(packageRoot, manifest.module));
  if (typeof module.createApplication !== 'function')
    applicationError('应用模块必须导出 createApplication');
  const implementation: WorkflowApplicationImplementation = await module.createApplication({
    ...(existingRun && !options.useLatestDefinition ? { existingRun } : {}),
    manifest,
    skills,
    projectRoot,
    packageRoot,
    identity,
    createSkillExecutor: (host: Parameters<typeof createApplicationSkillExecutor>[1]) =>
      createApplicationSkillExecutor({ manifest, skills }, host),
  });
  if (
    !implementation ||
    !Array.isArray(implementation.workflows) ||
    !implementation.workflows.length
  )
    applicationError('应用模块必须提供完整 SDK 工作流');
  const workflows = implementation.workflows.map(defineWorkflow);
  const bindingKeys = new Set<string>();
  for (const binding of manifest.bindings) {
    const key = `${binding.workflowId}/${binding.stepId}/${binding.usage}${binding.usage === 'guidance' ? `/${binding.skillId}` : ''}`;
    if (
      binding.workspaceFrom !== undefined &&
      !/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)*$/u.test(binding.workspaceFrom)
    )
      applicationError(`工作区输入路径无效：${key}`);
    if (bindingKeys.has(key)) applicationError(`重复 Skill 绑定：${key}`);
    bindingKeys.add(key);
    const workflow = workflows.find((workflow) => workflow.id === binding.workflowId);
    const step = workflow?.steps[binding.stepId];
    const skill = skills.get(binding.skillId);
    if (!step || !skill) applicationError(`绑定的工作或 Skill 不存在：${key}`);
    if (
      !binding.capability?.trim() ||
      !skill.adapter.review.capabilities.some((capability) => capability.id === binding.capability)
    )
      applicationError(`真实 Skill 没有已审查的所需能力：${key}`);
    if (binding.usage === 'guidance') {
      if (skill.adapter.kind !== 'guidance')
        applicationError('只有只读指导 Skill 可附加为 guidance');
      continue;
    }
    if (binding.usage === 'subworkflow') {
      if (skill.adapter.kind !== 'subworkflow' || step.type !== 'child_workflow')
        applicationError('完整流程必须绑定显式 child_workflow');
      continue;
    }
    if (
      binding.usage !== 'action' ||
      !['action', 'check'].includes(skill.adapter.kind) ||
      step.type !== 'invoke_skill' ||
      step.ref !== binding.skillId
    )
      applicationError(`Skill 工作类型或引用不匹配：${key}`);
    if (skill.adapter.controlsApproval) applicationError('接管审批的 Skill 必须适配为隔离的子流程');
    if (
      step.outputSchema === undefined ||
      hashRuntimeValue(step.outputSchema) !== hashRuntimeValue(skill.adapter.outputSchema)
    )
      applicationError(`Skill 输出与工作流契约不匹配：${key}`);
    if (
      skill.adapter.completion !== 'self-report' &&
      (!step.validator ||
        !implementation.validators?.some(
          (validator) =>
            validator.id === step.validator?.id && validator.version === step.validator.version,
        ))
    )
      applicationError(`机器检查或独立评审需要真实验证器：${key}`);
    if (
      skill.adapter.requiredCapabilities.some(
        (capability) => !step.requiredCapabilities?.includes(capability),
      )
    )
      applicationError(`Skill 必需宿主能力未传到 Action：${key}`);
    if (skill.adapter.sideEffect !== 'read') {
      const approval = binding.authorizationFrom
        ? workflow!.steps[binding.authorizationFrom]
        : undefined;
      const allowed = binding.authorizationChoices ?? ['approved'];
      if (
        approval?.type !== 'ask_user' ||
        !Array.isArray(allowed) ||
        !allowed.length ||
        allowed.some((choice) => typeof choice !== 'string' || !approval.choices.includes(choice))
      )
        applicationError(`有副作用的 Skill 缺少有效父流程审批：${key}`);
    }
    if (skill.adapter.sideEffect === 'external' && step.retry !== 'reconcile')
      applicationError(`外部 Skill 必须先核对再重试：${key}`);
  }
  for (const workflow of workflows) {
    const registered = <T extends { id: string; version: string }>(
      reference: { id: string; version: string } | undefined,
      entries: readonly T[] | undefined,
      label: string,
    ) => {
      if (
        reference &&
        !entries?.some((entry) => entry.id === reference.id && entry.version === reference.version)
      )
        applicationError(`${label} 未注册固定实现：${reference.id}@${reference.version}`);
    };
    registered(workflow.transitionHandler, implementation.transitionHandlers, '转移处理器');
    registered(workflow.stateValidator, implementation.stateValidators, '状态验证器');
    for (const command of Object.values(workflow.commands ?? {}))
      registered(command.validator, implementation.commandValidators, '命令验证器');
    for (const [stepId, step] of Object.entries(workflow.steps)) {
      if (step.type === 'await_evidence')
        registered(step.validator, implementation.evidenceValidators, '证据验证器');
      else registered(step.validator, implementation.validators, '工作验证器');
      if (
        step.type === 'invoke_skill' &&
        !manifest.bindings.some(
          (binding) =>
            binding.workflowId === workflow.id &&
            binding.stepId === stepId &&
            binding.usage === 'action',
        )
      )
        applicationError(`Skill Action 缺少适配绑定：${workflow.id}/${stepId}`);
    }
    const mutations = manifest.bindings.filter(
      (binding) =>
        binding.workflowId === workflow.id &&
        binding.usage === 'action' &&
        skills.get(binding.skillId)!.adapter.sideEffect !== 'read',
    );
    const reaches = (from: string, to: string, visited = new Set<string>()): boolean => {
      if (from === to) return true;
      if (visited.has(from)) return false;
      visited.add(from);
      return workflow.transitions.some(
        (edge) => edge.from === from && reaches(edge.to, to, visited),
      );
    };
    for (let i = 0; i < mutations.length; i++)
      for (const other of mutations.slice(i + 1)) {
        const current = mutations[i];
        if (
          skills.get(current.skillId)!.adapter.sideEffect === 'write' &&
          skills.get(other.skillId)!.adapter.sideEffect === 'write' &&
          Boolean(current.workspaceFrom) !== Boolean(other.workspaceFrom) &&
          !reaches(current.stepId, other.stepId) &&
          !reaches(other.stepId, current.stepId)
        )
          applicationError(
            `并行写入不能混用声明工作区和默认范围：${current.stepId} / ${other.stepId}`,
          );
        if (
          !current.workspaceFrom &&
          !other.workspaceFrom &&
          skills
            .get(current.skillId)!
            .adapter.scope.some((scope) =>
              skills.get(other.skillId)!.adapter.scope.includes(scope),
            ) &&
          !reaches(current.stepId, other.stepId) &&
          !reaches(other.stepId, current.stepId)
        )
          applicationError(
            `并行 Skill 的写入范围冲突：${current.stepId} / ${other.stepId}，请声明隔离或执行顺序`,
          );
      }
  }
  const assertWritable = () => {
    if (options.readOnly)
      throw new RuntimeProtocolError('READ_ONLY_OPERATION', '应用诊断不能恢复或推进 Run');
  };
  const pinnedStore: RuntimeStore<WorkflowRun> = {
    async read(runId) {
      await assertCurrentMaterial();
      const record = await persistent.read(runId);
      if (!record) return null;
      assertIdentity(record);
      return record.run;
    },
    async restoreCheckpoint(runId, expectedRevision, run) {
      assertWritable();
      await assertCurrentMaterial();
      const record = await persistent.read(runId);
      if (record) assertIdentity(record);
      if (run.runId !== runId || run.actions.some((action) => action.status === 'running')) {
        throw new RuntimeProtocolError(
          'INVALID_RUN',
          '应用恢复必须使用同一 Run 的 portable checkpoint，活跃领取须先转为 unknown',
        );
      }
      const workflow =
        manifest.base === 'native'
          ? 'native'
          : manifest.base.startsWith('classic-')
            ? 'classic'
            : null;
      if (workflow) {
        const owner = await readChangeRuntimeOwner(projectRoot, workflow, runId);
        if (
          !owner ||
          owner.format !== 'sdk' ||
          owner.application !== identity.id ||
          owner.runId !== runId
        ) {
          throw new RuntimeProtocolError(
            'INVALID_RUN',
            '恢复 Run 前须验证相同的固定应用和 change 归属',
          );
        }
      }
      const restored = { runId, revision: run.revision, application: identity, run };
      assertIdentity(restored);
      return persistent.restoreCheckpoint!(runId, expectedRevision, restored);
    },
    async compareAndSwap(runId, expectedRevision, run) {
      assertWritable();
      await assertCurrentMaterial();
      const record = await persistent.read(runId);
      if (record) assertIdentity(record);
      for (const action of run.actions) {
        if (
          action.status === 'running' &&
          !record?.run.actions.some(
            (previous) =>
              previous.id === action.id &&
              previous.status === 'running' &&
              previous.claim?.token === action.claim?.token,
          )
        ) {
          assertApplicationSkillExecutionScope({ manifest, skills }, run, action);
          if (action.type === 'invoke_skill') {
            assertApplicationSkillAction({ manifest, skills }, action, run);
            const executor = implementation.executors?.find(
              (executor) => executor.id === action.claim?.executorId,
            );
            if (!executor)
              throw new RuntimeProtocolError(
                'EXECUTOR_UNAVAILABLE',
                'Skill 必须由应用已配置的执行端口领取',
              );
            if (!executor.supports(structuredClone(action)) || !executor.preflight)
              throw new RuntimeProtocolError(
                'EXECUTOR_UNSUPPORTED',
                'Skill 执行端口缺少对应的领取预检',
              );
            if (
              action.requiredCapabilities.some(
                (capability) => !executor.capabilities.includes(capability),
              )
            )
              throw new RuntimeProtocolError(
                'CAPABILITY_REQUIRED',
                '已配置执行端口缺少 Skill 所需能力',
              );
          }
        }
      }
      return persistent.compareAndSwap(runId, expectedRevision, {
        runId,
        revision: run.revision,
        application: identity,
        run,
      });
    },
  };
  const store = implementation.wrapStore
    ? implementation.wrapStore(pinnedStore, identity, { readOnly: options.readOnly })
    : pinnedStore;
  if (options.runId && !existingRun && !options.readOnly && implementation.wrapStore) {
    // portable 恢复写回原记录后重新选择固定定义，避免第一次恢复误用新版图。
    const recovered = await store.read(options.runId);
    const persisted = recovered ? await persistent.read(options.runId) : null;
    if (persisted) {
      assertIdentity(persisted);
      return loadWorkflowApplication(options);
    }
  }
  const checkedImplementation: WorkflowApplicationImplementation = {
    ...implementation,
    async validateOutcome(input) {
      if (input.action.type === 'invoke_skill') {
        try {
          assertApplicationSkillAction({ manifest, skills }, input.action, input.run);
        } catch (error) {
          return {
            accepted: false,
            reason: error instanceof Error ? error.message : 'Skill 结果不满足应用契约',
          };
        }
      }
      return implementation.validateOutcome?.(input) ?? { accepted: true };
    },
  };
  // SDK 自身校验所有 handler、validator、executor 身份；只装载图不足以通过这里。
  createRuntime({ ...checkedImplementation, store });
  return { manifest, identity, implementation: checkedImplementation, skills, store };
}

export async function selectWorkflowApplication(
  application: LoadedWorkflowApplication,
  runId: string,
): Promise<void> {
  await writeCometCurrentSelection(application.identity.projectRoot, {
    schema: 'comet.selection.v2',
    workflow: 'application',
    applicationId: application.identity.id,
    change: runId,
    branch: null,
  });
}

export async function inspectWorkflowApplicationRun(
  projectRoot: string,
  applicationId: string,
  runId: string,
  options: { readOnly?: boolean } = {},
): Promise<{ application: LoadedWorkflowApplication; run: WorkflowRun }> {
  const application = await loadWorkflowApplication({
    projectRoot,
    file: await resolveWorkflowApplicationFile(projectRoot, applicationId, runId),
    runId,
    readOnly: options.readOnly,
  });
  if (application.identity.id !== applicationId)
    throw new RuntimeProtocolError('INVALID_RUN', '应用选择与固定 Run 归属不一致');
  const run = await createRuntime({
    ...application.implementation,
    store: application.store,
  }).inspect(runId);
  return { application, run };
}

export async function readSelectedWorkflowApplication(
  projectRoot: string,
): Promise<{ application: LoadedWorkflowApplication; run: WorkflowRun } | null> {
  const current = await readCometCurrentSelection(projectRoot);
  if (current.status !== 'selected' || current.selection.workflow !== 'application') return null;
  return inspectWorkflowApplicationRun(
    projectRoot,
    current.selection.applicationId!,
    current.selection.change,
  );
}

/** 保留当前选择的身份，即使固定包或 Run 损坏也不把它显示为没有任务。 */
export async function inspectSelectedWorkflowApplicationStatus(projectRoot: string) {
  const current = await readCometCurrentSelection(projectRoot);
  if (current.status !== 'selected' || current.selection.workflow !== 'application') return null;
  const { applicationId, change: name } = current.selection;
  const inspection = {
    commandArgs: [
      'comet',
      'runtime',
      'dispatch',
      '--application',
      applicationId!,
      '--project-root',
      projectRoot,
      '--request',
      '<request-file>',
      '--json',
    ],
    request: { operation: 'inspect' as const, runId: name },
  };
  const common = { name, applicationId: applicationId!, selected: true as const, inspection };
  try {
    const { application, run } = await inspectWorkflowApplicationRun(
      projectRoot,
      applicationId!,
      name,
      { readOnly: true },
    );
    return {
      ...common,
      healthy:
        run.status !== 'failed' && !run.actions.some((action) => action.status === 'unknown'),
      application: application.identity,
      run: projectWorkflowApplicationRun(application, run),
    };
  } catch (error) {
    return {
      ...common,
      healthy: false,
      error: {
        code: error instanceof RuntimeProtocolError ? error.code : 'APPLICATION_UNAVAILABLE',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export type SelectedWorkflowApplicationStatus = NonNullable<
  Awaited<ReturnType<typeof inspectSelectedWorkflowApplicationStatus>>
>;
