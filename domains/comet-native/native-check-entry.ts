import { nativeCheckCommand } from './native-check-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('check', nativeCheckCommand);
