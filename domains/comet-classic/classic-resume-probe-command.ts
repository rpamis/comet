import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import {
  COMET_RESUME_PROBE_SCHEMA_VERSION,
  resolveCometResumeProbe,
} from './classic-resume-probe.js';
import { classicCommandProjectRoot, withClassicCommandContext } from './classic-command-context.js';

function result(exitCode: number, stdout?: string, stderr?: string): ClassicCommandResult {
  return {
    exitCode,
    ...(stdout === undefined ? {} : { stdout }),
    ...(stderr === undefined ? {} : { stderr }),
  };
}

function usage(): ClassicCommandResult {
  return result(
    64,
    undefined,
    'Usage: comet-resume-probe.mjs probe <input-json>\nUsage: comet-resume-probe.mjs probe --stdin',
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function rawUtteranceInput(utterance: string) {
  return {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    utterance,
    locale: 'unknown',
    agent_context: {
      non_trivial_work: true,
      already_in_comet_flow: false,
    },
  };
}

function parseStdinInput(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return rawUtteranceInput(source);
  }
}

export const classicResumeProbeCommand: ClassicCommandHandler = async (args, options) =>
  withClassicCommandContext(options, async () => {
    const [subcommand, input] = args;
    if (subcommand !== 'probe') return usage();

    const fromStdin = input === '--stdin';
    const source = fromStdin ? await readStdin() : input;
    if (!source) return usage();

    try {
      const parsedInput = fromStdin ? parseStdinInput(source) : JSON.parse(source);
      const resolution = await resolveCometResumeProbe(classicCommandProjectRoot(), parsedInput);
      return result(0, `${JSON.stringify(resolution, null, 2)}\n`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return result(1, undefined, `Invalid JSON: ${error.message}`);
      }
      return result(1, undefined, error instanceof Error ? error.message : String(error));
    }
  });
