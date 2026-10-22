import { resolveClassicStateFile } from './classic-state-file.js';
import { resolveWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import { measureCometGitCommandAsync } from '../../platform/process/runtime-metrics.js';
import path from 'node:path';

import { assertClassicLayoutReadable } from './classic-layout.js';
import { execFile } from 'child_process';
import { readDir } from '../../platform/fs/file-system.js';
import type { ClassicDiagnostic } from './classic-diagnostics.js';
import { readClassicState } from './classic-store.js';
import { hasClassicManagedRunMarker } from './classic-sdk-state-store.js';
import { PORTABLE_RUN_CHECKPOINT_KEY, readPortableRunCheckpoint } from '../engine/runtime.js';
import { parseDocument } from 'yaml';
import { inspectPristineClassicSdkState } from './classic-runtime-ownership.js';
import { isClassicSdkCancellationComplete } from './classic-sdk-run-lifecycle.js';
import {
  classicStateToDocument,
  parseClassicStateDocument,
  type ClassicState,
  type ClassicStateProjection,
} from './classic-state.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { createFileRuntimeStore, type WorkflowRun } from '../engine/runtime.js';
import { readClassicDelivery } from './classic-progress.js';
import { inspectClassicActiveChangeDirectory, openSpecChangeNameError } from './classic-paths.js';
import {
  classicProjectTargetExists,
  inspectClassicProjectTarget,
  readClassicProjectFile,
} from './classic-protected-path.js';

export const COMET_RESUME_PROBE_SCHEMA_VERSION = 'comet.resume_probe.v1' as const;

export type CometResumeProbeAction = 'none' | 'auto_resume' | 'ask_user' | 'out_of_scope';
export type CometResumeProbeConfidence = 'none' | 'low' | 'high';
export type CometResumeProbeEvidenceSource = 'user' | 'state' | 'repo';

export interface CometResumeProbeInput {
  schema_version: typeof COMET_RESUME_PROBE_SCHEMA_VERSION;
  utterance: string;
  locale: string;
  agent_context: {
    non_trivial_work: boolean;
    already_in_comet_flow: boolean;
  };
}

export interface CometResumeProbeEvidence {
  source: CometResumeProbeEvidenceSource;
  quote: string;
}

export interface CometResumeProbeResult {
  schema_version: typeof COMET_RESUME_PROBE_SCHEMA_VERSION;
  action: CometResumeProbeAction;
  changeName: string | null;
  phase: string | null;
  nextCommand: string | null;
  confidence: CometResumeProbeConfidence;
  reason: string;
  evidence: CometResumeProbeEvidence[];
}

interface ActiveProbeChange {
  name: string;
  workflow: string;
  phase: string;
  nextCommand: string | null;
  diagnostic: ClassicDiagnostic;
  buildPause: string | null;
  hasClassicProjection: boolean;
  verifyResult: 'pending' | 'pass' | 'fail' | null;
  archived: boolean;
  text: string;
  missingCometState: boolean;
  cancellationPending?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeInput(input: unknown): CometResumeProbeInput {
  if (!isRecord(input)) {
    throw new Error('Invalid CometResumeProbeInput: input must be an object');
  }
  if (input.schema_version !== COMET_RESUME_PROBE_SCHEMA_VERSION) {
    throw new Error(
      `Invalid CometResumeProbeInput: schema_version must be ${COMET_RESUME_PROBE_SCHEMA_VERSION}`,
    );
  }
  if (typeof input.utterance !== 'string') {
    throw new Error('Invalid CometResumeProbeInput: utterance must be a string');
  }
  const context = isRecord(input.agent_context) ? input.agent_context : {};
  return {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    utterance: input.utterance,
    locale: typeof input.locale === 'string' ? input.locale : 'unknown',
    agent_context: {
      non_trivial_work: context.non_trivial_work === true,
      already_in_comet_flow: context.already_in_comet_flow === true,
    },
  };
}

function result(
  action: CometResumeProbeAction,
  change: ActiveProbeChange | null,
  confidence: CometResumeProbeConfidence,
  reason: string,
  evidence: CometResumeProbeEvidence[] = [],
): CometResumeProbeResult {
  return {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    action,
    changeName: change?.name ?? null,
    phase: change?.phase ?? null,
    nextCommand:
      action === 'auto_resume' || action === 'ask_user' ? (change?.nextCommand ?? null) : null,
    confidence,
    reason,
    evidence,
  };
}

async function readIfExists(projectRoot: string, filePath: string, label: string): Promise<string> {
  if (
    !(await classicProjectTargetExists(projectRoot, filePath, {
      label,
      expected: 'file',
    }))
  ) {
    return '';
  }
  return readClassicProjectFile(projectRoot, filePath, { label });
}

async function changeSearchText(
  projectRoot: string,
  changeDir: string,
  classic: ActiveProbeChange,
): Promise<string> {
  const files = ['proposal.md', 'design.md', 'tasks.md'];
  const parts = [classic.name, classic.workflow, classic.phase];
  for (const file of files) {
    parts.push(
      await readIfExists(
        projectRoot,
        `${changeDir}/${file}`,
        `Classic change ${classic.name} ${file}`,
      ),
    );
  }
  return parts.join('\n').toLowerCase();
}

function nextCommandForPhase(phase: string, workflow: string): string | null {
  switch (phase) {
    case 'open':
      return '/comet-open';
    case 'design':
      return '/comet-design';
    case 'build':
      return workflow === 'hotfix' || workflow === 'tweak' ? `/comet-${workflow}` : '/comet-build';
    case 'verify':
      return '/comet-verify';
    case 'archive':
      return '/comet-archive';
    default:
      return null;
  }
}

function diagnosticFromProjection(
  changeDir: string,
  name: string,
  projection: ClassicStateProjection,
): ClassicDiagnostic {
  const classic = projection.classic;
  const unknownKeys = projection.unknownKeys.filter((key) => key !== 'run_id');
  if (!classic) {
    return {
      name,
      valid: false,
      workflow: 'unknown',
      phase: 'invalid',
      currentStep: null,
      nextCommand: null,
      runtimeMode: 'invalid',
      runtimeEval: null,
      evidence: [],
      error: `${changeDir} does not contain valid Comet state`,
    };
  }
  if (unknownKeys.length > 0) {
    return {
      name,
      valid: false,
      workflow: classic.workflow,
      phase: classic.phase,
      currentStep: null,
      nextCommand: null,
      runtimeMode: 'invalid',
      runtimeEval: null,
      evidence: [],
      error: `unknown field(s): ${unknownKeys.join(', ')}`,
    };
  }
  return {
    name,
    valid: true,
    workflow: classic.workflow,
    phase: classic.phase,
    currentStep: null,
    nextCommand: nextCommandForPhase(classic.phase, classic.workflow),
    runtimeMode: 'engine-projection',
    runtimeEval: null,
    evidence: [],
  };
}

async function hasOpenSpecChangeFiles(projectRoot: string, changeDir: string): Promise<boolean> {
  return (
    (await classicProjectTargetExists(projectRoot, `${changeDir}/proposal.md`, {
      label: 'Classic proposal',
      expected: 'file',
    })) ||
    (await classicProjectTargetExists(projectRoot, `${changeDir}/design.md`, {
      label: 'Classic design',
      expected: 'file',
    })) ||
    (await classicProjectTargetExists(projectRoot, `${changeDir}/tasks.md`, {
      label: 'Classic tasks',
      expected: 'file',
    }))
  );
}

async function inspectManagedRun(
  projectRoot: string,
  name: string,
  stateFile: string,
): Promise<{
  state: ClassicState | null;
  lostRun: boolean;
  cancellation?: 'complete' | 'pending';
}> {
  const source = await readClassicProjectFile(projectRoot, stateFile, {
    label: 'Classic change state',
  });
  const owner = await readSdkChangeOwner(projectRoot, 'classic', name);
  if (!hasClassicManagedRunMarker(source) && !owner) return { state: null, lostRun: false };
  const observe = (run: WorkflowRun, state: ClassicState) => ({
    state,
    lostRun: false,
    ...(run.status === 'cancelled'
      ? {
          cancellation: isClassicSdkCancellationComplete(run)
            ? ('complete' as const)
            : ('pending' as const),
        }
      : {}),
  });
  const checkpointState = () => {
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length > 0) return null;
    const data = document.toJS() as Record<string, unknown>;
    const checkpoint = readPortableRunCheckpoint(data[PORTABLE_RUN_CHECKPOINT_KEY], name);
    if (!checkpoint) return null;
    const state = parseClassicStateDocument(data).classic;
    return state &&
      checkpoint.input &&
      typeof checkpoint.input === 'object' &&
      !Array.isArray(checkpoint.input) &&
      checkpoint.input.change === name &&
      (checkpoint.state as unknown as ClassicState).phase === state.phase
      ? observe(checkpoint, state)
      : null;
  };
  if (!owner) {
    const saved = checkpointState();
    if (saved) return saved;
    const initial = await inspectPristineClassicSdkState(path.dirname(stateFile), source);
    return initial ? { state: initial, lostRun: false } : { state: null, lostRun: true };
  }
  try {
    const store = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(await resolveWorkspaceRuntimeRoot(projectRoot), 'sdk-runs', 'classic'),
    });
    const run = await store.read(owner.runId);
    if (!run) {
      const saved = checkpointState();
      return saved ?? { state: null, lostRun: true };
    }
    if (
      run.workflow.id !== `comet-${owner.application}` ||
      !run.input ||
      typeof run.input !== 'object' ||
      Array.isArray(run.input) ||
      run.input.change !== name
    ) {
      return { state: null, lostRun: true };
    }
    const state = parseClassicStateDocument(
      classicStateToDocument(run.state as unknown as ClassicState),
    ).classic;
    return state ? observe(run, state) : { state: null, lostRun: true };
  } catch {
    return { state: null, lostRun: true };
  }
}

