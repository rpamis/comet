import { classicCheckCommand } from './classic-check-command.js';
import {
  createClassicCommandRunner,
  isClassicScriptEntry,
  runClassicScript,
} from './classic-script-entry.js';

export const runClassicCli = createClassicCommandRunner('check', classicCheckCommand);

if (isClassicScriptEntry(import.meta.url)) {
  process.exitCode = await runClassicScript('check', classicCheckCommand);
}
