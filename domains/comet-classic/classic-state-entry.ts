import { classicStateCommand } from './classic-state-command.js';
import { runClassicScript } from './classic-script-entry.js';

process.exitCode = await runClassicScript('state', classicStateCommand);
