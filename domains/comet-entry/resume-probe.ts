import { isNativeSdkCancellationComplete } from '../comet-native/native-sdk-status.js';
import { measureCometGitCommandAsync } from '../../platform/process/runtime-metrics.js';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

import {
  COMET_RESUME_PROBE_SCHEMA_VERSION as CLASSIC_RESUME_PROBE_SCHEMA_VERSION,
  resolveCometResumeProbe as resolveClassicResumeProbe,
  type CometResumeProbeAction,
  type CometResumeProbeConfidence,
  type CometResumeProbeEvidence,
  type CometResumeProbeInput as ClassicResumeProbeInput,
} from '../comet-classic/classic-resume-probe.js';
import {
  inspectNativeChangeStateDocument,
  nativeChangeDir,
  readNativeChange,
} from '../comet-native/native-change.js';
import { assertNoPendingNativeRootMove } from '../comet-native/native-config.js';
import {
  inspectNativeArtifactFindings,
  listNativeChangeNames,
  NATIVE_STATUS_PAGE_LIMITS,
} from '../comet-native/native-diagnostics.js';
import { nativeProjectPaths } from '../comet-native/native-paths.js';
import {
  assertNativePortableChangeNotOrphaned,
  inspectPristineNativeSdkChange,
  inspectNativeSdkRun,
  listNativeSdkChangeNames,
} from '../comet-native/native-runtime-ownership.js';
import {
  isNativePortableChange,
  nativePortableChangeDir,
  readNativePortableChange,
} from '../comet-native/native-portable-runtime.js';
import {
  inspectNativePortableStatus,
  type NativePortableStatusProjection,
} from '../comet-native/native-portable-status.js';
import { runWithHookReadCache } from '../../platform/process/hook-read-cache.js';
import { discoverCachedNativeProject, readCachedProjectConfig } from './entry-reads.js';
import { readNativeSelectionRecord } from '../comet-native/native-selection.js';
import { readNativeProposedSpecs } from '../comet-native/native-specs.js';
import type {
  NativeChangeState,
  NativeFinding,
  NativeProjectPaths,
} from '../comet-native/native-types.js';
import type { NativePortableState } from '../comet-native/native-portable-types.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { resolveCometEntry } from './resolve-entry.js';
import type { CometEntryResolutionSource, CometEntrySkill, CometWorkflow } from './types.js';

export const COMET_RESUME_PROBE_SCHEMA_VERSION = 'comet.resume_probe.v2' as const;

export interface CometEntryResumeProbeInput {
  schema_version: typeof COMET_RESUME_PROBE_SCHEMA_VERSION;
  utterance: string;
  locale: string;
  agent_context: {
    non_trivial_work: boolean;
    already_in_comet_flow: boolean;
  };
}

export interface CometEntryResumeProbeCandidate {
  name: string;
  phase: string;
  selected: boolean;
}

export interface CometEntryResumeProbeResult {
  schema_version: typeof COMET_RESUME_PROBE_SCHEMA_VERSION;
  workflow: CometWorkflow | null;
  skill: CometEntrySkill | null;
  entrySource: CometEntryResolutionSource | null;
  action: CometResumeProbeAction;
  changeName: string | null;
  phase: string | null;
  nextCommand: '/comet-native' | '/comet-classic' | null;
  confidence: CometResumeProbeConfidence;
  reasonCode: string;
  reason: string;
  evidence: CometResumeProbeEvidence[];
  candidates: CometEntryResumeProbeCandidate[];
}

interface ResultOptions {
  workflow?: CometWorkflow | null;
  skill?: CometEntrySkill | null;
  entrySource?: CometEntryResolutionSource | null;
  action: CometResumeProbeAction;
  change?: { name: string; phase: string } | null;
  confidence: CometResumeProbeConfidence;
  reasonCode: string;
  reason: string;
  evidence?: CometResumeProbeEvidence[];
  candidates?: CometEntryResumeProbeCandidate[];
}

interface ResumeIntent {
  positiveText: string;
  negativeText: string;
  resumeLike: boolean;
  commitLike: boolean;
  commitOnly: boolean;
  currentChange: boolean;
  excludesCurrentChange: boolean;
  outsideChange: boolean;
  optedOut: boolean;
}

