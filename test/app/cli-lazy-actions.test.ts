import path from 'path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

const statusCommand = vi.fn(async () => undefined);
const initCommand = vi.fn(async () => undefined);
const cometTaskCommand = vi.fn(async () => undefined);
const workflowResolveCommand = vi.fn(async () => undefined);
const personalMemoryManageCommand = vi.fn(async () => undefined);
const personalMemoryStatusCommand = vi.fn(async () => undefined);
const personalMemoryRetrieveCommand = vi.fn(async () => undefined);
const personalMemoryRememberCommand = vi.fn(async () => undefined);
const personalMemoryCorrectCommand = vi.fn(async () => undefined);
const personalMemoryForgetCommand = vi.fn(async () => undefined);
const personalMemoryRollbackCommand = vi.fn(async () => undefined);
const personalMemoryObserveCommand = vi.fn(async () => undefined);
const personalMemoryContextCommand = vi.fn(async () => undefined);
const personalMemorySyncCommand = vi.fn(async () => undefined);
const personalMemoryRemoteCommand = vi.fn(async () => undefined);
const personalMemoryPauseCommand = vi.fn(async () => undefined);
const projectKnowledgeStatusCommand = vi.fn(async () => undefined);
const projectKnowledgeQueryCommand = vi.fn(async () => undefined);
const projectKnowledgeRebuildCommand = vi.fn(async () => undefined);
const projectKnowledgeListCommand = vi.fn(async () => undefined);
const projectKnowledgeGetCommand = vi.fn(async () => undefined);
const projectKnowledgeCorrectCommand = vi.fn(async () => undefined);
const projectKnowledgeForgetCommand = vi.fn(async () => undefined);
const projectKnowledgeFeedbackCommand = vi.fn(async () => undefined);
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
const creatorStartCommand = vi.fn(async () => undefined);
const creatorDispatchCommand = vi.fn(async () => undefined);
const creatorCandidatesCommand = vi.fn(async () => undefined);
const applicationInstallCommand = vi.fn(async () => undefined);
const applicationExportCommand = vi.fn(async () => undefined);
const applicationUninstallCommand = vi.fn(async () => undefined);
const applicationDistributeCommand = vi.fn(async () => undefined);
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
vi.mock('../../app/commands/comet-task.js', () => ({ cometTaskCommand }));
vi.mock('../../app/commands/workflow.js', () => ({ workflowResolveCommand }));
vi.mock('../../app/commands/personal-memory.js', () => ({
  personalMemoryManageCommand,
  personalMemoryStatusCommand,
  personalMemoryRetrieveCommand,
  personalMemoryRememberCommand,
  personalMemoryCorrectCommand,
  personalMemoryForgetCommand,
  personalMemoryRollbackCommand,
  personalMemoryObserveCommand,
  personalMemoryContextCommand,
  personalMemorySyncCommand,
  personalMemoryRemoteCommand,
  personalMemoryPauseCommand,
}));
vi.mock('../../app/commands/project-knowledge.js', () => ({
  projectKnowledgeStatusCommand,
  projectKnowledgeQueryCommand,
  projectKnowledgeRebuildCommand,
  projectKnowledgeListCommand,
  projectKnowledgeGetCommand,
  projectKnowledgeCorrectCommand,
  projectKnowledgeForgetCommand,
  projectKnowledgeFeedbackCommand,
}));
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
  creatorStartCommand,
  creatorDispatchCommand,
  creatorListCommand,
  creatorStatusCommand,
  creatorNextCommand,
  creatorGuideCommand,
  creatorCandidatesCommand,
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

