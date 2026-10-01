import { classicHandoffCommand } from './classic-handoff-command.js';
import { runClassicScript } from './classic-script-entry.js';

process.exitCode = await runClassicScript('handoff', classicHandoffCommand);
