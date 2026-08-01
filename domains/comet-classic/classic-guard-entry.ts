import { classicGuardCommand } from './classic-guard.js';
import { runClassicScript } from './classic-script-entry.js';

process.exitCode = await runClassicScript('guard', classicGuardCommand);
