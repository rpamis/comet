import { promises as fs, readFileSync } from 'fs';
import path from 'path';
import { stripUtf8Bom } from '../../platform/fs/strip-bom.js';
import { memoizedHookRead } from '../../platform/process/hook-read-cache.js';
import {
  assertClassicLayoutWritable,
  assertClassicLayoutReadable,
  classicProjectRelative,
  type ClassicLayoutPaths,
} from './classic-layout.js';
import { inspectClassicActiveChangeDirectory, openSpecChangeNameError } from './classic-paths.js';
import { inspectClassicProjectTarget } from './classic-protected-path.js';
import type { CometHookDecision, CometHookRequest } from '../comet-entry/hook-types.js';
import { scopeCometHookTargets } from '../workflow-contract/hook-target-scope.js';
import { configuredHookWritePath } from '../workflow-contract/hook-write-policy.js';
import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import {
  driftStaleReason,
  resolveBranchBinding,
  unboundDetachedMessage,
} from './classic-branch-binding.js';
import { resolveCurrentChange } from './classic-current-change.js';
import { classicGuardUserMessage, classicLocale } from './classic-output-language.js';
import { readClassicState, readLegacyState } from './classic-store.js';
import type { ClassicPhase, ClassicState } from './classic-state.js';
import {
  inspectClassicPlanReadiness,
  type ClassicPlanReadiness,
} from './classic-plan-readiness.js';

function result(exitCode: number, message: string): ClassicCommandResult {
  return { exitCode, stderr: message + '\n' };
}

function allowed(message: string): ClassicCommandResult {
  return result(0, `[COMET-HOOK] allowed: ${message}`);
}

function inputTarget(): string {
  if (process.env.FILE_PATH) return process.env.FILE_PATH;
  if (process.stdin.isTTY) return '';
  const input = stripUtf8Bom(readFileSync(0, 'utf8'));
  if (!input) return '';
  try {
    const parsed = JSON.parse(input) as { tool_input?: { file_path?: unknown } };
    return typeof parsed.tool_input?.file_path === 'string' ? parsed.tool_input.file_path : '';
  } catch {
    return '';
  }
}

function normalized(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+/gu, '/');
}

function comparisonKey(value: string): string {
  const normalizedValue = normalized(value);
  return process.platform === 'win32' ? normalizedValue.toLowerCase() : normalizedValue;
}

function parseProjectRoot(args: string[]): string {
  const index = args.indexOf('--project-root');
  const value = index >= 0 ? args[index + 1] : undefined;
  return path.resolve(value && !value.startsWith('--') ? value : process.cwd());
}

function relativeToProjectRoot(target: string, projectRoot: string): string | null {
  const relative = normalized(path.relative(projectRoot, target));
  if (relative === '') return '';
  if (relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) return null;
  return relative;
}

