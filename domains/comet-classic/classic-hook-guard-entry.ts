import { classicHookGuardCommand } from './classic-hook-guard.js';
import { runClassicScript } from './classic-script-entry.js';

process.exitCode = await runClassicScript('hook-guard', classicHookGuardCommand);
