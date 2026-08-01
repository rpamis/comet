import { nativeEvidenceCommand } from './native-evidence-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('evidence', nativeEvidenceCommand);
