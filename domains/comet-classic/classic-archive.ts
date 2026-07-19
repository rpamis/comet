import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import { openSpecChangeNameError } from './classic-paths.js';
import { ensureClassicRuntimeRun, transitionClassicRuntimeRun } from './classic-runtime-run.js';
import { appendClassicStateEvent } from './classic-state-events.js';
import { readClassicState, writeClassicState } from './classic-store.js';
import { applyClassicTransition } from './classic-transitions.js';
import { clearCurrentChangeIf } from './classic-current-change.js';
import {
  appendTrajectory,
  clearPendingAction,
  readArtifacts,
  readContext,
  readPendingAction,
  readTrajectory,
  writeArtifacts,
  writeCheckpoint,
  writePendingAction,
} from '../../domains/engine/run-store.js';
import type { Checkpoint, EngineAction, RunState } from '../../domains/engine/types.js';

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

class ArchiveFailure extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

class ArchiveOutput {
  readonly stderr: string[] = [];
  stepsOk = 0;
  stepsTotal = 0;

  toResult(exitCode = 0): ClassicCommandResult {
    return {
      exitCode,
      ...(this.stderr.length > 0 ? { stderr: this.stderr.join('\n') + '\n' } : {}),
    };
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function validateChangeName(name: string): void {
  const error = openSpecChangeNameError(name);
  if (error) throw new ArchiveFailure(red(`FATAL: ${error}`));
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

function exactlyOneFinalNewline(markdown: string): string {
  return `${markdown.replace(/\n+$/u, '')}\n`;
}

export function annotatedMarkdown(
  original: string,
  archiveName: string,
  extraFields: string,
): string {
  const normalized = original.replace(/\r\n/gu, '\n');
  const lines = normalized.split('\n');
  const closingDelimiter = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const extraFieldName = extraFields.match(/^([^:\n]+):/u)?.[1]?.trim();

  if (closingDelimiter !== -1) {
    const frontmatter = lines.slice(1, closingDelimiter).filter((line) => {
      const fieldName = line.match(/^([^:\n]+):/u)?.[1]?.trim();
      if (fieldName === undefined) return true;
      return fieldName !== 'archived-with' && fieldName !== extraFieldName;
    });
    frontmatter.push(`archived-with: ${archiveName}`);
    if (extraFields) frontmatter.push(extraFields);
    return exactlyOneFinalNewline(
      ['---', ...frontmatter, '---', ...lines.slice(closingDelimiter + 1)].join('\n'),
    );
  }

  const header = ['---', `archived-with: ${archiveName}`];
  if (extraFields) header.push(extraFields);
  if (extraFieldName !== 'status') header.push('status: final');
  header.push('---');
  return exactlyOneFinalNewline([...header, normalized].join('\n'));
}

async function findArchiveDir(change: string, preferred: string): Promise<string | null> {
  if (await exists(preferred)) return preferred;
  const archiveRoot = 'openspec/changes/archive';
  if (!(await exists(archiveRoot))) return null;
  for (const entry of (await fs.readdir(archiveRoot)).sort()) {
    if (!entry.endsWith(`-${change}`)) continue;
    const candidate = `${archiveRoot}/${entry}`;
    if ((await fs.stat(candidate)).isDirectory()) return candidate;
  }
  return null;
}

async function appendRecoveryEvent(
  changeDir: string,
  run: RunState,
  actionId: string,
): Promise<void> {
  const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
  if (
    trajectory.some(
      (event) =>
        event.type === 'recovery_reconciled' &&
        event.data.kind === 'classic-archive' &&
        event.data.actionId === actionId,
    )
  ) {
    return;
  }
  await appendTrajectory(changeDir, run.trajectoryRef, {
    sequence: trajectory.length + 1,
    timestamp: new Date().toISOString(),
    type: 'recovery_reconciled',
    runId: run.runId,
    data: {
      kind: 'classic-archive',
      actionId,
    },
  });
}

async function annotateFrontmatter(
  output: ArchiveOutput,
  file: string,
  archiveName: string,
  extraFields: string,
  dryRun: boolean,
): Promise<void> {
  if (!(await exists(file))) return;
  if (dryRun) {
    output.stderr.push(yellow(`  [DRY-RUN] Would annotate: ${file}`));
    output.stepsOk += 1;
    output.stepsTotal += 1;
    return;
  }
  const original = await fs.readFile(file, 'utf8');
  const updated = annotatedMarkdown(original, archiveName, extraFields);
  await fs.writeFile(file, updated);
  output.stderr.push(green(`  [OK] Annotated: ${file}`));
  output.stepsOk += 1;
  output.stepsTotal += 1;
}

async function verifyMainSpecsClean(): Promise<void> {
  const specsRoot = 'openspec/specs';
  if (!(await exists(specsRoot))) return;
  let found = false;
  for (const entry of await fs.readdir(specsRoot)) {
    const specFile = `${specsRoot}/${entry}/spec.md`;
    if (!(await exists(specFile))) continue;
    const matches = (await fs.readFile(specFile, 'utf8'))
      .split(/\r?\n/u)
      .map((line, index) => ({ line, number: index + 1 }))
      .filter((item) => /^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements$/u.test(item.line));
    if (matches.length > 0) {
      found = true;
      process.stderr.write(
        red(`FATAL: delta-only section heading leaked into main spec: ${specFile}`) + '\n',
      );
      for (const match of matches) process.stderr.write(`${match.number}:${match.line}\n`);
    }
  }
  if (found) throw new ArchiveFailure('');
}

export const classicArchiveCommand: ClassicCommandHandler = async (args) => {
  const output = new ArchiveOutput();
  const change = args[0];
  const dryRun = args[1] === '--dry-run';
  try {
    validateChangeName(change);
    const activeDir = `openspec/changes/${change}`;
    const today = new Date().toISOString().slice(0, 10);
    let archiveName = `${today}-${change}`;
    let archiveDir = `openspec/changes/archive/${archiveName}`;
    const openspec = process.env.COMET_OPENSPEC || 'openspec';

    output.stderr.push(`=== Comet Archive: ${change} ===`);

    const activeExists = await exists(`${activeDir}/.comet.yaml`);
    const recoveredArchive = activeExists ? null : await findArchiveDir(change, archiveDir);
    const changeDir = activeExists ? activeDir : recoveredArchive;
    if (!changeDir || !(await exists(`${changeDir}/.comet.yaml`))) {
      throw new ArchiveFailure(red(`FATAL: .comet.yaml not found in ${activeDir}/`));
    }
    if (recoveredArchive) {
      archiveDir = recoveredArchive;
      archiveName = path.basename(recoveredArchive);
    }
    const projection = await readClassicState(changeDir);
    if (!projection.classic) {
      throw new ArchiveFailure(red('FATAL: archive requires Classic state'));
    }
    const classic = projection.classic;
    const designDoc = classic.designDoc;
    const planPath = classic.plan;

    if (classic.phase !== 'archive') {
      throw new ArchiveFailure(red(`FATAL: phase is '${classic.phase}', expected 'archive'`));
    }
    if (classic.verifyResult !== 'pass') {
      throw new ArchiveFailure(
        red(
          `FATAL: verify_result is '${classic.verifyResult}', expected 'pass'. Run comet-verify first.`,
        ),
      );
    }
    output.stderr.push(green('  [OK] Entry state verified'));
    output.stepsOk += 1;
    output.stepsTotal += 1;

    if (activeExists && (await exists(archiveDir))) {
      throw new ArchiveFailure(red(`FATAL: archive target already exists: ${archiveDir}`));
    }
    output.stderr.push(green('  [OK] Archive target available'));
    output.stepsOk += 1;
    output.stepsTotal += 1;

    if (dryRun) {
      output.stderr.push(yellow(`  [DRY-RUN] Would run OpenSpec archive: ${change}`));
      output.stepsOk += 1;
      output.stepsTotal += 1;
    } else if (!classic.archived || projection.run?.pending) {
      const runtime = await ensureClassicRuntimeRun(changeDir);
      const actionId = `classic-archive:${change}`;
      const pendingAction = await readPendingAction(changeDir, runtime.run.pendingRef);
      const recovering =
        Boolean(recoveredArchive) ||
        (pendingAction?.id === actionId &&
          pendingAction.type === 'checkpoint' &&
          pendingAction.ref === change);
      if (runtime.run.pending && runtime.run.pending !== actionId) {
        throw new ArchiveFailure(red(`FATAL: another action is pending: ${runtime.run.pending}`));
      }
      if (!recovering && !classic.archived && classic.archiveConfirmation !== 'confirmed') {
        throw new ArchiveFailure(
          red(
            `FATAL: archive_confirmation is '${classic.archiveConfirmation ?? 'null'}', expected 'confirmed'. Run final archive confirmation first.`,
          ),
        );
      }

      if (!recovering) {
        const action: EngineAction = {
          id: actionId,
          stepId: runtime.run.currentStep,
          type: 'checkpoint',
          ref: change,
        };
        await writePendingAction(changeDir, runtime.run.pendingRef, action);
        await writeClassicState(changeDir, {
          classic: runtime.classic,
          run: {
            ...runtime.run,
            pending: actionId,
            status: 'waiting',
          },
          unknownKeys: (await readClassicState(changeDir)).unknownKeys,
        });
      }

      if (!recoveredArchive) {
        const archiveRun = spawnSync(openspec, ['archive', change, '--yes'], {
          encoding: 'utf8',
          shell: process.platform === 'win32',
        });
        if (archiveRun.stdout) process.stderr.write(archiveRun.stdout);
        if (archiveRun.stderr) process.stderr.write(archiveRun.stderr);
        if (archiveRun.error && (archiveRun.error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new ArchiveFailure(
            [
              red(`FATAL: OpenSpec CLI not found: ${openspec}`),
              red('Install OpenSpec or set COMET_OPENSPEC to the openspec executable.'),
            ].join('\n'),
          );
        }
        if (archiveRun.status !== 0) {
          throw new ArchiveFailure('', archiveRun.status ?? 1);
        }
      }

      const resolvedArchive = await findArchiveDir(change, archiveDir);
      if (!resolvedArchive) {
        output.stderr.push(red('  [FAIL] OpenSpec archive output not found'));
        output.stepsTotal += 1;
        output.stderr.push('');
        output.stderr.push(
          green(`Archive complete. ${output.stepsOk}/${output.stepsTotal} steps succeeded.`),
        );
        return output.toResult(1);
      }
      archiveDir = resolvedArchive;
      archiveName = path.basename(resolvedArchive);
      output.stderr.push(green(`  [OK] OpenSpec archive completed: ${archiveDir}`));
      output.stepsOk += 1;
      output.stepsTotal += 1;

      await verifyMainSpecsClean();
      output.stderr.push(green('  [OK] Main specs verified clean'));
      output.stepsOk += 1;
      output.stepsTotal += 1;

      if (designDoc) {
        await annotateFrontmatter(output, designDoc, archiveName, 'status: final', false);
      }
      if (planPath) {
        await annotateFrontmatter(output, planPath, archiveName, '', false);
      }

      const archivedProjection = await readClassicState(archiveDir);
      if (!archivedProjection.classic || !archivedProjection.run) {
        throw new ArchiveFailure(red('  [FAIL] archived state projection is incomplete'));
      }
      const artifacts = {
        ...(await readArtifacts(archiveDir, archivedProjection.run.artifactsRef)),
        archive_directory: archiveDir,
      };
      await writeArtifacts(archiveDir, archivedProjection.run.artifactsRef, artifacts);

      const archiveTransition = applyClassicTransition(
        recovering && archivedProjection.classic.archiveConfirmation !== 'confirmed'
          ? { ...archivedProjection.classic, archiveConfirmation: 'confirmed' }
          : archivedProjection.classic,
        'archived',
      );
      const archivedClassic = archiveTransition.classic;
      let transitionedRun = archivedProjection.run;
      if (
        archivedProjection.run.currentStep !== 'completed' ||
        archivedProjection.run.status !== 'completed'
      ) {
        transitionedRun = await transitionClassicRuntimeRun(
          archiveDir,
          archivedClassic,
          archivedProjection.run,
          {
            actionId,
            archiveDirectory: archiveDir,
            event: 'archived',
            source: 'comet-archive',
          },
        );
      }
      if (recovering) {
        await appendRecoveryEvent(archiveDir, transitionedRun, actionId);
      }
      const trajectory = await readTrajectory(archiveDir, transitionedRun.trajectoryRef);
      const context = await readContext(archiveDir, transitionedRun.contextRef);
      const checkpoint: Checkpoint = {
        runId: transitionedRun.runId,
        stateVersion: transitionedRun.iteration,
        trajectoryOffset: trajectory.length,
        contextHash: context === null ? null : hashText(context),
        artifactsHash: artifactsHash(artifacts),
        createdAt: new Date().toISOString(),
      };
      await writeCheckpoint(archiveDir, transitionedRun.checkpointRef, checkpoint);
      const completedRun: RunState = {
        ...transitionedRun,
        pending: null,
        status: 'completed',
      };
      await writeClassicState(archiveDir, {
        classic: archivedClassic,
        run: completedRun,
        unknownKeys: archivedProjection.unknownKeys,
      });
      await appendClassicStateEvent(archiveDir, {
        change: archiveName,
        event: 'archived',
        source: 'comet-archive',
        from: archivedProjection.classic,
        to: archivedClassic,
        effects: archiveTransition.effects,
      });
      await clearPendingAction(archiveDir, completedRun.pendingRef);
      output.stderr.push(green('  [OK] archived: true'));
      output.stepsOk += 1;
      output.stepsTotal += 1;
    } else {
      if (!projection.run) {
        throw new ArchiveFailure(
          red('FATAL: archived Classic state is missing its Run projection'),
        );
      }
      output.stderr.push(green(`  [OK] OpenSpec archive completed: ${archiveDir}`));
      output.stepsOk += 1;
      output.stepsTotal += 1;
      output.stderr.push(green('  [OK] Main specs verified clean'));
      output.stepsOk += 1;
      output.stepsTotal += 1;
      output.stderr.push(green('  [OK] archived: true'));
      output.stepsOk += 1;
      output.stepsTotal += 1;
    }

    if (dryRun) {
      if (designDoc) {
        await annotateFrontmatter(output, designDoc, archiveName, 'status: final', true);
      }
      if (planPath) {
        await annotateFrontmatter(output, planPath, archiveName, '', true);
      }
      output.stderr.push(
        yellow(`  [DRY-RUN] Would set archived: true in ${archiveDir}/.comet.yaml`),
      );
      output.stepsOk += 1;
      output.stepsTotal += 1;
    }

    if (!dryRun) await clearCurrentChangeIf(process.cwd(), change);

    output.stderr.push('');
    output.stderr.push(
      dryRun
        ? yellow(`Dry run complete. ${output.stepsOk}/${output.stepsTotal} steps would succeed.`)
        : green(`Archive complete. ${output.stepsOk}/${output.stepsTotal} steps succeeded.`),
    );
    return output.toResult(output.stepsOk < output.stepsTotal ? 1 : 0);
  } catch (error) {
    if (error instanceof ArchiveFailure) {
      if (error.message) {
        for (const line of error.message.split('\n')) output.stderr.push(line);
      }
      return output.toResult(error.exitCode);
    }
    throw error;
  }
};
