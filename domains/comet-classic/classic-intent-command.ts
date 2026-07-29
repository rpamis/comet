import type {
  ClassicCommandHandler,
  ClassicCommandOptions,
  ClassicCommandResult,
} from './classic-cli.js';
import { CometIntentValidationError, resolveCometIntentRoute } from './classic-intent.js';
import { readClassicRecommendLightweightWorkflows } from './classic-project-config.js';

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
  return Buffer.concat(chunks).toString('utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function withConfiguredLightweightRecommendationSwitch(
  input: unknown,
  options: Pick<ClassicCommandOptions, 'invocationCwd' | 'projectRoot'> = {},
): Promise<unknown> {
  if (!isRecord(input) || !isRecord(input.context)) return input;
  const context = { ...input.context };
  if (
    context.recommend_lightweight_workflows !== undefined &&
    context.recommend_lightweight_workflows !== null
  ) {
    return input;
  }
  const configured = await readClassicRecommendLightweightWorkflows(options);
  return {
    ...input,
    context: {
      ...context,
      recommend_lightweight_workflows: configured.value,
    },
  };
}

export const classicIntentCommand: ClassicCommandHandler = async (args, options) => {
  const [subcommand, input] = args;
  if (subcommand !== 'route') return usage();

  const source = input === '--stdin' ? await readStdin() : input;
  if (!source) return usage();

  try {
    const resolution = resolveCometIntentRoute(
      await withConfiguredLightweightRecommendationSwitch(JSON.parse(source), options),
    );
    return result(0, `${JSON.stringify(resolution, null, 2)}\n`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return result(1, undefined, `Invalid JSON: ${error.message}`);
    }
    if (error instanceof CometIntentValidationError) {
      return result(1, undefined, error.message);
    }
    if (error instanceof Error) {
      return result(1, undefined, error.message);
    }
    throw error;
  }
};
