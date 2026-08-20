import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { parseDocument } from 'yaml';
import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import { inspectClassicActiveChangeDirectory, openSpecChangeNameError } from './classic-paths.js';
import { ensureClassicRuntimeRun, transitionClassicRuntimeRun } from './classic-runtime-run.js';
import { readClassicState, writeClassicState } from './classic-store.js';
import {
  appendTrajectory,
  clearPendingAction,
  readArtifacts,
  readCheckpoint,
  readContext,
  readPendingAction,
  readTrajectory,
  writeArtifacts,
  writeCheckpoint,
  writeContext,
  writePendingAction,
} from '../../domains/engine/run-store.js';
import type { Checkpoint, EngineAction, RunState } from '../../domains/engine/types.js';
import { assertClassicLayoutWritable, classicProjectRelative } from './classic-layout.js';
import {
  classicProjectFileNonempty,
  classicProjectTargetExists,
  ensureClassicProjectDirectory,
  inspectClassicProjectTarget,
  readClassicProjectFile,
  writeClassicProjectText,
} from './classic-protected-path.js';
import { classicCommandProjectRoot, withClassicCommandContext } from './classic-command-context.js';

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';

function green(message: string): string {
  return `${GREEN}${message}${RESET}`;
}

function red(message: string): string {
  return `${RED}${message}${RESET}`;
}

function yellow(message: string): string {
  return `${YELLOW}${message}${RESET}`;
}

class HandoffFailure extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

class HandoffOutput {
  readonly stdout: string[] = [];
  readonly stderr: string[] = [];

  toResult(exitCode = 0): ClassicCommandResult {
    return {
      exitCode,
      ...(this.stdout.length > 0 ? { stdout: this.stdout.join('\n') + '\n' } : {}),
      ...(this.stderr.length > 0 ? { stderr: this.stderr.join('\n') + '\n' } : {}),
    };
  }
}

async function readProtectedIfExists(
  projectRoot: string,
  file: string,
  label: string,
): Promise<string | null> {
  if (
    !(await classicProjectTargetExists(projectRoot, file, {
      label,
      expected: 'file',
    }))
  ) {
    return null;
  }
  return readClassicProjectFile(projectRoot, file, { label });
}

async function writeProtectedText(
  projectRoot: string,
  file: string,
  content: string,
  label: string,
): Promise<void> {
  await writeClassicProjectText(projectRoot, file, content, { label });
}

function validateChangeName(name: string): void {
  const error = openSpecChangeNameError(name);
  if (error) throw new HandoffFailure(red(`ERROR: ${error}`));
}

function hashText(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function artifactsHash(artifacts: Record<string, string>): string {
  return hashText(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(artifacts).sort(([left], [right]) => left.localeCompare(right)),
      ),
    ),
  );
}

