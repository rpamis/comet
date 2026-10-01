import { nativeTransferCommand } from './native-transfer-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('transfer', nativeTransferCommand);