async function discoverActiveChanges(projectRoot: string): Promise<ActiveProbeChange[]> {
  const changesDir = (await assertClassicLayoutReadable(projectRoot)).changesDir;
  const changesInspection = await inspectClassicProjectTarget(projectRoot, changesDir, {
    label: 'Classic changes directory',
    expected: 'directory',
  });
  if (!changesInspection.exists) return [];

  const entries = await readDir(changesDir);
  const changes: ActiveProbeChange[] = [];
  for (const entry of entries) {
    if (entry === 'archive') continue;
    if (openSpecChangeNameError(entry)) continue;
    const active = await inspectClassicActiveChangeDirectory(entry, projectRoot);
    if (!active.exists) continue;
    const changeDir = active.directory;
    const hasCometState = active.stateExists;
    if (!hasCometState) {
      if (!(await hasOpenSpecChangeFiles(projectRoot, changeDir))) continue;
      const missingStateChange: ActiveProbeChange = {
        name: entry,
        workflow: 'unknown',
        phase: 'invalid',
        nextCommand: null,
        diagnostic: {
          name: entry,
          valid: false,
          workflow: 'unknown',
          phase: 'invalid',
          currentStep: null,
          nextCommand: null,
          runtimeMode: 'invalid',
          runtimeEval: null,
          evidence: [],
          error: 'missing Comet state',
        },
        buildPause: null,
        hasClassicProjection: false,
        verifyResult: null,
        archived: false,
        text: '',
        missingCometState: true,
      };
      missingStateChange.text = await changeSearchText(projectRoot, changeDir, missingStateChange);
      changes.push(missingStateChange);
      continue;
    }

    const managed = await inspectManagedRun(
      projectRoot,
      entry,
      await resolveClassicStateFile(changeDir),
    );
    if (managed.cancellation === 'complete') continue;
    const projection = await readClassicState(changeDir, { migrate: false });
    if (managed.state) projection.classic = managed.state;
    const classic = projection.classic;
    const baseDiagnostic = diagnosticFromProjection(changeDir, entry, projection);
    const diagnostic = managed.lostRun
      ? {
          ...baseDiagnostic,
          valid: false,
          nextCommand: null,
          error: `Classic change ${entry} has a state file but lost its local Run history`,
        }
      : baseDiagnostic;
    const hasClassicProjection = Boolean(classic);
    const phase = classic?.phase ?? diagnostic.phase;
    const workflow = classic?.workflow ?? diagnostic.workflow;
    if ((phase === 'archive' || classic?.archived) && managed.cancellation !== 'pending') continue;

    const change: ActiveProbeChange = {
      name: entry,
      workflow,
      phase,
      nextCommand: managed.cancellation === 'pending' ? null : diagnostic.nextCommand,
      diagnostic,
      buildPause: classic?.buildPause ?? null,
      hasClassicProjection,
      verifyResult: classic?.verifyResult ?? null,
      archived: classic?.archived ?? false,
      text: '',
      missingCometState: false,
      ...(managed.cancellation === 'pending' ? { cancellationPending: true } : {}),
    };
    change.text = await changeSearchText(projectRoot, changeDir, change);
    changes.push(change);
  }
  return changes;
}