const RESUME_PATTERN =
  /(?:\b(?:continue|resume|carry on|finish|verify|archive)(?![a-z0-9_.-])|继续|接着|恢复|跑完|验证|归档|修刚才)/u;
const COMMIT_PATTERN = /(?:\bcommit(?![a-z0-9_.-])|提交)/u;
const CURRENT_CHANGE_PATTERN =
  /(?:\b(?:current|selected|this|active)\s+(?:comet\s+)?change\b|(?:当前|选中|这个|本次|正在处理的)(?:的)?\s*(?:change|需求|变更))/u;
const NEGATION_PATTERN =
  /(?:\b(?:do not|don't|does not|doesn't|never|not)(?!\s+only\b)\s+|不要|不用|无需|不必|别|暂不|先不|不再|不需要|不(?=走|继续|恢复|处理|启动|进入|执行))/u;

function normalizeIntentText(utterance: string): string {
  return utterance
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/\s+/gu, ' ')
    .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/gu, '$1')
    .trim();
}

function resolveResumeIntent(utterance: string): ResumeIntent {
  const text = normalizeIntentText(utterance);
  // 否定句中的动作和 change 名称不能成为恢复授权；后续只用肯定部分选择目标。
  const positive: string[] = [];
  const negative: string[] = [];
  for (const clause of text.split(/[,;!?。！？；，\r\n]+|\.(?:\s|$)|\bbut\b|但是/gu)) {
    const negation = NEGATION_PATTERN.exec(clause);
    if (!negation) {
      positive.push(clause);
    } else {
      positive.push(clause.slice(0, negation.index));
      negative.push(clause.slice(negation.index));
    }
  }
  const positiveText = positive.join(' ').trim();
  const negativeText = negative.join(' ').trim();
  const compact = text.replace(/\s+/gu, '');
  const optedOut =
    /\b(?:without|skip|avoid|no)\s+(?:the\s+)?comet\b/u.test(positiveText) ||
    /(?:不走|不要走)comet|直接解释|只回答/u.test(compact) ||
    negative.some((clause) => {
      const compactClause = clause.replace(/\s+/gu, '');
      const workflow = /\bcomet\b|\bworkflow\b|流程/u.test(clause);
      const workflowAction =
        /\b(?:start|continue|resume|run|enter|load|use|trigger)\b|启动|开启|继续|恢复|进入|加载|使用|执行|走/u.test(
          clause,
        );
      // 拒绝新建流程不等于拒绝恢复已有流程。
      const newOnly = /\bnew\b|新建|新的|新流程/u.test(clause) && !RESUME_PATTERN.test(clause);
      return (
        (workflow && workflowAction && !newOnly) ||
        /^(?:do not|don't|never)\s+(?:resume|continue|carry on)\s*(?:it|now|yet|please)?$/u.test(
          clause.trim(),
        ) ||
        /^(?:不要|别|暂不|先不|不再)(?:恢复|继续|接着)(?:了|执行)?$/u.test(compactClause)
      );
    });
  return {
    positiveText,
    negativeText,
    resumeLike: RESUME_PATTERN.test(
      positiveText.replace(
        /\b(?:continue|resume|finish)(?:\s+(?:to|the|with))?\s+(?:git\s+)?commit(?:ting)?\b|(?:继续|接着|恢复|跑完)(?:执行)?(?:git\s*)?提交/gu,
        '',
      ),
    ),
    commitLike: COMMIT_PATTERN.test(positiveText),
    commitOnly: /\b(?:just|only|simply)\b|只|仅|单纯|直接/u.test(positiveText),
    currentChange: CURRENT_CHANGE_PATTERN.test(positiveText),
    excludesCurrentChange: CURRENT_CHANGE_PATTERN.test(negativeText),
    outsideChange:
      /\b(?:another|different|unrelated)\s+(?:change|changes|files?|code|work)\b|(?:另一个|另外|其他|无关)(?:的)?\s*(?:change|修改|变更|文件|代码|需求)/u.test(
        positiveText,
      ),
    optedOut,
  };
}

