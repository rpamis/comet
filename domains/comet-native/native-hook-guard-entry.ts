import { nativeHookGuardCommand } from './native-hook-guard-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('hook-guard', nativeHookGuardCommand);
