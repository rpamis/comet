import { Command, Option } from 'commander';
import { getCurrentVersion } from '../../platform/version/version.js';
import { COMET_TAGLINE } from './comet-banner.js';

// Command handlers are imported lazily inside each `.action()` so that running
// `comet status` does not load the dashboard/eval/creator/bundle modules (and
// their transitive dependencies such as @inquirer/prompts). This keeps CLI
// startup proportional to the command actually being run.

// The public Classic facade commands are stable names inlined here to avoid
// importing the Classic CLI graph at module load time.
const PUBLIC_CLASSIC_COMMANDS = ['state', 'guard', 'handoff', 'archive'] as const;
type PublicClassicCommand = (typeof PUBLIC_CLASSIC_COMMANDS)[number];

const program = new Command();
const collect = (value: string, previous: string[]): string[] => [...previous, value];

program
  .name('comet')
  .description(COMET_TAGLINE)
  .version(getCurrentVersion(), '-v, --version', 'output the current version');

program
  .command('init [path]')
  .description('Initialize Comet workflow in your project')
  .option('--yes', 'Auto-install missing components, skip existing')
  .option('--skip-existing', 'Never overwrite existing components')
  .option('--overwrite', 'Overwrite manifest-managed files')
  .option('--json', 'Output as JSON')
  .option('--platform <platform>', 'Platform target to initialize')
  .addOption(
    new Option('--codegraph <action>', 'Project CodeGraph index action').choices(['init', 'skip']),
  )
  .addOption(new Option('--scope <scope>', 'Install scope').choices(['global', 'project']))
  .addOption(new Option('--language <lang>', 'Language for skills').choices(['en', 'zh']))
  .addOption(
    new Option('--workflow <workflow>', 'Workflows to initialize').choices([
      'native',
      'classic',
      'both',
    ]),
  )
  .option('--root <artifact-root>', 'Native artifact root relative to the project')
  .action(async (targetPath = '.', options) => {
    const { initCommand } = await import('../commands/init.js');
    const { exitCodeForCommandResult } = await import('../commands/command-result.js');
    const result = await initCommand(targetPath, { ...options, artifactRoot: options.root });
    process.exitCode = exitCodeForCommandResult(result);
  });

program
  .command('status [path]')
  .description('Show active changes and workflow status')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { statusCommand } = await import('../commands/status.js');
    await statusCommand(targetPath, options);
  });

program
  .command('task [path]')
  .description('为普通 Comet Skill 任务选择上下文并在结束时记录结果')
  .requiredOption('--task <text>', '用户原始请求')
  .option('--path <path>', '当前任务目标路径')
  .option('--phase <phase>', '当前工作阶段，例如 build 或 verify')
  .option('--operation <operation>', '当前操作，例如 edit、review 或 verify')
  .option('--session <id>', '当前 Agent 会话标识，用于避免重复注入')
  .option('--context-budget <characters>', '本次注入的字符预算')
  .option('--expand-context <id>', '按 Context Manifest 标识渐进加载完整内容')
  .option('--application <id>', '记录一次上下文应用结果')
  .addOption(
    new Option('--outcome <outcome>', '上下文应用结果').choices([
      'used-successfully',
      'ignored',
      'overridden',
      'corrected',
      'contributed-to-failure',
    ]),
  )
  .option('--complete', '记录成功任务')
  .option('--workflow <workflow>', '工作流类型')
  .option('--change <id>', '当前 change ID')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { cometTaskCommand } = await import('../commands/comet-task.js');
    await cometTaskCommand(targetPath, options);
  });

const workflow = program.command('workflow').description('Resolve the configured Comet workflow');

workflow
  .command('resolve [path]')
  .description('Resolve /comet to its permanent Native or Classic entry')
  .option('--activate', 'Create project configuration from global defaults when missing')
  .option('--task <text>', '当前任务，用于自动选择个人记忆上下文')
  .option('--path <path>', '当前任务目标路径')
  .option('--phase <phase>', '当前工作阶段，例如 build 或 verify')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { workflowResolveCommand } = await import('../commands/workflow.js');
    await workflowResolveCommand(targetPath, options);
  });

const memory = program.command('memory').description('查看和维护跨会话的个人记忆');

