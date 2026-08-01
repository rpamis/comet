import { nativeNextCommand } from './native-next-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('next', nativeNextCommand);
