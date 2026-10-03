import { classicHandoffCommand } from './classic-handoff-command.js';
import {
  createClassicCommandRunner,
  isClassicScriptEntry,
  runClassicScript,
} from './classic-script-entry.js';

export const runClassicCli = createClassicCommandRunner('handoff', classicHandoffCommand);

if (isClassicScriptEntry(import.meta.url)) {
  process.exitCode = await runClassicScript('handoff', classicHandoffCommand);
}
