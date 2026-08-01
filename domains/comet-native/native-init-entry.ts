import { nativeInitCommand } from './native-init-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('init', nativeInitCommand);
