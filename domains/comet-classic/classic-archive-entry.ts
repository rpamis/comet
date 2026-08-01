import { classicArchiveCommand } from './classic-archive.js';
import { runClassicScript } from './classic-script-entry.js';

process.exitCode = await runClassicScript('archive', classicArchiveCommand);
