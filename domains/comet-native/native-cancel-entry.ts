import { nativeCancelCommand } from './native-cancel-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('cancel', nativeCancelCommand);
