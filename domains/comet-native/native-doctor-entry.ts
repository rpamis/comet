import { nativeDoctorCommand } from './native-doctor-command.js';
import { runNativeScript } from './native-script-entry.js';

process.exitCode = await runNativeScript('doctor', nativeDoctorCommand);