async function physicalPathForPossiblyMissingTarget(target: string): Promise<string | null> {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  const missingSegments: string[] = [];
  let cursor = resolved;

  while (cursor && cursor !== root) {
    try {
      const physicalBase = await fs.realpath(cursor);
      return path.join(physicalBase, ...missingSegments.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      missingSegments.push(path.basename(cursor));
      cursor = path.dirname(cursor);
    }
  }

  try {
    const physicalRoot = await fs.realpath(root);
    return path.join(physicalRoot, ...missingSegments.reverse());
  } catch {
    return null;
  }
}

async function projectRelative(target: string, projectRoot: string): Promise<string> {
  const rawCandidate = path.isAbsolute(target) ? target : path.resolve(projectRoot, target);
  let candidate = normalized(rawCandidate);
  const rootRelative = relativeToProjectRoot(rawCandidate, projectRoot);
  if (rootRelative !== null) return rootRelative;

  try {
    const physicalCandidate = await physicalPathForPossiblyMissingTarget(rawCandidate);
    const physicalRoot = await fs.realpath(projectRoot);
    if (physicalCandidate) {
      const physicalRootRelative = relativeToProjectRoot(physicalCandidate, physicalRoot);
      if (physicalRootRelative !== null) return physicalRootRelative;
      candidate = normalized(physicalCandidate);
    }
  } catch {
    if (!path.isAbsolute(target)) return normalized(target).replace(/^\.\//u, '');
  }
  return candidate.replace(/^\.\//u, '');
}

interface GoverningChange {
  changeDir: string | null;
  phase: ClassicPhase;
  classic: ClassicState | null;
  archived: boolean;
  invalidState?: boolean;
  superpowersArtifact?: 'matched' | 'unmatched';
  superpowersSlot?: SuperpowersArtifactSlot;
}

interface GoverningBlock {
  blockedResult: ClassicCommandResult;
}

type GoverningResolution = GoverningChange | GoverningBlock | null;

async function loadGoverningChange(changeDir: string): Promise<GoverningChange | null> {
  try {
    const projection = await readClassicState(changeDir, { migrate: false });
    const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
    if (unknownKeys.length > 0) {
      throw new Error(`Invalid Classic state: unknown field(s): ${unknownKeys.join(', ')}`);
    }
    if (!projection.classic) throw new Error('Classic state projection is unavailable');
    return {
      changeDir,
      phase: projection.classic.phase,
      classic: projection.classic,
      archived: projection.classic.archived,
    };
  } catch (error) {
    // Legacy/partial state without the required Classic fields: fall back to a
    // direct yaml read so the guard still respects the recorded phase rather
    // than crashing the way master's lenient shell scripts did not.
    const legacy = await readLegacyState(changeDir);
    if (!legacy.phase) return null;
    return {
      changeDir,
      phase: legacy.phase,
      classic: null,
      archived: legacy.archived,
      invalidState: error instanceof Error && error.message.includes('unknown field'),
    };
  }
}

async function activeChangesImpl(projectRoot: string): Promise<GoverningChange[]> {
  const changesDir = (await assertClassicLayoutReadable(projectRoot)).changesDir;
  const governingChanges: GoverningChange[] = [];
  const changesInspection = await inspectClassicProjectTarget(projectRoot, changesDir, {
    label: 'Classic changes directory',
    expected: 'directory',
  });
  if (!changesInspection.exists) return governingChanges;
  for (const entry of (await fs.readdir(changesDir, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (entry.name === 'archive') continue;
    if (openSpecChangeNameError(entry.name)) continue;
    const active = await inspectClassicActiveChangeDirectory(entry.name, projectRoot);
    if (!active.exists || !active.stateExists) continue;
    const governing = await loadGoverningChange(active.directory);
    if (!governing || governing.archived) continue;
    governingChanges.push(governing);
  }
  return governingChanges;
}

// `activeChanges` is invoked once by the router's `listActiveClassicHookChanges`
// and again by `inspectClassicHookGuard`. Within a single Hook decision the
// changes directory is immutable, so memoize the enumeration to avoid a second
// readdir + per-change state read. CLI commands bypass this cache.
const activeChanges = memoizedHookRead('classicActiveChanges', (projectRoot: string) =>
  activeChangesImpl(projectRoot),
);
const hookPlanReadiness = memoizedHookRead('classicPlanReadiness', inspectClassicPlanReadiness);

export interface ActiveClassicHookChange {
  workflow: 'classic';
  name: string;
  phase: ClassicPhase;
}

export interface ClassicHookGuardDependencies {
  scopeTargets?: typeof scopeCometHookTargets;
}

export async function listActiveClassicHookChanges(
  projectRoot: string,
): Promise<ActiveClassicHookChange[]> {
  return (await activeChanges(projectRoot)).map((change) => ({
    workflow: 'classic',
    name: governingChangeName(change)!,
    phase: change.phase,
  }));
}

function superpowersArtifactPrefix(projectRoot: string, layout: ClassicLayoutPaths): string {
  return `${classicProjectRelative(projectRoot, layout.superpowersRoot)}/`;
}

function isSuperpowersArtifactPath(relativePath: string, prefix: string): boolean {
  return comparisonKey(relativePath).startsWith(comparisonKey(prefix));
}

type SuperpowersArtifactField = 'designDoc' | 'plan' | 'verificationReport';

interface SuperpowersArtifactSlot {
  prefix: string;
  field: SuperpowersArtifactField;
  wireField: 'design_doc' | 'plan' | 'verification_report';
  phase: 'design' | 'build' | 'verify';
}

function superpowersArtifactSlots(
  projectRoot: string,
  layout: ClassicLayoutPaths,
): readonly SuperpowersArtifactSlot[] {
  return [
    {
      prefix: `${classicProjectRelative(projectRoot, layout.superpowersSpecsDir)}/`,
      field: 'designDoc',
      wireField: 'design_doc',
      phase: 'design',
    },
    {
      prefix: `${classicProjectRelative(projectRoot, layout.superpowersPlansDir)}/`,
      field: 'plan',
      wireField: 'plan',
      phase: 'build',
    },
    {
      prefix: `${classicProjectRelative(projectRoot, layout.superpowersReportsDir)}/`,
      field: 'verificationReport',
      wireField: 'verification_report',
      phase: 'verify',
    },
  ];
}

function standardSuperpowersArtifactSlot(
  relativePath: string,
  slots: readonly SuperpowersArtifactSlot[],
): SuperpowersArtifactSlot | null {
  const key = comparisonKey(relativePath);
  const slot = slots.find((candidate) => key.startsWith(comparisonKey(candidate.prefix)));
  if (!slot) return null;
  const fileName = key.slice(comparisonKey(slot.prefix).length);
  if (!fileName || fileName.includes('/') || !fileName.endsWith('.md')) return null;
  return slot;
}

function superpowersArtifactValue(
  governing: GoverningChange,
  slot: SuperpowersArtifactSlot,
): string | null {
  return governing.classic?.[slot.field] ?? null;
}

function allowsFirstSuperpowersArtifactWrite(
  governing: GoverningChange,
  slot: SuperpowersArtifactSlot,
): boolean {
  return (
    governing.classic !== null &&
    governing.phase === slot.phase &&
    !superpowersArtifactValue(governing, slot)
  );
}

async function allowsSuperpowersArtifactWrite(
  projectRoot: string,
  governing: GoverningChange,
  slot: SuperpowersArtifactSlot,
): Promise<boolean> {
  if (allowsFirstSuperpowersArtifactWrite(governing, slot)) return true;
  if (slot.field !== 'plan' || governing.phase !== 'build') return false;
  return (
    (await hookPlanReadiness(projectRoot, governing.classic?.plan ?? null)).status === 'broken'
  );
}

function allowsSuperpowersArtifacts(governing: GoverningChange): boolean {
  return (
    governing.phase === 'design' || governing.phase === 'build' || governing.phase === 'verify'
  );
}

function governingChangeName(governing: GoverningChange): string | null {
  return governing.changeDir ? path.basename(governing.changeDir) : null;
}

const SUPERPOWERS_ARTIFACT_SUFFIXES = new Set([
  'design',
  'plan',
  'verify',
  'verification',
  'verification-report',
  'report',
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function matchesRecordedSuperpowersArtifact(
  relativePath: string,
  governing: GoverningChange,
): boolean {
  const artifactPaths = [
    governing.classic?.designDoc,
    governing.classic?.plan,
    governing.classic?.verificationReport,
  ];
  return artifactPaths.some(
    (artifactPath) => artifactPath && comparisonKey(artifactPath) === comparisonKey(relativePath),
  );
}

function matchesSuperpowersArtifactName(relativePath: string, changeName: string): boolean {
  const fileName = relativePath.split('/').at(-1) ?? relativePath;
  const stem = fileName.replace(/\.[^.]+$/u, '');
  if (stem === changeName) return true;

  const suffixes = [...SUPERPOWERS_ARTIFACT_SUFFIXES].map(escapeRegex).join('|');
  const pattern = new RegExp(`(^|[-_.])${escapeRegex(changeName)}[-_.](${suffixes})$`, 'u');
  return pattern.test(stem);
}

async function superpowersArtifactGoverningChange(
  relativePath: string,
  projectRoot: string,
): Promise<{ governing: GoverningChange; match: 'recorded' | 'named' } | null> {
  const active = await activeChanges(projectRoot);
  const recorded = active.find((governing) =>
    matchesRecordedSuperpowersArtifact(relativePath, governing),
  );
  if (recorded) return { governing: recorded, match: 'recorded' };

  const eligible = active.filter(allowsSuperpowersArtifacts);
  const named = eligible
    .filter((governing) => {
      const name = governingChangeName(governing);
      return name !== null && matchesSuperpowersArtifactName(relativePath, name);
    })
    .sort(
      (a, b) => (governingChangeName(b)?.length ?? 0) - (governingChangeName(a)?.length ?? 0),
    )[0];
  if (named) return { governing: named, match: 'named' };

  return null;
}

async function repoSourceGoverningChange(
  projectRoot: string,
  relativePath: string,
  selectedChangeName?: string,
): Promise<GoverningResolution> {
  const active = await activeChanges(projectRoot);
  if (active.length === 0) return null;

  if (selectedChangeName) {
    const selected = active.find(
      (governing) => governingChangeName(governing) === selectedChangeName,
    );
    return (
      selected ?? {
        blockedResult: blockedStaleSelection(
          relativePath,
          `selected change '${selectedChangeName}' is no longer active`,
        ),
      }
    );
  }

  const current = await resolveCurrentChange(projectRoot);
  if (current.status === 'stale') {
    return { blockedResult: blockedStaleSelection(relativePath, current.reason) };
  }
  if (current.status === 'selected') {
    const selected = active.find(
      (governing) => governingChangeName(governing) === current.selection.change,
    );
    if (selected) return selected;
    return {
      blockedResult: blockedStaleSelection(
        relativePath,
        `selected change '${current.selection.change}' is no longer active`,
      ),
    };
  }
  if (active.length === 1) {
    // No selection file exists, so the drift check inside
    // resolveCurrentChange never ran — enforce the branch binding here
    // (read-only) before letting the sole active change govern the write.
    const sole = active[0];
    if (sole.changeDir !== null) {
      const outcome = await resolveBranchBinding(sole.changeDir, {
        heal: false,
        cwd: projectRoot,
      });
      const name = governingChangeName(sole) ?? 'unknown';
      if (outcome.status === 'drift') {
        return {
          blockedResult: blockedStaleSelection(
            relativePath,
            driftStaleReason(name, outcome.boundBranch, outcome.currentBranch),
          ),
        };
      }
      if (outcome.status === 'unbound-detached') {
        return {
          blockedResult: blockedStaleSelection(relativePath, unboundDetachedMessage(name)),
        };
      }
    }
    return sole;
  }
  return {
    blockedResult: blockedMultipleChanges(
      relativePath,
      active.map((governing) => governingChangeName(governing)!).filter(Boolean),
    ),
  };
}

async function governingChange(
  relativePath: string,
  projectRoot: string,
  layout: ClassicLayoutPaths,
  selectedChangeName?: string,
): Promise<GoverningResolution> {
  const prefix = `${classicProjectRelative(projectRoot, layout.changesDir)}/`;
  if (relativePath.startsWith(prefix)) {
    const rest = relativePath.slice(prefix.length);
    const [name] = rest.split('/');
    if (name && name !== 'archive') {
      const active = await inspectClassicActiveChangeDirectory(name, projectRoot);
      if (active.stateExists) {
        const governing = await loadGoverningChange(active.directory);
        if (governing) return governing;
        return { changeDir: active.directory, phase: 'open', classic: null, archived: false };
      }
      return { changeDir: active.directory, phase: 'open', classic: null, archived: false };
    }
  }
  if (isSuperpowersArtifactPath(relativePath, superpowersArtifactPrefix(projectRoot, layout))) {
    const superpowers = await superpowersArtifactGoverningChange(relativePath, projectRoot);
    if (superpowers?.match === 'recorded') {
      return { ...superpowers.governing, superpowersArtifact: 'matched' };
    }

    const slot = standardSuperpowersArtifactSlot(
      relativePath,
      superpowersArtifactSlots(projectRoot, layout),
    );
    if (superpowers) {
      return slot
        ? {
            ...superpowers.governing,
            superpowersArtifact: (await allowsSuperpowersArtifactWrite(
              projectRoot,
              superpowers.governing,
              slot,
            ))
              ? 'matched'
              : 'unmatched',
            superpowersSlot: slot,
          }
        : { ...superpowers.governing, superpowersArtifact: 'matched' };
    }
    if (slot) {
      const candidate = await repoSourceGoverningChange(
        projectRoot,
        relativePath,
        selectedChangeName,
      );
      if (!candidate || 'blockedResult' in candidate) return candidate;
      return {
        ...candidate,
        superpowersArtifact: (await allowsSuperpowersArtifactWrite(projectRoot, candidate, slot))
          ? 'matched'
          : 'unmatched',
        superpowersSlot: slot,
      };
    }

    const active = await activeChanges(projectRoot);
    const fallback = selectedChangeName
      ? (active.find((candidate) => governingChangeName(candidate) === selectedChangeName) ?? null)
      : (active[0] ?? null);
    return fallback ? { ...fallback, superpowersArtifact: 'unmatched' } : null;
  }
  return repoSourceGoverningChange(projectRoot, relativePath, selectedChangeName);
}

function isRootMarkdown(relativePath: string): boolean {
  return !relativePath.includes('/') && relativePath.endsWith('.md');
}

function isCometConfig(relativePath: string): boolean {
  return relativePath.startsWith('.comet/') || relativePath.includes('/.comet/');
}

function isSuperpowersWorkspace(relativePath: string): boolean {
  return relativePath === '.superpowers' || relativePath.startsWith('.superpowers/');
}

function openSpecAllowed(
  relativePath: string,
  phase: ClassicPhase,
  openSpecPrefix: string,
): string | null {
  if (!relativePath.startsWith(openSpecPrefix)) return null;
  const stateFile =
    relativePath.endsWith('/.comet.yaml') || relativePath.endsWith('/.openspec.yaml');
  const proposal =
    relativePath.endsWith('/proposal.md') ||
    relativePath.endsWith('/design.md') ||
    relativePath.endsWith('/tasks.md');
  const handoff = relativePath.includes('/.comet/');
  const specs = relativePath.includes('/specs/');

  if (phase === 'open' && (proposal || stateFile || handoff || specs)) {
    return `${relativePath} (phase: open, openspec artifacts)`;
  }
  if (phase === 'design' && (proposal || stateFile || handoff || specs)) {
    return `${relativePath} (phase: design, handoff/spec)`;
  }
  if (phase === 'build' && (relativePath.endsWith('/tasks.md') || stateFile || specs)) {
    return `${relativePath} (phase: build, spec/tasks)`;
  }
  if (phase === 'verify' && stateFile) {
    return `${relativePath} (phase: verify, state)`;
  }
  if (phase === 'archive' && stateFile) {
    return `${relativePath} (phase: archive, state)`;
  }
  return null;
}

function blocked(
  relativePath: string,
  phase: ClassicPhase,
  locale: ReturnType<typeof classicLocale>,
): ClassicCommandResult {
  const guidance =
    phase === 'open'
      ? [
          '  BLOCKED: source writes are not allowed during open',
          '  This phase does not allow source writes',
          '  ALLOWED: create proposal/design/tasks artifacts and run guard',
          '  NEXT: finish clarification and artifacts, then run guard --apply',
        ]
      : phase === 'design'
        ? [
            '  BLOCKED: source writes are not allowed during design',
            '  This phase does not allow source writes',
            '  ALLOWED: run brainstorming, create the Design Doc, and run guard',
            '  NEXT: finish the Design Doc, then run comet guard <change-name> design --apply to enter build',
          ]
        : phase === 'verify'
          ? [
              '  BLOCKED: implementation writes are not allowed during verify',
              '  This phase allows verification reports and state updates only',
              '  NEXT: run verify-fail and return to build before repairing implementation',
            ]
          : [
              '  BLOCKED: source writes are not allowed during archive',
              '  This phase does not allow source writes',
              '  ALLOWED: confirm archive state and run the archive script',
            ];
  return blockedBanner(relativePath, phase, phase, locale, guidance);
}

function blockedBanner(
  relativePath: string,
  phase: string,
  phaseLabel: string,
  locale: ReturnType<typeof classicLocale>,
  guidance: readonly string[],
): ClassicCommandResult {
  const user = classicGuardUserMessage(phaseLabel, locale);
  return result(
    2,
    [
      '',
      '╔══════════════════════════════════════════╗',
      '║     COMET PHASE GUARD — WRITE BLOCKED    ║',
      '╚══════════════════════════════════════════╝',
      '',
      `  Current phase: ${phase}`,
      `  Target file: ${relativePath}`,
      '',
      `  ${user.summary}`,
      `  RELAY TO USER: ${user.user_message}`,
      '',
      ...guidance,
      '',
    ].join('\n'),
  );
}

function blockedMissingDesignDoc(
  relativePath: string,
  locale: ReturnType<typeof classicLocale>,
): ClassicCommandResult {
  return blockedBanner(
    relativePath,
    'build (workflow: full), but design_doc is empty',
    'build',
    locale,
    [
      '  BLOCKED: full workflow source writes require a recorded Design Doc',
      '  This phase does not allow source writes until design_doc is recorded',
      '  NEXT: return to design, create/link the Design Doc, then run guard again',
    ],
  );
}

function blockedPlanNotReady(
  relativePath: string,
  governing: GoverningChange,
  planReadiness: Exclude<ClassicPlanReadiness, { status: 'ready' }>,
  projectRoot: string,
  layout: ClassicLayoutPaths,
): ClassicCommandResult {
  const name = governingChangeName(governing) ?? '<change-name>';
  const missing = planReadiness.status === 'missing';
  const errorCode = missing ? 'classic-build-plan-missing' : 'classic-build-plan-broken';
  const state = missing
    ? 'plan is not recorded'
    : 'the recorded plan path does not resolve to a file';
  const recorded = missing ? [] : [`RECORDED_PLAN: ${planReadiness.recordedPath}`];
  const changeDirectory = governing.changeDir
    ? classicProjectRelative(projectRoot, governing.changeDir)
    : '<classic-change-dir>';
  const plansDirectory = classicProjectRelative(projectRoot, layout.superpowersPlansDir);
  const createCommand = missing
    ? `comet state set ${name} plan <repository-relative-plan-path>`
    : `comet state set ${name} plan <new-repository-relative-plan-path>`;
  const repair = missing
    ? [
        '2. Load the Superpowers writing-plans Skill.',
        `3. Read the Design Doc path from "comet state get ${name} design_doc" and read ${changeDirectory}/tasks.md.`,
        `4. Create the implementation plan under ${plansDirectory}/.`,
        '5. Record the plan path:',
        `   ${createCommand}`,
      ]
    : [
        `2. Restore the plan file at ${planReadiness.recordedPath}, or load the Superpowers writing-plans Skill and create a replacement under ${plansDirectory}/.`,
        '3. When creating a replacement, record its path:',
        `   ${createCommand}`,
      ];

  return result(
    2,
    [
      '',
      '╔══════════════════════════════════════════╗',
      '║     COMET PHASE GUARD — WRITE BLOCKED    ║',
      '╚══════════════════════════════════════════╝',
      '',
      `ERROR_CODE: ${errorCode}`,
      `CHANGE: ${name}`,
      'WORKFLOW: full',
      'PHASE: build',
      `TARGET: ${relativePath}`,
      `STATE: ${state}`,
      ...recorded,
      '',
      'BLOCKED: project source writes require a ready Superpowers implementation plan.',
      '',
      'ALLOWED_RECOVERY_WRITES:',
      `- ${plansDirectory}/<plan-file>.md`,
      '- Comet state updates performed by the comet CLI',
      `- ${changeDirectory} artifacts allowed by the build phase`,
      '',
      'RECOVERY:',
      `1. Invoke /comet-build for ${name} and resume Step 1.`,
      ...repair,
      `${missing ? '6' : '4'}. Verify recovery:`,
      `   comet state check ${name} build --recover`,
      '',
      'SUCCESS: plan is reported as DONE and recovery advances beyond plan creation.',
      `RETRY: retry the original Write/Edit for ${relativePath} only after SUCCESS.`,
      'PROHIBITED: do not treat tasks.md as the implementation plan or write project source before SUCCESS.',
      'If writing-plans is unavailable, stop and report the missing Skill instead of bypassing this check.',
      '',
    ].join('\n'),
  );
}

function blockedUnmatchedSuperpowersArtifact(
  relativePath: string,
  governing: GoverningChange,
): ClassicCommandResult {
  const slot = governing.superpowersSlot;
  const recorded = slot ? superpowersArtifactValue(governing, slot) : null;
  const details = slot
    ? governing.phase !== slot.phase
      ? [
          `  BLOCKED: ${slot.wireField} cannot be first-written in phase ${governing.phase}`,
          `  Expected phase: ${slot.phase}`,
          '  NEXT: resume the matching Comet phase or use an already recorded artifact path',
        ]
      : recorded
        ? [
            `  BLOCKED: ${slot.wireField} is already recorded for this change`,
            `  Recorded path: ${recorded}`,
            '  NEXT: write the recorded artifact or explicitly correct the state path',
          ]
        : [
            '  BLOCKED: standard Superpowers artifact state is incomplete',
            '  NEXT: validate the active change state, then retry the matching phase',
          ]
    : [
        '  BLOCKED: unmatched Superpowers artifact',
        '  This docs/superpowers/ path does not match any active change artifact',
        '  NEXT: use a recorded artifact path or a standard phase artifact directory',
      ];

  return result(
    2,
    [
      '',
      '╔══════════════════════════════════════════╗',
      '║     COMET PHASE GUARD — WRITE BLOCKED    ║',
      '╚══════════════════════════════════════════╝',
      '',
      `  Current phase: ${governing.phase}`,
      `  Target file: ${relativePath}`,
      '',
      ...details,
      '',
    ].join('\n'),
  );
}

function blockedMultipleChanges(relativePath: string, changeNames: string[]): ClassicCommandResult {
  return result(
    2,
    [
      '',
      '╔══════════════════════════════════════════╗',
      '║     COMET PHASE GUARD — WRITE BLOCKED    ║',
      '╚══════════════════════════════════════════╝',
      '',
      '  BLOCKED: multiple active changes require a current change',
      `  Target file: ${relativePath}`,
      `  Active changes: ${changeNames.join(', ')}`,
      '',
      '  NEXT: run comet state select <change-name>, then retry the source write',
      '',
    ].join('\n'),
  );
}

function blockedStaleSelection(relativePath: string, reason: string): ClassicCommandResult {
  return result(
    2,
    [
      '',
      '╔══════════════════════════════════════════╗',
      '║     COMET PHASE GUARD — WRITE BLOCKED    ║',
      '╚══════════════════════════════════════════╝',
      '',
      '  BLOCKED: current change selection is stale or invalid',
      `  Target file: ${relativePath}`,
      `  Reason: ${reason}`,
      '',
      '  NEXT: run comet state select <change-name>, then retry the source write',
      '',
    ].join('\n'),
  );
}

async function inspectClassicHookTarget(
  projectRoot: string,
  target: string,
  selectedChangeName?: string,
  scopeTargets: typeof scopeCometHookTargets = scopeCometHookTargets,
): Promise<ClassicCommandResult> {
  try {
    const scoped = await scopeTargets(projectRoot, [target]);
    if (scoped.projectTargets.length === 0) {
      return allowed(`${target} (outside guarded project)`);
    }
  } catch (error) {
    return result(
      2,
      [
        `[COMET-HOOK] blocked: scope could not be determined safely for ${target}.`,
        `REASON: ${error instanceof Error ? error.message : String(error)}`,
        'NEXT: verify that the project root is accessible, then retry the write.',
      ].join('\n'),
    );
  }
  const relativePath = await projectRelative(target, projectRoot);
  let layout: ClassicLayoutPaths;
  try {
    layout = await assertClassicLayoutWritable(projectRoot);
  } catch (error) {
    return result(
      2,
      `[COMET-HOOK] blocked: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (isCometConfig(relativePath)) {
    return allowed(`${relativePath} (whitelist: comet config)`);
  }
  if (isSuperpowersWorkspace(relativePath)) {
    return allowed(`${relativePath} (whitelist: superpowers workspace)`);
  }
  if (
    relativePath === 'CLAUDE.md' ||
    relativePath === 'CHANGELOG.md' ||
    relativePath === 'README.md' ||
    isRootMarkdown(relativePath)
  ) {
    return allowed(`${relativePath} (whitelist: root markdown)`);
  }

  const configuredAllowPath = await configuredHookWritePath(projectRoot, target, [
    path.join(projectRoot, '.comet'),
    layout.openSpecRoot,
    layout.superpowersRoot,
  ]);
  if (configuredAllowPath) return allowed(configuredAllowPath);

  let governing: GoverningResolution;
  try {
    governing = await governingChange(relativePath, projectRoot, layout, selectedChangeName);
  } catch (error) {
    return result(
      2,
      `[COMET-HOOK] blocked: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!governing) return allowed('no active comet change');
  if ('blockedResult' in governing) return governing.blockedResult;
  if (governing.archived) return allowed(`${relativePath} (own change archived)`);

  const phase = governing.phase;

  const openSpec = openSpecAllowed(
    relativePath,
    phase,
    `${classicProjectRelative(projectRoot, layout.openSpecRoot)}/`,
  );
  if (openSpec) return allowed(openSpec);
  if (isSuperpowersArtifactPath(relativePath, superpowersArtifactPrefix(projectRoot, layout))) {
    if (governing.superpowersArtifact === 'matched' && allowsSuperpowersArtifacts(governing)) {
      return allowed(`${relativePath} (phase: ${phase}, superpowers)`);
    }
    if (governing.superpowersArtifact === 'unmatched') {
      return blockedUnmatchedSuperpowersArtifact(relativePath, governing);
    }
  }
  if (governing.invalidState) {
    return result(
      2,
      `[COMET-HOOK] blocked: active Classic state is invalid; repair .comet.yaml before writing ${relativePath}`,
    );
  }
  if (phase === 'build' && governing.classic?.workflow === 'full' && !governing.classic.designDoc) {
    return blockedMissingDesignDoc(relativePath, classicLocale(governing.classic?.language));
  }
  if (phase === 'build' && governing.classic?.workflow === 'full') {
    const planReadiness = await hookPlanReadiness(projectRoot, governing.classic.plan);
    if (planReadiness.status !== 'ready') {
      return blockedPlanNotReady(relativePath, governing, planReadiness, projectRoot, layout);
    }
  }
  if (phase === 'build') {
    return allowed(`${relativePath} (phase: ${phase})`);
  }
  return blocked(relativePath, phase, classicLocale(governing.classic?.language));
}

export async function inspectClassicHookGuard(
  projectRoot: string,
  changeName: string,
  request: CometHookRequest,
  dependencies: ClassicHookGuardDependencies = {},
): Promise<CometHookDecision> {
  if (request.intent !== 'non-write') {
    try {
      await assertClassicLayoutWritable(projectRoot);
    } catch (error) {
      return {
        allowed: false,
        reason: error instanceof Error ? error.message : String(error),
        workflow: 'classic',
        change: changeName,
      };
    }
  }
  let active: GoverningChange[];
  try {
    active = await activeChanges(projectRoot);
  } catch (error) {
    return {
      allowed: false,
      reason: error instanceof Error ? error.message : String(error),
      workflow: 'classic',
      change: changeName,
    };
  }
  const selected = active.find((change) => governingChangeName(change) === changeName);
  if (!selected) {
    return {
      allowed: false,
      reason: `Selected Classic change ${changeName} is missing or archived; resume /comet-classic before retrying`,
      workflow: 'classic',
      change: changeName,
    };
  }
  if (request.intent === 'non-write') {
    return { allowed: true, reason: 'Hook event is not a write' };
  }
  if (request.intent === 'unknown' || request.targets.length === 0) {
    return {
      allowed: true,
      reason: 'Hook write target was not attributed to the guarded project',
      workflow: 'classic',
      change: changeName,
      phase: selected.phase,
    };
  }

  let configuredTarget = false;
  for (const target of request.targets) {
    const inspected = await inspectClassicHookTarget(
      projectRoot,
      target,
      changeName,
      dependencies.scopeTargets,
    );
    if (inspected.exitCode !== 0) {
      return {
        allowed: false,
        reason: inspected.stderr?.trim() || 'Classic phase guard blocked the write',
        workflow: 'classic',
        change: changeName,
        phase: selected.phase,
      };
    }
    if (inspected.stderr?.includes('configured Hook allow path')) configuredTarget = true;
  }
  return {
    allowed: true,
    reason: configuredTarget
      ? 'Classic write allowed by configured Hook allow path'
      : `Classic write allowed in ${selected.phase}`,
    workflow: 'classic',
    change: changeName,
    phase: selected.phase,
  };
}

export const classicHookGuardCommand: ClassicCommandHandler = async (args) => {
  const projectRoot = parseProjectRoot(args);
  const target = inputTarget();
  if (!target) return allowed('no file path in tool input');
  return inspectClassicHookTarget(projectRoot, target);
};
