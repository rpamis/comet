import { Command, Option } from 'commander';
import { createRequire } from 'module';
import { initCommand } from '../commands/init.js';
import { statusCommand } from '../commands/status.js';
import { dashboardCommand } from '../commands/dashboard.js';
import { doctorCommand } from '../commands/doctor.js';
import { updateCommand } from '../commands/update.js';
import { uninstallCommand } from '../commands/uninstall.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

const program = new Command();

program
  .name('comet')
  .description('Agent Skill Harness Phase-Guarded Automation From Idea To Archive')
  .version(version);

program
  .command('init [path]')
  .description('Initialize Comet workflow in your project')
  .option('--yes', 'Auto-install missing components, skip existing')
  .option('--skip-existing', 'Never overwrite existing components')
  .option('--overwrite', 'Overwrite manifest-managed files')
  .option('--json', 'Output as JSON')
  .addOption(new Option('--scope <scope>', 'Install scope').choices(['global', 'project']))
  .addOption(new Option('--language <lang>', 'Language for skills').choices(['en', 'zh']))
  .action(async (targetPath = '.', options) => {
    try {
      await initCommand(targetPath, options);
    } catch (error) {
      if (error instanceof Error && error.name === 'ExitPromptError') {
        console.log('\n  Cancelled.\n');
        process.exit(0);
      }
      throw error;
    }
  });

program
  .command('status [path]')
  .description('Show active changes and workflow status')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    await statusCommand(targetPath, options);
  });

program
  .command('dashboard [path]')
  .description('Launch the local Comet dashboard in your browser')
  .option('--port <port>', 'HTTP port to bind (default 4321, auto-bumps if busy)', (value) => {
    if (!/^\d+$/u.test(value)) {
      throw new Error(`Invalid --port value: "${value}". Use an integer between 0 and 65535.`);
    }
    return Number.parseInt(value, 10);
  })
  .option('--no-open', "Don't open the dashboard URL in the browser automatically")
  .option('--json', 'Print a single dashboard snapshot to stdout and exit')
  .action(async (targetPath = '.', options) => {
    await dashboardCommand(targetPath, options);
  });

program
  .command('doctor [path]')
  .description('Diagnose Comet installation health')
  .option('--json', 'Output as JSON')
  .addOption(
    new Option('--scope <scope>', 'Install scope to diagnose').choices([
      'auto',
      'global',
      'project',
    ]),
  )
  .action(async (targetPath = '.', options) => {
    await doctorCommand(targetPath, options);
  });

program
  .command('update [path]')
  .description('Update comet skill files to latest version')
  .option('--json', 'Output as JSON')
  .addOption(new Option('--language <lang>', 'Language for skills').choices(['en', 'zh']))
  .addOption(new Option('--scope <scope>', 'Install scope').choices(['global', 'project']))
  .addOption(new Option('--skip-npm', 'Skip npm package self-update').hideHelp())
  .action(async (targetPath = '.', options) => {
    await updateCommand(targetPath, options);
  });

program
  .command('uninstall [path]')
  .description('Remove Comet skills, rules, and hooks from your project or global scope')
  .option('--json', 'Output as JSON')
  .addOption(new Option('--scope <scope>', 'Uninstall scope').choices(['global', 'project']))
  .option('--force', 'Skip confirmation prompts')
  .action(async (targetPath = '.', options) => {
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

program.parse();