memory
  .command('list [path]')
  .description('查看可管理的个人记忆及其状态')
  .option('--query <text>', '关键词')
  .addOption(new Option('--scope <scope>', '记忆范围').choices(['global', 'project']))
  .option('--category <category>', '记忆类别')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { personalMemoryManageCommand } = await import('../commands/personal-memory.js');
    await personalMemoryManageCommand(targetPath, options);
  });

memory
  .command('status [path]')
  .description('查看个人记忆状态和同步状态')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { personalMemoryStatusCommand } = await import('../commands/personal-memory.js');
    await personalMemoryStatusCommand(targetPath, options);
  });

memory
  .command('retrieve [path]')
  .description('按当前任务检索相关个人记忆')
  .addOption(new Option('--scope <scope>', '记忆范围').choices(['global', 'project']))
  .option('--project <key>', '项目记忆 key')
  .option('--task <text>', '任务描述')
  .option('--path <path>', '当前文件或目录')
  .option('--operation <operation>', '当前操作')
  .option('--category <category>', '记忆类别')
  .option('--tag <tag>', '记忆标签', collect, [])
  .option('--query <text>', '关键词')
  .option('--max-entries <count>', '最多返回条目数')
  .option('--max-bytes <bytes>', '最多返回字节数')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { personalMemoryRetrieveCommand } = await import('../commands/personal-memory.js');
    await personalMemoryRetrieveCommand(targetPath, { ...options, tags: options.tag });
  });

memory
  .command('remember [path]')
  .description('手动记录一条个人记忆')
  .requiredOption('--text <text>', '记忆内容')
  .option('--category <category>', '记忆类别')
  .addOption(
    new Option('--scope <scope>', '记忆范围').choices(['global', 'project']).default('project'),
  )
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { personalMemoryRememberCommand } = await import('../commands/personal-memory.js');
    await personalMemoryRememberCommand(targetPath, options);
  });

memory
  .command('correct [path]')
  .description('纠正一条个人记忆')
  .requiredOption('--id <id>', '记忆标识')
  .option('--text <text>', '新的记忆内容')
  .option('--category <category>', '新的记忆类别')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { personalMemoryCorrectCommand } = await import('../commands/personal-memory.js');
    await personalMemoryCorrectCommand(targetPath, options);
  });

memory
  .command('forget [path]')
  .description('忘记一条个人记忆（默认保留回滚能力）')
  .requiredOption('--id <id>', '记忆标识')
  .option('--permanent', '永久删除且不可回滚')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { personalMemoryForgetCommand } = await import('../commands/personal-memory.js');
    await personalMemoryForgetCommand(targetPath, options);
  });

memory
  .command('rollback [path]')
  .description('回滚一条个人记忆')
  .requiredOption('--id <id>', '记忆标识')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { personalMemoryRollbackCommand } = await import('../commands/personal-memory.js');
    await personalMemoryRollbackCommand(targetPath, options);
  });

memory
  .command('observe [path]')
  .description('记录一次可跨任务复用的用户偏好或稳定协作方式')
  .requiredOption('--text <text>', '只填写偏好或约定，不填写任务摘要、命令输出或测试结果')
  .requiredOption('--workflow <workflow>', '工作流类型')
  .requiredOption('--change <id>', 'Change ID')
  .requiredOption('--candidate-key <key>', '候选行为标识')
  .option('--category <category>', '记忆类别')
  .option('--no-success', '将本次结果记录为失败')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { personalMemoryObserveCommand } = await import('../commands/personal-memory.js');
    await personalMemoryObserveCommand(targetPath, options);
  });

memory
  .command('context [path]')
  .description('为当前任务选择应注入的个人记忆')
  .requiredOption('--task <text>', '任务描述')
  .option('--path <path>', '当前文件或目录')
  .option('--phase <phase>', '验证阶段，例如 build 或 verify')
  .option('--operation <operation>', '当前操作，例如 edit、review 或 verify')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { personalMemoryContextCommand } = await import('../commands/personal-memory.js');
    await personalMemoryContextCommand(targetPath, options);
  });

memory
  .command('sync [path]')
  .description('同步个人记忆仓库')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { personalMemorySyncCommand } = await import('../commands/personal-memory.js');
    await personalMemorySyncCommand(targetPath, options);
  });

