import { matchesWorkflowApplicationDefinition } from '../workflow-application/index.js';
import type {
  ApplicationRunRecord,
  WorkflowApplicationDefinition,
  WorkflowApplicationManifest,
} from '../workflow-application/index.js';
import type {
  DashboardApplicationDefinition,
  DashboardApplicationRecord,
} from './application-types.js';

/** 定义只提供计划结构；状态与轮次均来自同一 Run 的实际记录。 */
export function projectDashboardApplicationDefinition(options: {
  run: ApplicationRunRecord['run'];
  records: DashboardApplicationRecord[];
  material: {
    status: 'matched' | 'changed' | 'unavailable';
    definition?: WorkflowApplicationDefinition;
    manifest?: WorkflowApplicationManifest;
    message?: string;
  } | null;
}): DashboardApplicationDefinition {
  const { run, records, material } = options;
  if (!material) return { status: 'missing' };
  if (material.status !== 'matched') return { status: material.status, message: material.message };
  const definition = material.definition;
  if (!definition) return { status: 'missing' };
  const definitions = new Map(
    definition.workflows.map((workflow) => [
      JSON.stringify([workflow.id, workflow.version]),
      workflow,
    ]),
  );
  const workflow = definitions.get(JSON.stringify([run.workflow.id, run.workflow.version]));
  if (!workflow || !matchesWorkflowApplicationDefinition(definition, run))
    return { status: 'changed', message: '流程定义与当前运行绑定的版本不一致，保留实际执行记录。' };
  const presentation = definition.presentation;
  const metadata = new Map(
    (presentation?.steps ?? [])
      .filter((step) => step.workflowId === workflow.id)
      .map((step) => [step.stepId, step]),
  );
  const observedSteps = new Map<string, DashboardApplicationRecord[]>();
  for (const record of records) {
    const observed = observedSteps.get(record.stepId) ?? [];
    observed.push(record);
    observedSteps.set(record.stepId, observed);
  }
  const bindings = new Map<string, Set<string>>();
  for (const binding of material.manifest?.bindings ?? []) {
    if (binding.workflowId !== workflow.id) continue;
    const skills = bindings.get(binding.stepId) ?? new Set<string>();
    skills.add(binding.skillId);
    bindings.set(binding.stepId, skills);
  }
  const contracts = new Map(
    (material.manifest?.artifactContracts ?? [])
      .filter((contract) => contract.workflowId === workflow.id)
      .map((contract) => [contract.stepId, contract]),
  );
  return {
    status: 'available',
    title: presentation?.title ?? definition.application.id,
    ...(presentation?.description ? { description: presentation.description } : {}),
    workflow: {
      id: workflow.id,
      version: workflow.version,
      entry: workflow.entry,
      transitions: workflow.transitions,
      maxTransitions: workflow.maxTransitions,
      dynamicRouting: Boolean(workflow.transitionHandler),
      ...(workflow.commands
        ? {
            commands: Object.fromEntries(
              Object.entries(workflow.commands).map(([name, command]) => [
                name,
                { stepId: command.stepId },
              ]),
            ),
          }
        : {}),
      // 展示不需要静态输入、初始状态或执行端口配置。
      steps: Object.fromEntries(
        Object.entries(workflow.steps).map(([id, step]) => [
          id,
          {
            type: step.type,
            ...(step.ref ? { ref: step.ref } : {}),
            ...(step.join ? { join: step.join } : {}),
            ...(step.type === 'child_workflow' ? { workflow: step.workflow } : {}),
            ...(step.type === 'ask_user' ? { choices: step.choices } : {}),
          },
        ]),
      ),
    },
    steps: Object.entries(workflow.steps).map(([stepId, step]) => {
      const display = metadata.get(stepId);
      const observed = observedSteps.get(stepId) ?? [];
      const latest = observed.at(-1);
      const artifactContract = contracts.get(stepId);
      return {
        stepId,
        title: display?.title ?? stepId,
        phase: display?.phase ?? '执行步骤',
        ...(display?.description ? { description: display.description } : {}),
        type: step.type,
        ...(step.ref ? { ref: step.ref } : {}),
        skills: [...(bindings.get(stepId) ?? [])],
        ...(artifactContract ? { artifactContract } : {}),
        ...(display?.outputFields ? { outputFields: display.outputFields } : {}),
        observation: step.type === 'child_workflow' ? 'subworkflow' : 'action',
        recordCount: observed.length,
        activeRecordIds: observed.filter((record) => record.active).map((record) => record.id),
        latestRecordId: latest?.id ?? null,
        latestStatus: latest?.status ?? null,
      };
    }),
  };
}

export function labelDashboardApplicationRecords(
  records: DashboardApplicationRecord[],
  definition: DashboardApplicationDefinition,
): DashboardApplicationRecord[] {
  const steps = new Map(definition.steps?.map((step) => [step.stepId, step]));
  return records.map((record) => {
    const step = steps.get(record.stepId);
    return step ? { ...record, title: step.title, phase: step.phase } : record;
  });
}