function archivedChangeName(entry: string): string | null {
  const candidate = /^\d{4}-\d{2}-\d{2}-(.+)$/u.exec(entry)?.[1] ?? entry;
  return openSpecChangeNameError(candidate) === null ? candidate : null;
}

async function discoverPendingArchivedChanges(projectRoot: string): Promise<ActiveProbeChange[]> {
  const layout = await assertClassicLayoutReadable(projectRoot);
  const archiveInspection = await inspectClassicProjectTarget(projectRoot, layout.archiveDir, {
    label: 'Classic archive directory',
    expected: 'directory',
  });
  if (!archiveInspection.exists) return [];

  // 批量并发只重叠每个归档目录的只读 IO 等待；任何目录失败仍按整体失败处理。
  const entries = (await readDir(layout.archiveDir))
    .map((entry) => ({ entry, name: archivedChangeName(entry) }))
    .filter((item): item is { entry: string; name: string } => item.name !== null);
  const changes: ActiveProbeChange[] = [];
  const CONCURRENCY = 8;
  for (let offset = 0; offset < entries.length; offset += CONCURRENCY) {
    const results = await Promise.all(
      entries.slice(offset, offset + CONCURRENCY).map(async ({ entry, name }) => {
        const directory = path.join(layout.archiveDir, entry);
        const inspection = await inspectClassicProjectTarget(projectRoot, directory, {
          label: `Classic archived change ${entry}`,
          expected: 'directory',
        });
        if (!inspection.exists) return null;

        const projection = await readClassicState(inspection.target, { migrate: false });
        const managed = await inspectManagedRun(
          projectRoot,
          name,
          await resolveClassicStateFile(inspection.target),
        );
        if (managed.cancellation === 'complete') return null;
        if (managed.state) projection.classic = managed.state;
        const classic = projection.classic;
        if (!classic?.archived || classic.phase !== 'archive') return null;
        const delivery = await readClassicDelivery(projectRoot, inspection.target, {
          evidence: false,
        });
        if (['complete', 'local-verified'].includes(delivery.verification.status)) return null;

        const baseDiagnostic = diagnosticFromProjection(inspection.target, name, projection);
        const diagnostic = managed.lostRun
          ? {
              ...baseDiagnostic,
              valid: false,
              nextCommand: null,
              error: `Classic change ${name} has a state file but lost its local Run history`,
            }
          : baseDiagnostic;
        const change: ActiveProbeChange = {
          name,
          workflow: classic.workflow,
          phase: 'archive',
          nextCommand: managed.cancellation === 'pending' ? null : diagnostic.nextCommand,
          diagnostic,
          buildPause: null,
          hasClassicProjection: true,
          verifyResult: classic.verifyResult,
          archived: true,
          text: '',
          missingCometState: false,
          ...(managed.cancellation === 'pending' ? { cancellationPending: true } : {}),
        };
        change.text = await changeSearchText(projectRoot, inspection.target, change);
        return change;
      }),
    );
    for (const change of results) if (change) changes.push(change);
  }
  return changes;
}