memory
  .command('remote [path]')
  .description('查看或配置专用记忆仓库的 Git remote')
  .option('--set <url>', '设置 origin remote')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { personalMemoryRemoteCommand } = await import('../commands/personal-memory.js');
    await personalMemoryRemoteCommand(targetPath, options);
  });

memory
  .command('pause [path]')
  .description('暂停或恢复指定项目的记忆学习/检索')
  .option('--project <key>', '项目记忆 key')
  .option('--learning', '仅暂停学习')
  .option('--retrieval', '仅暂停检索')
  .option('--resume', '恢复项目记忆')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { personalMemoryPauseCommand } = await import('../commands/personal-memory.js');
    await personalMemoryPauseCommand(targetPath, options);
  });

const knowledge = program.command('knowledge').description('查看和查询当前项目的项目知识');

knowledge
  .command('status [path]')
  .description('查看 Local 索引或 Remote Provider 状态')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { projectKnowledgeStatusCommand } = await import('../commands/project-knowledge.js');
    await projectKnowledgeStatusCommand(targetPath, options);
  });

knowledge
  .command('query [path]')
  .description('查询项目知识记录与来源')
  .option('--task <text>', '查询或任务描述')
  .option('--path <path>', '当前文件或目录')
  .option('--phase <phase>', '当前阶段')
  .option('--operation <operation>', '当前操作')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { projectKnowledgeQueryCommand } = await import('../commands/project-knowledge.js');
    await projectKnowledgeQueryCommand(targetPath, options);
  });

knowledge
  .command('rebuild [path]')
  .description('重新核对当前项目知识来源')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { projectKnowledgeRebuildCommand } = await import('../commands/project-knowledge.js');
    await projectKnowledgeRebuildCommand(targetPath, options);
  });

knowledge
  .command('list [path]')
  .description('列出项目知识记录')
  .addOption(
    new Option('--state <state>', '记录状态').choices([
      'trial',
      'proven',
      'enforced',
      'superseded',
      'all',
    ]),
  )
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { projectKnowledgeListCommand } = await import('../commands/project-knowledge.js');
    await projectKnowledgeListCommand(targetPath, options);
  });

knowledge
  .command('get [path]')
  .description('查看一条项目知识记录')
  .requiredOption('--id <id>', '记录标识')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { projectKnowledgeGetCommand } = await import('../commands/project-knowledge.js');
    await projectKnowledgeGetCommand(targetPath, options);
  });

knowledge
  .command('correct [path]')
  .description('纠正一条项目知识记录')
  .requiredOption('--id <id>', '记录标识')
  .requiredOption('--text <text>', '新的记录说明')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { projectKnowledgeCorrectCommand } = await import('../commands/project-knowledge.js');
    await projectKnowledgeCorrectCommand(targetPath, options);
  });

knowledge
  .command('forget [path]')
  .description('忘记一条项目知识记录')
  .requiredOption('--id <id>', '记录标识')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { projectKnowledgeForgetCommand } = await import('../commands/project-knowledge.js');
    await projectKnowledgeForgetCommand(targetPath, options);
  });

knowledge
  .command('feedback [path]')
  .description('记录一条项目知识在真实任务中的应用结果')
  .requiredOption('--id <id>', '记录标识')
  .addOption(
    new Option('--outcome <outcome>', '应用结果').choices([
      'used-successfully',
      'ignored',
      'overridden',
      'corrected',
      'contributed-to-failure',
    ]),
  )
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    const { projectKnowledgeFeedbackCommand } = await import('../commands/project-knowledge.js');
    await projectKnowledgeFeedbackCommand(targetPath, options);
  });

program
  .command('resume-probe [path]')
  .description('Probe whether an active Comet workflow should resume')
  .option('--utterance <text>', 'User request to classify', '')
  .option('--stdin', 'Read the user request from stdin')
  .option('--json', 'Output as JSON')
  .option('--no-workflow-work', 'Treat the request as informational instead of workflow work')
  .option(
    '--already-in-comet-flow',
    'Report out_of_scope when the current turn is already inside Comet',
  )
  .action(async (targetPath = '.', options) => {
    const { resumeProbeCommand } = await import('../commands/resume-probe.js');
    await resumeProbeCommand(targetPath, options);
  });

