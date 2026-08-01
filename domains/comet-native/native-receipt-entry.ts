import { nativeReceiptCommand } from './native-receipt-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('receipt', nativeReceiptCommand);