const RESUME_WORDS = [
  'continue',
  'resume',
  'carry on',
  'finish',
  'run it',
  'commit',
  'verify',
  'archive',
  '继续',
  '接着',
  '恢复',
  '跑完',
  '提交',
  '验证',
  '归档',
  '修刚才',
];

const QUESTION_WORDS = [
  'what',
  'why',
  'how',
  'explain',
  'summarize',
  'reliable',
  '靠谱吗',
  '是什么',
  '为什么',
  '解释',
  '总结',
  '取名',
  '命名',
];

const GENERIC_RELATED_TOKENS = new Set([
  'add',
  'build',
  'cache',
  'change',
  'code',
  'design',
  'docs',
  'file',
  'fix',
  'implement',
  'plan',
  'readme',
  'task',
  'test',
  'update',
  '修改',
  '更新',
  '修复',
  '添加',
  '文档',
  '任务',
  '计划',
  '实现',
]);

const OPT_OUT_WORDS = [
  'do not resume',
  "don't resume",
  'without comet',
  'skip comet',
  '不要恢复',
  '不走 comet',
  '不要走 comet',
  '直接解释',
  '只回答',
];

function includesAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

function hasDecisionPoint(change: ActiveProbeChange): boolean {
  if (change.missingCometState) return true;
  if (!change.hasClassicProjection) return true;
  if (!change.diagnostic.valid) return true;
  if (change.phase === 'archive') return true;
  if (change.verifyResult === 'fail') return true;
  if (change.diagnostic.runtimeEval && !change.diagnostic.runtimeEval.passed) return true;
  if (change.phase !== 'build') return false;
  if (change.buildPause === 'plan-ready') return true;
  return false;
}