function requestScopeDecision(
  intent: ResumeIntent,
  names: readonly string[],
): Pick<ResultOptions, 'action' | 'confidence' | 'reasonCode' | 'reason'> | null {
  const explicitChange =
    intent.currentChange || namesInUtterance(intent.positiveText, names).length > 0;
  if (intent.outsideChange && !explicitChange) {
    return {
      action: 'out_of_scope',
      confidence: 'low',
      reasonCode: 'request-unrelated',
      reason: 'user requested work outside the current Comet change',
    };
  }
  if (!intent.commitLike || intent.resumeLike || explicitChange) {
    return null;
  }
  return intent.commitOnly
    ? {
        action: 'out_of_scope',
        confidence: 'low',
        reasonCode: 'commit-only-request',
        reason: 'committing existing files alone does not request a Comet workflow',
      }
    : {
        action: 'ask_user',
        confidence: 'low',
        reasonCode: 'commit-scope-ambiguous',
        reason: 'Does this commit belong to the active Comet change or to unrelated files?',
      };
}

const GENERIC_RELATED_TOKENS = new Set([
  'acceptance',
  'build',
  'change',
  'constraints',
  'decisions',
  'implementation',
  'native',
  'non-goals',
  'outcome',
  'questions',
  'scope',
  'specification',
  'verification',
]);

const RESUMABLE_NATIVE_FINDING_CODES = new Set([
  'run-action-pending',
  'transition-incomplete',
  'verification-report-missing',
]);

