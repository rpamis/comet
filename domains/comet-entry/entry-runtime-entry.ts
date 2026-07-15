import { runCometEntryRuntime } from './entry-runtime.js';

process.exitCode = await runCometEntryRuntime(process.argv.slice(2));
