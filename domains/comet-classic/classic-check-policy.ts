import { createHash } from 'node:crypto';
import {
  normalizeWorkflowRelativePath,
  normalizeWorkflowSnapshotPattern,
} from '../workflow-contract/project-config.js';
import { classicProjectTargetExists, readClassicProjectFile } from './classic-protected-path.js';
import { hasGlobCharacters } from './classic-check-manifest.js';

export const CHECK_POLICY_PATH = '.comet/check-policy.json';

export interface CheckIdentity {
  argv: string[];
  cwd: string;
}

export interface CheckPolicy {
  /** sha256 of the raw declaration file; empty without one. */
  digest: string;
  /**
   * v2 only: canonical digest of the command entry matching the identity, so
   * unrelated entries can change without invalidating this command's evidence.
   */
  entryDigest?: string;
  /**
   * v2 only: the matched entry's cwd. Guard accepts this command's evidence
   * recorded in that directory even when the guard runs elsewhere in the
   * project; without it evidence must come from the guard's invocation cwd.
   */
  declaredCwd?: string;
  /** Resolved declaration scope: v1 top-level fields, or the matched v2 entry. */
  files?: string[];
  /** Declared command outputs excluded from the input snapshot. */
  outputs?: string[];
  env?: string[];
  git: 'all' | 'none';
  taskCheckboxes: 'include' | 'ignore';
}

export interface CheckPolicyCommand {
  argv: string[];
  cwd: string;
  files?: string[];
  outputs?: string[];
  env?: string[];
  git: 'all' | 'none';
  taskCheckboxes: 'include' | 'ignore';
}

const COMMAND_KEYS = ['argv', 'cwd', 'files', 'outputs', 'env', 'git', 'taskCheckboxes'];

function parseCommandEntry(value: unknown, label: string): CheckPolicyCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !COMMAND_KEYS.includes(key)))
    throw new Error(`${label} has unknown fields`);
  if (
    !Array.isArray(record.argv) ||
    !record.argv.length ||
    !record.argv[0] ||
    record.argv.some((arg: unknown) => typeof arg !== 'string' || arg.includes('\0'))
  )
    throw new Error(`${label} argv must bind literal command arguments`);
  if (typeof record.cwd !== 'string' || !record.cwd)
    throw new Error(`${label} cwd must bind a project-relative directory`);
  const cwd = record.cwd === '.' ? '.' : normalizeWorkflowRelativePath(record.cwd, `${label} cwd`);
  const command: CheckPolicyCommand = {
    argv: [...record.argv],
    cwd,
    git: 'none',
    taskCheckboxes: 'ignore',
  };
  for (const key of ['files', 'outputs', 'env'] as const) {
    if (record[key] === undefined) continue;
    if (
      !Array.isArray(record[key]) ||
      record[key].some((item: unknown) => typeof item !== 'string' || !item)
    )
      throw new Error(`${label} ${key} must be an array of nonempty strings`);
  }
  if (record.files !== undefined) {
    command.files = [
      ...new Set(
        (record.files as string[]).map((file) =>
          hasGlobCharacters(file)
            ? normalizeWorkflowSnapshotPattern(file, `${label} file`)
            : normalizeWorkflowRelativePath(file, `${label} file`),
        ),
      ),
    ].sort((left, right) => left.localeCompare(right, 'en'));
  }
  if (record.outputs !== undefined) {
    command.outputs = [
      ...new Set(
        (record.outputs as string[]).map((file) =>
          hasGlobCharacters(file)
            ? normalizeWorkflowSnapshotPattern(file, `${label} output`)
            : normalizeWorkflowRelativePath(file, `${label} output`),
        ),
      ),
    ].sort((left, right) => left.localeCompare(right, 'en'));
  }
  if (record.env !== undefined) {
    if ((record.env as string[]).some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
      throw new Error(`${label} has an invalid environment variable name`);
    command.env = [...new Set(record.env as string[])].sort((left, right) =>
      left.localeCompare(right, 'en'),
    );
  }
  if (record.git !== undefined) {
    if (!['all', 'none'].includes(record.git as string))
      throw new Error(`${label} has an invalid git binding`);
    command.git = record.git as 'all' | 'none';
  }
  if (record.taskCheckboxes !== undefined) {
    if (!['include', 'ignore'].includes(record.taskCheckboxes as string))
      throw new Error(`${label} has an invalid taskCheckboxes mode`);
    command.taskCheckboxes = record.taskCheckboxes as 'include' | 'ignore';
  }
  return command;
}

function commandEntryDigest(command: CheckPolicyCommand): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        argv: command.argv,
        cwd: command.cwd,
        files: command.files ?? null,
        outputs: command.outputs ?? null,
        env: command.env ?? null,
        git: command.git,
        taskCheckboxes: command.taskCheckboxes,
      }),
    )
    .digest('hex');
}

