import { nativeSpecCommand } from './native-spec-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('spec', nativeSpecCommand);
