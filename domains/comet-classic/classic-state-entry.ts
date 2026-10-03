import { classicStateCommand } from './classic-state-command.js';
import {
  createClassicCommandRunner,
  isClassicScriptEntry,
  runClassicScript,
} from './classic-script-entry.js';

export const runClassicCli = createClassicCommandRunner('state', classicStateCommand);

if (isClassicScriptEntry(import.meta.url)) {
  process.exitCode = await runClassicScript('state', classicStateCommand);
}
