import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { samePath } from '../../platform/paths/git-worktree.js';
import type { ClassicState } from './classic-state.js';
import { projectLanguageDefault } from './classic-state-command.js';

const units = {
  contextBytes: 'bytes',
  inputTokens: 'tokens',
  toolRoundTrips: 'calls',
  waitMs: 'ms',
} as const;
type MetricName = keyof typeof units;

const counts = {
  contextBytes: z.number().int().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
};
const attribution = z.strictObject(counts);
const scopeSchema = z.strictObject({
  projectRoot: z.string().refine(path.isAbsolute, 'Expected an absolute projectRoot'),
  change: z.string().min(1),
  phase: z.enum(['open', 'design', 'build', 'verify', 'archive']),
});
const traceSchema = z.strictObject({
  schema: z.literal('comet.classic.context-trace.v1'),
  scope: scopeSchema,
  source: z.string().trim().min(1),
  metrics: z
    .strictObject({
      ...counts,
      toolRoundTrips: z.number().int().nonnegative().optional(),
      waitMs: z.number().nonnegative().optional(),
    })
    .optional(),
  categories: z
    .strictObject({
      rule: attribution.optional(),
      stage: attribution.optional(),
      cli: attribution.optional(),
    })
    .optional(),
});

type Scope = z.infer<typeof scopeSchema>;
type Trace = z.infer<typeof traceSchema>;

const estimate = (value: number, source: string) => ({
  kind: 'estimated' as const,
  value,
  unit: units.contextBytes,
  source,
});

function observed(trace: Trace | null, name: MetricName, value: number | undefined) {
  return trace && value !== undefined
    ? { kind: 'observed' as const, value, unit: units[name], source: trace.source }
    : null;
}

async function readTrace(file: string, scope: Scope): Promise<Trace> {
  const trace = traceSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  if (
    trace.scope.change !== scope.change ||
    trace.scope.phase !== scope.phase ||
    !samePath(trace.scope.projectRoot, scope.projectRoot)
  ) {
    throw new Error('Trace scope must match the report project root, change, and current phase.');
  }
  return trace;
}

async function statBytes(file: string): Promise<number | null> {
  try {
    const stats = await fs.stat(file);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

async function bundledStageFiles(assetsRoot: string, skill: string): Promise<string[]> {
  const entry = `${skill}/SKILL.md`;
  let markdown: string;
  try {
    markdown = await fs.readFile(path.join(assetsRoot, entry), 'utf8');
  } catch {
    return [entry];
  }
  const references = [
    ...markdown.matchAll(/(?:\]\(|`)((?:[.\w-]+\/)*reference\/[\w.-]+\.md)(?=[#)`])/gu),
  ].flatMap(([, target]) => {
    const relative = path.posix.normalize(
      target.startsWith('comet-') || target.startsWith('comet/')
        ? target
        : path.posix.join(skill, target),
    );
    return relative.startsWith('../') ? [] : [relative];
  });
  return [...new Set([entry, ...references])];
}

async function bundledCost(assetsRoot: string, references: readonly string[]) {
  const sizes = await Promise.all(references.map((ref) => statBytes(path.join(assetsRoot, ref))));
  const missing = references.filter((_, index) => sizes[index] === null);
  const bytes = missing.length
    ? null
    : sizes.reduce<number>((total, size) => total + (size ?? 0), 0);
  return {
    estimate: bytes === null ? null : estimate(bytes, 'bundled-assets'),
    references,
    missing,
  };
}

function attributed(trace: Trace | null, category: 'rule' | 'stage' | 'cli') {
  const values = trace?.categories?.[category];
  const contextBytes = observed(trace, 'contextBytes', values?.contextBytes);
  const inputTokens = observed(trace, 'inputTokens', values?.inputTokens);
  return {
    ...(contextBytes ? { contextBytes } : {}),
    ...(inputTokens ? { inputTokens } : {}),
  };
}

export async function classicContextCost(options: {
  assetsRoot: string;
  projectRoot: string;
  change: string;
  phase: string;
  configuration?: Pick<ClassicState, 'language' | 'workflow' | 'archived'>;
  cliBytes: number;
  traceFile?: string;
}) {
  const scope = scopeSchema.parse({
    projectRoot: options.projectRoot,
    change: options.change,
    phase: options.phase,
  });
  const { configuration } = options;
  const language = configuration?.language ?? (await projectLanguageDefault(scope.projectRoot));
  const root = path.join(options.assetsRoot, language === 'zh-CN' ? 'skills-zh' : 'skills');
  const ruleRefs = [`comet/rules/comet-workflow-guard${language === 'en' ? '.en' : ''}.md`];
  const skill =
    scope.phase === 'build' &&
    (configuration?.workflow === 'tweak' || configuration?.workflow === 'hotfix')
      ? `comet-${configuration.workflow}`
      : `comet-${scope.phase}`;
  const [rule, stage, trace] = await Promise.all([
    bundledCost(path.join(options.assetsRoot, 'skills'), ruleRefs),
    configuration?.archived
      ? Promise.resolve({ estimate: null, references: [], missing: [] })
      : bundledStageFiles(root, skill).then((references) => bundledCost(root, references)),
    options.traceFile ? readTrace(options.traceFile, scope) : Promise.resolve(null),
  ]);
  const cli = estimate(options.cliBytes, 'classic-state-next');
  const overallEstimate =
    rule.estimate && stage.estimate
      ? estimate(
          rule.estimate.value + stage.estimate.value + cli.value,
          'bundled-assets-and-classic-state-next',
        )
      : null;
  return {
    schema: 'comet.classic.context-cost.v1' as const,
    scope,
    language,
    trace: trace ? { source: trace.source, status: 'provided' } : { status: 'not-provided' },
    metrics: {
      contextBytes:
        observed(trace, 'contextBytes', trace?.metrics?.contextBytes) ?? overallEstimate,
      inputTokens: observed(trace, 'inputTokens', trace?.metrics?.inputTokens),
      toolRoundTrips: observed(trace, 'toolRoundTrips', trace?.metrics?.toolRoundTrips),
      waitMs: observed(trace, 'waitMs', trace?.metrics?.waitMs),
    },
    categories: {
      rule: { ...rule, observed: attributed(trace, 'rule') },
      stage: { ...stage, observed: attributed(trace, 'stage') },
      cli: { estimate: cli, observed: attributed(trace, 'cli') },
    },
  };
}
