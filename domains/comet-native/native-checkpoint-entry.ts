import { nativeCheckpointCommand } from './native-checkpoint-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('checkpoint', nativeCheckpointCommand);
