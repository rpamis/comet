import type {
  CreateRuntimeOptions,
  RuntimeAction,
  RuntimeInvocationContext,
  RuntimeOutcome,
  RuntimeStore,
  RuntimeValue,
  WorkflowRun,
} from '../engine/runtime.js';
import type { CometHookDecision } from '../workflow-contract/hook.js';
import type { CometHookRequest } from '../../platform/process/hook-adapter.js';

export type ApplicationBase =
  'standalone' | 'native' | 'classic-full' | 'classic-hotfix' | 'classic-tweak';

/** 审查记录绑定实际字节；reviewedBy 是关联标识，不证明执行者身份。 */
export interface SkillAdapterContract {
  kind: 'guidance' | 'action' | 'check' | 'subworkflow';
  inputSchema: RuntimeValue;
  outputSchema: RuntimeValue;
  scope: string[];
  requiredCapabilities: string[];
  interaction: 'none' | 'user';
  sideEffect: 'read' | 'write' | 'external';
  controlsApproval: boolean;
  completion: 'self-report' | 'machine-check' | 'independent-review';
  failure: 'stop' | 'repair' | 'retry';
  recovery: 'manual' | 'reconcile';
  review: {
    status: 'accepted' | 'requires-review';
    reviewedBy: string;
    contentHash: string;
    capabilities: Array<{ id: string; file: string; excerpt: string }>;
    effects: Array<{ file: string; excerpt: string }>;
  };
}

export interface ApplicationSkillDependency {
  id: string;
  /** 相对应用包目录，或用户明确选择的绝对依赖目录。 */
  root: string;
  contentHash: string;
  adapter: SkillAdapterContract;
}

export interface ApplicationSkillBinding {
  workflowId: string;
  stepId: string;
  skillId: string;
  capability: string;
  usage: 'guidance' | 'action' | 'subworkflow';
  /** 有副作用的工作必须引用本 Run 的已批准 Wait，并由宿主授权适配器核对。 */
  authorizationFrom?: string;
  authorizationChoices?: string[];
  /** 本地写入范围相对此 Action 的实际工作区解析，如 activation.workspaceRoot。 */
  workspaceFrom?: string;
}

export interface WorkflowApplicationManifest {
  schema: 'comet.workflow.application.v1';
  id: string;
  version: string;
  base: ApplicationBase;
  runtimeVersion: string;
  entrySkill: string;
  /** 自包含 ESM；相对引用必须留在包内，第三方依赖须先 bundle。 */
  module: string;
  /** 应用规则引用；组合器从同一份流程声明生成并纳入固定包摘要。 */
  rule?: string;
  skills: ApplicationSkillDependency[];
  bindings: ApplicationSkillBinding[];
}

export interface InspectedSkill {
  root: string;
  contentHash: string;
  files: Readonly<Record<string, string>>;
}

export interface AdaptedSkill extends InspectedSkill {
  id: string;
  adapter: SkillAdapterContract;
  validateInput(value: RuntimeValue): void;
  validateOutput(value: RuntimeValue): void;
}

export interface WorkflowApplicationImplementation extends Omit<CreateRuntimeOptions, 'store'> {
  /** 领域可包裹 SDK Store 同步自己的投影/恢复记录；SDK Run 仍是推进权威。 */
  wrapStore?(
    store: RuntimeStore<WorkflowRun>,
    context: ApplicationIdentity,
    options?: { readOnly?: boolean },
  ): RuntimeStore<WorkflowRun>;
  /** 纯 Guard 读取同一 SDK Run；不拥有另一份流程状态。 */
  inspectHook?(
    run: Readonly<WorkflowRun>,
    request: CometHookRequest,
  ): CometHookDecision | Promise<CometHookDecision>;
}

export interface ApplicationIdentity {
  id: string;
  version: string;
  base: ApplicationBase;
  contentHash: string;
  packageRoot: string;
  projectRoot: string;
  runtimeVersion: string;
}

export interface LoadedWorkflowApplication {
  manifest: WorkflowApplicationManifest;
  identity: ApplicationIdentity;
  implementation: WorkflowApplicationImplementation;
  skills: ReadonlyMap<string, AdaptedSkill>;
  store: RuntimeStore<WorkflowRun>;
}

export interface WorkflowApplicationFactoryContext {
  /** 已核对固定应用身份的防御性快照，只用于选择兼容定义；不会改变权威 Run。 */
  existingRun?: Readonly<WorkflowRun>;
  manifest: WorkflowApplicationManifest;
  identity: ApplicationIdentity;
  skills: ReadonlyMap<string, AdaptedSkill>;
  projectRoot: string;
  packageRoot: string;
  createSkillExecutor(host: SkillExecutionHost): import('../engine/runtime.js').RuntimeExecutor;
}

/** 此接口由宿主提供；凭据留在闭包或本次 context.environment 中。 */
export interface SkillExecutionHost {
  id: string;
  capabilities: readonly string[];
  authorize(input: {
    action: Readonly<RuntimeAction>;
    run: Readonly<WorkflowRun>;
    binding: ApplicationSkillBinding;
    skill: AdaptedSkill;
    context?: RuntimeInvocationContext;
  }): Promise<boolean>;
  invokeSkill(input: {
    action: Readonly<RuntimeAction>;
    run: Readonly<WorkflowRun>;
    skill: AdaptedSkill;
    binding: ApplicationSkillBinding;
    context?: RuntimeInvocationContext;
  }): Promise<Pick<RuntimeOutcome, 'status' | 'output' | 'summary' | 'artifacts'>>;
  reconcile?(input: {
    action: Readonly<RuntimeAction>;
    run: Readonly<WorkflowRun>;
    skill: AdaptedSkill;
    context?: RuntimeInvocationContext;
  }): Promise<
    | { resolution: 'not-executed'; evidence: string }
    | { resolution: 'executed'; outcome: RuntimeOutcome }
  >;
}
