import { classicGuardCommand } from './classic-guard.js';
import {
  createClassicCommandRunner,
  isClassicScriptEntry,
  runClassicScript,
} from './classic-script-entry.js';

export const runClassicCli = createClassicCommandRunner('guard', classicGuardCommand);

if (isClassicScriptEntry(import.meta.url)) {
  process.exitCode = await runClassicScript('guard', classicGuardCommand);
}
