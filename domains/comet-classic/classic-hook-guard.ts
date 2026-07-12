import { existsSync, promises as fs, readFileSync } from 'fs';
import path from 'path';
import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import { resolveCurrentChange } from './classic-current-change.js';
import { ensureStrictClassicRuntimeRun } from './classic-runtime-run.js';
import { readLegacyState } from './classic-store.js';
import type { ClassicPhase, ClassicState } from './classic-state.js';

function result(exitCode: number, message: string): ClassicCommandResult {
  return { exitCode, stderr: message + '\n' };
}

function allowed(message: string): ClassicCommandResult {
  return result(0, `[COMET-HOOK] allowed: ${message}`);
}

function inputTarget(): string {
  if (process.env.FILE_PATH) return process.env.FILE_PATH;
  if (process.stdin.isTTY) return '';
  const input = readFileSync(0, 'utf8');
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
  const rawCandidate = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
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
  superpowersArtifact?: 'matched' | 'unmatched';
}

interface GoverningBlock {
  blockedResult: ClassicCommandResult;
}

type GoverningResolution = GoverningChange | GoverningBlock | null;

async function loadGoverningChange(changeDir: string): Promise<GoverningChange | null> {
  try {
    const runtime = await ensureStrictClassicRuntimeRun(changeDir);
    return {
      changeDir,
      phase: runtime.classic.phase,
      classic: runtime.classic,
      archived: runtime.classic.archived,
    };
  } catch {
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
    };
  }
}

async function activeChanges(projectRoot: string): Promise<GoverningChange[]> {
  const changesDir = path.join(projectRoot, 'openspec', 'changes');
  const governingChanges: GoverningChange[] = [];
  if (!existsSync(changesDir)) return governingChanges;
  for (const entry of (await fs.readdir(changesDir, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isDirectory() || entry.name === 'archive') continue;
    const changeDir = path.join(changesDir, entry.name);
    if (!existsSync(path.join(changeDir, '.comet.yaml'))) continue;
    const governing = await loadGoverningChange(changeDir);
    if (!governing || governing.archived) continue;
    governingChanges.push(governing);
  }
  return governingChanges;
}

function isSuperpowersArtifactPath(relativePath: string): boolean {
  return relativePath.startsWith('docs/superpowers/');
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
    (artifactPath) => artifactPath && normalized(artifactPath) === relativePath,
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
): Promise<GoverningChange | null> {
  const active = await activeChanges(projectRoot);
  const recorded = active.find((governing) =>
    matchesRecordedSuperpowersArtifact(relativePath, governing),
  );
  if (recorded) return recorded;

  const eligible = active.filter(allowsSuperpowersArtifacts);
  const named = eligible
    .filter((governing) => {
      const name = governingChangeName(governing);
      return name !== null && matchesSuperpowersArtifactName(relativePath, name);
    })
    .sort(
      (a, b) => (governingChangeName(b)?.length ?? 0) - (governingChangeName(a)?.length ?? 0),
    )[0];
  if (named) return named;

  return null;
}

async function repoSourceGoverningChange(
  projectRoot: string,
  relativePath: string,
): Promise<GoverningResolution> {
  const active = await activeChanges(projectRoot);
  if (active.length === 0) return null;

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
  if (active.length === 1) return active[0];
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
): Promise<GoverningResolution> {
  const prefix = 'openspec/changes/';
  if (relativePath.startsWith(prefix)) {
    const rest = relativePath.slice(prefix.length);
    const [name] = rest.split('/');
    if (name && name !== 'archive') {
      const changeDir = path.join(projectRoot, 'openspec', 'changes', name);
      const stateFile = path.join(changeDir, '.comet.yaml');
      if (existsSync(stateFile)) {
        const governing = await loadGoverningChange(changeDir);
        if (governing) return governing;
        return { changeDir, phase: 'open', classic: null, archived: false };
      }
      return { changeDir, phase: 'open', classic: null, archived: false };
    }
  }
  if (isSuperpowersArtifactPath(relativePath)) {
    const superpowers = await superpowersArtifactGoverningChange(relativePath, projectRoot);
    if (superpowers) return { ...superpowers, superpowersArtifact: 'matched' };
    const fallback = (await activeChanges(projectRoot))[0] ?? null;
    return fallback ? { ...fallback, superpowersArtifact: 'unmatched' } : null;
  }
  return repoSourceGoverningChange(projectRoot, relativePath);
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

function openSpecAllowed(relativePath: string, phase: ClassicPhase): string | null {
  if (!relativePath.startsWith('openspec/')) return null;
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
  if (phase === 'verify' && (relativePath.endsWith('/tasks.md') || stateFile)) {
    return `${relativePath} (phase: verify, tasks/state)`;
  }
  if (phase === 'archive' && stateFile) {
    return `${relativePath} (phase: archive, state)`;
  }
  return null;
}

function blocked(relativePath: string, phase: ClassicPhase): ClassicCommandResult {
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
            '  NEXT: finish the Design Doc, then run comet-guard design --apply to enter build',
          ]
        : [
            '  BLOCKED: source writes are not allowed during archive',
            '  This phase does not allow source writes',
            '  ALLOWED: confirm archive state and run the archive script',
          ];
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
      ...guidance,
      '',
    ].join('\n'),
  );
}