function matchesIdentity(command: CheckPolicyCommand, identity: CheckIdentity): boolean {
  return (
    identity.cwd === command.cwd && JSON.stringify(identity.argv) === JSON.stringify(command.argv)
  );
}

export async function readCheckPolicy(
  root: string,
  identity?: CheckIdentity,
  legacy = false,
): Promise<CheckPolicy> {
  // Evidence recorded before per-file manifests existed resolves omitted
  // declarations with the original conservative defaults (bind HEAD, the
  // index and task checkboxes). Current evidence treats working-tree content
  // as the check input: HEAD/index, task checkbox marks and the environment
  // bind only when the policy declares them.
  const defaults: CheckPolicy = legacy
    ? { digest: '', git: 'all', taskCheckboxes: 'include' }
    : { digest: '', git: 'none', taskCheckboxes: 'ignore' };
  if (
    !(await classicProjectTargetExists(root, CHECK_POLICY_PATH, {
      label: 'Classic check policy',
      expected: 'file',
    }))
  )
    return defaults;
  const raw = await readClassicProjectFile(root, CHECK_POLICY_PATH, {
    label: 'Classic check policy',
  });
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value)) throw new Error('Expected a policy object');
    const digest = createHash('sha256').update(raw).digest('hex');
    if (value.version === 2) {
      if (Object.keys(value).some((key) => key !== 'version' && key !== 'commands'))
        throw new Error('version 2 allows only version and commands');
      if (!Array.isArray(value.commands) || !value.commands.length)
        throw new Error('commands must be a nonempty array');
      const commands: CheckPolicyCommand[] = value.commands.map((entry: unknown, index: number) =>
        parseCommandEntry(entry, `Classic check policy commands[${index}]`),
      );
      const identityKeys = new Set(
        commands.map((command) => JSON.stringify([command.argv, command.cwd])),
      );
      if (identityKeys.size !== commands.length)
        throw new Error('commands must not repeat an argv and cwd pair');
      if (!identity || !commands.some((command) => matchesIdentity(command, identity)))
        return { ...defaults, digest };
      const matched = commands.find((command) => matchesIdentity(command, identity))!;
      return {
        digest,
        entryDigest: commandEntryDigest(matched),
        declaredCwd: matched.cwd,
        files: matched.files,
        outputs: matched.outputs,
        env: matched.env,
        git: matched.git,
        taskCheckboxes: matched.taskCheckboxes,
      };
    }
    if (
      value.version !== 1 ||
      Object.keys(value).some(
        (key) =>
          !['version', 'argv', 'cwd', 'files', 'outputs', 'env', 'git', 'taskCheckboxes'].includes(
            key,
          ),
      )
    )
      throw new Error('Expected version 1 or 2 with known fields');
    if (
      !Array.isArray(value.argv) ||
      !value.argv.length ||
      !value.argv[0] ||
      value.argv.some((arg: unknown) => typeof arg !== 'string' || arg.includes('\0'))
    )
      throw new Error('argv must bind literal command arguments');
    if (typeof value.cwd !== 'string' || !value.cwd)
      throw new Error('cwd must bind a project-relative directory');
    const cwd =
      value.cwd === '.'
        ? '.'
        : normalizeWorkflowRelativePath(value.cwd, 'Classic check policy cwd');
    for (const key of ['files', 'outputs', 'env'] as const) {
      if (value[key] === undefined) continue;
      if (
        !Array.isArray(value[key]) ||
        value[key].some((item: unknown) => typeof item !== 'string' || !item)
      )
        throw new Error(`${key} must be an array of nonempty strings`);
    }
    const files = value.files?.map((file: string) => {
      if (/[?*[\]{}]/.test(file)) throw new Error('files accepts literal paths, not globs');
      return normalizeWorkflowRelativePath(file, 'Classic check policy file');
    });
    const outputs = value.outputs?.map((file: string) => {
      if (/[?*[\]{}]/u.test(file)) throw new Error('outputs accepts literal paths, not globs');
      return normalizeWorkflowRelativePath(file, 'Classic check policy output');
    });
    if (value.env?.some((name: string) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
      throw new Error('Invalid environment variable name');
    if (value.git !== undefined && !['all', 'none'].includes(value.git))
      throw new Error('Invalid git binding');
    if (value.taskCheckboxes !== undefined && !['include', 'ignore'].includes(value.taskCheckboxes))
      throw new Error('Invalid taskCheckboxes mode');
    if (
      !identity ||
      identity.cwd !== cwd ||
      JSON.stringify(identity.argv) !== JSON.stringify(value.argv)
    )
      return { ...defaults, digest };
    return {
      digest,
      files,
      outputs,
      env: value.env,
      git: value.git ?? defaults.git,
      taskCheckboxes: value.taskCheckboxes ?? defaults.taskCheckboxes,
    };
  } catch (error) {
    throw new Error(
      `Invalid Classic check policy: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
