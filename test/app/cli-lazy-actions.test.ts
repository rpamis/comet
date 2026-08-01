import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const statusCommand = vi.fn(async () => undefined);
const initCommand = vi.fn(async () => undefined);
const workflowResolveCommand = vi.fn(async () => undefined);
const resumeProbeCommand = vi.fn(async () => undefined);
const dashboardCommand = vi.fn(async () => undefined);
const doctorCommand = vi.fn(async () => undefined);
const updateCommand = vi.fn(async () => undefined);
const uninstallCommand = vi.fn(async () => undefined);
const evalCommand = vi.fn(async () => undefined);
const runClassicFacade = vi.fn(async () => 0);
const runClassicGroupFacade = vi.fn(async () => 0);
const runNativeFacade = vi.fn(async () => 0);
const skillInstallCommand = vi.fn(async () => undefined);
const skillShowCommand = vi.fn(async () => undefined);
const skillRunCommand = vi.fn(async () => undefined);
const skillResumeCommand = vi.fn(async () => undefined);
const skillCheckCommand = vi.fn(async () => undefined);
const creatorListCommand = vi.fn(async () => undefined);
const creatorStatusCommand = vi.fn(async () => undefined);
const creatorNextCommand = vi.fn(async () => undefined);
const creatorGuideCommand = vi.fn(async () => undefined);
const creatorCandidatesCommand = vi.fn(async () => undefined);
const creatorProposeCommand = vi.fn(async () => undefined);
const creatorInitCommand = vi.fn(async () => undefined);
const creatorResolveCommand = vi.fn(async () => undefined);
const creatorAuthoringPlanCommand = vi.fn(async () => undefined);
const creatorAuthoringRecordCommand = vi.fn(async () => undefined);
const creatorGenerateCommand = vi.fn(async () => undefined);
const publishReviewCommand = vi.fn(async () => undefined);
const publishApproveCommand = vi.fn(async () => undefined);
const publishRunCommand = vi.fn(async () => undefined);
const publishDistributeCommand = vi.fn(async () => undefined);
const bundleDraftCreateCommand = vi.fn(async () => undefined);
const bundleDraftOptimizeCommand = vi.fn(async () => undefined);
const bundleCompileCommand = vi.fn(async () => undefined);
const bundleEvalPlanCommand = vi.fn(async () => undefined);
const bundleEvalRecordCommand = vi.fn(async () => undefined);
const bundleReviewSummaryCommand = vi.fn(async () => undefined);
const bundleReviewCommand = vi.fn(async () => undefined);
const bundlePublishCommand = vi.fn(async () => undefined);
const bundleDistributeCommand = vi.fn(async () => undefined);

vi.mock('../../app/commands/init.js', () => ({ initCommand }));
vi.mock('../../app/commands/status.js', () => ({ statusCommand }));
vi.mock('../../app/commands/workflow.js', () => ({ workflowResolveCommand }));
vi.mock('../../app/commands/resume-probe.js', () => ({ resumeProbeCommand }));
vi.mock('../../app/commands/dashboard.js', () => ({ dashboardCommand }));
vi.mock('../../app/commands/doctor.js', () => ({ doctorCommand }));
vi.mock('../../app/commands/update.js', () => ({ updateCommand }));
vi.mock('../../app/commands/uninstall.js', () => ({ uninstallCommand }));
vi.mock('../../app/commands/eval.js', () => ({ evalCommand }));
vi.mock('../../app/commands/command-result.js', () => ({ exitCodeForCommandResult: () => 0 }));
vi.mock('../../app/commands/classic.js', () => ({ runClassicFacade, runClassicGroupFacade }));
vi.mock('../../app/commands/native.js', () => ({ runNativeFacade }));
vi.mock('../../app/commands/skill.js', () => ({
  skillInstallCommand,
  skillShowCommand,
  skillRunCommand,
  skillResumeCommand,
  skillCheckCommand,
}));
vi.mock('../../app/commands/creator.js', () => ({
  creatorListCommand,
  creatorStatusCommand,
  creatorNextCommand,
  creatorGuideCommand,
  creatorCandidatesCommand,
  creatorProposeCommand,
  creatorInitCommand,
  creatorResolveCommand,
  creatorAuthoringPlanCommand,
  creatorAuthoringRecordCommand,
  creatorGenerateCommand,
}));
vi.mock('../../app/commands/publish.js', () => ({
  publishReviewCommand,
  publishApproveCommand,
  publishRunCommand,
  publishDistributeCommand,
}));
vi.mock('../../app/commands/bundle.js', () => ({
  bundleDraftCreateCommand,
  bundleDraftOptimizeCommand,
  bundleCompileCommand,
  bundleEvalPlanCommand,
  bundleEvalRecordCommand,
  bundleReviewSummaryCommand,
  bundleReviewCommand,
  bundlePublishCommand,
  bundleDistributeCommand,
}));