program
  .command('dashboard [path]')
  .description('Launch the local Comet dashboard in your browser')
  .option('--port <port>', 'HTTP port to bind (default 4321, auto-bumps if busy)', (value) => {
    if (!/^\d+$/u.test(value)) {
      throw new Error(`Invalid --port value: "${value}". Use an integer between 0 and 65535.`);
    }
    const port = Number.parseInt(value, 10);
    if (port < 0 || port > 65535) {
      throw new Error(`Invalid --port value: "${value}". Use an integer between 0 and 65535.`);
    }
    return port;
  })
  .option('--no-open', "Don't open the dashboard URL in the browser automatically")
  .option('--json', 'Print a single dashboard snapshot to stdout and exit')
  .action(async (targetPath = '.', options) => {
    const { dashboardCommand } = await import('../commands/dashboard.js');
    await dashboardCommand(targetPath, options);
  });

program
  .command('doctor [path]')
  .description('Diagnose Comet installation health')
  .option('--json', 'Output as JSON')
  .option('--repair', 'Repair managed Hook, Rule, and deterministic selection state')
  .option('--yes', 'Authorize repairable project integrations such as CodeGraph indexing')
  .addOption(
    new Option('--strategy <strategy>', 'Classic root move recovery strategy').choices([
      'continue',
      'rollback',
    ]),
  )
  .addOption(
    new Option('--scope <scope>', 'Install scope to diagnose').choices([
      'auto',
      'global',
      'project',
    ]),
  )
  .action(async (targetPath = '.', options) => {
    const { doctorCommand } = await import('../commands/doctor.js');
    await doctorCommand(targetPath, options);
  });

program
  .command('update [path]')
  .description('Update comet skill files to latest version')
  .option('--json', 'Output as JSON')
  .option('--platform <platform>', 'Platform target to update')
  .addOption(new Option('--language <lang>', 'Language for skills').choices(['en', 'zh']))
  .addOption(
    new Option('--classic-layout <layout>', 'Classic root to record when both roots exist').choices(
      ['legacy', 'docs'],
    ),
  )
  .addOption(new Option('--scope <scope>', 'Install scope').choices(['global', 'project']))
  .option('--all-projects', 'Update all indexed project-scope Comet installs')
  .option('--current-project', 'Update only the current project')
  .option(
    '--self-update',
    'Update the Comet npm package and installed Classic dependencies before refreshing project assets',
  )
  .option('--skip-self-update', 'Skip the Comet npm package self-update')
  .addOption(new Option('--skip-npm', 'Deprecated alias for --skip-self-update').hideHelp())
  .action(async (targetPath = '.', options) => {
    const { updateCommand } = await import('../commands/update.js');
    const { exitCodeForCommandResult } = await import('../commands/command-result.js');
    const result = await updateCommand(targetPath, options);
    process.exitCode = exitCodeForCommandResult(result);
  });

program
  .command('uninstall [path]')
  .description('Remove Comet skills, rules, and hooks from your project or global scope')
  .option('--json', 'Output as JSON')
  .addOption(new Option('--scope <scope>', 'Uninstall scope').choices(['global', 'project']))
  .option('--all-projects', 'Uninstall all indexed project-scope Comet installs')
  .option('--current-project', 'Uninstall only the current project')
  .option('--force', 'Skip confirmation prompts')
  .action(async (targetPath = '.', options) => {
    const { uninstallCommand } = await import('../commands/uninstall.js');
    try {
      await uninstallCommand(targetPath, options);
    } catch (error) {
      if (error instanceof Error && error.name === 'ExitPromptError') {
        console.log('\n  Cancelled.\n');
        process.exit(0);
      }
      throw error;
    }
  });

