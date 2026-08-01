import { nativeRootCommand } from './native-root-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('root', nativeRootCommand);
