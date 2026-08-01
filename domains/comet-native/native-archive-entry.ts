import { nativeArchiveCommand } from './native-archive-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('archive', nativeArchiveCommand);
