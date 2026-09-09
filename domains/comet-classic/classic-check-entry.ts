import { classicCheckCommand } from './classic-check-command.js';
import { runClassicScript } from './classic-script-entry.js';

process.exitCode = await runClassicScript('check', classicCheckCommand);