program
  .command('eval')
  .description('Evaluate a Skill or eval manifest with one command')
  .argument('[target]', 'Local Skill directory, SKILL.md, or comet/eval.yaml')
  .option('--project <dir>', 'Repository root that contains eval/')
  .option('--manifest <path>', 'Path to comet/eval.yaml')
  .option('--skill-path <path>', 'Local Skill directory or SKILL.md')
  .option('--skill-name <name>', 'Skill name used with --skill-path')
  .option('--agent <agent>', 'Evaluation agent (built-in or explicitly installed custom adapter)')
  .option('--model <model>', 'Main evaluation model override')
  .option('--base-url <url>', 'Main evaluation API base URL override')
  .option('--judge-agent <agent>', 'Independent Judge agent (built-in or installed custom adapter)')
  .option('--judge-model <model>', 'Independent Judge model (required when enabled)')
  .option('--judge-base-url <url>', 'Independent Judge API base URL override')
  .addOption(
    new Option('--suite <suite>', 'Eval suite')
      .choices(['local', 'langsmith', 'langfuse'])
      .default('local'),
  )
  .option('--profile <name>', 'Eval profile override')
  .option('--task <task>', 'Explicit eval task override')
  .option('--report-config <path>', 'JSON/YAML report output config')
  .option('--html', 'Enable HTML report output')
  .option('--quick', 'Use the default quick smoke task where applicable')
  .option('--collect', 'Collect targets without executing Claude or Docker workloads')
  .action(async (target, options) => {
    const { evalCommand: evalFacadeCommand } = await import('../commands/eval.js');
    await evalFacadeCommand(target, options);
  });

const classicDescriptions: Record<PublicClassicCommand, string> = {
  state: 'Read and update Classic workflow state',
  guard: 'Check Classic workflow phase guards',
  handoff: 'Create and inspect Classic workflow handoffs',
  archive: 'Archive completed Classic workflow changes',
};

for (const command of PUBLIC_CLASSIC_COMMANDS) {
  program
    .command(`${command} [args...]`)
    .description(classicDescriptions[command])
    .allowUnknownOption()
    .allowExcessArguments()
    .action(async (args: string[]) => {
      const { runClassicFacade } = await import('../commands/classic.js');
      process.exitCode = await runClassicFacade(command as PublicClassicCommand, args);
    });
}

program
  .command('classic [args...]')
  .description('Manage the Comet Classic workflow and its configured artifact root')
  .allowUnknownOption()
  .allowExcessArguments()
  .helpOption(false)
  .action(async (args: string[]) => {
    const { runClassicGroupFacade } = await import('../commands/classic.js');
    process.exitCode = await runClassicGroupFacade(args);
  });

program
  .command('native [args...]')
  .description('Manage the self-contained Comet Native workflow')
  .allowUnknownOption()
  .allowExcessArguments()
  .helpOption(false)
  .action(async (args: string[]) => {
    const { runNativeFacade } = await import('../commands/native.js');
    process.exitCode = await runNativeFacade(args);
  });

const skill = program
  .command('skill')
  .description('Install, inspect, and debug local Skill packages');

skill
  .command('add <path>')
  .description('Install a Comet Skill into the project Skill pool')
  .option('--project <dir>', 'Project root', '.')
  .option('--overwrite', 'Replace an existing project Skill')
  .option('--json', 'Output as JSON')
  .action(async (source, options) => {
    const { skillInstallCommand } = await import('../commands/skill.js');
    await skillInstallCommand(source, options);
  });

skill
  .command('show <skill>')
  .description('Show Skill package identity, validation status, and runtime metadata')
  .option('--project <dir>', 'Project root used for Skill discovery', '.')
  .option('--json', 'Output as JSON')
  .action(async (selector, options) => {
    const { skillShowCommand } = await import('../commands/skill.js');
    await skillShowCommand(selector, options);
  });

skill
  .command('run <skill>')
  .description('Advanced: start a deterministic Engine Skill Run')
  .option('--change <dir>', 'Change directory that owns the Run')
  .option('--run-id <id>', 'Standalone Run id stored under .comet/runs/<id>')
  .option('--project <dir>', 'Project root used for Skill discovery', '.')
  .option('--confirm <ref>', 'Confirm a guarded reference', collect, [])
  .option('--json', 'Output as JSON')
  .action(async (selector, options) => {
    const { skillRunCommand } = await import('../commands/skill.js');
    await skillRunCommand(selector, options);
  });

