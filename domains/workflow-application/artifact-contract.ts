import path from 'node:path';
import {
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeOutcome,
  type RuntimeValue,
  type RuntimeValidator,
  type WorkflowRun,
} from '../engine/runtime.js';
import {
  inspectApplicationArtifactFiles,
  type ApplicationArtifactCheck,
} from './artifact-validator.js';
import type {
  WorkflowApplicationFactoryContext,
  WorkflowApplicationImplementation,
  WorkflowApplicationManifest,
} from './types.js';
import { applicationError } from './skill-adapter.js';

export interface ApplicationRequiredArtifact extends Omit<ApplicationArtifactCheck, 'ref'> {
  ref?: string;
  /** 从该步骤实际 output 中读取相对文件引用，如 report.ref。 */
  refFrom?: string;
  /** 已有业务输出中的实际 SHA-256；没有此字段时使用 outcome.artifacts。 */
  sha256From?: string;
}
export interface ApplicationArtifactContract {
  workflowId: string;
  stepId: string;
  artifacts: readonly ApplicationRequiredArtifact[];
  noArtifactsReason?: string;
  /** 修复步骤显式替代同一流程的这些产物证据；不能隐式绕过依赖。 */
  replaces?: readonly string[];
}
type Input = Parameters<RuntimeValidator['validate']>[0];
export function applicationArtifactWorkspace(
  projectRoot: string,
  manifest: WorkflowApplicationManifest,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): string {
  const binding = manifest.bindings.find(
    (b) => b.usage === 'action' && b.workflowId === run.workflow.id && b.stepId === action.stepId,
  );
  if (!binding?.workspaceFrom) return projectRoot;
  const workspace = field(action.input, binding.workspaceFrom);
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace))
    throw new Error('产物检查缺少当前 Action 已声明的实际工作区');
  return workspace;
}
const field = (value: unknown, selector: string): unknown =>
  selector
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === 'object' && Object.hasOwn(current, key)
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value,
    );
