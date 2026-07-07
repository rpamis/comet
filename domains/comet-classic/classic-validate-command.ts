import { promises as fs } from 'fs';
import path from 'path';
import { isMap, parseDocument } from 'yaml';
import type { ClassicCommandHandler } from './classic-cli.js';
import { openSpecChangeNameError, resolveClassicChangeDirectory } from './classic-paths.js';
import { CLASSIC_WIRE_KEYS, RUN_WIRE_KEYS } from './classic-state.js';

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';
const REQUIRED = [
  'workflow',
  'phase',
  'design_doc',
  'plan',
  'build_mode',
  'isolation',
  'verify_mode',
  'verify_result',
  'verified_at',
  'archived',
] as const;
const ENUMS: Record<string, readonly string[]> = {
  workflow: ['full', 'hotfix', 'tweak'],
  language: ['en', 'zh-CN'],
  phase: ['open', 'design', 'build', 'verify', 'archive'],
  context_compression: ['off', 'beta'],
  build_mode: ['subagent-driven-development', 'executing-plans', 'direct'],
  build_pause: ['plan-ready'],
  subagent_dispatch: ['confirmed'],
  tdd_mode: ['tdd', 'direct'],
  review_mode: ['off', 'standard', 'thorough'],
  isolation: ['branch', 'worktree'],
  verify_mode: ['light', 'full'],
  auto_transition: ['true', 'false'],
  verify_result: ['pending', 'pass', 'fail'],
  branch_status: ['pending', 'handled'],
  archive_confirmation: ['pending', 'confirmed'],
  archived: ['true', 'false'],
  direct_override: ['true', 'false'],
  classic_profile: ['full', 'hotfix', 'tweak'],
  classic_migration: ['1'],
};
const KNOWN_KEYS = new Set<string>([
  ...CLASSIC_WIRE_KEYS,
  ...RUN_WIRE_KEYS, // just 'run_id'
  'classic_profile',
  'classic_migration',
]);

function color(code: string, message: string): string {
  return `${code}${message}${RESET}`;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export const classicValidateCommand: ClassicCommandHandler = async (args) => {
  const name = args[0];
  const nameError = openSpecChangeNameError(name);
  if (nameError) {
    return {
      exitCode: 1,
      stderr: color(RED, `ERROR: ${nameError}`),
    };
  }

  const { directory, label } = await resolveClassicChangeDirectory(name);
  const yamlFile = path.join(directory, '.comet.yaml');
  const lines = [`[VALIDATE] ${label}/.comet.yaml`];
  let errors = 0;
  let warnings = 0;
  const fail = (message: string) => {
    errors += 1;
    lines.push(color(RED, `  FAIL: ${message}`));
  };
  const warn = (message: string) => {
    warnings += 1;
    lines.push(color(YELLOW, `  WARN: ${message}`));
  };

  let source: string;
  try {
    source = await fs.readFile(yamlFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail('.comet.yaml does not exist');
      lines.push('', color(RED, `${errors} error(s), ${warnings} warning(s) — validation FAILED`));
      return { exitCode: 1, stderr: lines.join('\n') };
    }
    throw error;
  }

  const document = parseDocument(source);
  if (document.errors.length > 0 || !isMap(document.contents)) {
    for (const error of document.errors) fail(error.message);
    if (!isMap(document.contents)) fail('document root must be a mapping');
    lines.push('', color(RED, `${errors} error(s), ${warnings} warning(s) — validation FAILED`));
    return { exitCode: 1, stderr: lines.join('\n') };
  }
  const record = document.toJS() as Record<string, unknown>;

  for (const field of REQUIRED) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      fail(`missing required field '${field}'`);
    }
  }
  for (const [field, values] of Object.entries(ENUMS)) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    const value = text(record[field]);
    if (!value) {
      if (field === 'auto_transition') {
        fail(`${field}='' is not valid. Expected: ${values.join(' ')}`);
      }
      continue;
    }
    if (!values.includes(value)) {
      fail(`${field}='${value}' is not valid. Expected: ${values.join(' ')}`);
    }
  }
  for (const field of ['design_doc', 'plan', 'handoff_context'] as const) {
    const value = text(record[field]);
    if (value && !(await exists(path.resolve(value)))) {
      fail(`${field}='${value}' does not exist on disk`);
    }
  }
  for (const field of ['handoff_hash'] as const) {
    const value = text(record[field]);
    if (value && !/^[a-f0-9]{64}$/u.test(value)) {
      fail(`${field}='${value}' is not a sha256 hex digest`);
    }
  }
  for (const field of Object.keys(record)) {
    if (!KNOWN_KEYS.has(field)) warn(`unknown field '${field}' found`);
  }

  lines.push('');
  if (errors > 0) {
    lines.push(color(RED, `${errors} error(s), ${warnings} warning(s) — validation FAILED`));
    return { exitCode: 1, stderr: lines.join('\n') };
  }
  lines.push(color(GREEN, `0 errors, ${warnings} warning(s) — validation PASSED`));
  return { exitCode: 0, stderr: lines.join('\n') };
};
