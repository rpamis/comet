import { nativeSelectCommand } from './native-select-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('select', nativeSelectCommand);