const originalArgv = process.argv;
const cliPath = path.join(path.resolve('.'), 'bin', 'comet.js');

async function runAction(args: string[], command: { mock: { calls: unknown[][] } }): Promise<void> {
  process.argv = [process.execPath, cliPath, ...args];
  process.exitCode = undefined;
  vi.resetModules();
  await import('../../app/cli/index.js');
  await vi.waitFor(() => expect(command.mock.calls).toHaveLength(1));
}

describe('CLI lazy command actions', () => {
  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = undefined;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('loads and dispatches every deferred command group when invoked', async () => {
    await runAction(['init', 'project'], initCommand);
    await runAction(['status', 'project'], statusCommand);
    await runAction(['workflow', 'resolve', 'project'], workflowResolveCommand);
    await runAction(['resume-probe', 'project'], resumeProbeCommand);
    await runAction(['dashboard', 'project', '--port', '0'], dashboardCommand);
    await runAction(['doctor', 'project'], doctorCommand);
    await runAction(['update', 'project'], updateCommand);
    await runAction(['uninstall', 'project', '--force'], uninstallCommand);
    await runAction(['eval'], evalCommand);
    await runAction(['state', 'show'], runClassicFacade);
    await runAction(['classic', 'root', 'show'], runClassicGroupFacade);
    await runAction(['native', 'next', 'change'], runNativeFacade);
    await runAction(['skill', 'add', 'source'], skillInstallCommand);
    await runAction(['skill', 'show', 'example'], skillShowCommand);
    await runAction(['skill', 'run', 'example'], skillRunCommand);
    await runAction(['skill', 'continue'], skillResumeCommand);
    await runAction(['skill', 'check'], skillCheckCommand);
    await runAction(['creator', 'list'], creatorListCommand);
    await runAction(['creator', 'status', 'example'], creatorStatusCommand);
    await runAction(['creator', 'next', 'example'], creatorNextCommand);
    await runAction(['creator', 'guide'], creatorGuideCommand);
    await runAction(['creator', 'candidates'], creatorCandidatesCommand);
    await runAction(
      ['creator', 'propose', 'example', '--file', 'plan.json'],
      creatorProposeCommand,
    );
    await runAction(['creator', 'init', 'example', '--file', 'plan.json'], creatorInitCommand);
    await runAction(
      ['creator', 'resolve', 'example', '--candidate', 'source'],
      creatorResolveCommand,
    );
    await runAction(['creator', 'authoring-plan', 'example'], creatorAuthoringPlanCommand);
    await runAction(
      ['creator', 'authoring-record', 'example', '--lane', 'lane', '--file', 'result.json'],
      creatorAuthoringRecordCommand,
    );
    await runAction(['creator', 'generate', 'example'], creatorGenerateCommand);
    await runAction(['publish', 'review', 'example', '--platform', 'codex'], publishReviewCommand);
    await runAction(
      ['publish', 'approve', 'example', '--reviewer', 'reviewer'],
      publishApproveCommand,
    );
    await runAction(['publish', 'run', 'example', '--platform', 'codex'], publishRunCommand);
    await runAction(['publish', 'distribute', 'example'], publishDistributeCommand);
    await runAction(['bundle', 'draft', 'create', 'example'], bundleDraftCreateCommand);
    await runAction(['bundle', 'draft', 'optimize', 'source'], bundleDraftOptimizeCommand);
    await runAction(['bundle', 'compile', 'example', '--platform', 'codex'], bundleCompileCommand);
    await runAction(['bundle', 'eval-plan', 'example'], bundleEvalPlanCommand);
    await runAction(
      ['bundle', 'eval-record', 'example', '--result', 'result.json'],
      bundleEvalRecordCommand,
    );
    await runAction(
      ['bundle', 'review-summary', 'example', '--platform', 'codex'],
      bundleReviewSummaryCommand,
    );
    await runAction(
      ['bundle', 'review', 'example', '--approve', '--reviewer', 'reviewer'],
      bundleReviewCommand,
    );
    await runAction(['bundle', 'publish', 'example', '--platform', 'codex'], bundlePublishCommand);
    await runAction(['bundle', 'distribute', 'example'], bundleDistributeCommand);
  });
});