function blockingNativeResumeFinding(findings: NativeFinding[]): NativeFinding | null {
  return findings.find((finding) => !RESUMABLE_NATIVE_FINDING_CODES.has(finding.code)) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeInput(input: unknown): CometEntryResumeProbeInput {
  if (!isRecord(input)) {
    throw new Error('Invalid CometEntryResumeProbeInput: input must be an object');
  }
  if (input.schema_version !== COMET_RESUME_PROBE_SCHEMA_VERSION) {
    throw new Error(
      `Invalid CometEntryResumeProbeInput: schema_version must be ${COMET_RESUME_PROBE_SCHEMA_VERSION}`,
    );
  }
  if (typeof input.utterance !== 'string') {
    throw new Error('Invalid CometEntryResumeProbeInput: utterance must be a string');
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

function result(options: ResultOptions): CometEntryResumeProbeResult {
  const nextCommand =
    options.action === 'auto_resume'
      ? options.skill === 'comet-native'
        ? '/comet-native'
        : options.skill === 'comet-classic'
          ? '/comet-classic'
          : null
      : null;
  return {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    workflow: options.workflow ?? null,
    skill: options.skill ?? null,
    entrySource: options.entrySource ?? null,
    action: options.action,
    changeName: options.change?.name ?? null,
    phase: options.change?.phase ?? null,
    nextCommand,
    confidence: options.confidence,
    reasonCode: options.reasonCode,
    reason: options.reason,
    evidence: options.evidence ?? [],
    candidates: options.candidates ?? [],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function namesInUtterance(utterance: string, names: readonly string[]): string[] {
  const lower = utterance.toLowerCase();
  return names.filter((name) => {
    const pattern = new RegExp(
      `(?:^|[^a-z0-9_-])${escapeRegExp(name.toLowerCase())}(?=$|[^a-z0-9_-])`,
      'u',
    );
    return pattern.test(lower);
  });
}

async function inspectCandidates<T, R>(
  items: readonly T[],
  inspect: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await inspect(items[index]);
      }
    }),
  );
  return results;
}

async function nativeResumeCandidates(
  paths: NativeProjectPaths,
  names: readonly string[],
  selectedName: string | null,
  targetName: string | null,
  inspectSdk: (name: string) => ReturnType<typeof inspectNativeSdkRun>,
): Promise<CometEntryResumeProbeCandidate[]> {
  const displayedNames = names.slice(0, NATIVE_STATUS_PAGE_LIMITS.maxItems);
  if (targetName && !displayedNames.includes(targetName)) {
    if (displayedNames.length === NATIVE_STATUS_PAGE_LIMITS.maxItems) displayedNames.pop();
    displayedNames.push(targetName);
  }
  return inspectCandidates(displayedNames, async (name) => {
    try {
      if (await readSdkChangeOwner(paths.projectRoot, 'native', name, { readOnly: true })) {
        const { state } = await inspectSdk(name);
        return { name, phase: state.phase, selected: name === selectedName };
      }
      if (await isNativePortableChange(paths, name)) {
        const recoverable = await inspectPristineNativeSdkChange(paths, name);
        if (!recoverable) await assertNativePortableChangeNotOrphaned(paths, name);
        const state = recoverable ?? (await readNativePortableChange(paths, name));
        return {
          name,
          phase: state.phase,
          selected: name === selectedName,
        };
      }
      const inspection = await inspectNativeChangeStateDocument(paths, name);
      return {
        name,
        phase: inspection.state?.phase ?? 'invalid',
        selected: name === selectedName,
      };
    } catch {
      return { name, phase: 'invalid', selected: name === selectedName };
    }
  });
}

async function nativeRelatedEvidence(
  paths: NativeProjectPaths,
  change: { name: string; phase: string },
  state: NativeChangeState | NativePortableState,
  utterance: string,
): Promise<CometResumeProbeEvidence[]> {
  let source: string;
  try {
    const portable = state.schema === 'comet.native.v4';
    const specs = portable
      ? Object.fromEntries(
          await Promise.all(
            state.spec_changes
              .filter((entry): entry is typeof entry & { source: string } => entry.source !== null)
              .map(async (entry) => [
                entry.capability,
                await fs.readFile(
                  path.join(nativePortableChangeDir(paths, change.name), entry.source),
                  'utf8',
                ),
              ]),
          ),
        )
      : await readNativeProposedSpecs(paths, change.name);
    const changeDirectory = portable
      ? nativePortableChangeDir(paths, change.name)
      : nativeChangeDir(paths, change.name);
    source = [
      change.name,
      await fs.readFile(path.join(changeDirectory, state.brief), 'utf8'),
      ...Object.keys(specs),
      ...Object.values(specs),
    ]
      .join('\n')
      .toLowerCase();
  } catch {
    return [];
  }
  const lower = utterance.toLowerCase();
  const tokens = source
    .split(/[^a-zA-Z0-9_\-\u4e00-\u9fff/]+/u)
    .map((token) => token.trim())
    .filter((token) => {
      if (GENERIC_RELATED_TOKENS.has(token)) return false;
      return /^[\u4e00-\u9fff]+$/u.test(token) ? token.length >= 2 : token.length >= 4;
    });
  return [...new Set(tokens.filter((token) => lower.includes(token)))]
    .slice(0, 3)
    .map((token) => ({ source: 'repo' as const, quote: token }));
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

function mapClassicResult(
  classic: Awaited<ReturnType<typeof resolveClassicResumeProbe>>,
  entrySource: CometEntryResolutionSource,
): CometEntryResumeProbeResult {
  return result({
    workflow: 'classic',
    skill: 'comet-classic',
    entrySource,
    action: classic.action,
    change:
      classic.changeName && classic.phase
        ? { name: classic.changeName, phase: classic.phase }
        : null,
    confidence: classic.confidence,
    reasonCode: `classic-${classic.action.replaceAll('_', '-')}`,
    reason: classic.reason,
    evidence: classic.evidence,
    candidates:
      classic.changeName && classic.phase
        ? [{ name: classic.changeName, phase: classic.phase, selected: false }]
        : [],
  });
}

async function resolveNativeResumeProbe(
  projectRoot: string,
  input: CometEntryResumeProbeInput,
  entrySource: CometEntryResolutionSource,
  intent: ResumeIntent,
): Promise<CometEntryResumeProbeResult> {
  const config = await readCachedProjectConfig(projectRoot);
  if (!config?.native) {
    throw new Error('.comet/config.yaml has no Native configuration after resolving Native entry');
  }
  await assertNoPendingNativeRootMove(projectRoot);
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root, {
    readOnly: true,
  });
  const sdkNames = await listNativeSdkChangeNames(projectRoot, { readOnly: true });
  const legacyNames = await listNativeChangeNames(paths);
  const knownNames = [...new Set([...legacyNames, ...sdkNames])].sort((left, right) =>
    left.localeCompare(right, 'en'),
  );
  const explicitlyNamed = namesInUtterance(intent.positiveText, knownNames);
  // A named request needs the named Run, not every unrelated historical Run.
  const inspectedNames = explicitlyNamed.length > 0 ? explicitlyNamed : knownNames;
  const sdkObservations = new Map<string, ReturnType<typeof inspectNativeSdkRun>>();
  const inspectSdk = (name: string) => {
    let observation = sdkObservations.get(name);
    if (!observation) {
      observation = inspectNativeSdkRun(projectRoot, name, { readOnly: true });
      sdkObservations.set(name, observation);
    }
    return observation;
  };
  const sdkNameSet = new Set(sdkNames);
  const names = (
    await inspectCandidates(inspectedNames, async (name) => {
      if (!sdkNameSet.has(name)) return name;
      const { run, state } = await inspectSdk(name);
      if (run.status === 'cancelled')
        return (await isNativeSdkCancellationComplete({ projectRoot, run })) ? null : name;
      return (run.status === 'running' || run.status === 'waiting') && state.status !== 'done'
        ? name
        : null;
    })
  ).filter((name): name is string => name !== null);
  let selectedName: string | null = null;
  let selectionError: string | null = null;
  try {
    const selection = await readNativeSelectionRecord(paths);
    if (selection && names.includes(selection.change)) {
      selectedName = selection.change;
    } else if (selection) {
      selectionError = `ENOENT: selected Native change ${selection.change} is missing or archived`;
    }
  } catch (error) {
    selectionError = error instanceof Error ? error.message : String(error);
  }
  if (names.length === 0) {
    const excludedScope = intent.outsideChange ? requestScopeDecision(intent, []) : null;
    if (excludedScope) {
      return result({
        workflow: 'native',
        skill: 'comet-native',
        entrySource,
        ...excludedScope,
        evidence: [{ source: 'user', quote: input.utterance.trim() }],
      });
    }
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      action: 'none',
      confidence: 'none',
      reasonCode: 'no-active-native-changes',
      reason: 'no active Native changes',
      candidates: [],
    });
  }

  const utterance = intent.positiveText;
  const { resumeLike } = intent;
  const currentChangeCommit = intent.commitLike && intent.currentChange;
  const resumeRequested = resumeLike || currentChangeCommit;
  const named = namesInUtterance(utterance, names);
  const targetName = named[0] ?? selectedName ?? (names.length === 1 ? names[0] : null);
  const candidates = await nativeResumeCandidates(
    paths,
    names,
    selectedName,
    targetName,
    inspectSdk,
  );
  const excludedNames = namesInUtterance(intent.negativeText, knownNames);
  const excludedCurrent = intent.excludesCurrentChange
    ? (selectedName ?? (knownNames.length === 1 ? knownNames[0] : null))
    : null;
  if (
    (intent.excludesCurrentChange && named.length === 0) ||
    (targetName && (excludedNames.includes(targetName) || targetName === excludedCurrent))
  ) {
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      action: 'out_of_scope',
      confidence: 'low',
      reasonCode: 'resume-target-excluded',
      reason: 'user excluded this change from the requested work',
      evidence: [{ source: 'user', quote: input.utterance.trim() }],
      candidates,
    });
  }
  const scopeDecision = requestScopeDecision(intent, names);
  if (scopeDecision) {
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      ...scopeDecision,
      evidence: [{ source: 'user', quote: input.utterance.trim() }],
      candidates,
    });
  }
  if (!input.agent_context.non_trivial_work && !resumeLike && !intent.commitLike) {
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      action: 'out_of_scope',
      confidence: 'low',
      reasonCode: 'request-not-workflow-work',
      reason: 'request is informational rather than workflow work',
      candidates,
    });
  }

  if (named.length > 1) {
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      action: 'ask_user',
      confidence: 'low',
      reasonCode: 'multiple-native-changes-named',
      reason: 'request names multiple active Native changes',
      evidence: named.map((name) => ({ source: 'user', quote: name })),
      candidates,
    });
  }

  if (!targetName) {
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      action: resumeRequested ? 'ask_user' : 'out_of_scope',
      confidence: 'low',
      reasonCode: resumeRequested ? 'multiple-native-changes' : 'request-unrelated',
      reason: resumeRequested
        ? 'multiple active Native changes require an explicit name or Native selection'
        : 'request does not identify an active Native change',
      ...(selectionError
        ? { evidence: [{ source: 'state' as const, quote: selectionError }] }
        : {}),
      candidates,
    });
  }

  const target = candidates.find((change) => change.name === targetName);
  let targetState: NativeChangeState | NativePortableState | null = null;
  let targetPortableStatus: NativePortableStatusProjection | null = null;
  let targetStateError: string | null = null;
  if (target) {
    try {
      if (await readSdkChangeOwner(projectRoot, 'native', target.name, { readOnly: true })) {
        const inspected = await inspectSdk(target.name);
        if (inspected.run.status === 'cancelled')
          throw new Error(
            'Native cancellation is incomplete; confirm the original execution has stopped with comet native doctor before continuing',
          );
        targetState = inspected.state;
      } else if (await isNativePortableChange(paths, target.name)) {
        const recoverable = await inspectPristineNativeSdkChange(paths, target.name);
        if (!recoverable) await assertNativePortableChangeNotOrphaned(paths, target.name);
        targetState = recoverable ?? (await readNativePortableChange(paths, target.name));
        targetPortableStatus = await inspectNativePortableStatus({ paths, name: target.name });
      } else {
        targetState = await readNativeChange(paths, target.name);
      }
    } catch (error) {
      targetStateError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!target || targetStateError || !targetState) {
    if (!resumeRequested && named.length === 0) {
      return result({
        workflow: 'native',
        skill: 'comet-native',
        entrySource,
        action: 'out_of_scope',
        change: { name: targetName, phase: target?.phase ?? 'invalid' },
        confidence: 'low',
        reasonCode: 'request-unrelated',
        reason: 'request does not identify the invalid Native change as its resume target',
        candidates,
      });
    }
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      action: 'ask_user',
      change: { name: targetName, phase: target?.phase ?? 'invalid' },
      confidence: 'low',
      reasonCode: 'native-change-invalid',
      reason: targetStateError ?? `selected Native change ${targetName} is unavailable`,
      evidence: [{ source: 'state', quote: `change: ${targetName}` }],
      candidates,
    });
  }

  const exactName = named[0] === target.name;
  const related =
    !resumeLike && !exactName && !currentChangeCommit
      ? await nativeRelatedEvidence(paths, target, targetState, utterance)
      : [];
  if (!resumeLike && !exactName && !currentChangeCommit && related.length === 0) {
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      action: 'out_of_scope',
      change: { name: target.name, phase: target.phase },
      confidence: 'low',
      reasonCode: 'request-unrelated',
      reason: 'request does not appear related to the active Native change',
      candidates,
    });
  }

  if (targetPortableStatus?.workspace.bindingState === 'mismatch') {
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      action: 'ask_user',
      change: { name: target.name, phase: target.phase },
      confidence: 'low',
      reasonCode: 'native-workspace-mismatch',
      reason: targetPortableStatus.workspace.message ?? 'Native workspace binding is invalid',
      evidence: [{ source: 'state', quote: `change: ${target.name}` }],
      candidates,
    });
  }

  const blockingFinding =
    targetState.schema === 'comet.native.v4'
      ? null
      : blockingNativeResumeFinding(await inspectNativeArtifactFindings(paths, targetState));
  if (blockingFinding) {
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      action: 'ask_user',
      change: { name: target.name, phase: target.phase },
      confidence: 'low',
      reasonCode: 'native-change-invalid',
      reason: blockingFinding.message,
      evidence: [
        { source: 'state', quote: `change: ${target.name}` },
        { source: 'state', quote: `finding: ${blockingFinding.code}` },
      ],
      candidates,
    });
  }

  const dirtyFiles = await gitDirtyFiles(projectRoot);
  return result({
    workflow: 'native',
    skill: 'comet-native',
    entrySource,
    action: 'auto_resume',
    change: { name: target.name, phase: target.phase },
    confidence: 'high',
    reasonCode: exactName
      ? 'native-change-named'
      : selectedName === target.name
        ? 'native-change-selected'
        : 'single-native-change-related',
    reason: 'configured Native workflow has one unambiguous related resume target',
    evidence: [
      { source: 'state', quote: `phase: ${target.phase}` },
      ...(exactName ? [{ source: 'user' as const, quote: target.name }] : related),
      ...(selectionError ? [{ source: 'state' as const, quote: selectionError }] : []),
      ...(dirtyFiles.length > 0
        ? [{ source: 'repo' as const, quote: `${dirtyFiles.length} dirty file(s)` }]
        : []),
    ],
    candidates,
  });
}