skill
  .command('continue')
  .description('Advanced: resume a deterministic Engine Skill Run or submit its pending action')
  .option('--change <dir>', 'Change directory that owns the Run')
  .option('--run-id <id>', 'Standalone Run id stored under .comet/runs/<id>')
  .option('--project <dir>', 'Project root used for Skill discovery', '.')
  .addOption(
    new Option('--status <status>', 'Pending action outcome').choices(['succeeded', 'failed']),
  )
  .option('--summary <text>', 'Outcome summary')
  .option('--artifact <key=value>', 'Merge an artifact reference', collect, [])
  .option('--state <key=value>', 'Record outcome state evidence', collect, [])
  .option('--confirm <ref>', 'Confirm a guarded reference', collect, [])
  .option('--upgrade <skill>', 'Upgrade the Run to a compatible Skill snapshot')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { skillResumeCommand } = await import('../commands/skill.js');
    await skillResumeCommand(options);
  });

skill
  .command('check')
  .description('Check deterministic Engine Run runtime checks. Use comet eval for eval reports')
  .option('--change <dir>', 'Change directory that owns the Run')
  .option('--run-id <id>', 'Standalone Run id stored under .comet/runs/<id>')
  .option('--project <dir>', 'Project root used for standalone Run lookup', '.')
  .addOption(
    new Option('--scope <scope>', 'Runtime check scope')
      .choices(['progress', 'step', 'completion'])
      .default('progress'),
  )
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { skillCheckCommand } = await import('../commands/skill.js');
    await skillCheckCommand(options);
  });

const publish = program
  .command('publish')
  .description('Review, approve, publish, and distribute Skill Creator candidates');

const creator = program
  .command('creator')
  .description('Skill Creator workspace for /comet-any creation and resume flows');

creator
  .command('list')
  .description('List Skill Creator candidates that can be resumed')
  .option('--project <dir>', 'Project root', '.')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { creatorListCommand } = await import('../commands/creator.js');
    await creatorListCommand(options);
  });

creator
  .command('status <name>')
  .description('Show validation readiness and next action for one Skill Creator candidate')
  .option('--project <dir>', 'Project root', '.')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { creatorStatusCommand } = await import('../commands/creator.js');
    await creatorStatusCommand(name, options);
  });

creator
  .command('next <name>')
  .description('Print the single recommended next user step')
  .option('--project <dir>', 'Project root', '.')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { creatorNextCommand } = await import('../commands/creator.js');
    await creatorNextCommand(name, options);
  });

creator
  .command('guide')
  .description('Summarize /comet-any first-use, preferences, and resumable flows')
  .option('--project <dir>', 'Project root', '.')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { creatorGuideCommand } = await import('../commands/creator.js');
    await creatorGuideCommand(options);
  });

creator
  .command('candidates')
  .description('Discover Skill candidates for Skill Creator authoring')
  .option('--project <dir>', 'Project root', '.')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { creatorCandidatesCommand } = await import('../commands/creator.js');
    await creatorCandidatesCommand(options);
  });

creator
  .command('propose <name>')
  .description('Preview a Skill Creator proposal without writing candidate state')
  .option('--project <dir>', 'Project root', '.')
  .requiredOption('--file <path>', 'Skill Creator plan JSON file')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { creatorProposeCommand } = await import('../commands/creator.js');
    await creatorProposeCommand(name, options);
  });

creator
  .command('init <name>')
  .description('Initialize or update Skill Creator metadata from a structured plan file')
  .option('--project <dir>', 'Project root', '.')
  .requiredOption('--file <path>', 'Skill Creator plan JSON file')
  .option('--confirmed-proposal', 'Record that the user approved the Skill Creator proposal')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { creatorInitCommand } = await import('../commands/creator.js');
    await creatorInitCommand(name, options);
  });

creator
  .command('resolve <name>')
  .description('Resolve a missing or ambiguous Skill Creator candidate')
  .option('--project <dir>', 'Project root', '.')
  .requiredOption('--candidate <query>', 'Skill Creator candidate query')
  .option('--source <root-or-hash>', 'Selected source root or exact source hash')
  .option('--ignore-missing', 'Ignore a missing preference and remove it from the call chain')
  .option('--reason <text>', 'Reason for ignoring a missing preference')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { creatorResolveCommand } = await import('../commands/creator.js');
    await creatorResolveCommand(name, options);
  });

creator
  .command('authoring-plan <name>')
  .description('Plan the Skill Creator authoring pipeline for a candidate')
  .option('--project <dir>', 'Project root', '.')
  .addOption(
    new Option('--depth <depth>', 'Authoring depth').choices(['quick', 'full']).default('quick'),
  )
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { creatorAuthoringPlanCommand } = await import('../commands/creator.js');
    await creatorAuthoringPlanCommand(name, options);
  });

