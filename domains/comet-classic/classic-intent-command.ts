import { stripUtf8Bom } from '../../platform/fs/strip-bom.js';
import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import { CometIntentValidationError, resolveCometIntentRoute } from './classic-intent.js';

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
    'Usage: comet-intent.mjs route <frame-json>\nUsage: comet-intent.mjs route --stdin',
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return stripUtf8Bom(Buffer.concat(chunks).toString('utf8'));
}

export const classicIntentCommand: ClassicCommandHandler = async (args, _options) => {
  const [subcommand, input] = args;
  if (subcommand !== 'route') return usage();

  const source = input === '--stdin' ? await readStdin() : input;
  if (!source) return usage();

  try {
    const resolution = resolveCometIntentRoute(JSON.parse(source));
    return result(0, `${JSON.stringify(resolution, null, 2)}\n`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return result(1, undefined, `Invalid JSON: ${error.message}`);
    }
    if (error instanceof CometIntentValidationError) {
      return result(1, undefined, error.message);
    }
    throw error;
  }
};