export async function resolveCometEntryResumeProbe(
  startPath: string,
  rawInput: unknown,
): Promise<CometEntryResumeProbeResult> {
  // Activate a per-invocation read cache so the project-root discovery and
  // config read below are shared with `resolveCometEntry` and the per-workflow
  // resolvers instead of being repeated 2-3 times.
  return runWithHookReadCache(() => resolveCometEntryResumeProbeImpl(startPath, rawInput));
}

async function resolveCometEntryResumeProbeImpl(
  startPath: string,
  rawInput: unknown,
): Promise<CometEntryResumeProbeResult> {
  const input = normalizeInput(rawInput);
  const utterance = input.utterance.trim();
  const intent = resolveResumeIntent(utterance);
  if (input.agent_context.already_in_comet_flow) {
    return result({
      action: 'out_of_scope',
      confidence: 'low',
      reasonCode: 'already-in-comet-flow',
      reason: 'already in Comet flow',
    });
  }
  if (intent.optedOut) {
    return result({
      action: 'out_of_scope',
      confidence: 'low',
      reasonCode: 'user-opted-out',
      reason: 'user opted out of Comet resume',
      evidence: [{ source: 'user', quote: utterance }],
    });
  }

  let projectRoot: string;
  let entry: Awaited<ReturnType<typeof resolveCometEntry>>;
  try {
    projectRoot = await discoverCachedNativeProject(startPath);
    // Read config once here; the cached read is reused by resolveCometEntry
    // and the per-workflow resolvers below, instead of each re-opening the
    // file. Check ambient_resume on the same cached config.
    const ambientConfig = await readCachedProjectConfig(projectRoot);
    if (ambientConfig !== null && !ambientConfig.ambient_resume) {
      return result({
        action: 'out_of_scope',
        confidence: 'none',
        reasonCode: 'ambient-resume-disabled',
        reason: 'Ambient Resume is disabled by .comet/config.yaml',
        evidence: [{ source: 'state', quote: 'ambient_resume: false' }],
      });
    }
    entry = await resolveCometEntry(projectRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result({
      action: 'ask_user',
      confidence: 'low',
      reasonCode: 'project-config-invalid',
      reason: message,
      evidence: [{ source: 'state', quote: message }],
    });
  }

  if (entry.workflow === 'classic') {
    const classicInput: ClassicResumeProbeInput = {
      schema_version: CLASSIC_RESUME_PROBE_SCHEMA_VERSION,
      utterance: intent.positiveText,
      locale: input.locale,
      agent_context: input.agent_context,
    };
    try {
      const classic = mapClassicResult(
        await resolveClassicResumeProbe(projectRoot, classicInput),
        entry.source,
      );
      if (classic.action === 'none') return classic;
      const names = classic.candidates.map(({ name }) => name);
      if (intent.excludesCurrentChange || namesInUtterance(intent.negativeText, names).length > 0) {
        return result({
          workflow: 'classic',
          skill: 'comet-classic',
          entrySource: entry.source,
          action: 'out_of_scope',
          confidence: 'low',
          reasonCode: 'resume-target-excluded',
          reason: 'user excluded this change from the requested work',
          evidence: [{ source: 'user', quote: utterance }],
        });
      }
      const scopeDecision = requestScopeDecision(intent, names);
      return scopeDecision
        ? result({
            workflow: 'classic',
            skill: 'comet-classic',
            entrySource: entry.source,
            ...scopeDecision,
            evidence: [{ source: 'user', quote: utterance }],
            candidates: classic.candidates,
          })
        : classic;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return result({
        workflow: 'classic',
        skill: 'comet-classic',
        entrySource: entry.source,
        action: 'ask_user',
        confidence: 'low',
        reasonCode: 'classic-state-invalid',
        reason: message,
        evidence: [{ source: 'state', quote: message }],
      });
    }
  }

  try {
    return await resolveNativeResumeProbe(projectRoot, input, entry.source, intent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource: entry.source,
      action: 'ask_user',
      confidence: 'low',
      reasonCode: 'native-state-invalid',
      reason: message,
      evidence: [{ source: 'state', quote: message }],
    });
  }
}
