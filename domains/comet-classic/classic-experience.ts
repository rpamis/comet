import { resolveClassicChangeDirectory } from './classic-paths.js';
import { readClassicState } from './classic-store.js';

export interface ClassicLifecycleEvidence {
  changedPaths: string[];
  artifactRefs: string[];
}

export function parseClassicLifecycleEvidence(
  stdout: string | undefined,
): ClassicLifecycleEvidence {
  if (!stdout?.trim()) return { changedPaths: [], artifactRefs: [] };
  try {
    const value = JSON.parse(stdout) as { data?: Record<string, unknown> };
    const data = value.data;
    if (!data || typeof data !== 'object') return { changedPaths: [], artifactRefs: [] };
    const list = (candidate: unknown): string[] =>
      Array.isArray(candidate)
        ? candidate.filter((entry): entry is string => typeof entry === 'string').slice(0, 24)
        : [];
    return {
      changedPaths: list(data.changedPaths),
      artifactRefs: list(data.artifactRefs ?? data.artifacts),
    };
  } catch {
    return { changedPaths: [], artifactRefs: [] };
  }
}

export function classicChangeId(args: readonly string[], command: string): string {
  const values = args.filter((value) => !value.startsWith('--'));
  if (command === 'state' && values[0] !== undefined) return values[1] ?? values[0];
  return values[0] ?? command;
}

export async function inferClassicWorkflow(
  args: readonly string[],
  projectRoot: string,
  command: string,
): Promise<string> {
  const explicit = args.find(
    (value) => value === 'full' || value === 'hotfix' || value === 'tweak',
  );
  if (explicit) return explicit;
  const changeId = classicChangeId(args, command);
  try {
    const { directory } = await resolveClassicChangeDirectory(changeId, projectRoot);
    const projection = await readClassicState(directory, { migrate: false });
    const workflow = projection.classic?.workflow;
    if (workflow) return workflow;
  } catch {
    // A command that does not target an existing change falls back to the host hint.
  }
  return process.env.COMET_WORKFLOW ?? 'full';
}
