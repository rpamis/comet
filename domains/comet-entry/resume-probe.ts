import { spawn } from 'child_process';
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
import { nativeChangeDir, readNativeChange } from '../comet-native/native-change.js';
import { assertNoPendingNativeRootMove, readProjectConfig } from '../comet-native/native-config.js';
import {
  inspectNativeArtifactFindings,
  listNativeStatus,
} from '../comet-native/native-diagnostics.js';
import { discoverNativeProject, nativeProjectPaths } from '../comet-native/native-paths.js';
import { resolveSelectedNativeChange } from '../comet-native/native-selection.js';
import { readNativeProposedSpecs } from '../comet-native/native-specs.js';
import type {
  NativeChangeState,
  NativeFinding,
  NativeProjectPaths,
  NativeStatusProjection,
} from '../comet-native/native-types.js';
import { resolveCometEntry } from './resolve-entry.js';
import type { CometEntryResolutionSource, CometEntrySkill, CometWorkflow } from './types.js';
import { readAmbientResumeEnabled } from '../workflow-contract/project-config.js';

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

const RESUME_WORDS = [
  'continue',
  'resume',
  'carry on',
  'finish',
  '继续',
  '接着',
  '恢复',
  '跑完',
  '提交',
  '验证',
  '归档',
  '修刚才',
] as const;

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
] as const;

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

function includesAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function namesInUtterance(
  utterance: string,
  candidates: readonly CometEntryResumeProbeCandidate[],
): CometEntryResumeProbeCandidate[] {
  const lower = utterance.toLowerCase();
  return candidates.filter((candidate) => {
    const pattern = new RegExp(
      `(?:^|[^a-z0-9_-])${escapeRegExp(candidate.name.toLowerCase())}(?=$|[^a-z0-9_-])`,
      'u',
    );
    return pattern.test(lower);
  });
}

async function nativeRelatedEvidence(
  paths: NativeProjectPaths,
  change: NativeStatusProjection,
  utterance: string,
): Promise<CometResumeProbeEvidence[]> {
  let source: string;
  try {
    const state = await readNativeChange(paths, change.name);
    const specs = await readNativeProposedSpecs(paths, change.name);
    source = [
      change.name,
      await fs.readFile(path.join(nativeChangeDir(paths, change.name), state.brief), 'utf8'),
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
  return new Promise((resolve) => {
    const child = spawn('git', ['status', '--short', '--untracked-files=all'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on('error', () => resolve([]));
    child.on('exit', (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      resolve(
        Buffer.concat(chunks)
          .toString('utf8')
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean),
      );
    });
  });
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
): Promise<CometEntryResumeProbeResult> {
  const config = await readProjectConfig(projectRoot);
  if (!config) throw new Error('.comet/config.yaml was not found after resolving Native entry');
  await assertNoPendingNativeRootMove(projectRoot);
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  const statuses = await listNativeStatus(paths);
  let selectedName: string | null = null;
  let selectionError: string | null = null;
  try {
    selectedName = await resolveSelectedNativeChange(paths);
  } catch (error) {
    selectionError = error instanceof Error ? error.message : String(error);
  }
  const candidates = statuses.map((change) => ({
    name: change.name,
    phase: change.phase,
    selected: change.name === selectedName,
  }));
  if (statuses.length === 0) {
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      action: 'none',
      confidence: 'none',
      reasonCode: 'no-active-native-changes',
      reason: 'no active Native changes',
      candidates,
    });
  }

  const utterance = input.utterance.trim();
  const lower = utterance.toLowerCase();
  const resumeLike = includesAny(lower, RESUME_WORDS);
  if (!input.agent_context.non_trivial_work && !resumeLike) {
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

  const named = namesInUtterance(utterance, candidates);
  if (named.length > 1) {
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      action: 'ask_user',
      confidence: 'low',
      reasonCode: 'multiple-native-changes-named',
      reason: 'request names multiple active Native changes',
      evidence: named.map((change) => ({ source: 'user', quote: change.name })),
      candidates,
    });
  }

  const targetName =
    named[0]?.name ?? selectedName ?? (statuses.length === 1 ? statuses[0].name : null);
  if (!targetName) {
    return result({
      workflow: 'native',
      skill: 'comet-native',
      entrySource,
      action: resumeLike ? 'ask_user' : 'out_of_scope',
      confidence: 'low',
      reasonCode: resumeLike ? 'multiple-native-changes' : 'request-unrelated',
      reason: resumeLike
        ? 'multiple active Native changes require an explicit name or Native selection'
        : 'request does not identify an active Native change',
      ...(selectionError
        ? { evidence: [{ source: 'state' as const, quote: selectionError }] }
        : {}),
      candidates,
    });
  }

  const target = statuses.find((change) => change.name === targetName);
  let targetState: NativeChangeState | null = null;
  let targetStateError: string | null = null;
  if (target) {
    try {
      targetState = await readNativeChange(paths, target.name);
    } catch (error) {
      targetStateError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!target || targetStateError || !targetState) {
    if (!resumeLike && named.length === 0) {
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

  const exactName = named[0]?.name === target.name;
  const related = exactName ? [] : await nativeRelatedEvidence(paths, target, utterance);
  if (!resumeLike && !exactName && related.length === 0) {
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

  const blockingFinding = blockingNativeResumeFinding(
    await inspectNativeArtifactFindings(paths, targetState),
  );
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
  const input = normalizeInput(rawInput);
  const utterance = input.utterance.trim();
  const lower = utterance.toLowerCase();
  if (input.agent_context.already_in_comet_flow) {
    return result({
      action: 'out_of_scope',
      confidence: 'low',
      reasonCode: 'already-in-comet-flow',
      reason: 'already in Comet flow',
    });
  }
  if (includesAny(lower, OPT_OUT_WORDS)) {
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
    projectRoot = await discoverNativeProject(startPath);
    if (!(await readAmbientResumeEnabled(projectRoot))) {
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
      utterance: input.utterance,
      locale: input.locale,
      agent_context: input.agent_context,
    };
    try {
      return mapClassicResult(
        await resolveClassicResumeProbe(projectRoot, classicInput),
        entry.source,
      );
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
    return await resolveNativeResumeProbe(projectRoot, input, entry.source);
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
