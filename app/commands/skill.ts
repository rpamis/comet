import path from 'path';
import {
  evaluateManualRun,
  resumeManualRun,
  startManualRun,
  upgradeManualRun,
} from '../../domains/engine/manual-run.js';
import {
  evaluateStandaloneRun,
  resumeStandaloneRun,
  startStandaloneRun,
  upgradeStandaloneRun,
} from '../../domains/engine/standalone-run.js';
import { resolveSkill, type ResolvedSkill } from '../../domains/skill/discovery.js';
import { installProjectSkill } from '../../domains/skill/install.js';

interface SkillCommandOptions {
  project?: string;
  json?: boolean;
  overwrite?: boolean;
  change?: string;
  runId?: string;
  status?: 'succeeded' | 'failed';
  summary?: string;
  artifact?: string[];
  state?: string[];
  confirm?: string[];
  upgrade?: string;
  scope?: 'progress' | 'step' | 'completion';
}

function projectRoot(options: SkillCommandOptions): string {
  return path.resolve(options.project ?? '.');
}

function emit(value: unknown, json: boolean | undefined, text: string): void {
  console.log(json ? JSON.stringify(value, null, 2) : text);
}

function changeDir(options: SkillCommandOptions): string {
  if (!options.change) throw new Error('--change is required');
  return path.resolve(options.change);
}

function assertSingleRunTarget(options: SkillCommandOptions): void {
  if (Boolean(options.change) === Boolean(options.runId)) {
    throw new Error('Pass exactly one of --change or --run-id');
  }
}

function keyValuePairs(values: string[] | undefined, label: string): Record<string, string> {
  return Object.fromEntries(
    (values ?? []).map((value) => {
      const separator = value.indexOf('=');
      if (separator <= 0 || separator === value.length - 1) {
        throw new Error(`${label} must use key=value: ${value}`);
      }
      return [value.slice(0, separator), value.slice(separator + 1)];
    }),
  );
}

function hasValues(values: string[] | undefined): boolean {
  return Boolean(values && values.length > 0);
}

function runtimeChecks(
  evals: Array<{ evalId: string; passed: boolean; evidence?: string }>,
): Array<{ checkId: string; passed: boolean; evidence?: string }> {
  return evals.map((evaluation) => ({
    checkId: evaluation.evalId,
    passed: evaluation.passed,
    ...(evaluation.evidence === undefined ? {} : { evidence: evaluation.evidence }),
  }));
}

function runCommandResult<
  T extends {
    evals: Array<{ evalId: string; passed: boolean; evidence?: string }>;
  },
>(
  result: T,
): Omit<T, 'evals'> & {
  checks: Array<{ checkId: string; passed: boolean; evidence?: string }>;
} {
  const { evals, ...rest } = result;
  return {
    ...rest,
    checks: runtimeChecks(evals),
  };
}

function runText(result: {
  state: { runId: string; status: string; currentStep: string | null };
  action: { id: string; type: string; stepId: string | null } | null;
  evals: Array<{ evalId: string; passed: boolean }>;
  reason?: string;
}): string {
  const next = result.action
    ? 'Next: complete the pending action, then run comet skill continue'
    : result.evals.some((evaluation) => !evaluation.passed)
      ? 'Next: record the missing artifact/state and rerun comet skill check'
      : 'Next: none';
  return [
    `Run: ${result.state.runId}`,
    `Status: ${result.state.status}`,
    `Current step: ${result.state.currentStep ?? '(complete)'}`,
    result.action
      ? `Pending action: ${result.action.id} (${result.action.type}, step ${result.action.stepId ?? 'adaptive'})`
      : 'Pending action: none',
    `Runtime checks: ${result.evals.length}`,
    next,
    ...(result.reason ? [`Reason: ${result.reason}`] : []),
  ].join('\n');
}

function skillIdentity(resolved: ResolvedSkill) {
  return {
    valid: true,
    name: resolved.name,
    version: resolved.version,
    origin: resolved.origin,
    root: resolved.root,
    hash: resolved.hash,
  };
}

async function inspectSkill(selector: string, options: SkillCommandOptions) {
  const resolved = await resolveSkill(selector, { projectRoot: projectRoot(options) });
  const { definition, guardrails, evals } = resolved.package;
  return {
    ...skillIdentity(resolved),
    description: definition.metadata.description,
    goal: definition.goal,
    orchestration: definition.orchestration,
    skills: definition.skills,
    agents: definition.agents,
    tools: definition.tools,
    guardrails,
    checks: evals.map(({ id, ...evaluation }) => ({
      checkId: id,
      ...evaluation,
    })),
  };
}

function skillDetailLines(result: Awaited<ReturnType<typeof inspectSkill>>): string[] {
  return [
    `Orchestration: ${result.orchestration.mode}`,
    `Steps: ${result.orchestration.steps?.length ?? 0}`,
    `Skills: ${result.skills.length}`,
    `Agents: ${result.agents.length}`,
    `Tools: ${result.tools.length}`,
    `Runtime checks: ${result.checks.length}`,
  ];
}