function cancellationDecision(change: ActiveProbeChange): CometResumeProbeResult {
  return result(
    'ask_user',
    change,
    'low',
    'Classic Run is cancelled; the original host must confirm its execution and child tasks stopped, then submit the original claim and stop evidence through runtime dispatch cancel stoppedActions before releasing the workspace',
    [{ source: 'state', quote: 'Run cancelled; original execution stop is not confirmed' }],
  );
}

function relatedEvidence(utterance: string, change: ActiveProbeChange): CometResumeProbeEvidence[] {
  const text = utterance.toLowerCase();
  const evidence: CometResumeProbeEvidence[] = [];
  if (text.includes(change.name.toLowerCase())) {
    evidence.push({ source: 'user', quote: change.name });
  }
  const tokens = change.text
    .split(/[^a-zA-Z0-9_\-\u4e00-\u9fff/]+/u)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 4 && !GENERIC_RELATED_TOKENS.has(token));
  const matched = [...new Set(tokens.filter((token) => text.includes(token)))].slice(0, 3);
  for (const token of matched) {
    evidence.push({ source: 'repo', quote: token });
  }
  return evidence;
}

async function gitDirtyFiles(projectRoot: string): Promise<string[]> {
  return measureCometGitCommandAsync(
    () =>
      new Promise<string[]>((resolve) => {
        execFile(
          'git',
          ['status', '--short', '--untracked-files=all'],
          {
            cwd: projectRoot,
            timeout: 3000,
            maxBuffer: 2 * 1024 * 1024,
            windowsHide: true,
          },
          (error, stdout) => {
            if (error || typeof stdout !== 'string') {
              resolve([]);
              return;
            }
            resolve(
              stdout
                .split(/\r?\n/u)
                .map((line) => line.trim())
                .filter(Boolean),
            );
          },
        );
      }),
  );
}