const key = (workflowId: string, stepId: string) => `${workflowId}/${stepId}`;
function relative(ref: unknown): asserts ref is string {
  if (
    typeof ref !== 'string' ||
    !ref ||
    ref.length > 4096 ||
    ref.includes('\\') ||
    ref.includes(':') ||
    ref.includes('\0') ||
    path.posix.isAbsolute(ref) ||
    ref.split('/').some((part) => !part || part === '.' || part === '..' || /[ .]$/u.test(part))
  )
    applicationError('产物引用必须是项目内安全相对路径');
  const forbidden = [
    '.git',
    'node_modules',
    '.agents',
    '.claude',
    '.codex',
    '.cursor',
    '.comet/runtime',
    '.comet/applications',
    '.comet/creator',
  ];
  if (
    forbidden.some(
      (prefix) => ref.toLowerCase() === prefix || ref.toLowerCase().startsWith(prefix + '/'),
    ) ||
    ['agents.md', 'agents.override.md', 'claude.md', '.comet/current-change.json'].includes(
      ref.toLowerCase(),
    )
  )
    applicationError(`产物引用不能指向控制资源：${ref}`);
}
function selector(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*$/u.test(value) ||
    value.split('.').some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))
  )
    applicationError('产物字段选择器无效');
}
export function validateApplicationArtifactContracts(
  value: unknown,
): asserts value is readonly ApplicationArtifactContract[] {
  if (!Array.isArray(value) || value.length > 256) applicationError('阶段产物契约必须是有界数组');
  const seen = new Set<string>();
  for (const raw of value) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).some(
        (name) =>
          !['workflowId', 'stepId', 'artifacts', 'noArtifactsReason', 'replaces'].includes(name),
      )
    )
      applicationError('阶段产物契约含未声明字段');
    const c = raw as ApplicationArtifactContract;
    if (
      typeof c.workflowId !== 'string' ||
      !c.workflowId.trim() ||
      typeof c.stepId !== 'string' ||
      !c.stepId.trim() ||
      seen.has(key(c.workflowId, c.stepId)) ||
      !Array.isArray(c.artifacts) ||
      c.artifacts.length > 64
    )
      applicationError('阶段产物契约缺少唯一流程、步骤或产物列表');
    seen.add(key(c.workflowId, c.stepId));
    if (
      !c.artifacts.length &&
      (typeof c.noArtifactsReason !== 'string' || !c.noArtifactsReason.trim())
    )
      applicationError(`无强制产物的阶段需要说明原因：${key(c.workflowId, c.stepId)}`);
    if (c.artifacts.length && c.noArtifactsReason !== undefined)
      applicationError('必需产物与无产物声明不能同时存在');
    if (
      c.replaces &&
      (!Array.isArray(c.replaces) ||
        c.replaces.some((id) => typeof id !== 'string' || !id.trim()) ||
        new Set(c.replaces).size !== c.replaces.length)
    )
      applicationError('替代产物的步骤声明无效');
    const refs = new Set<string>();
    for (const a of c.artifacts) {
      if (
        !a ||
        typeof a !== 'object' ||
        Object.keys(a).some(
          (name) =>
            ![
              'ref',
              'refFrom',
              'sha256From',
              'nonEmpty',
              'schema',
              'requiredText',
              'requiredHeadings',
            ].includes(name),
        ) ||
        Boolean(a.ref) === Boolean(a.refFrom)
      )
        applicationError('必需产物需要唯一的 ref 或 refFrom');
      if (a.ref !== undefined) relative(a.ref);
      if (a.refFrom !== undefined) selector(a.refFrom);
      if (a.sha256From !== undefined) selector(a.sha256From);
      const identity = a.ref ?? `output:${a.refFrom}`;
      if (refs.has(identity)) applicationError('阶段产物引用重复');
      refs.add(identity);
      if (a.nonEmpty !== undefined && typeof a.nonEmpty !== 'boolean')
        applicationError('nonEmpty 必须是布尔值');
      for (const list of [a.requiredText, a.requiredHeadings])
        if (
          list !== undefined &&
          (!Array.isArray(list) ||
            !list.length ||
            list.length > 64 ||
            list.some((text) => typeof text !== 'string' || !text.trim()))
        )
          applicationError('产物内容检查必须是非空文本数组');
    }
  }
}
export function assertApplicationArtifactContractCoverage(
  implementation: WorkflowApplicationImplementation,
  contracts: readonly ApplicationArtifactContract[],
): void {
  for (const c of contracts) {
    const workflow = implementation.workflows.find((w) => w.id === c.workflowId);
    if (!workflow?.steps[c.stepId])
      applicationError(`阶段产物契约引用不存在的步骤：${key(c.workflowId, c.stepId)}`);
    for (const id of c.replaces ?? [])
      if (!workflow.steps[id]) applicationError(`替代产物的步骤不存在：${id}`);
    if (
      c.artifacts.length &&
      !['handoff', 'invoke_skill', 'call_tool', 'child_workflow'].includes(
        workflow.steps[c.stepId].type,
      )
    )
      applicationError('必需产物必须绑定可回传结果的执行步骤');
    if (
      workflow.steps[c.stepId].type === 'child_workflow' &&
      c.artifacts.some((a) => !a.sha256From)
    )
      applicationError('子流程产物需要 sha256From，读取子流程结果中的实际摘要');
  }
}
export async function collectApplicationArtifactEvidence(
  projectRoot: string,
  contract: ApplicationArtifactContract,
  output: RuntimeValue,
) {
  const checks = contract.artifacts.map((artifact) => {
    const ref = artifact.ref ?? field(output, artifact.refFrom!);
    relative(ref);
    return { ...artifact, ref, nonEmpty: artifact.nonEmpty !== false };
  });
  const result = await inspectApplicationArtifactFiles(projectRoot, checks);
  return {
    ...result,
    artifacts: checks.map(({ ref }) => ({ uri: ref, sha256: result.artifactHashes[ref] })),
  };
}
export async function validateApplicationArtifactOutcome(
  projectRoot: string,
  contract: ApplicationArtifactContract,
  outcome: Readonly<RuntimeOutcome>,
): Promise<void> {
  if (outcome.status !== 'succeeded' || !contract.artifacts.length) return;
  const actual = await collectApplicationArtifactEvidence(projectRoot, contract, outcome.output);
  for (let i = 0; i < actual.artifacts.length; i++) {
    const evidence = actual.artifacts[i];
    const declaration = contract.artifacts[i];
    const expected = declaration.sha256From
      ? field(outcome.output, declaration.sha256From)
      : outcome.artifacts?.find((a) => a.uri === evidence.uri)?.sha256;
    if (expected !== evidence.sha256)
      throw new Error(`必需产物缺少当前结果的实际摘要或内容已变化：${evidence.uri}`);
  }
}
export async function assertApplicationArtifactDependencies(
  projectRoot: string,
  contracts: readonly ApplicationArtifactContract[],
  run: Readonly<WorkflowRun>,
  stepId: string,
  results: WorkflowRun['outputs'],
  manifest?: WorkflowApplicationManifest,
): Promise<void> {
  const relevant = contracts.filter((c) => c.workflowId === run.workflow.id);
  const replaced = new Set(relevant.find((c) => c.stepId === stepId)?.replaces ?? []);
  for (const c of relevant)
    if (results[c.stepId])
      for (const id of c.replaces ?? [])
        if (results[c.stepId].sequence > (results[id]?.sequence ?? -1)) replaced.add(id);
  for (const c of relevant) {
    const source = results[c.stepId];
    if (!source || !c.artifacts.length || replaced.has(c.stepId)) continue;
    const producer = run.actions.find(
      (a) =>
        a.stepId === c.stepId &&
        ['succeeded', 'failed'].includes(a.status) &&
        run.actionContexts[a.id]?.sequence === source.sequence,
    );
    if (
      !producer?.outcome ||
      hashRuntimeValue(producer.outcome.output) !== hashRuntimeValue(source.value)
    )
      throw new Error(`依赖产物没有对应的原 Action 证据：${c.stepId}`);
    await validateApplicationArtifactOutcome(
      manifest ? applicationArtifactWorkspace(projectRoot, manifest, run, producer) : projectRoot,
      c,
      producer.outcome,
    );
  }
}
export function applyApplicationArtifactContracts(
  implementation: WorkflowApplicationImplementation,
  context: Pick<WorkflowApplicationFactoryContext, 'manifest' | 'projectRoot'>,
): WorkflowApplicationImplementation {
  const contracts = context.manifest.artifactContracts;
  if (contracts === undefined) return implementation;
  validateApplicationArtifactContracts(contracts);
  assertApplicationArtifactContractCoverage(implementation, contracts);
  const find = (run: Readonly<WorkflowRun>, stepId: string) =>
    contracts.find((c) => c.workflowId === run.workflow.id && c.stepId === stepId);
  const check = async (input: Input) => {
    if (input.outcome.status === 'succeeded')
      await assertApplicationArtifactDependencies(
        context.projectRoot,
        contracts,
        input.run,
        input.action.stepId,
        input.run.actionContexts[input.action.id]?.results ?? {},
        context.manifest,
      );
    const contract = find(input.run, input.action.stepId);
    if (contract)
      await validateApplicationArtifactOutcome(
        applicationArtifactWorkspace(
          context.projectRoot,
          context.manifest,
          input.run,
          input.action,
        ),
        contract,
        input.outcome,
      );
  };
  return {
    ...implementation,
    executors: implementation.executors?.map((executor) => ({
      ...executor,
      ...(executor.preflight
        ? {
            async preflight(
              action: Parameters<NonNullable<typeof executor.preflight>>[0],
              invocation: Parameters<NonNullable<typeof executor.preflight>>[1],
              run: Parameters<NonNullable<typeof executor.preflight>>[2],
            ) {
              if (run)
                await assertApplicationArtifactDependencies(
                  context.projectRoot,
                  contracts,
                  run,
                  action.stepId,
                  run.actionContexts[action.id]?.results ?? {},
                  context.manifest,
                );
              await executor.preflight?.(action, invocation, run);
            },
          }
        : {}),
      async execute(action, invocation, run) {
        const result = await executor.execute(action, invocation, run);
        const contract = run ? find(run, action.stepId) : undefined;
        if (!contract?.artifacts.length || result.status !== 'succeeded') return result;
        // 收集真实字节作为原 Outcome 的证据；失败不把缺少产物伪装成成功。
        try {
          const actual = await collectApplicationArtifactEvidence(
            applicationArtifactWorkspace(context.projectRoot, context.manifest, run!, action),
            contract,
            result.output,
          );
          return {
            ...result,
            artifacts: [
              ...(result.artifacts ?? []).filter(
                (a) => !actual.artifacts.some((b) => b.uri === a.uri),
              ),
              ...actual.artifacts,
            ],
          };
        } catch {
          return result;
        }
      },
    })),
    validators: implementation.validators?.map((validator) => ({
      ...validator,
      async validate(input) {
        const verdict = await validator.validate(input);
        if (!verdict.accepted) return verdict;
        try {
          await check(input);
          return verdict;
        } catch (error) {
          return {
            accepted: false,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      },
    })),
    async validateOutcome(input) {
      try {
        await check(input);
        const verdict = (await implementation.validateOutcome?.(input)) ?? { accepted: true };
        if (verdict.accepted) await check(input);
        return verdict;
      } catch (error) {
        return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
