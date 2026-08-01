import { classicHandoffCommand } from './classic-handoff.js';
import { runClassicScript } from './classic-script-entry.js';

process.exitCode = await runClassicScript('handoff', classicHandoffCommand);