export async function resolveCometResumeProbe(
  projectRoot: string,
  rawInput: unknown,
): Promise<CometResumeProbeResult> {
  const input = normalizeInput(rawInput);
  const utterance = input.utterance.trim();
  const lower = utterance.toLowerCase();

  if (input.agent_context.already_in_comet_flow) {
    return result('out_of_scope', null, 'low', 'already in Comet flow');
  }
  if (includesAny(lower, OPT_OUT_WORDS)) {
    return result('out_of_scope', null, 'low', 'user opted out of Comet resume', [
      { source: 'user', quote: utterance },
    ]);
  }

  const activeChanges = await discoverActiveChanges(projectRoot);
  const activeNames = new Set(activeChanges.map(({ name }) => name));
  const archivedChanges = (await discoverPendingArchivedChanges(projectRoot)).filter(
    ({ name }) => !activeNames.has(name),
  );
  const changes = [...activeChanges, ...archivedChanges];
  if (changes.length === 0) {
    return result('none', null, 'none', 'no active Comet changes');
  }
  const dirtyFiles = await gitDirtyFiles(projectRoot);
  if (changes.length > 1) {
    const named = changes.find((change) => lower.includes(change.name.toLowerCase()));
    if (!named) {
      return result('ask_user', null, 'low', 'multiple active changes require a change name');
    }
    if (named.cancellationPending) return cancellationDecision(named);
    if (dirtyFiles.length > 0) {
      return result('ask_user', named, 'low', 'uncommitted worktree changes require attribution', [
        { source: 'repo', quote: `${dirtyFiles.length} dirty file(s)` },
      ]);
    }
    return hasDecisionPoint(named)
      ? result('ask_user', named, 'low', 'active change is at a decision point')
      : result('auto_resume', named, 'high', 'request names an active change', [
          { source: 'user', quote: named.name },
        ]);
  }

  const [change] = changes;
  if (change.cancellationPending) return cancellationDecision(change);
  if (dirtyFiles.length > 0) {
    return result('ask_user', change, 'low', 'uncommitted worktree changes require attribution', [
      { source: 'repo', quote: `${dirtyFiles.length} dirty file(s)` },
    ]);
  }

  if (hasDecisionPoint(change)) {
    if (change.archived) {
      return result(
        'ask_user',
        change,
        'low',
        change.diagnostic.valid
          ? 'archived change has pending delivery'
          : 'archived change execution history is unavailable',
        [
          { source: 'state', quote: 'archived: true' },
          { source: 'state', quote: 'delivery is not complete' },
        ],
      );
    }
    if (change.missingCometState) {
      return result('ask_user', change, 'low', 'active OpenSpec change is missing Comet state');
    }
    return result('ask_user', change, 'low', 'active change is at a decision point', [
      { source: 'state', quote: `phase: ${change.phase}` },
    ]);
  }

  const resumeLike = includesAny(lower, RESUME_WORDS);
  const questionLike = !input.agent_context.non_trivial_work && includesAny(lower, QUESTION_WORDS);
  if (questionLike && !resumeLike) {
    return result('out_of_scope', change, 'low', 'user asked a question without workflow work');
  }

  const evidence = relatedEvidence(utterance, change);
  if (resumeLike || evidence.length > 0) {
    return result('auto_resume', change, 'high', 'single active change and request is related', [
      { source: 'state', quote: `phase: ${change.phase}` },
      ...evidence,
    ]);
  }

  if (input.agent_context.non_trivial_work) {
    return result(
      'ask_user',
      change,
      'low',
      'single active change exists but request looks unrelated',
    );
  }

  return result('out_of_scope', change, 'low', 'request is not workflow work');
}
