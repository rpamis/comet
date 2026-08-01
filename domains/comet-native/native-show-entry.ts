import { nativeShowCommand } from './native-show-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('show', nativeShowCommand);
