import { classicValidateCommand } from './classic-validate-command.js';
import { runClassicScript } from './classic-script-entry.js';

process.exitCode = await runClassicScript('validate', classicValidateCommand);
