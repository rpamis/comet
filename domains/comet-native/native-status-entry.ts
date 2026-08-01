import { nativeStatusCommand } from './native-status-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('status', nativeStatusCommand);
