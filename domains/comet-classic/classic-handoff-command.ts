import type { ClassicCommandHandler } from './classic-cli.js';
import { classicCommandProjectRoot, withProjectContext } from './classic-command-context.js';
import {
  compatHandoffCommand,
  validateClassicSdkDesignContext,
  writeClassicDesignHandoffView,
} from './classic-handoff.js';
import { assertClassicLayoutWritable } from './classic-layout.js';
import { classicHandoffEnvelope, classicLocale } from './classic-output-language.js';
import { inspectClassicActiveChangeDirectory, openSpecChangeNameError } from './classic-paths.js';
import { resolveClassicChangeRuntimeOwner } from './classic-runtime-ownership.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';

/** Route handoff writes by ownership before invoking either Runtime. */
export const classicHandoffCommand: ClassicCommandHandler = withProjectContext(
  async (args, options) => {
    const [change, phase, mode, fullFlag] = args;
    const write =
      phase === 'design' &&
      mode === '--write' &&
      (args.length === 3 || (args.length === 4 && fullFlag === '--full'));
    if (!write) return compatHandoffCommand(args, options);
    const error = openSpecChangeNameError(change);
    if (error) return { exitCode: 1, stderr: `ERROR: ${error}\n` };
    const layout = await assertClassicLayoutWritable(classicCommandProjectRoot());
    const active = await inspectClassicActiveChangeDirectory(change, layout.projectRoot);
    const owner = active.stateExists
      ? await resolveClassicChangeRuntimeOwner(layout.projectRoot, change)
      : null;
    if (owner?.format !== 'sdk') return compatHandoffCommand(args, options);
    const { run, state } = await inspectClassicSdkRun(layout.projectRoot, change);
    if (!['design', 'build'].includes(state.phase))
      return { exitCode: 1, stderr: 'ERROR: design handoff requires phase: design or build\n' };
    if (!state.handoffContext)
      return {
        exitCode: 1,
        stderr:
          `ERROR: SDK Design handoff is recorded by comet state propose-design ${change} --proposal <text>. ` +
          'The handoff command cannot replace sources already bound to an SDK approval; preserve the approved sources and Run state.\n',
      };
    if (
      !(await validateClassicSdkDesignContext({
        run,
        projectRoot: layout.projectRoot,
        changeDir: active.directory,
        change,
        contextCompression: state.contextCompression,
        handoffContext: state.handoffContext,
        handoffHash: state.handoffHash,
      }))
    )
      return {
        exitCode: 1,
        stderr:
          'ERROR: SDK handoff does not reference this change. Continue from its original Run and formal source files.\n',
      };
    const envelope = classicHandoffEnvelope({
      name: change,
      locale: classicLocale(state.language),
    });
    const view =
      fullFlag === '--full'
        ? await writeClassicDesignHandoffView({
            projectRoot: layout.projectRoot,
            changeDir: active.directory,
            change,
          })
        : null;
    return {
      exitCode: 0,
      envelope,
      stderr: `${envelope.summary}\n[HANDOFF] source ${state.handoffContext}${view ? '\n[HANDOFF] view ' + view : ''}\n`,
    };
  },
);