creator
  .command('authoring-record <name>')
  .description('Validate and record a Skill Creator authoring lane output')
  .option('--project <dir>', 'Project root', '.')
  .requiredOption('--lane <id>', 'Authoring lane id')
  .requiredOption('--file <path>', 'Lane output JSON file')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { creatorAuthoringRecordCommand } = await import('../commands/creator.js');
    await creatorAuthoringRecordCommand(name, options);
  });

creator
  .command('generate <name>')
  .description('Generate candidate source from stored Skill Creator metadata')
  .option('--project <dir>', 'Project root', '.')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { creatorGenerateCommand } = await import('../commands/creator.js');
    await creatorGenerateCommand(name, options);
  });

publish
  .command('review <name>')
  .description('Build a validation summary before approval')
  .option('--project <dir>', 'Project root', '.')
  .requiredOption('--platform <id>', 'Reference platform id')
  .addOption(new Option('--scope <scope>', 'Install scope').choices(['global', 'project']))
  .option('--locale <locale>', 'Locale to compile')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { publishReviewCommand } = await import('../commands/publish.js');
    await publishReviewCommand(name, options);
  });

publish
  .command('approve <name>')
  .description('Approve a Skill Creator candidate after validation')
  .option('--project <dir>', 'Project root', '.')
  .requiredOption('--reviewer <name>', 'Reviewer name')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { publishApproveCommand } = await import('../commands/publish.js');
    await publishApproveCommand(name, options);
  });

publish
  .command('run <name>')
  .description('Generate an install candidate into .comet/bundles')
  .option('--project <dir>', 'Project root', '.')
  .requiredOption('--platform <id>', 'Reference platform id')
  .option('--overwrite', 'Replace an existing published Bundle')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { publishRunCommand } = await import('../commands/publish.js');
    await publishRunCommand(name, options);
  });

publish
  .command('distribute <name>')
  .description('Preview or install a generated Skill Creator candidate')
  .option('--project <dir>', 'Project root', '.')
  .option('--platform <id>', 'Platform id', collect, [])
  .addOption(new Option('--scope <scope>', 'Install scope').choices(['global', 'project']))
  .option('--locale <locale>', 'Locale to distribute')
  .option('--overwrite', 'Overwrite existing target files')
  .option(
    '--skip-capability <capability>',
    'Explicitly skip an unsupported optional capability',
    collect,
    [],
  )
  .option('--confirm-executables', 'Confirm executable hook/script disclosures')
  .option('--preview', 'Preview platform writes without installing files')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { publishDistributeCommand } = await import('../commands/publish.js');
    await publishDistributeCommand(name, options);
  });

const bundle = program
  .command('bundle')
  .description('Advanced Bundle backend for /comet-any Skill Creator state and audits');

const draft = bundle.command('draft').description('Manage Bundle drafts');

draft
  .command('create <name>')
  .description('Create an empty Bundle draft')
  .option('--project <dir>', 'Project root', '.')
  .addOption(new Option('--default-locale <locale>', 'Default locale').default('en'))
  .option('--locale-option <locale>', 'Supported locale', collect, [])
  .option('--engine', 'Enable optional Engine metadata')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { bundleDraftCreateCommand } = await import('../commands/bundle.js');
    await bundleDraftCreateCommand(name, options);
  });

draft
  .command('optimize <bundle>')
  .description('Create an optimization draft from an existing Bundle root')
  .option('--project <dir>', 'Project root', '.')
  .option('--name <name>', 'Override draft name')
  .option('--json', 'Output as JSON')
  .action(async (source, options) => {
    const { bundleDraftOptimizeCommand } = await import('../commands/bundle.js');
    await bundleDraftOptimizeCommand(source, options);
  });

bundle
  .command('compile <name>')
  .description('Dry-run compile a Bundle for one platform')
  .option('--project <dir>', 'Project root', '.')
  .requiredOption('--platform <id>', 'Platform id')
  .addOption(new Option('--scope <scope>', 'Install scope').choices(['global', 'project']))
  .option('--locale <locale>', 'Locale to compile')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { bundleCompileCommand } = await import('../commands/bundle.js');
    await bundleCompileCommand(name, options);
  });

