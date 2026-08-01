import { classicResumeProbeCommand } from './classic-resume-probe-command.js';
import { runClassicScript } from './classic-script-entry.js';

process.exitCode = await runClassicScript('resume-probe', classicResumeProbeCommand);
