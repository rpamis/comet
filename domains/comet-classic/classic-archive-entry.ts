import { classicArchiveCommand } from './classic-archive.js';
import {
  createClassicCommandRunner,
  isClassicScriptEntry,
  runClassicScript,
} from './classic-script-entry.js';

export const runClassicCli = createClassicCommandRunner('archive', classicArchiveCommand);

if (isClassicScriptEntry(import.meta.url)) {
  process.exitCode = await runClassicScript('archive', classicArchiveCommand);
}
