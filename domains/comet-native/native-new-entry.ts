import { nativeNewCommand } from './native-new-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('new', nativeNewCommand);