function blockedMissingDesignDoc(relativePath: string): ClassicCommandResult {
  return result(
    2,
    [
      '',
      '╔══════════════════════════════════════════╗',
      '║     COMET PHASE GUARD — WRITE BLOCKED    ║',
      '╚══════════════════════════════════════════╝',
      '',
      '  Current phase: build (workflow: full), but design_doc is empty',
      `  Target file: ${relativePath}`,
      '',
      '  BLOCKED: full workflow source writes require a recorded Design Doc',
      '  This phase does not allow source writes until design_doc is recorded',
      '  NEXT: return to design, create/link the Design Doc, then run guard again',
      '',
    ].join('\n'),
  );
}

function blockedUnmatchedSuperpowersArtifact(
  relativePath: string,
  phase: ClassicPhase,
): ClassicCommandResult {
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
      '  BLOCKED: unmatched Superpowers artifact',
      '  This docs/superpowers/ path does not match any active change artifact',
      '  NEXT: record the artifact path in .comet.yaml or include the change name in the artifact filename',
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

export const classicHookGuardCommand: ClassicCommandHandler = async (args) => {
  const projectRoot = parseProjectRoot(args);
  const target = inputTarget();
  if (!target) return allowed('no file path in tool input');
  const relativePath = await projectRelative(target, projectRoot);

  if (isCometConfig(relativePath)) {
    return allowed(`${relativePath} (whitelist: comet config)`);
  }
  if (relativePath.startsWith('.claude/')) {
    return allowed(`${relativePath} (whitelist: claude config)`);
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

  let governing: GoverningResolution;
  try {
    governing = await governingChange(relativePath, projectRoot);
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

  const openSpec = openSpecAllowed(relativePath, phase);
  if (openSpec) return allowed(openSpec);
  if (isSuperpowersArtifactPath(relativePath)) {
    if (governing.superpowersArtifact === 'matched' && allowsSuperpowersArtifacts(governing)) {
      return allowed(`${relativePath} (phase: ${phase}, superpowers)`);
    }
    if (governing.superpowersArtifact === 'unmatched') {
      return blockedUnmatchedSuperpowersArtifact(relativePath, phase);
    }
  }
  if (phase === 'build' && governing.classic?.workflow === 'full' && !governing.classic.designDoc) {
    return blockedMissingDesignDoc(relativePath);
  }
  if (phase === 'build' || phase === 'verify') {
    return allowed(`${relativePath} (phase: ${phase})`);
  }
  return blocked(relativePath, phase);
};
