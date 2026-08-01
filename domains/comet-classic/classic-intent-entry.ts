import { classicIntentCommand } from './classic-intent-command.js';
import { runClassicScript } from './classic-script-entry.js';

process.exitCode = await runClassicScript('intent', classicIntentCommand);