bundle
  .command('eval-plan <name>')
  .description('Estimate Bundle eval work')
  .option('--project <dir>', 'Project root', '.')
  .addOption(
    new Option('--level <level>', 'Eval level').choices(['quick', 'full']).default('quick'),
  )
  .option('--locale <locale>', 'Locale to compile')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { bundleEvalPlanCommand } = await import('../commands/bundle.js');
    await bundleEvalPlanCommand(name, options);
  });

bundle
  .command('eval-record <name>')
  .description('Record structured Bundle eval evidence')
  .option('--project <dir>', 'Project root', '.')
  .requiredOption('--result <file>', 'Eval result JSON')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { bundleEvalRecordCommand } = await import('../commands/bundle.js');
    await bundleEvalRecordCommand(name, options);
  });

bundle
  .command('review-summary <name>')
  .description('Build a Bundle review summary before approval')
  .option('--project <dir>', 'Project root', '.')
  .requiredOption('--platform <id>', 'Reference platform id')
  .addOption(new Option('--scope <scope>', 'Install scope').choices(['global', 'project']))
  .option('--locale <locale>', 'Locale to compile')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { bundleReviewSummaryCommand } = await import('../commands/bundle.js');
    await bundleReviewSummaryCommand(name, options);
  });

bundle
  .command('review <name>')
  .description('Approve or reject a Bundle for publishing')
  .option('--project <dir>', 'Project root', '.')
  .option('--approve', 'Approve the Bundle')
  .option('--reject', 'Reject the Bundle')
  .requiredOption('--reviewer <name>', 'Reviewer name')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { bundleReviewCommand } = await import('../commands/bundle.js');
    await bundleReviewCommand(name, options);
  });

bundle
  .command('publish <name>')
  .description('Publish an approved Bundle into .comet/bundles')
  .option('--project <dir>', 'Project root', '.')
  .requiredOption('--platform <id>', 'Reference platform id')
  .option('--overwrite', 'Replace an existing published Bundle')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { bundlePublishCommand } = await import('../commands/bundle.js');
    await bundlePublishCommand(name, options);
  });

bundle
  .command('distribute <name>')
  .description('Install a ready Bundle across selected platforms')
  .option('--project <dir>', 'Project root', '.')
  .option('--platform <id>', 'Platform id', collect, [])
  .addOption(new Option('--scope <scope>', 'Install scope').choices(['global', 'project']))
  .option('--locale <locale>', 'Locale to distribute')
  .option('--overwrite', 'Overwrite existing target files')
  .option(
    '--skip-capability <capability>',
    'Explicitly skip an unsupported optional capability',
    collect,
    [],
  )
  .option('--confirm-executables', 'Confirm executable hook/script disclosures')
  .option('--preview', 'Preview platform writes without installing files')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const { bundleDistributeCommand } = await import('../commands/bundle.js');
    await bundleDistributeCommand(name, options);
  });

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classicGroupArgs(argv: readonly string[]): string[] | null {
  const args = argv.slice(2);
  const classicIndex = args[0] === '--' ? 1 : 0;
  return args[classicIndex] === 'classic' ? args.slice(classicIndex + 1) : null;
}

async function runCli(): Promise<void> {
  try {
    const classicArgs = classicGroupArgs(process.argv);
    if (classicArgs) {
      const { runClassicGroupFacade } = await import('../commands/classic.js');
      process.exitCode = await runClassicGroupFacade(classicArgs);
      return;
    }

    await program.parseAsync();
  } catch (error) {
    const cancelled = error instanceof Error && error.name === 'ExitPromptError';
    const message = cancelled ? 'Command cancelled by user' : errorMessage(error);
    if (process.argv.includes('--json')) {
      console.log(
        JSON.stringify(
          {
            status: cancelled ? 'cancelled' : 'failed',
            error: message,
          },
          null,
          2,
        ),
      );
      console.error(`${cancelled ? 'Cancelled' : 'Error'}: ${message}`);
    } else {
      console.error(`\n  ${cancelled ? 'Cancelled.' : `Error: ${message}`}\n`);
    }
    process.exitCode = cancelled ? 130 : 1;
  }
}

await runCli();
