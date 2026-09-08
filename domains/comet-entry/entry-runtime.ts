import path from 'path';

import {
  formatCometWorkflowResolution,
  resolveCometWorkflowResolution,
} from './workflow-resolution.js';

const USAGE = 'Usage: comet workflow resolve [path] [--json]';

interface EntryRuntimeIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

interface ParsedEntryRuntimeArgs {
  help: boolean;
  json: boolean;
  targetPath: string;
}

function parseEntryRuntimeArgs(args: readonly string[]): ParsedEntryRuntimeArgs {
  let help = false;
  let json = false;
  let targetPath: string | null = null;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (targetPath !== null) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    targetPath = arg;
  }

  return { help, json, targetPath: path.resolve(targetPath ?? '.') };
}

export async function runCometEntryRuntime(
  args: readonly string[],
  io: EntryRuntimeIo = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  let parsed: ParsedEntryRuntimeArgs;
  try {
    parsed = parseEntryRuntimeArgs(args);
  } catch (error) {
    const message = `${error instanceof Error ? error.message : String(error)}\n${USAGE}`;
    if (args.includes('--json')) {
      io.stdout(`${JSON.stringify({ status: 'failed', exitCode: 64, error: message })}\n`);
    } else io.stderr(`${message}\n`);
    return 64;
  }

  if (parsed.help) {
    io.stdout(`${USAGE}\n`);
    return 0;
  }

  try {
    const resolution = await resolveCometWorkflowResolution(parsed.targetPath);
    io.stdout(
      parsed.json
        ? `${JSON.stringify(resolution, null, 2)}\n`
        : `${formatCometWorkflowResolution(resolution)}\n`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (parsed.json) {
      io.stdout(`${JSON.stringify({ status: 'failed', exitCode: 65, error: message })}\n`);
    } else io.stderr(`${message}\n`);
    return 65;
  }
}
