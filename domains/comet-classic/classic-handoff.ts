import { randomUUID } from 'node:crypto';
import type { WorkflowRun } from '../engine/runtime.js';
import { readClassicArtifactRequirements } from './classic-artifact-requirements.js';
import type { ClassicCommandHandler } from './classic-cli.js';
import { classicCommandProjectRoot, withProjectContext } from './classic-command-context.js';
import { assertClassicLayoutWritable, classicProjectRelative } from './classic-layout.js';
import { classicHandoffEnvelope, classicLocale } from './classic-output-language.js';
import {
  collectClassicSpecFiles,
  inspectClassicActiveChangeDirectory,
  openSpecChangeNameError,
} from './classic-paths.js';
import {
  classicProjectTargetExists,
  ensureClassicProjectDirectory,
  readClassicProjectFile,
  writeClassicProjectText,
} from './classic-protected-path.js';
import {
  appendTrajectory,
  clearPendingAction,
  readArtifacts,
  readPendingAction,
  readTrajectory,
  writeArtifacts,
  writeContext,
} from './classic-run-store.js';
import { ensureClassicRuntimeRun, transitionClassicRuntimeRun } from './classic-runtime-run.js';
import { readClassicState, withClassicStateMutation, writeClassicState } from './classic-store.js';

export interface ClassicHandoffSource {
  reference: string;
  content: string;
  sha256?: string;
}
export function renderClassicHandoffMarkdown(
  change: string,
  mode: string,
  _contextHash: string,
  sources: readonly ClassicHandoffSource[],
): string {
  return [
    '# Comet Design Handoff',
    '',
    '- Change: ' + change,
    '- Phase: design',
    '- Mode: ' + mode,
    '',
    'Generated-by: comet handoff',
    '',
    'Read source files for current requirements and task completion.',
    '',
    ...sources.flatMap((source) => [
      '## ' + source.reference,
      '',
      '- Source: ' + source.reference,
      '',
      source.content,
      '',
    ]),
  ].join('\n');
}
export function renderClassicSpecHandoffMarkdown(
  _changeRef: string,
  change: string,
  _contextHash: string,
  sources: readonly ClassicHandoffSource[],
): string {
  return renderClassicHandoffMarkdown(change, 'beta', '', sources);
}

/** 交接直接引用原需求材料；原 Run 已保存提案与决定，不再复制正文。 */
export async function resolveClassicDesignContext(options: {
  projectRoot: string;
  changeDir: string;
  change: string;
  contextCompression: 'off' | 'beta' | null;
  run?: Readonly<WorkflowRun>;
}): Promise<{ handoffContext: string; handoffHash: string | null }> {
  const { projectRoot, changeDir, change } = options;
  const changeRef = classicProjectRelative(projectRoot, changeDir);
  if (
    options.run &&
    ((options.run.input as { change: string }).change !== change ||
      (options.run.input as { changeDir: string }).changeDir !== changeRef)
  )
    throw new Error('Classic Design context belongs to a different Run');
  const handoffContext = changeRef + '/proposal.md';
  const source = await readClassicProjectFile(projectRoot, handoffContext, {
    label: 'Classic Design source',
  });
  if (!source.trim()) throw new Error('Classic Design source is empty');
  return { handoffContext, handoffHash: options.run?.actions.at(-1)?.inputHash ?? null };
}

export async function validateClassicSdkDesignContext(options: {
  projectRoot: string;
  changeDir: string;
  change: string;
  contextCompression: 'off' | 'beta' | null;
  handoffContext: string;
  handoffHash?: string | null;
  allowDesignDocumentChanges?: boolean;
  run?: Readonly<WorkflowRun>;
}): Promise<boolean> {
  const changeRef = classicProjectRelative(options.projectRoot, options.changeDir);
  const basename = options.contextCompression === 'beta' ? 'spec-context' : 'design-context';
  if (
    ![changeRef + '/proposal.md', changeRef + '/.comet/handoff/' + basename + '.json'].includes(
      options.handoffContext,
    )
  )
    return false;
  // 旧派生文件只保留历史引用；恢复从同一 Run 的正式材料读取。
  const context = await resolveClassicDesignContext(options);
  return context.handoffContext === changeRef + '/proposal.md';
}