vi.mock('../../app/commands/application.js', () => ({
  applicationInstallCommand,
  applicationExportCommand,
  applicationUninstallCommand,
  applicationDistributeCommand,
}));
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
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('dispatches application distribution and selective uninstall for multiple Comet platforms', async () => {
    await runAction(
      [
        'application',
        'distribute',
        'application.json',
        '--platform',
        'cursor',
        '--platform',
        'zcode',
        '--scope',
        'user',
        '--user-root',
        'isolated-home',
        '--preview',
        '--json',
      ],
      applicationDistributeCommand,
    );
    expect(applicationDistributeCommand).toHaveBeenCalledWith(
      'application.json',
      expect.objectContaining({
        platform: ['cursor', 'zcode'],
        scope: 'user',
        userRoot: 'isolated-home',
        preview: true,
        json: true,
      }),
    );
    await runAction(
      [
        'application',
        'uninstall',
        'editorial',
        '--platform',
        'cursor',
        '--platform',
        'zcode',
        '--confirmation-hash',
        'current-preview',
        '--json',
      ],
      applicationUninstallCommand,
    );
    expect(applicationUninstallCommand).toHaveBeenCalledWith(
      'editorial',
      expect.objectContaining({
        platform: ['cursor', 'zcode'],
        confirmationHash: 'current-preview',
        json: true,
      }),
    );
  });

  it('dispatches application previews, explicit confirmations, and export with their scopes', async () => {
    await runAction(
      [
        'application',
        'install',
        'application.json',
        '--scope',
        'user',
        '--user-root',
        'user-apps',
        '--host',
        'codex',
        '--upgrade',
        '--json',
      ],
      applicationInstallCommand,
    );
    expect(applicationInstallCommand).toHaveBeenCalledWith(
      'application.json',
      expect.objectContaining({
        scope: 'user',
        userRoot: 'user-apps',
        host: 'codex',
        upgrade: true,
        json: true,
      }),
    );
    expect(applicationInstallCommand.mock.calls[0][1]).not.toHaveProperty('confirmationHash');
    await runAction(
      ['application', 'export', 'application.json', 'exported', '--project', 'project', '--json'],
      applicationExportCommand,
    );
    expect(applicationExportCommand).toHaveBeenCalledWith(
      'application.json',
      'exported',
      expect.objectContaining({ project: 'project', json: true }),
    );
    await runAction(
      [
        'application',
        'uninstall',
        'weekly-report',
        '--scope',
        'user',
        '--user-root',
        'user-apps',
        '--confirmation-hash',
        'current-preview',
        '--json',
      ],
      applicationUninstallCommand,
    );
    expect(applicationUninstallCommand).toHaveBeenCalledWith(
      'weekly-report',
      expect.objectContaining({
        scope: 'user',
        userRoot: 'user-apps',
        confirmationHash: 'current-preview',
        json: true,
      }),
    );
  });

  it('dispatches SDK Creator start and current action requests with their required inputs', async () => {
    await runAction(
      [
        'creator',
        'start',
        'weekly-report',
        '--goal',
        '生成每周报告',
        '--install-target',
        '.claude/skills/weekly-report',
        '--host',
        'claude-code',
        '--json',
      ],
      creatorStartCommand,
    );
    expect(creatorStartCommand).toHaveBeenCalledWith(
      'weekly-report',
      expect.objectContaining({
        goal: '生成每周报告',
        installTarget: '.claude/skills/weekly-report',
        host: 'claude-code',
        json: true,
      }),
    );
    await runAction(
      ['creator', 'dispatch', 'weekly-report', '--request', 'current-action.json', '--json'],
      creatorDispatchCommand,
    );
    expect(creatorDispatchCommand).toHaveBeenCalledWith(
      'weekly-report',
      expect.objectContaining({ request: 'current-action.json', json: true }),
    );
  });

  it('retains root commands without constructing unrelated group subcommands', async () => {
    const register = vi.spyOn(Command.prototype, 'command');
    await runAction(['status', 'project'], statusCommand);
    const commands = register.mock.calls.map(([name]) => name);
    expect(commands).toEqual(
      expect.arrayContaining([
        'workflow',
        'memory',
        'knowledge',
        'skill',
        'creator',
        'publish',
        'bundle',
      ]),
    );
    expect(commands).not.toContain('retrieve [path]');
    expect(commands).not.toContain('review [path]');
    expect(commands).not.toContain('draft');
    expect(commands).not.toContain('generate <name>');
  });

  it.each([
    ['memory', '--help'],
    ['help', 'memory'],
    ['help', '--', 'memory'],
  ])('registers group help for %j', async (...args) => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation((exitCode) => {
      throw Object.assign(new Error('CLI exit'), { exitCode });
    });
    process.argv = [process.execPath, cliPath, ...args];
    vi.resetModules();
    await import('../../app/cli/index.js');
    expect(output.join('')).toContain('Usage: comet memory [options] [command]');
    expect(output.join('')).toContain('retrieve [options] [path]');
    expect(output.join('')).toContain('rollback [options] [path]');
    expect(personalMemoryManageCommand).not.toHaveBeenCalled();
  });

  it.each([
    { args: ['memroy', '--json'], message: "unknown command 'memroy'", suggestion: 'memory' },
    {
      args: ['memory', 'retriev', '--json'],
      message: "unknown command 'retriev'",
      suggestion: 'retrieve',
    },
    { args: ['memory', 'retrieve', '--bogus', '--json'], message: "unknown option '--bogus'" },
    {
      args: ['memory', 'remember', '--json'],
      message: "required option '--text <text>' not specified",
    },
  ])('retains Commander errors for $args', async ({ args, message, suggestion }) => {
    const output: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)));
    vi.spyOn(console, 'error').mockImplementation((value) => errors.push(String(value)));
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errors.push(String(chunk));
      return true;
    });
    process.argv = [process.execPath, cliPath, ...args];
    vi.resetModules();
    await import('../../app/cli/index.js');
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(output.join(''))).toMatchObject({
      status: 'failed',
      error: expect.stringContaining(message),
    });
    if (suggestion) expect(errors.join('')).toContain(suggestion);
    expect(personalMemoryRetrieveCommand).not.toHaveBeenCalled();
    expect(personalMemoryRememberCommand).not.toHaveBeenCalled();
  });

  it('loads and dispatches every deferred command group when invoked', async () => {
    await runAction(['init', 'project'], initCommand);
    await runAction(['status', 'project'], statusCommand);
    await runAction(['task', 'project', '--task', 'verify the change'], cometTaskCommand);
    await runAction(['workflow', 'resolve', 'project'], workflowResolveCommand);
    await runAction(['memory', 'list', 'project'], personalMemoryManageCommand);
    await runAction(['memory', 'status', 'project'], personalMemoryStatusCommand);
    await runAction(['memory', 'retrieve', 'project'], personalMemoryRetrieveCommand);
    await runAction(
      ['memory', 'remember', 'project', '--text', 'prefer concise output'],
      personalMemoryRememberCommand,
    );
    await runAction(
      ['memory', 'correct', 'project', '--id', 'memory-id'],
      personalMemoryCorrectCommand,
    );
    await runAction(
      ['memory', 'forget', 'project', '--id', 'memory-id'],
      personalMemoryForgetCommand,
    );
    await runAction(
      ['memory', 'rollback', 'project', '--id', 'memory-id'],
      personalMemoryRollbackCommand,
    );
    await runAction(
      [
        'memory',
        'observe',
        'project',
        '--text',
        'run verification',
        '--workflow',
        'native',
        '--change',
        'change-a',
        '--candidate-key',
        'verification',
      ],
      personalMemoryObserveCommand,
    );
    await runAction(
      ['memory', 'context', 'project', '--task', 'verify the change'],
      personalMemoryContextCommand,
    );
    await runAction(['memory', 'sync', 'project'], personalMemorySyncCommand);
    await runAction(['memory', 'remote', 'project'], personalMemoryRemoteCommand);
    await runAction(['memory', 'pause', 'project'], personalMemoryPauseCommand);
    await runAction(['knowledge', 'status', 'project'], projectKnowledgeStatusCommand);
    await runAction(
      ['knowledge', 'query', 'project', '--task', 'find project guidance'],
      projectKnowledgeQueryCommand,
    );
    await runAction(['knowledge', 'rebuild', 'project'], projectKnowledgeRebuildCommand);
    await runAction(['knowledge', 'list', 'project'], projectKnowledgeListCommand);
    await runAction(
      ['knowledge', 'get', 'project', '--id', 'knowledge-id'],
      projectKnowledgeGetCommand,
    );
    await runAction(
      ['knowledge', 'correct', 'project', '--id', 'knowledge-id', '--text', 'updated guidance'],
      projectKnowledgeCorrectCommand,
    );
    await runAction(
      ['knowledge', 'forget', 'project', '--id', 'knowledge-id'],
      projectKnowledgeForgetCommand,
    );
    await runAction(
      [
        'knowledge',
        'feedback',
        'project',
        '--id',
        'knowledge-id',
        '--outcome',
        'used-successfully',
      ],
      projectKnowledgeFeedbackCommand,
    );
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

  it.each([
    {
      args: ['creator', 'start', '--json'],
      command: 'comet creator start [options] <name>',
      requiredArguments: ['<name>'],
      missingOptions: ['--goal <text>', '--install-target <directory>'],
    },
    {
      args: ['creator', 'start', 'weekly', '--goal', 'weekly report', '--json'],
      command: 'comet creator start [options] <name>',
      requiredArguments: ['<name>'],
      missingOptions: ['--install-target <directory>'],
    },
    {
      args: ['application', 'export', '--json'],
      command: 'comet application export [options] <file> <destination>',
      requiredArguments: ['<file>', '<destination>'],
      missingOptions: [],
    },
    {
      args: ['bundle', 'compile', '--json'],
      command: 'comet bundle compile [options] <name>',
      requiredArguments: ['<name>'],
      missingOptions: ['--platform <id>'],
    },
  ])('returns all required inputs on the first failure for $args', async (expected) => {
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    process.argv = [process.execPath, cliPath, ...expected.args];
    vi.resetModules();
    await import('../../app/cli/index.js');
    expect(process.exitCode).toBe(1);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({
      status: 'failed',
      usage: {
        command: expected.command,
        requiredArguments: expected.requiredArguments,
        missingOptions: expected.missingOptions,
        helpCommand: `${expected.args.slice(0, 2).join(' ')} --help`.replace(/^/, 'comet '),
      },
    });
    expect(creatorStartCommand).not.toHaveBeenCalled();
    expect(applicationExportCommand).not.toHaveBeenCalled();
    expect(bundleCompileCommand).not.toHaveBeenCalled();
  });
});
