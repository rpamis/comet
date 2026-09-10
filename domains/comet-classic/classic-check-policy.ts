import { createHash } from 'node:crypto';
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';
import { classicProjectTargetExists, readClassicProjectFile } from './classic-protected-path.js';

export const CHECK_POLICY_PATH = '.comet/check-policy.json';

export interface CheckIdentity {
  argv: string[];
  cwd: string;
}

export interface CheckPolicy {
  digest: string;
  files?: string[];
  env?: string[];
  git: 'all' | 'none';
  taskCheckboxes: 'include' | 'ignore';
}

export async function readCheckPolicy(
  root: string,
  identity?: CheckIdentity,
): Promise<CheckPolicy> {
  const defaults: CheckPolicy = { digest: '', git: 'all', taskCheckboxes: 'include' };
  if (
    !(await classicProjectTargetExists(root, CHECK_POLICY_PATH, {
      label: 'Classic check policy',
      expected: 'file',
    }))
  )
    return defaults;
  const raw = await readClassicProjectFile(root, CHECK_POLICY_PATH, {
    label: 'Classic check policy',
    maxBytes: 64 * 1024,
  });
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      Array.isArray(value) ||
      value.version !== 1 ||
      Object.keys(value).some(
        (key) => !['version', 'argv', 'cwd', 'files', 'env', 'git', 'taskCheckboxes'].includes(key),
      )
    )
      throw new Error('Expected version 1 and known fields');
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
    for (const key of ['files', 'env'] as const) {
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
    if (value.env?.some((name: string) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
      throw new Error('Invalid environment variable name');
    if (value.git !== undefined && !['all', 'none'].includes(value.git))
      throw new Error('Invalid git binding');
    if (value.taskCheckboxes !== undefined && !['include', 'ignore'].includes(value.taskCheckboxes))
      throw new Error('Invalid taskCheckboxes mode');
    const digest = createHash('sha256').update(raw).digest('hex');
    if (
      !identity ||
      identity.cwd !== cwd ||
      JSON.stringify(identity.argv) !== JSON.stringify(value.argv)
    )
      return { ...defaults, digest };
    return {
      digest,
      files,
      env: value.env,
      git: value.git ?? defaults.git,
      taskCheckboxes: value.taskCheckboxes ?? defaults.taskCheckboxes,
    };
  } catch (error) {
    throw new Error('Invalid Classic check policy', { cause: error });
  }
}