/** 仅在明确请求 --full 时生成可读视图；推进仍引用正式材料。 */
export async function writeClassicDesignHandoffView(options: {
  projectRoot: string;
  changeDir: string;
  change: string;
}): Promise<string> {
  const { projectRoot, changeDir, change } = options;
  const sources: ClassicHandoffSource[] = [];
  const files = [
    ...['proposal.md', 'design.md', 'tasks.md'].map((ref) => changeDir + '/' + ref),
    ...(await collectClassicSpecFiles(projectRoot, changeDir + '/specs')),
  ];
  for (const file of files) {
    if (
      await classicProjectTargetExists(projectRoot, file, {
        label: 'Classic handoff source',
        expected: 'file',
      })
    ) {
      sources.push({
        reference: classicProjectRelative(projectRoot, file),
        content: await readClassicProjectFile(projectRoot, file, {
          label: 'Classic handoff source',
        }),
      });
    }
  }
  await ensureClassicProjectDirectory(
    projectRoot,
    changeDir + '/.comet/handoff',
    'Classic handoff view directory',
  );
  const view = changeDir + '/.comet/handoff/design-context.md';
  await writeClassicProjectText(
    projectRoot,
    view,
    renderClassicHandoffMarkdown(change, 'full', '', sources),
    { label: 'Classic handoff view' },
  );
  return classicProjectRelative(projectRoot, view);
}

export const compatHandoffCommand: ClassicCommandHandler = withProjectContext(async (args) => {
  const [change, phase, mode, full] = args;
  if (phase === '--hash-only')
    return {
      exitCode: 64,
      stderr: 'handoff --hash-only 已移除。由 Agent 读取实际文档并判断上下文是否需要更新。\n',
    };
  if (
    phase !== 'design' ||
    mode !== '--write' ||
    (args.length !== 3 && !(args.length === 4 && full === '--full'))
  )
    return { exitCode: 64, stderr: 'Usage: comet handoff <change-name> design --write [--full]\n' };
  const error = openSpecChangeNameError(change);
  if (error) return { exitCode: 1, stderr: error };
  const root = classicCommandProjectRoot(),
    layout = await assertClassicLayoutWritable(root),
    active = await inspectClassicActiveChangeDirectory(change, layout.projectRoot);
  if (!active.exists || !active.stateExists)
    return { exitCode: 1, stderr: 'Classic change directory or state is missing' };
  return withClassicStateMutation(active.directory, async () => {
    const current = await readClassicState(active.directory);
    if (!current.classic || !['design', 'build'].includes(current.classic.phase))
      throw new Error('Design handoff requires phase: design or build');
    const requirements = await readClassicArtifactRequirements(root, active.directory);
    if (requirements.problems.length) throw new Error(requirements.problems.join('\n'));
    const runtime = await ensureClassicRuntimeRun(active.directory);
    const pending = await readPendingAction(active.directory, runtime.run.pendingRef);
    if (runtime.run.pending && pending?.type !== 'handoff')
      throw new Error('Another Classic action is pending');
    if (pending && runtime.run.pending !== pending.id)
      throw new Error('Classic handoff pending identity does not match the original Run');
    const context = await resolveClassicDesignContext({
      projectRoot: root,
      changeDir: active.directory,
      change,
      contextCompression: runtime.classic.contextCompression,
    });
    const markdown = context.handoffContext.replace(/\.json$/u, '.md');
    const content = await readClassicProjectFile(root, markdown, { label: 'Classic handoff' });
    const view =
      full === '--full'
        ? await writeClassicDesignHandoffView({
            projectRoot: root,
            changeDir: active.directory,
            change,
          })
        : null;
    await writeContext(active.directory, runtime.run.contextRef, content);
    await writeArtifacts(active.directory, runtime.run.artifactsRef, {
      ...(await readArtifacts(active.directory, runtime.run.artifactsRef)),
      handoff_context: context.handoffContext,
      handoff_markdown: markdown,
    });
    const classic = { ...runtime.classic, ...context };
    let run: import('../engine/types.js').RunState = { ...runtime.run, pending: null };
    if (run.currentStep === 'full.design.handoff')
      run = await transitionClassicRuntimeRun(active.directory, classic, run, {
        actionId: pending?.id ?? randomUUID(),
        kind: 'classic-handoff',
      });
    await writeClassicState(active.directory, { ...current, classic, run });
    if (pending) {
      const trajectory = await readTrajectory(active.directory, run.trajectoryRef);
      if (
        !trajectory.some(
          (event) => event.type === 'recovery_reconciled' && event.data?.actionId === pending.id,
        )
      )
        await appendTrajectory(active.directory, run.trajectoryRef, {
          sequence: trajectory.length + 1,
          timestamp: new Date().toISOString(),
          type: 'recovery_reconciled',
          runId: run.runId,
          data: { kind: 'classic-handoff', actionId: pending.id },
        });
      await clearPendingAction(active.directory, runtime.run.pendingRef);
    }
    const envelope = classicHandoffEnvelope({
      name: change,
      locale: classicLocale(classic.language),
    });
    return {
      exitCode: 0,
      envelope,
      stderr:
        envelope.summary +
        '\n[HANDOFF] source ' +
        context.handoffContext +
        (view ? '\n[HANDOFF] view ' + view : '') +
        '\n',
    };
  });
});