// Forward-slash references keep hash inputs + markdown Source/SHA256 references
// compatible with the frozen shell while changeDir remains an absolute filesystem path.
async function handoffSourceFiles(projectRoot: string, changeDir: string): Promise<string[]> {
  const files = [`${changeDir}/proposal.md`, `${changeDir}/design.md`, `${changeDir}/tasks.md`];
  const specs = `${changeDir}/specs`;
  const specsInspection = await inspectClassicProjectTarget(projectRoot, specs, {
    label: 'Classic handoff specs directory',
    expected: 'directory',
  });
  if (specsInspection.exists) {
    const entries = (await fs.readdir(specs, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const spec = `${specs}/${entry.name}/spec.md`;
      const specDirectory = await inspectClassicProjectTarget(
        projectRoot,
        `${specs}/${entry.name}`,
        {
          label: `Classic handoff spec directory ${entry.name}`,
          expected: 'directory',
        },
      );
      if (!specDirectory.exists) continue;
      if (
        await classicProjectTargetExists(projectRoot, spec, {
          label: `Classic handoff spec ${entry.name}`,
          expected: 'file',
        })
      ) {
        files.push(spec);
      }
    }
  }
  return files;
}

function handoffSourceReference(changeDir: string, changeRef: string, file: string): string {
  const relative = path.relative(changeDir, file).replaceAll('\\', '/');
  return `${changeRef}/${relative}`;
}

async function computeContextHash(
  projectRoot: string,
  changeDir: string,
  changeRef: string,
): Promise<string> {
  const lines: string[] = [];
  for (const file of await handoffSourceFiles(projectRoot, changeDir)) {
    const reference = handoffSourceReference(changeDir, changeRef, file);
    const content = await readProtectedIfExists(
      projectRoot,
      file,
      `Classic handoff source ${reference}`,
    );
    if (content === null) continue;
    lines.push(`path:${reference}`, `sha256:${hashText(content)}`);
  }
  // Command substitution $(...) strips the trailing newline; mirror that exactly.
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

function jsonEscape(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

// wc -l counts newlines.
function lineCount(content: string): number {
  return (content.match(/\n/gu) ?? []).length;
}

// sed -n "1,${max}p": content up to and including the max-th newline.
function firstLines(content: string, max: number): string {
  let count = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '\n') {
      count += 1;
      if (count === max) return content.slice(0, i + 1);
    }
  }
  return content;
}
async function writeMarkdownContext(
  projectRoot: string,
  changeDir: string,
  changeRef: string,
  change: string,
  mode: string,
  contextHash: string,
  output: string,
): Promise<void> {
  const lines: string[] = [
    '# Comet Design Handoff',
    '',
    `- Change: ${change}`,
    '- Phase: design',
    `- Mode: ${mode}`,
    `- Context hash: ${contextHash}`,
    '',
    'Generated-by: comet-handoff.sh',
    '',
    'OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.',
    '',
  ];
  for (const file of await handoffSourceFiles(projectRoot, changeDir)) {
    const reference = handoffSourceReference(changeDir, changeRef, file);
    const content = await readProtectedIfExists(
      projectRoot,
      file,
      `Classic handoff source ${reference}`,
    );
    if (content === null) continue;
    const total = lineCount(content);
    lines.push(
      `## ${reference}`,
      '',
      `- Source: ${reference}`,
      `- Lines: 1-${total}`,
      `- SHA256: ${hashText(content)}`,
      '',
    );
    if (mode === 'full' || total <= 80) {
      lines.push('```md', content, '```');
    } else {
      lines.push(
        '[TRUNCATED]',
        '',
        '```md',
        firstLines(content, 80),
        '```',
        '',
        `Full source: ${reference}`,
      );
    }
    lines.push('');
  }
  await writeProtectedText(
    projectRoot,
    output,
    lines.join('\n'),
    'Classic handoff markdown output',
  );
}

async function writeJsonContext(
  projectRoot: string,
  changeDir: string,
  changeRef: string,
  change: string,
  mode: string,
  contextHash: string,
  output: string,
): Promise<void> {
  const entries: string[] = [];
  for (const file of await handoffSourceFiles(projectRoot, changeDir)) {
    const reference = handoffSourceReference(changeDir, changeRef, file);
    const content = await readProtectedIfExists(
      projectRoot,
      file,
      `Classic handoff source ${reference}`,
    );
    if (content === null) continue;
    entries.push(`    { "path": "${jsonEscape(reference)}", "sha256": "${hashText(content)}" }`);
  }
  const filesBlock = entries.join(',\n');
  const document = [
    '{',
    `  "change": "${jsonEscape(change)}",`,
    '  "phase": "design",',
    `  "mode": "${mode}",`,
    '  "canonical_spec": "openspec",',
    '  "generated_by": "comet-handoff.sh",',
    `  "context_hash": "${contextHash}",`,
    '  "files": [',
    filesBlock,
    '  ]',
    '}',
    '',
  ].join('\n');
  await writeProtectedText(projectRoot, output, document, 'Classic handoff JSON output');
}

async function writeSpecProjectionForFile(reference: string, content: string): Promise<string[]> {
  return [
    `## ${reference}`,
    '',
    `- Source: ${reference}`,
    `- Lines: 1-${lineCount(content)}`,
    `- SHA256: ${hashText(content)}`,
    '',
    '```md',
    content,
    '```',
    '',
  ];
}

async function writeSpecMarkdownContext(
  projectRoot: string,
  changeDir: string,
  changeRef: string,
  change: string,
  contextHash: string,
  output: string,
): Promise<void> {
  const lines: string[] = [
    '# Comet Spec Context',
    '',
    `- Change: ${change}`,
    '- Phase: design',
    '- Mode: beta',
    `- Context hash: ${contextHash}`,
    '',
    'Generated-by: comet-handoff.sh',
    '',
    'OpenSpec remains the canonical capability spec. This beta context pack verbatim-projects spec files and references supporting artifacts by hash, not an agent-authored summary.',
    '',
    '## Source References',
    '',
  ];
  for (const file of await handoffSourceFiles(projectRoot, changeDir)) {
    const reference = handoffSourceReference(changeDir, changeRef, file);
    const content = await readProtectedIfExists(
      projectRoot,
      file,
      `Classic handoff source ${reference}`,
    );
    if (content === null) continue;
    lines.push(`- Source: ${reference}`, `- SHA256: ${hashText(content)}`);
  }
  lines.push('', '## Acceptance Projection', '');
  const specs = `${changeDir}/specs`;
  let projected = false;
  const specsInspection = await inspectClassicProjectTarget(projectRoot, specs, {
    label: 'Classic handoff specs directory',
    expected: 'directory',
  });
  if (specsInspection.exists) {
    const entries = (await fs.readdir(specs, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const spec = `${specs}/${entry.name}/spec.md`;
      const content = await readProtectedIfExists(
        projectRoot,
        spec,
        `Classic handoff spec ${entry.name}`,
      );
      if (content === null) continue;
      projected = true;
      lines.push(
        ...(await writeSpecProjectionForFile(
          handoffSourceReference(changeDir, changeRef, spec),
          content,
        )),
      );
    }
  }
  if (!projected) {
    lines.push('No delta spec files found.', '');
  }
  lines.push(
    'Full source files remain canonical. If a required heading or scenario is missing here, regenerate the handoff or read the source spec directly. Supporting files (proposal, design, tasks) are referenced by hash only.',
  );
  await writeProtectedText(
    projectRoot,
    output,
    lines.join('\n'),
    'Classic handoff spec markdown output',
  );
}

async function writeSpecJsonContext(
  projectRoot: string,
  changeDir: string,
  changeRef: string,
  change: string,
  contextHash: string,
  output: string,
): Promise<void> {
  const entries: Array<{ path: string; sha256: string; role: 'spec' | 'supporting' }> = [];
  for (const file of await handoffSourceFiles(projectRoot, changeDir)) {
    const reference = handoffSourceReference(changeDir, changeRef, file);
    const content = await readProtectedIfExists(
      projectRoot,
      file,
      `Classic handoff source ${reference}`,
    );
    if (content === null) continue;
    const role = /\/specs\/[^/]+\/spec\.md$/u.test(reference) ? 'spec' : 'supporting';
    entries.push({ path: reference, sha256: hashText(content), role });
  }
  await writeProtectedText(
    projectRoot,
    output,
    `${JSON.stringify(
      {
        change,
        phase: 'design',
        mode: 'beta',
        canonical_spec: 'openspec',
        generated_by: 'comet-handoff.sh',
        context_hash: contextHash,
        files: entries,
      },
      null,
      2,
    )}\n`,
    'Classic handoff spec JSON output',
  );
}

async function readField(projectRoot: string, changeDir: string, field: string): Promise<string> {
  const file = path.join(changeDir, '.comet.yaml');
  const document = parseDocument(
    await readClassicProjectFile(projectRoot, file, { label: 'Classic change state' }),
    { uniqueKeys: false },
  );
  if (document.errors.length > 0) {
    throw new HandoffFailure(`ERROR: Invalid .comet.yaml: ${document.errors[0].message}`);
  }
  const record = document.toJS() as Record<string, unknown>;
  const value = record[field];
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function appendRecoveryEvent(
  changeDir: string,
  run: RunState,
  actionId: string,
): Promise<void> {
  const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
  const alreadyRecorded = trajectory.some(
    (event) =>
      event.type === 'recovery_reconciled' &&
      event.data.kind === 'classic-handoff' &&
      event.data.actionId === actionId,
  );
  if (alreadyRecorded) return;
  await appendTrajectory(changeDir, run.trajectoryRef, {
    sequence: trajectory.length + 1,
    timestamp: new Date().toISOString(),
    type: 'recovery_reconciled',
    runId: run.runId,
    data: {
      kind: 'classic-handoff',
      actionId,
    },
  });
}

async function handoffMarkdownIsCurrent(
  projectRoot: string,
  changeDir: string,
  contextMd: string,
  contextHash: string,
): Promise<boolean> {
  const markdown = await readProtectedIfExists(
    projectRoot,
    contextMd,
    'Classic handoff markdown output',
  );
  if (markdown === null) return false;
  const lines = new Set(markdown.split(/\r?\n/u));
  // Verifying the exact Context hash line catches not only stale sources but
  // also sources that have since been removed from OpenSpec: a deleted delta
  // spec no longer appears in the SHA256 loop below, so the loop alone would
  // trivially pass for `--write` on aligned hashes while leaving the deleted
  // spec embedded in the stale markdown. Any add/remove/edit of a source
  // changes the computed hash, which must match the marker on disk.
  if (!lines.has(`- Context hash: ${contextHash}`)) return false;
  for (const file of await handoffSourceFiles(projectRoot, changeDir)) {
    const content = await readProtectedIfExists(
      projectRoot,
      file,
      `Classic handoff source ${file}`,
    );
    if (content === null) continue;
    if (!lines.has(`- SHA256: ${hashText(content)}`)) return false;
  }
  return true;
}

async function completedHandoffIsCurrent(
  projectRoot: string,
  changeDir: string,
  run: RunState,
  contextHash: string,
  contextJson: string,
  contextMd: string,
  contextJsonRef: string,
  contextMdRef: string,
): Promise<boolean> {
  const [context, artifacts, checkpoint] = await Promise.all([
    readContext(changeDir, run.contextRef),
    readArtifacts(changeDir, run.artifactsRef),
    readCheckpoint(changeDir, run.checkpointRef),
  ]);
  const [contextJsonContent, contextMdContent] = await Promise.all([
    readProtectedIfExists(projectRoot, contextJson, 'Classic handoff JSON output'),
    readProtectedIfExists(projectRoot, contextMd, 'Classic handoff markdown output'),
  ]);
  if (contextJsonContent === null || contextMdContent === null) return false;
  if (context !== contextMdContent) return false;
  if (artifacts.handoff_context !== contextJsonRef || artifacts.handoff_markdown !== contextMdRef) {
    return false;
  }
  return (
    checkpoint?.runId === run.runId &&
    checkpoint.contextHash === (context === null ? null : hashText(context)) &&
    checkpoint.artifactsHash === artifactsHash(artifacts) &&
    contextHash.length === 64
  );
}

export const classicHandoffCommand: ClassicCommandHandler = async (args, options) =>
  withClassicCommandContext(options, async () => {
    const output = new HandoffOutput();
    const [change, phase, mode, fullFlag] = args;
    try {
      validateChangeName(change);
      const layout = await assertClassicLayoutWritable(classicCommandProjectRoot());
      const active = await inspectClassicActiveChangeDirectory(change, layout.projectRoot);
      const changeDir = active.directory;
      const changeRef = classicProjectRelative(layout.projectRoot, changeDir);

      if (phase === '--hash-only') {
        if (!active.exists) {
          throw new HandoffFailure(red(`ERROR: change directory not found: ${changeRef}`));
        }
        for (const required of ['proposal.md', 'design.md', 'tasks.md']) {
          if (
            !(await classicProjectFileNonempty(
              layout.projectRoot,
              `${changeDir}/${required}`,
              `Classic handoff source ${required}`,
            ))
          ) {
            throw new HandoffFailure(
              red(`ERROR: required file missing or empty: ${changeRef}/${required}`),
            );
          }
        }
        output.stdout.push(await computeContextHash(layout.projectRoot, changeDir, changeRef));
        return output.toResult(0);
      }

      if (phase !== 'design' || mode !== '--write') {
        throw new HandoffFailure(
          red('Usage: comet-handoff.mjs <change-name> design --write [--full]'),
        );
      }
      let handoffMode: string;
      if (fullFlag === undefined || fullFlag === '') handoffMode = 'compact';
      else if (fullFlag === '--full') handoffMode = 'full';
      else
        throw new HandoffFailure(
          red('Usage: comet-handoff.mjs <change-name> design --write [--full]'),
        );

      if (!active.exists) {
        throw new HandoffFailure(red(`ERROR: change directory not found: ${changeRef}`));
      }
      if (!active.stateExists) {
        throw new HandoffFailure(red(`ERROR: .comet.yaml not found at ${changeRef}/.comet.yaml`));
      }
      const currentPhase = await readField(layout.projectRoot, changeDir, 'phase');
      if (currentPhase !== 'design' && currentPhase !== 'build') {
        // Issue #324: a Spec Patch after the guard advanced the phase to build
        // must still be able to refresh the design handoff. The write path
        // below only updates handoff context/hash and never transitions the
        // run state outside full.design.handoff, so refreshing from build is
        // safe and unblocks the workflow.
        throw new HandoffFailure(red('ERROR: design handoff requires phase: design or build'));
      }
      for (const required of ['proposal.md', 'design.md', 'tasks.md']) {
        if (
          !(await classicProjectFileNonempty(
            layout.projectRoot,
            `${changeDir}/${required}`,
            `Classic handoff source ${required}`,
          ))
        ) {
          throw new HandoffFailure(
            red(`ERROR: required OpenSpec artifact missing or empty: ${changeRef}/${required}`),
          );
        }
      }

      const handoffDir = `${changeDir}/.comet/handoff`;
      await inspectClassicProjectTarget(layout.projectRoot, `${changeDir}/.comet`, {
        label: 'Classic change runtime directory',
        expected: 'directory',
      });
      await inspectClassicProjectTarget(layout.projectRoot, handoffDir, {
        label: 'Classic handoff directory',
        expected: 'directory',
      });
      const contextCompression =
        (await readField(layout.projectRoot, changeDir, 'context_compression')) || 'off';
      let contextJson: string;
      let contextMd: string;
      if (contextCompression === 'off') {
        contextJson = `${handoffDir}/design-context.json`;
        contextMd = `${handoffDir}/design-context.md`;
      } else if (contextCompression === 'beta') {
        if (handoffMode === 'full') {
          output.stderr.push(
            yellow('[HANDOFF] --full is ignored in beta mode; spec files are projected verbatim'),
          );
        }
        handoffMode = 'beta';
        contextJson = `${handoffDir}/spec-context.json`;
        contextMd = `${handoffDir}/spec-context.md`;
      } else {
        throw new HandoffFailure(
          [
            red(`ERROR: invalid context_compression: ${contextCompression}`),
            red('Valid values: off, beta'),
          ].join('\n'),
        );
      }
      const contextJsonRef = classicProjectRelative(layout.projectRoot, contextJson);
      const contextMdRef = classicProjectRelative(layout.projectRoot, contextMd);
      const contextHash = await computeContextHash(layout.projectRoot, changeDir, changeRef);
      const actionId = `classic-handoff:${contextHash}`;
      const initialProjection = await readClassicState(changeDir);
      if (!initialProjection.classic) {
        throw new HandoffFailure(red('ERROR: design handoff requires Classic state'));
      }
      const initialPending = initialProjection.run
        ? await readPendingAction(changeDir, initialProjection.run.pendingRef)
        : null;
      const recovering =
        initialPending?.id === actionId &&
        initialPending.type === 'handoff' &&
        initialPending.ref === contextHash;
      if (
        initialProjection.classic.handoffHash &&
        initialProjection.classic.handoffHash !== contextHash &&
        !recovering
      ) {
        // Issue #324: the design guard requires regenerating the handoff
        // after OpenSpec artifacts change, and `--write` is the only legal
        // invocation mode (enforced by the usage guard above), so an explicit
        // --write always refreshes the completed handoff instead of being
        // rejected as stale.
        output.stderr.push(
          yellow(
            `[HANDOFF] refreshing stale design handoff: previous hash ${initialProjection.classic.handoffHash}`,
          ),
        );
      }

      await ensureClassicProjectDirectory(
        layout.projectRoot,
        `${changeDir}/.comet`,
        'Classic change runtime directory',
      );
      await ensureClassicProjectDirectory(
        layout.projectRoot,
        handoffDir,
        'Classic handoff directory',
      );
      const runtime = await ensureClassicRuntimeRun(changeDir);
      const pendingAction = await readPendingAction(changeDir, runtime.run.pendingRef);
      const resumesPending =
        pendingAction?.id === actionId &&
        pendingAction.type === 'handoff' &&
        pendingAction.ref === contextHash;
      if (runtime.run.pending && runtime.run.pending !== actionId) {
        throw new HandoffFailure(red(`ERROR: another action is pending: ${runtime.run.pending}`));
      }
      if (
        runtime.classic.handoffHash === contextHash &&
        runtime.classic.handoffContext === contextJsonRef &&
        !runtime.run.pending &&
        !pendingAction &&
        (await completedHandoffIsCurrent(
          layout.projectRoot,
          changeDir,
          runtime.run,
          contextHash,
          contextJson,
          contextMd,
          contextJsonRef,
          contextMdRef,
        )) &&
        // Issue #324: even when the recorded hash was aligned, only treat the
        // handoff as current if the on-disk markdown actually reflects the
        // current source files. Otherwise --write would report success while
        // leaving stale context files behind.
        (await handoffMarkdownIsCurrent(layout.projectRoot, changeDir, contextMd, contextHash))
      ) {
        output.stderr.push(green(`[HANDOFF] wrote ${contextJsonRef}`));
        output.stderr.push(green(`[HANDOFF] wrote ${contextMdRef}`));
        output.stderr.push(green(`[HANDOFF] handoff_hash=${contextHash}`));
        return output.toResult(0);
      }

      const action: EngineAction = {
        id: actionId,
        stepId: runtime.run.currentStep,
        type: 'handoff',
        ref: contextHash,
      };
      await writePendingAction(changeDir, runtime.run.pendingRef, action);
      const pendingRun: RunState = {
        ...runtime.run,
        pending: actionId,
        status: 'waiting',
      };
      await writeClassicState(changeDir, {
        classic: runtime.classic,
        run: pendingRun,
        unknownKeys: (await readClassicState(changeDir)).unknownKeys,
      });

      if (handoffMode === 'beta') {
        await writeSpecMarkdownContext(
          layout.projectRoot,
          changeDir,
          changeRef,
          change,
          contextHash,
          contextMd,
        );
        await writeSpecJsonContext(
          layout.projectRoot,
          changeDir,
          changeRef,
          change,
          contextHash,
          contextJson,
        );
      } else {
        await writeMarkdownContext(
          layout.projectRoot,
          changeDir,
          changeRef,
          change,
          handoffMode,
          contextHash,
          contextMd,
        );
        await writeJsonContext(
          layout.projectRoot,
          changeDir,
          changeRef,
          change,
          handoffMode,
          contextHash,
          contextJson,
        );
      }

      const context = await readClassicProjectFile(layout.projectRoot, contextMd, {
        label: 'Classic handoff markdown output',
      });
      await writeContext(changeDir, pendingRun.contextRef, context);
      const artifacts = {
        ...(await readArtifacts(changeDir, pendingRun.artifactsRef)),
        handoff_context: contextJsonRef,
        handoff_markdown: contextMdRef,
      };
      await writeArtifacts(changeDir, pendingRun.artifactsRef, artifacts);
      const completedClassic = {
        ...runtime.classic,
        handoffContext: contextJsonRef,
        handoffHash: contextHash,
      };
      const transitionedRun =
        pendingRun.currentStep === 'full.design.handoff'
          ? await transitionClassicRuntimeRun(changeDir, completedClassic, pendingRun, {
              actionId,
              kind: 'classic-handoff',
            })
          : pendingRun;
      const completedRun: RunState = {
        ...transitionedRun,
        pending: null,
        status: 'running',
      };
      if (recovering || resumesPending) {
        await appendRecoveryEvent(changeDir, completedRun, actionId);
      }
      const trajectory = await readTrajectory(changeDir, completedRun.trajectoryRef);
      const checkpoint: Checkpoint = {
        runId: completedRun.runId,
        stateVersion: completedRun.iteration,
        trajectoryOffset: trajectory.length,
        contextHash: hashText(context),
        artifactsHash: artifactsHash(artifacts),
        createdAt: new Date().toISOString(),
      };
      await writeCheckpoint(changeDir, completedRun.checkpointRef, checkpoint);
      await writeClassicState(changeDir, {
        classic: completedClassic,
        run: completedRun,
        unknownKeys: (await readClassicState(changeDir)).unknownKeys,
      });
      await clearPendingAction(changeDir, completedRun.pendingRef);

      output.stderr.push(green(`[SET] handoff_context=${contextJson}`));
      output.stderr.push(green(`[SET] handoff_hash=${contextHash}`));

      output.stderr.push(green(`[HANDOFF] wrote ${contextJsonRef}`));
      output.stderr.push(green(`[HANDOFF] wrote ${contextMdRef}`));
      output.stderr.push(green(`[HANDOFF] handoff_hash=${contextHash}`));
      return output.toResult(0);
    } catch (error) {
      if (error instanceof HandoffFailure) {
        for (const line of error.message.split('\n')) output.stderr.push(line);
        return output.toResult(error.exitCode);
      }
      throw error;
    }
  });