// Keep the original output contracts for package consumers using the command module.
export async function skillValidateCommand(
  selector: string,
  options: SkillCommandOptions = {},
): Promise<void> {
  const result = skillIdentity(await resolveSkill(selector, { projectRoot: projectRoot(options) }));
  emit(
    result,
    options.json,
    `Valid Comet Skill: ${result.name}@${result.version} (${result.origin})\nHash: ${result.hash}\nRoot: ${result.root}`,
  );
}

export async function skillInspectCommand(
  selector: string,
  options: SkillCommandOptions = {},
): Promise<void> {
  const result = await inspectSkill(selector, options);
  emit(
    result,
    options.json,
    [
      `${result.name}@${result.version} (${result.origin})`,
      result.description,
      `Root: ${result.root}`,
      ...skillDetailLines(result),
    ].join('\n'),
  );
}

export async function skillShowCommand(
  selector: string,
  options: SkillCommandOptions = {},
): Promise<void> {
  const result = await inspectSkill(selector, options);
  emit(
    result,
    options.json,
    [
      `Valid Comet Skill: ${result.name}@${result.version} (${result.origin})`,
      result.description,
      `Root: ${result.root}`,
      `Hash: ${result.hash}`,
      ...skillDetailLines(result),
    ].join('\n'),
  );
}

export async function skillInstallCommand(
  source: string,
  options: SkillCommandOptions = {},
): Promise<void> {
  const result = await installProjectSkill(source, projectRoot(options), {
    overwrite: options.overwrite,
  });
  emit(
    result,
    options.json,
    `Installed ${result.name}@${result.version}\nHash: ${result.hash}\nDestination: ${result.destination}`,
  );
}

export async function skillRunCommand(
  selector: string,
  options: SkillCommandOptions = {},
): Promise<void> {
  assertSingleRunTarget(options);
  const resolved = await resolveSkill(selector, { projectRoot: projectRoot(options) });
  const result = options.runId
    ? await startStandaloneRun(resolved.package, {
        projectRoot: projectRoot(options),
        runId: options.runId,
        confirmations: options.confirm ?? [],
      })
    : await startManualRun(resolved.package, changeDir(options), options.confirm ?? []);
  emit(runCommandResult(result), options.json, runText(result));
}

export async function skillResumeCommand(options: SkillCommandOptions = {}): Promise<void> {
  assertSingleRunTarget(options);
  const root = projectRoot(options);
  const target = options.runId ? null : changeDir(options);
  if (options.upgrade) {
    if (
      options.status ||
      options.summary ||
      hasValues(options.artifact) ||
      hasValues(options.state)
    ) {
      throw new Error('--upgrade cannot be combined with outcome options');
    }
    const resolved = await resolveSkill(options.upgrade, {
      projectRoot: root,
    });
    const result = options.runId
      ? await upgradeStandaloneRun(root, options.runId, resolved.package)
      : await upgradeManualRun(target!, resolved.package);
    emit(
      result,
      options.json,
      `${result.changed ? 'Upgraded' : 'Unchanged'} ${result.state.skill}@${result.state.skillVersion}\nHash: ${result.state.skillHash}`,
    );
    return;
  }

  const hasOutcomeOptions = Boolean(
    options.summary || hasValues(options.artifact) || hasValues(options.state),
  );
  if (!options.status && hasOutcomeOptions) {
    throw new Error('--summary, --artifact, and --state require --status');
  }
  if (options.status && !options.summary) {
    throw new Error('--summary is required when submitting an outcome');
  }

  const resumeOptions = {
    confirmations: options.confirm ?? [],
    outcome: options.status
      ? {
          status: options.status,
          summary: options.summary!,
          artifacts: keyValuePairs(options.artifact, '--artifact'),
          state: keyValuePairs(options.state, '--state'),
        }
      : undefined,
  };
  const result = options.runId
    ? await resumeStandaloneRun(root, options.runId, resumeOptions)
    : await resumeManualRun(target!, resumeOptions);
  emit(runCommandResult(result), options.json, runText(result));
}

export async function skillCheckCommand(options: SkillCommandOptions = {}): Promise<void> {
  assertSingleRunTarget(options);
  const result = options.runId
    ? await evaluateStandaloneRun(projectRoot(options), options.runId, options.scope ?? 'progress')
    : await evaluateManualRun(changeDir(options), options.scope ?? 'progress');
  const failed = result.evals.filter((evaluation) => !evaluation.passed);
  emit(
    runCommandResult(result),
    options.json,
    [
      `Run: ${result.state.runId}`,
      `Scope: ${result.scope}`,
      ...result.evals.map(
        (evaluation) =>
          `${evaluation.passed ? 'PASS' : 'FAIL'} ${evaluation.evalId}: ${evaluation.evidence}`,
      ),
      ...(failed.length > 0
        ? ['Next: record the missing artifact/state and rerun comet skill check']
        : []),
    ].join('\n'),
  );
}

export type { SkillCommandOptions };
